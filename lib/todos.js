export const TODO_STORAGE_KEY = "ogTimeTabTodos";
export const TODO_UI_STORAGE_KEY = "ogTimeTabTodoUi";
export const TODO_GROUP_PREFIX = "todo:";

/**
 * @typedef {"idle"|"playing"|"paused"} TodoTimerStatus
 * @typedef {{ id: string, text: string, timerStatus?: TodoTimerStatus }} TodoItem
 * @typedef {{
 *   open?: boolean,
 *   collapsed?: boolean,
 *   left?: number,
 *   top?: number,
 *   width?: number,
 *   height?: number,
 *   openToken?: number,
 *   windowId?: number|null,
 *   hostWindowId?: number|null
 * }} TodoUiState
 * @typedef {{
 *   todoId: string,
 *   text: string,
 *   status: "playing"|"paused",
 *   segmentStart: number,
 *   openedAt: number,
 *   activeSeconds: number,
 *   openSeconds: number,
 *   lastTickAt: number
 * }} TodoTimerLive
 */

export function makeTodoId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function todoGroupKey(todoId) {
  return `${TODO_GROUP_PREFIX}${todoId}`;
}

export function todoUrl(todoId) {
  return `todo://${todoId}`;
}

export function isTodoGroupKey(key) {
  return typeof key === "string" && key.startsWith(TODO_GROUP_PREFIX);
}

export function isTodoUrl(url) {
  return typeof url === "string" && url.startsWith("todo://");
}

export function parseTodoIdFromGroupKey(key) {
  if (!isTodoGroupKey(key)) return null;
  return key.slice(TODO_GROUP_PREFIX.length) || null;
}

/** @returns {Promise<TodoItem[]>} */
export async function loadTodos() {
  const { [TODO_STORAGE_KEY]: todos = [] } = await chrome.storage.local.get(TODO_STORAGE_KEY);
  return Array.isArray(todos) ? todos : [];
}

/** @param {TodoItem[]} todos */
export async function saveTodos(todos) {
  await chrome.storage.local.set({ [TODO_STORAGE_KEY]: todos });
}

/** @param {string} todoId @param {TodoTimerStatus} status */
export async function setTodoTimerStatus(todoId, status) {
  const todos = await loadTodos();
  let changed = false;
  for (const t of todos) {
    if (t.id === todoId) {
      if (t.timerStatus !== status) {
        t.timerStatus = status;
        changed = true;
      }
    } else if (status === "playing" && t.timerStatus === "playing") {
      t.timerStatus = "paused";
      changed = true;
    }
  }
  if (changed) await saveTodos(todos);
}

/** @returns {Promise<TodoUiState>} */
export async function loadTodoUi() {
  const { [TODO_UI_STORAGE_KEY]: ui = {} } = await chrome.storage.local.get(TODO_UI_STORAGE_KEY);
  return ui && typeof ui === "object" ? ui : {};
}

/** @param {TodoUiState} partial */
export async function saveTodoUi(partial) {
  const current = await loadTodoUi();
  await chrome.storage.local.set({
    [TODO_UI_STORAGE_KEY]: { ...current, ...partial }
  });
}
