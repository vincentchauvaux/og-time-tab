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
        files: ["content.js"]
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
    }))
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

chrome.runtime.onInstalled.addListener(async () => {
  await refreshConfig();
  await scheduleTickAlarm();
  await scheduleActivityCheckAlarm();
  await refreshFocusedTab();
  await syncAllTabs();
  await injectContentScriptsForOpenTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await refreshConfig();
  await scheduleTickAlarm();
  await scheduleActivityCheckAlarm();
  await syncAllTabs();
  await injectContentScriptsForOpenTabs();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.ogTimeTabConfig) {
    refreshConfig().then(async () => {
      await scheduleTickAlarm();
      await scheduleActivityCheckAlarm();
      await syncAllTabs();
      const tabsList = await chrome.tabs.query({});
      for (const tab of tabsList) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: "CONFIG_UPDATED", config }).catch(() => {});
        }
      }
    });
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
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  await refreshFocusedTab();
  await publishLive();
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
          files: ["content.js"]
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
  })();
  return true;
});

refreshConfig().then(async () => {
  await scheduleTickAlarm();
  await scheduleActivityCheckAlarm();
  await syncAllTabs();
  await injectContentScriptsForOpenTabs();
});
