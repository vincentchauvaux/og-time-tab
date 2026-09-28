(function () {
  const extId = chrome.runtime?.id || "og-todo";

  function contextAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  // Déjà vivant pour cette session d’extension → resync seulement
  const existing = window.__ogTimeTabTodoApi;
  if (existing?.extId === extId && typeof existing.sync === "function") {
    try {
      if (contextAlive()) {
        existing.sync();
        return;
      }
    } catch {
      /* contexte mort → réinit ci-dessous */
    }
  }

  document.getElementById("og-time-tab-todo-host")?.remove();
  window.__ogTimeTabTodoOverlay = extId;

  const TODO_KEY = "ogTimeTabTodos";
  const UI_KEY = "ogTimeTabTodoUi";
  const DEFAULT_W = 300;
  const DEFAULT_H = 380;
  const MIN_W = 220;
  const MIN_H = 200;
  const FAB = 52;
  const Z = 2147483000;

  /** @type {{ id: string, text: string }[]} */
  let todos = [];
  /** @type {{ open?: boolean, collapsed?: boolean, left?: number, top?: number, width?: number, height?: number, hostWindowId?: number|null }} */
  let ui = { open: false, collapsed: false };
  /** @type {number|null} */
  let myWindowId = null;
  /** @type {string|null} */
  let armedId = null;
  /** @type {string|null} */
  let dragId = null;

  let host = null;
  let root = null;
  let panelEl = null;
  let fabEl = null;

  function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function resolveMyWindowId() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "TODO_GET_TAB_CONTEXT" });
      if (res?.windowId != null) myWindowId = res.windowId;
    } catch {
      /* ignore */
    }
    return myWindowId;
  }

  function isHostWindow() {
    const hostId = ui.hostWindowId;
    if (hostId == null || !Number.isFinite(hostId)) return true;
    if (myWindowId == null) return false;
    return myWindowId === hostId;
  }

  async function loadState() {
    try {
      const data = await chrome.storage.local.get([TODO_KEY, UI_KEY]);
      todos = Array.isArray(data[TODO_KEY]) ? data[TODO_KEY] : [];
      ui = data[UI_KEY] && typeof data[UI_KEY] === "object" ? data[UI_KEY] : { open: false };
      await resolveMyWindowId();
    } catch {
      /* contexte invalidé */
    }
  }

  async function saveTodos() {
    try {
      await chrome.storage.local.set({ [TODO_KEY]: todos });
    } catch {
      /* ignore */
    }
  }

  async function saveUi(partial) {
    ui = { ...ui, ...partial };
    try {
      await chrome.storage.local.set({ [UI_KEY]: ui });
    } catch {
      /* ignore */
    }
  }

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement("div");
    host.id = "og-time-tab-todo-host";
    host.style.cssText = `all:initial;position:fixed;inset:0;pointer-events:none;z-index:${Z};`;
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${cssText()}</style>
      <div class="wrap">
        <div class="panel" part="panel">
          <header class="header" data-drag>
            <span class="title">To-do</span>
            <div class="actions">
              <button type="button" class="icon-btn" data-collapse title="Réduire" aria-label="Réduire">–</button>
              <button type="button" class="icon-btn" data-close title="Fermer" aria-label="Fermer">×</button>
            </div>
          </header>
          <div class="body">
            <form class="add-form">
              <input class="input" type="text" maxlength="200" placeholder="Nouvelle tâche…" autocomplete="off" />
              <button type="submit" class="add-btn" title="Ajouter" aria-label="Ajouter">+</button>
            </form>
            <ul class="list" aria-label="Liste de tâches"></ul>
            <p class="empty">Aucune tâche. Ajoutez-en une avec +.</p>
          </div>
          <div class="resize" data-resize title="Redimensionner"></div>
        </div>
        <button type="button" class="fab" title="Ouvrir To-do" aria-label="Ouvrir To-do">
          <span class="fab-check" aria-hidden="true"></span>
        </button>
      </div>`;
    (document.documentElement || document.body).appendChild(host);
    panelEl = root.querySelector(".panel");
    fabEl = root.querySelector(".fab");
    bindUi();
  }

  function cssText() {
    return `
      .wrap{all:initial;font-family:system-ui,-apple-system,sans-serif;color:#e8eaed}
      .panel,.fab{pointer-events:auto;position:fixed;box-sizing:border-box}
      .panel{
        display:flex;flex-direction:column;background:#1a1d23;border:1px solid rgba(255,255,255,.12);
        border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.45);overflow:hidden;min-width:${MIN_W}px;min-height:${MIN_H}px
      }
      .panel.hidden,.fab.hidden{display:none!important}
      .header{
        display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;
        background:#2c313c;border-bottom:1px solid rgba(255,255,255,.08);cursor:move;user-select:none
      }
      .title{font-size:12px;font-weight:600}
      .actions{display:flex;gap:4px}
      .icon-btn{
        width:24px;height:24px;border:none;border-radius:6px;background:transparent;color:#9aa0a6;
        cursor:pointer;font-size:14px;line-height:1
      }
      .icon-btn:hover{background:rgba(255,255,255,.08);color:#e8eaed}
      .body{display:flex;flex-direction:column;gap:8px;padding:10px;flex:1;min-height:0}
      .add-form{display:flex;gap:6px;flex-shrink:0}
      .input{
        flex:1;min-width:0;padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.1);
        background:#2c313c;color:#e8eaed;font-size:12px
      }
      .input:focus{outline:2px solid rgba(40,167,69,.45)}
      .add-btn{
        width:34px;height:34px;border:none;border-radius:6px;background:#28a745;color:#fff;
        font-size:18px;font-weight:600;cursor:pointer;flex-shrink:0
      }
      .list{list-style:none;margin:0;padding:0;overflow:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:4px}
      .empty{margin:0;font-size:11px;color:#9aa0a6;text-align:center;padding:10px 4px}
      .empty.hidden{display:none}
      .item{
        display:flex;align-items:center;gap:6px;padding:8px;border-radius:6px;background:#2c313c;
        border:1px solid transparent;cursor:grab;user-select:none;position:relative;overflow:hidden;min-height:36px
      }
      .item.is-armed{border-color:rgba(40,167,69,.4);background:#252a33}
      .item.is-playing{border-color:rgba(40,167,69,.65)}
      .item.is-paused{border-color:rgba(255,193,7,.45)}
      .item.is-dragging{opacity:.45}
      .item.is-drag-over{outline:1px dashed rgba(40,167,69,.7)}
      .item-text{flex:1;min-width:0;font-size:12px;line-height:1.3;word-break:break-word;padding-right:4px}
      .item-status{
        flex-shrink:0;font-size:9px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;
        color:#9aa0a6;margin-right:2px
      }
      .item.is-playing .item-status{color:#28a745}
      .item.is-paused .item-status{color:#ffc107}
      .item-veil{
        display:none;position:absolute;inset:0;pointer-events:none;
        background:linear-gradient(90deg,rgba(26,29,35,.15) 0%,rgba(26,29,35,.82) 42%,rgba(26,29,35,.96) 100%)
      }
      .item.is-armed .item-veil{display:block}
      .item-actions{
        display:none;position:absolute;right:6px;top:50%;transform:translateY(-50%);
        gap:4px;z-index:2;align-items:center
      }
      .item.is-armed .item-actions{display:inline-flex}
      .act{
        width:28px;height:28px;border:none;border-radius:6px;cursor:pointer;padding:0;
        display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.08);color:#e8eaed
      }
      .act:hover{background:rgba(255,255,255,.16)}
      .act-play{color:#28a745}
      .act-stop{color:#f0ad4e}
      .act-del{color:#dc3545}
      .ico-play{
        width:0;height:0;border-style:solid;border-width:5px 0 5px 8px;
        border-color:transparent transparent transparent currentColor;margin-left:2px;display:block
      }
      .ico-pause{
        width:8px;height:10px;box-sizing:border-box;border-left:2.5px solid currentColor;border-right:2.5px solid currentColor;display:block
      }
      .ico-stop{width:8px;height:8px;background:currentColor;border-radius:1px;display:block}
      .trash{width:11px;height:13px;border:1.5px solid currentColor;border-top:none;border-radius:0 0 2px 2px;position:relative;display:block}
      .trash:before{content:"";position:absolute;left:-3px;top:-4px;width:15px;height:2px;background:currentColor;border-radius:1px}
      .trash:after{content:"";position:absolute;left:2px;top:-7px;width:5px;height:3px;border:1.5px solid currentColor;border-bottom:none;border-radius:2px 2px 0 0}
      .resize{
        position:absolute;right:2px;bottom:2px;width:14px;height:14px;cursor:nwse-resize;
        background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,.35) 50%)
      }
      .fab{
        width:${FAB}px;height:${FAB}px;border-radius:50%;border:1.5px solid rgba(40,167,69,.75);
        background:#1a1d23;color:#28a745;box-shadow:0 6px 20px rgba(0,0,0,.4);
        display:inline-flex;align-items:center;justify-content:center;cursor:pointer
      }
      .fab:hover{background:#22262e}
      .fab-check{
        width:14px;height:8px;border-left:2.5px solid currentColor;border-bottom:2.5px solid currentColor;
        transform:rotate(-45deg) translate(1px,-1px);display:block
      }
    `;
  }

  function defaultUi() {
    const left = Math.max(16, window.innerWidth - DEFAULT_W - 24);
    const top = Math.max(16, window.innerHeight - DEFAULT_H - 24);
    return {
      open: true,
      collapsed: false,
      left,
      top,
      width: DEFAULT_W,
      height: DEFAULT_H
    };
  }

  function normalizedUi() {
    const base = { ...defaultUi(), ...ui };
    const width = clamp(Number(base.width) || DEFAULT_W, MIN_W, Math.max(MIN_W, window.innerWidth - 8));
    const height = clamp(Number(base.height) || DEFAULT_H, MIN_H, Math.max(MIN_H, window.innerHeight - 8));
    const left = clamp(Number(base.left) || 16, 0, Math.max(0, window.innerWidth - (base.collapsed ? FAB : width)));
    const top = clamp(Number(base.top) || 16, 0, Math.max(0, window.innerHeight - (base.collapsed ? FAB : height)));
    return { ...base, width, height, left, top };
  }

  function renderList() {
    if (!root) return;
    const list = root.querySelector(".list");
    const empty = root.querySelector(".empty");
    if (!list || !empty) return;
    list.innerHTML = "";
    empty.classList.toggle("hidden", todos.length > 0);
    for (const todo of todos) {
      const status = todo.timerStatus === "playing" || todo.timerStatus === "paused" ? todo.timerStatus : "idle";
      const li = document.createElement("li");
      li.className =
        "item" +
        (armedId === todo.id ? " is-armed" : "") +
        (status === "playing" ? " is-playing" : "") +
        (status === "paused" ? " is-paused" : "");
      li.dataset.id = todo.id;
      li.dataset.status = status;
      li.draggable = true;
      const statusLabel = status === "playing" ? "▶" : status === "paused" ? "⏸" : "";
      const playIcon =
        status === "playing"
          ? `<span class="ico-pause" aria-hidden="true"></span>`
          : `<span class="ico-play" aria-hidden="true"></span>`;
      const playTitle = status === "playing" ? "Pause" : "Lancer";
      li.innerHTML = `${statusLabel ? `<span class="item-status" title="${status === "playing" ? "En cours" : "En pause"}">${statusLabel}</span>` : ""}
        <span class="item-text">${escapeHtml(todo.text)}</span>
        <span class="item-veil" aria-hidden="true"></span>
        <span class="item-actions">
          <button type="button" class="act act-play" data-act="toggle" title="${playTitle}" aria-label="${playTitle}">${playIcon}</button>
          <button type="button" class="act act-stop" data-act="stop" title="Stop (finir l’entrée calendrier)" aria-label="Stop"><span class="ico-stop" aria-hidden="true"></span></button>
          <button type="button" class="act act-del" data-act="del" title="Supprimer la tâche" aria-label="Supprimer"><span class="trash" aria-hidden="true"></span></button>
        </span>`;
      list.appendChild(li);
    }
  }

  function applyLayout() {
    if (!panelEl || !fabEl) return;
    const state = normalizedUi();
    const visible = Boolean(state.open);
    const collapsed = Boolean(state.collapsed);

    if (!visible) {
      panelEl.classList.add("hidden");
      fabEl.classList.add("hidden");
      return;
    }

    if (collapsed) {
      panelEl.classList.add("hidden");
      fabEl.classList.remove("hidden");
      fabEl.style.left = `${state.left}px`;
      fabEl.style.top = `${state.top}px`;
      return;
    }

    fabEl.classList.add("hidden");
    panelEl.classList.remove("hidden");
    panelEl.style.left = `${state.left}px`;
    panelEl.style.top = `${state.top}px`;
    panelEl.style.width = `${state.width}px`;
    panelEl.style.height = `${state.height}px`;
  }

  function syncView() {
    const allowed = Boolean(ui.open) && isHostWindow();
    if (!allowed) {
      if (host) {
        // Masquer sans détruire (réouverture rapide dans cette fenêtre)
        if (panelEl) panelEl.classList.add("hidden");
        if (fabEl) fabEl.classList.add("hidden");
      }
      return;
    }
    ensureHost();
    renderList();
    applyLayout();
  }

  function bindUi() {
    if (!root) return;
    const form = root.querySelector(".add-form");
    const input = root.querySelector(".input");
    const list = root.querySelector(".list");

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = String(input?.value || "").trim();
      if (!text) return;
      todos.push({ id: makeId(), text });
      if (input) input.value = "";
      armedId = null;
      renderList();
      await saveTodos();
      input?.focus();
    });

    root.querySelector("[data-close]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      await saveUi({ open: false });
      syncView();
    });

    root.querySelector("[data-collapse]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      await saveUi({ collapsed: true });
      syncView();
    });

    fabEl?.addEventListener("click", async (e) => {
      e.stopPropagation();
      await saveUi({ collapsed: false });
      syncView();
    });

    list?.addEventListener("click", async (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      const item = t.closest(".item");
      if (!item) return;
      const id = item.dataset.id;
      if (!id) return;
      const actBtn = t.closest("[data-act]");
      if (actBtn) {
        e.stopPropagation();
        if (armedId !== id) {
          armedId = id;
          renderList();
        }
        const act = actBtn.getAttribute("data-act");
        const todo = todos.find((x) => x.id === id);
        const status = todo?.timerStatus || "idle";
        try {
          if (act === "toggle") {
            if (status === "playing") {
              await chrome.runtime.sendMessage({ type: "TODO_TIMER_PAUSE", todoId: id });
            } else {
              await chrome.runtime.sendMessage({ type: "TODO_TIMER_PLAY", todoId: id });
            }
          } else if (act === "stop") {
            await chrome.runtime.sendMessage({ type: "TODO_TIMER_STOP", todoId: id });
          } else if (act === "del") {
            await chrome.runtime.sendMessage({ type: "TODO_DELETE", todoId: id });
            armedId = null;
          }
        } catch {
          /* SW indisponible */
        }
        await loadState();
        renderList();
        return;
      }
      armedId = armedId === id ? null : id;
      renderList();
    });

    list?.addEventListener("dragstart", (e) => {
      const item = e.target instanceof Element ? e.target.closest(".item") : null;
      if (!item || !(e.dataTransfer instanceof DataTransfer)) return;
      dragId = item.dataset.id || null;
      item.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragId || "");
    });
    list?.addEventListener("dragend", () => {
      dragId = null;
      list.querySelectorAll(".item").forEach((el) => el.classList.remove("is-dragging", "is-drag-over"));
    });
    list?.addEventListener("dragover", (e) => {
      e.preventDefault();
      const item = e.target instanceof Element ? e.target.closest(".item") : null;
      list.querySelectorAll(".item").forEach((el) => el.classList.remove("is-drag-over"));
      if (item && item.dataset.id !== dragId) item.classList.add("is-drag-over");
    });
    list?.addEventListener("drop", async (e) => {
      e.preventDefault();
      const item = e.target instanceof Element ? e.target.closest(".item") : null;
      const targetId = item?.dataset.id;
      const sourceId = dragId || e.dataTransfer?.getData("text/plain");
      list.querySelectorAll(".item").forEach((el) => el.classList.remove("is-drag-over"));
      if (!sourceId || !targetId || sourceId === targetId) return;
      const from = todos.findIndex((t) => t.id === sourceId);
      const to = todos.findIndex((t) => t.id === targetId);
      if (from < 0 || to < 0) return;
      const [moved] = todos.splice(from, 1);
      todos.splice(to, 0, moved);
      armedId = null;
      renderList();
      await saveTodos();
    });

    // drag move
    let moving = false;
    let moveDX = 0;
    let moveDY = 0;
    root.querySelector("[data-drag]")?.addEventListener("pointerdown", (e) => {
      if (!(e instanceof PointerEvent) || e.button !== 0) return;
      if (e.target instanceof Element && e.target.closest("button")) return;
      const state = normalizedUi();
      moving = true;
      moveDX = e.clientX - state.left;
      moveDY = e.clientY - state.top;
      e.preventDefault();
    });

    // resize
    let resizing = false;
    let resizeStartX = 0;
    let resizeStartY = 0;
    let startW = 0;
    let startH = 0;
    root.querySelector("[data-resize]")?.addEventListener("pointerdown", (e) => {
      if (!(e instanceof PointerEvent) || e.button !== 0) return;
      const state = normalizedUi();
      resizing = true;
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      startW = state.width;
      startH = state.height;
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener(
      "pointermove",
      (e) => {
        if (moving) {
          const left = clamp(e.clientX - moveDX, 0, window.innerWidth - 40);
          const top = clamp(e.clientY - moveDY, 0, window.innerHeight - 40);
          ui = { ...ui, left, top };
          applyLayout();
        } else if (resizing) {
          const width = clamp(startW + (e.clientX - resizeStartX), MIN_W, window.innerWidth - 8);
          const height = clamp(startH + (e.clientY - resizeStartY), MIN_H, window.innerHeight - 8);
          ui = { ...ui, width, height };
          applyLayout();
        }
      },
      true
    );

    window.addEventListener(
      "pointerup",
      async () => {
        if (moving || resizing) {
          moving = false;
          resizing = false;
          const state = normalizedUi();
          await saveUi({
            left: state.left,
            top: state.top,
            width: state.width,
            height: state.height
          });
        }
      },
      true
    );

    // Prevent page interaction bleed for clicks inside panel
    panelEl?.addEventListener("mousedown", (e) => e.stopPropagation());
    panelEl?.addEventListener("click", (e) => e.stopPropagation());
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[TODO_KEY]) {
        todos = Array.isArray(changes[TODO_KEY].newValue) ? changes[TODO_KEY].newValue : [];
        renderList();
      }
      if (changes[UI_KEY]) {
        ui = changes[UI_KEY].newValue && typeof changes[UI_KEY].newValue === "object"
          ? changes[UI_KEY].newValue
          : { open: false };
        syncView();
      }
    });
  } catch {
    /* ignore */
  }

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "TODO_PANEL_SYNC") {
        loadState().then(() => {
          syncView();
          try {
            sendResponse({ ok: true });
          } catch {
            /* ignore */
          }
        });
        return true;
      }
      return undefined;
    });
  } catch {
    /* ignore */
  }

  window.__ogTimeTabTodoApi = {
    extId,
    sync: () => loadState().then(syncView)
  };

  loadState().then(syncView);
})();
