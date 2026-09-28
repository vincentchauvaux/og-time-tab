import { DEFAULT_CONFIG, loadConfig } from "./lib/config.js";
import { getGroupKey } from "./lib/grouping.js";
import {
  appendEntry,
  computeEraseCutoff,
  dateKey,
  eraseEntriesSince,
  getLiveState,
  makeEntryId,
  setLiveState
} from "./lib/storage.js";
import {
  loadTodoUi,
  saveTodoUi,
  loadTodos,
  saveTodos,
  setTodoTimerStatus,
  todoGroupKey,
  todoUrl
} from "./lib/todos.js";

const CONTENT_SCRIPT_FILES = ["content.js", "todo-overlay.js"];

function isHttpUrl(url) {
  return Boolean(url && /^https?:/i.test(url));
}

/** Ferme d’éventuelles anciennes fenêtres OS To-do (v1.0.93). */
async function closeLegacyTodoWindows() {
  try {
    const wins = await chrome.windows.getAll({ populate: true });
    const panelUrl = chrome.runtime.getURL("todo-panel.html");
    for (const win of wins) {
      if (win.type !== "popup" || win.id == null) continue;
      const hit = (win.tabs || []).some(
        (t) => typeof t.url === "string" && (t.url.startsWith(panelUrl) || t.url.includes("todo-panel"))
      );
      if (hit) {
        try {
          await chrome.windows.remove(win.id);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Réinjecte todo-overlay.js : l’IIFE resync si déjà vivant, sinon réinitialise
 * (flag orphelin après reload / contexte invalidé).
 * Pas de tabs.sendMessage ici — évite « No SW » / Receiving end does not exist.
 */
async function injectTodoOverlayOnTab(tabId) {
  if (tabId == null) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.discarded || !isHttpUrl(tab.url)) return false;
  } catch {
    return false;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["todo-overlay.js"]
    });
    return true;
  } catch {
    return false;
  }
}

/** Injecte / réveille l’overlay To-do (fenêtre hôte uniquement si ouvert). */
async function ensureTodoOverlayOnTabs() {
  let ui = {};
  try {
    ui = await loadTodoUi();
  } catch {
    /* ignore */
  }
  /** @type {chrome.tabs.QueryInfo} */
  const query = { discarded: false };
  // Ouvert → seulement la fenêtre qui a lancé le To-do ; fermé → toutes (pour masquer)
  if (ui.open && Number.isFinite(ui.hostWindowId)) {
    query.windowId = ui.hostWindowId;
  }
  let tabList = [];
  try {
    tabList = await chrome.tabs.query(query);
  } catch {
    return;
  }
  const targets = tabList.filter((tab) => tab.id != null && isHttpUrl(tab.url));
  for (const tab of targets) {
    await injectTodoOverlayOnTab(tab.id);
  }
  // Si ouvert, masquer aussi les overlays des autres fenêtres via storage (déjà fait)
  // + réinjecter les autres onglets http pour qu’ils appliquent hostWindowId
  if (ui.open && Number.isFinite(ui.hostWindowId)) {
    let others = [];
    try {
      others = await chrome.tabs.query({ discarded: false });
    } catch {
      return;
    }
    for (const tab of others) {
      if (tab.id == null || !isHttpUrl(tab.url)) continue;
      if (tab.windowId === ui.hostWindowId) continue;
      await injectTodoOverlayOnTab(tab.id);
    }
  }
}

async function resolveHostWindowId() {
  try {
    const win = await chrome.windows.getLastFocused({ populate: false });
    if (win?.id != null) return win.id;
  } catch {
    /* ignore */
  }
  try {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active?.windowId != null) return active.windowId;
  } catch {
    /* ignore */
  }
  return null;
}

async function openTodoOverlay() {
  await closeLegacyTodoWindows();
  const hostWindowId = await resolveHostWindowId();
  await saveTodoUi({
    open: true,
    collapsed: false,
    windowId: null,
    hostWindowId,
    openToken: Date.now()
  });

  try {
    const q =
      hostWindowId != null
        ? { active: true, windowId: hostWindowId }
        : { active: true, lastFocusedWindow: true };
    const [active] = await chrome.tabs.query(q);
    if (active?.id != null && isHttpUrl(active.url)) {
      await injectTodoOverlayOnTab(active.id);
    }
  } catch {
    /* ignore */
  }

  await ensureTodoOverlayOnTabs();
}

async function closeTodoOverlay() {
  await saveTodoUi({
    open: false,
    collapsed: false,
    hostWindowId: null,
    openToken: Date.now()
  });
  await ensureTodoOverlayOnTabs();
}

async function toggleTodoOverlay() {
  const ui = await loadTodoUi();
  if (ui.open) await closeTodoOverlay();
  else await openTodoOverlay();
}

/** Si le To-do est ouvert, le sync sur l’onglet activé — uniquement dans la fenêtre hôte. */
async function syncTodoOverlayForTab(tabId) {
  try {
    const ui = await loadTodoUi();
    if (!ui.open) return;
    const tab = await chrome.tabs.get(tabId);
    if (Number.isFinite(ui.hostWindowId) && tab.windowId !== ui.hostWindowId) {
      // Autre fenêtre : s’assurer que l’overlay y reste masqué
      await injectTodoOverlayOnTab(tabId);
      return;
    }
    await injectTodoOverlayOnTab(tabId);
  } catch {
    /* ignore */
  }
}

let syncTodoDebounceTimer = null;
/** @param {number} tabId */
function scheduleSyncTodoOverlayForTab(tabId) {
  if (syncTodoDebounceTimer != null) {
    clearTimeout(syncTodoDebounceTimer);
  }
  syncTodoDebounceTimer = setTimeout(() => {
    syncTodoDebounceTimer = null;
    void syncTodoOverlayForTab(tabId);
  }, 80);
}

/** @type {Map<string, import('./lib/todos.js').TodoTimerLive>} */
const taskTimers = new Map();

function snapshotTaskTimers() {
  return Array.from(taskTimers.values()).map((t) => ({ ...t }));
}

async function restoreTaskTimersFromLive() {
  try {
    const live = await getLiveState();
    for (const t of live.tasks || []) {
      if (!t?.todoId || taskTimers.has(t.todoId)) continue;
      taskTimers.set(t.todoId, {
        todoId: t.todoId,
        text: t.text || "Tâche",
        status: t.status === "paused" ? "paused" : "playing",
        segmentStart: t.segmentStart || Date.now(),
        openedAt: t.openedAt || t.segmentStart || Date.now(),
        activeSeconds: t.activeSeconds || 0,
        openSeconds: t.openSeconds || 0,
        lastTickAt: Date.now()
      });
    }
  } catch {
    /* ignore */
  }
}

async function flushTodoTimer(todoId, reason = "stop") {
  const state = taskTimers.get(todoId);
  if (!state) return;
  const now = Date.now();
  if (state.openSeconds > 0 || state.activeSeconds > 0) {
    await appendEntry({
      id: makeEntryId(),
      url: todoUrl(todoId),
      title: state.text,
      groupKey: todoGroupKey(todoId),
      start: state.segmentStart,
      end: now,
      activeSeconds: state.activeSeconds,
      openSeconds: state.openSeconds,
      date: dateKey(state.segmentStart),
      tabId: 0,
      reason
    });
  }
  taskTimers.delete(todoId);
  await setTodoTimerStatus(todoId, "idle");
}

/**
 * Clôture le segment play en cours (entrée calendrier) sans retirer la tâche du timer.
 * Sert au pause : coupe le bloc pour ne garder que les vrais moments actifs.
 */
async function commitTodoTimerSegment(todoId, reason = "pause") {
  const state = taskTimers.get(todoId);
  if (!state) return;
  const now = Date.now();
  if (state.openSeconds > 0 || state.activeSeconds > 0) {
    await appendEntry({
      id: makeEntryId(),
      url: todoUrl(todoId),
      title: state.text,
      groupKey: todoGroupKey(todoId),
      start: state.segmentStart,
      end: now,
      activeSeconds: state.activeSeconds,
      openSeconds: state.openSeconds,
      date: dateKey(state.segmentStart),
      tabId: 0,
      reason
    });
  }
  state.segmentStart = now;
  state.activeSeconds = 0;
  state.openSeconds = 0;
  state.lastTickAt = now;
}

async function playTodoTimer(todoId) {
  const todos = await loadTodos();
  const todo = todos.find((t) => t.id === todoId);
  if (!todo) return { ok: false, error: "not_found" };

  const now = Date.now();
  // Une seule tâche en play : les autres sont mises en pause (segment coupé)
  for (const [id, state] of taskTimers) {
    if (id !== todoId && state.status === "playing") {
      await commitTodoTimerSegment(id, "pause");
      state.status = "paused";
      await setTodoTimerStatus(id, "paused");
    }
  }

  const existing = taskTimers.get(todoId);
  if (existing) {
    // Reprise après pause → nouveau segment (bloc séparé sur le calendrier)
    if (existing.status === "paused") {
      existing.segmentStart = now;
      existing.activeSeconds = 0;
      existing.openSeconds = 0;
    }
    existing.status = "playing";
    existing.text = todo.text;
    existing.lastTickAt = now;
  } else {
    taskTimers.set(todoId, {
      todoId,
      text: todo.text,
      status: "playing",
      segmentStart: now,
      openedAt: now,
      activeSeconds: 0,
      openSeconds: 0,
      lastTickAt: now
    });
  }
  await setTodoTimerStatus(todoId, "playing");
  await publishLive();
  return { ok: true, status: "playing" };
}

async function pauseTodoTimer(todoId) {
  const state = taskTimers.get(todoId);
  if (!state) return { ok: false, error: "not_running" };
  if (state.status === "playing") {
    await commitTodoTimerSegment(todoId, "pause");
  }
  state.status = "paused";
  state.lastTickAt = Date.now();
  await setTodoTimerStatus(todoId, "paused");
  await publishLive();
  return { ok: true, status: "paused" };
}

async function stopTodoTimer(todoId) {
  if (!taskTimers.has(todoId)) {
    await setTodoTimerStatus(todoId, "idle");
    return { ok: true, status: "idle" };
  }
  await flushTodoTimer(todoId, "stop");
  await publishLive();
  return { ok: true, status: "idle" };
}

async function deleteTodoItem(todoId) {
  if (taskTimers.has(todoId)) {
    await flushTodoTimer(todoId, "delete");
  }
  const todos = await loadTodos();
  const next = todos.filter((t) => t.id !== todoId);
  await saveTodos(next);
  await publishLive();
  return { ok: true };
}

/** Compte O+A uniquement en play — en pause le chrono est figé (bloc déjà coupé). */
function tickTaskTimers(now) {
  for (const state of taskTimers.values()) {
    if (state.status !== "playing") {
      state.lastTickAt = now;
      continue;
    }
    const elapsed = Math.max(0, Math.floor((now - state.lastTickAt) / 1000));
    if (elapsed <= 0) continue;
    for (let i = 0; i < elapsed; i++) {
      state.openSeconds += 1;
      state.activeSeconds += 1;
    }
    state.lastTickAt = now;
  }
}

/** @type {Map<number, TabState>} */
const tabs = new Map();

/** @type {number | null} */
let focusedTabId = null;

/** @type {number | null} */
let focusedWindowId = null;

/** @type {import('./lib/config.js').DEFAULT_CONFIG} */
let config = { ...DEFAULT_CONFIG };

/**
 * @typedef {Object} TabState
 * @property {number} tabId
 * @property {string} url
 * @property {string} title
 * @property {string} groupKey
 * @property {number} openedAt
 * @property {number} segmentStart
 * @property {number} lastActivityAt
 * @property {number} activityScore
 * @property {number} activeSeconds
 * @property {number} openSeconds
 * @property {boolean} isFocused
 * @property {number} lastTickAt
 */

async function refreshConfig() {
  config = await loadConfig();
}

async function injectContentScriptsForOpenTabs() {
  const chromeTabs = await chrome.tabs.query({});
  for (const tab of chromeTabs) {
    if (!tab.id || !isTrackableUrl(tab.url)) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: CONTENT_SCRIPT_FILES
      });
    } catch {
      /* pages restreintes (Web Store, etc.) */
    }
  }
}

function isTrackableUrl(url) {
  if (!url) return false;
  return !url.startsWith("chrome://") && !url.startsWith("chrome-extension://");
}

function createTabState(tab, isFocused = false) {
  const now = Date.now();
  const url = tab.url || tab.pendingUrl || "";
  const groupKey = getGroupKey(url, config);
  return {
    tabId: tab.id,
    url,
    title: tab.title || url || "Sans titre",
    groupKey,
    openedAt: now,
    segmentStart: now,
    lastActivityAt: 0,
    activityScore: 0,
    activeSeconds: 0,
    openSeconds: 0,
    isFocused,
    lastTickAt: now
  };
}

async function ensureTab(tabId) {
  if (tabs.has(tabId)) return tabs.get(tabId);
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isTrackableUrl(tab.url)) return null;
    const state = createTabState(tab, tabId === focusedTabId);
    tabs.set(tabId, state);
    return state;
  } catch {
    return null;
  }
}

async function flushTab(tabId, reason = "close") {
  const state = tabs.get(tabId);
  if (!state) return;
  const now = Date.now();
  if (state.openSeconds > 0 || state.activeSeconds > 0) {
    await appendEntry({
      id: makeEntryId(),
      url: state.url,
      title: state.title,
      groupKey: state.groupKey,
      start: state.segmentStart,
      end: now,
      activeSeconds: state.activeSeconds,
      openSeconds: state.openSeconds,
      date: dateKey(state.segmentStart),
      tabId: state.tabId,
      reason
    });
  }
  tabs.delete(tabId);
  await publishLive();
}

function registerActivity(tabId, score = 1) {
  const state = tabs.get(tabId);
  if (!state) return;
  const now = Date.now();
  state.lastActivityAt = now;
  state.activityScore += score;
}

function isRecentlyActive(state, atTime) {
  if (!state.lastActivityAt) return false;
  if (atTime < state.lastActivityAt) return false;
  return atTime - state.lastActivityAt <= config.inactivityMs;
}

function shouldCountActiveSecond(state, now) {
  if (state.tabId !== focusedTabId) return false;
  return isRecentlyActive(state, now);
}

async function refreshFocusedTab() {
  let win;
  try {
    win = await chrome.windows.getLastFocused({ populate: false });
  } catch {
    win = null;
  }
  focusedWindowId = win?.id ?? null;
  let active = null;
  if (focusedWindowId != null) {
    const found = await chrome.tabs.query({
      active: true,
      windowId: focusedWindowId
    });
    active = found[0] ?? null;
  }
  focusedTabId = active?.id ?? null;
  for (const state of tabs.values()) {
    state.isFocused = state.tabId === focusedTabId;
  }
}

async function tick() {
  const now = Date.now();
  for (const state of tabs.values()) {
    const elapsed = Math.max(0, Math.floor((now - state.lastTickAt) / 1000));
    if (elapsed <= 0) continue;
    for (let i = 0; i < elapsed; i++) {
      const tickTime = state.lastTickAt + (i + 1) * 1000;
      state.openSeconds += 1;
      if (shouldCountActiveSecond(state, tickTime)) {
        state.activeSeconds += 1;
      }
    }
    state.lastTickAt = now;
  }
  tickTaskTimers(now);
  await publishLive();
}

async function activityHeartbeat() {
  const now = Date.now();
  for (const state of tabs.values()) {
    if (!isRecentlyActive(state, now)) {
      state.activityScore = 0;
    }
  }
}

/**
 * Efface la portion [cutoff, maintenant] des segments live : flush du tronçon conservé, reset compteurs.
 * @param {number} cutoff
 */
async function eraseLiveTabsSince(cutoff) {
  const now = Date.now();
  for (const state of tabs.values()) {
    if (state.segmentStart >= cutoff) {
      state.segmentStart = now;
      state.activeSeconds = 0;
      state.openSeconds = 0;
      state.lastTickAt = now;
      continue;
    }
    const totalMs = now - state.segmentStart;
    const keptMs = cutoff - state.segmentStart;
    if (
      keptMs > 0 &&
      totalMs > 0 &&
      (state.openSeconds > 0 || state.activeSeconds > 0)
    ) {
      const ratio = keptMs / totalMs;
      const openSeconds = Math.floor(state.openSeconds * ratio);
      const activeSeconds = Math.floor(state.activeSeconds * ratio);
      if (openSeconds > 0 || activeSeconds > 0) {
        await appendEntry({
          id: makeEntryId(),
          url: state.url,
          title: state.title,
          groupKey: state.groupKey,
          start: state.segmentStart,
          end: cutoff,
          activeSeconds,
          openSeconds,
          date: dateKey(state.segmentStart),
          tabId: state.tabId,
          reason: "erase-trim"
        });
      }
    }
    state.segmentStart = now;
    state.activeSeconds = 0;
    state.openSeconds = 0;
    state.lastTickAt = now;
  }
  await publishLive();
}

async function publishLive() {
  const snapshot = {
    updatedAt: Date.now(),
    focusedTabId,
    tabs: Array.from(tabs.values()).map((s) => ({
      tabId: s.tabId,
      url: s.url,
      title: s.title,
      groupKey: s.groupKey,
      openedAt: s.openedAt,
      segmentStart: s.segmentStart,
      activeSeconds: s.activeSeconds,
      openSeconds: s.openSeconds,
      isFocused: s.isFocused,
      lastActivityAt: s.lastActivityAt,
      isActive:
        s.tabId === focusedTabId && isRecentlyActive(s, Date.now())
    })),
    tasks: snapshotTaskTimers()
  };
  await setLiveState(snapshot);
  chrome.runtime.sendMessage({ type: "LIVE_UPDATE" }).catch(() => {});
}

async function syncAllTabs() {
  const chromeTabs = await chrome.tabs.query({});
  const openIds = new Set(chromeTabs.map((t) => t.id));
  for (const id of [...tabs.keys()]) {
    if (!openIds.has(id)) await flushTab(id, "gone");
  }
  await refreshFocusedTab();
  for (const tab of chromeTabs) {
    if (!isTrackableUrl(tab.url)) continue;
    if (!tabs.has(tab.id)) {
      const state = createTabState(tab, tab.id === focusedTabId);
      tabs.set(tab.id, state);
    } else {
      const state = tabs.get(tab.id);
      state.url = tab.url || state.url;
      state.title = tab.title || state.title;
      state.groupKey = getGroupKey(state.url, config);
      state.isFocused = tab.id === focusedTabId;
    }
  }
  await publishLive();
}

async function scheduleTickAlarm() {
  const ms = config?.heartbeatIntervalMs ?? 1000;
  await chrome.alarms.create("tick", { when: Date.now() + ms });
}

async function scheduleActivityCheckAlarm() {
  const ms = config?.activityCheckIntervalMs ?? 60000;
  await chrome.alarms.create("activityCheck", { when: Date.now() + ms });
}

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await refreshConfig();
    await restoreTaskTimersFromLive();
    await scheduleTickAlarm();
    await scheduleActivityCheckAlarm();
    await refreshFocusedTab();
    await syncAllTabs();
    await injectContentScriptsForOpenTabs();
  })().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await refreshConfig();
    await restoreTaskTimersFromLive();
    await scheduleTickAlarm();
    await scheduleActivityCheckAlarm();
    await syncAllTabs();
    await injectContentScriptsForOpenTabs();
  })().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.ogTimeTabConfig) {
    refreshConfig()
      .then(async () => {
        await scheduleTickAlarm();
        await scheduleActivityCheckAlarm();
        await syncAllTabs();
        const tabsList = await chrome.tabs.query({});
        for (const tab of tabsList) {
          if (tab.id && isTrackableUrl(tab.url)) {
            chrome.tabs.sendMessage(tab.id, { type: "CONFIG_UPDATED", config }).catch(() => {});
          }
        }
      })
      .catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  let lastFocusedWin;
  try {
    const win = await chrome.windows.getLastFocused({ populate: false });
    lastFocusedWin = win?.id ?? null;
  } catch {
    lastFocusedWin = null;
  }
  if (lastFocusedWin != null && windowId !== lastFocusedWin) return;

  focusedWindowId = windowId;
  focusedTabId = tabId;
  for (const state of tabs.values()) {
    state.isFocused = state.tabId === tabId;
  }
  const state = await ensureTab(tabId);
  if (state) {
    registerActivity(tabId, 1);
  }
  await publishLive();
  scheduleSyncTodoOverlayForTab(tabId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  await refreshFocusedTab();
  await publishLive();
  if (focusedTabId != null) scheduleSyncTodoOverlayForTab(focusedTabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url || changeInfo.title) {
    if (!isTrackableUrl(tab.url)) {
      if (tabs.has(tabId)) await flushTab(tabId, "navigate-away");
      return;
    }
    let state = tabs.get(tabId);
    if (!state) {
      state = createTabState(tab, tabId === focusedTabId);
      tabs.set(tabId, state);
    } else if (changeInfo.url && state.url !== tab.url) {
      await flushTab(tabId, "url-change");
      const fresh = createTabState(tab, tabId === focusedTabId);
      tabs.set(tabId, fresh);
    } else {
      state.url = tab.url || state.url;
      state.title = tab.title || state.title;
      state.groupKey = getGroupKey(state.url, config);
    }
    if (changeInfo.status === "complete") {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: CONTENT_SCRIPT_FILES
        });
      } catch {
        /* ignore */
      }
    }
    await publishLive();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (focusedTabId === tabId) focusedTabId = null;
  await flushTab(tabId, "close");
});

chrome.windows.onRemoved.addListener((windowId) => {
  void (async () => {
    try {
      const ui = await loadTodoUi();
      if (ui.open && ui.hostWindowId === windowId) {
        await closeTodoOverlay();
      }
    } catch {
      /* ignore */
    }
  })();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "tick") {
    await tick();
    await scheduleTickAlarm();
  }
  if (alarm.name === "activityCheck") {
    await activityHeartbeat();
    await scheduleActivityCheckAlarm();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "GET_CONFIG") {
        sendResponse({ config: config || (await loadConfig()) });
        return;
      }
      if (msg.type === "ACTIVITY") {
        const tabId = sender.tab?.id;
        if (!tabId) return;
        if (!config) await refreshConfig();
        await ensureTab(tabId);
        if (tabId === focusedTabId) {
          registerActivity(tabId, msg.score ?? 1);
        }
        await tick();
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === "GET_LIVE") {
        sendResponse(await getLiveState());
        return;
      }
      if (msg.type === "FORCE_SYNC") {
        await refreshConfig();
        await syncAllTabs();
        await injectContentScriptsForOpenTabs();
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === "ERASE_DATA") {
        const cutoff = computeEraseCutoff(msg.amount, msg.unit);
        if (cutoff == null) {
          sendResponse({ ok: false, error: "invalid_params" });
          return;
        }
        const stats = await eraseEntriesSince(cutoff);
        await eraseLiveTabsSince(cutoff);
        sendResponse({ ok: true, cutoff, ...stats });
        return;
      }
      if (msg.type === "TODO_PANEL_OPEN") {
        await openTodoOverlay();
        sendResponse({ ok: true, open: true });
        return;
      }
      if (msg.type === "TODO_PANEL_CLOSE") {
        await closeTodoOverlay();
        sendResponse({ ok: true, open: false });
        return;
      }
      if (msg.type === "TODO_PANEL_TOGGLE") {
        await toggleTodoOverlay();
        const ui = await loadTodoUi();
        sendResponse({ ok: true, open: Boolean(ui.open) });
        return;
      }
      if (msg.type === "TODO_PANEL_GET_STATE") {
        const ui = await loadTodoUi();
        sendResponse({
          ok: true,
          open: Boolean(ui.open),
          collapsed: Boolean(ui.collapsed),
          hostWindowId: ui.hostWindowId ?? null
        });
        return;
      }
      if (msg.type === "TODO_GET_TAB_CONTEXT") {
        sendResponse({
          ok: true,
          windowId: sender.tab?.windowId ?? null,
          tabId: sender.tab?.id ?? null
        });
        return;
      }
      if (msg.type === "TODO_TIMER_PLAY") {
        sendResponse(await playTodoTimer(String(msg.todoId || "")));
        return;
      }
      if (msg.type === "TODO_TIMER_PAUSE") {
        sendResponse(await pauseTodoTimer(String(msg.todoId || "")));
        return;
      }
      if (msg.type === "TODO_TIMER_STOP") {
        sendResponse(await stopTodoTimer(String(msg.todoId || "")));
        return;
      }
      if (msg.type === "TODO_DELETE") {
        sendResponse(await deleteTodoItem(String(msg.todoId || "")));
        return;
      }
    } catch {
      try {
        sendResponse({ ok: false, error: "handler_failed" });
      } catch {
        /* canal déjà fermé */
      }
    }
  })().catch(() => {});
  return true;
});

refreshConfig()
  .then(async () => {
    await restoreTaskTimersFromLive();
    await scheduleTickAlarm();
    await scheduleActivityCheckAlarm();
    await syncAllTabs();
    await injectContentScriptsForOpenTabs();
  })
  .catch(() => {});
