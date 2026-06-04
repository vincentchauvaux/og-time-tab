export const ENTRIES_KEY = "ogTimeTabEntries";
export const LIVE_KEY = "ogTimeTabLive";

/**
 * @typedef {Object} TimeEntry
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string} groupKey
 * @property {number} start
 * @property {number} end
 * @property {number} activeSeconds
 * @property {number} openSeconds
 * @property {string} date
 * @property {number} tabId
 */

export function dateKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function getEntries() {
  const { [ENTRIES_KEY]: entries = [] } = await chrome.storage.local.get(ENTRIES_KEY);
  return entries;
}

export async function appendEntry(entry) {
  const entries = await getEntries();
  entries.push(entry);
  await chrome.storage.local.set({ [ENTRIES_KEY]: entries });
  return entry;
}

export async function setLiveState(live) {
  await chrome.storage.local.set({ [LIVE_KEY]: live });
}

export async function getLiveState() {
  const { [LIVE_KEY]: live = { tabs: [], updatedAt: 0 } } = await chrome.storage.local.get(LIVE_KEY);
  return live;
}

export function makeEntryId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const ERASE_UNIT_MS = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000
};

/**
 * @param {number} amount
 * @param {"minutes"|"hours"|"days"} unit
 * @returns {number|null}
 */
export function computeEraseCutoff(amount, unit) {
  const unitMs = ERASE_UNIT_MS[unit];
  if (!unitMs || !Number.isFinite(amount) || amount < 1) return null;
  return Date.now() - Math.floor(amount) * unitMs;
}

/**
 * Règle d'effacement (fenêtre [cutoff, maintenant]) :
 * - entièrement avant cutoff (end ≤ cutoff) → conserver ;
 * - entièrement dans la fenêtre (start ≥ cutoff) → supprimer ;
 * - chevauchement → tronquer `end` à cutoff, secondes O/A au prorata.
 *
 * @param {TimeEntry} entry
 * @param {number} cutoff
 * @returns {TimeEntry|null}
 */
export function applyCutoffToEntry(entry, cutoff) {
  if (entry.end <= cutoff) return entry;
  if (entry.start >= cutoff) return null;
  const totalMs = entry.end - entry.start;
  const keptMs = cutoff - entry.start;
  if (keptMs <= 0) return null;
  const ratio = keptMs / totalMs;
  return {
    ...entry,
    end: cutoff,
    activeSeconds: Math.floor(entry.activeSeconds * ratio),
    openSeconds: Math.floor(entry.openSeconds * ratio)
  };
}

/**
 * @param {number} cutoff
 * @returns {Promise<{ before: number; after: number }>}
 */
export async function eraseEntriesSince(cutoff) {
  const entries = await getEntries();
  const next = [];
  for (const entry of entries) {
    const result = applyCutoffToEntry(entry, cutoff);
    if (result === null) continue;
    if (result.openSeconds > 0 || result.activeSeconds > 0) {
      next.push(result);
    }
  }
  await chrome.storage.local.set({ [ENTRIES_KEY]: next });
  return { before: entries.length, after: next.length };
}
