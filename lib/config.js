/** Paramètres par défaut — détection comportement humain */
export const DEFAULT_CONFIG = {
  mouseDistanceThreshold: 50,
  mouseWindowMs: 5000,
  trackKeyboard: true,
  trackScroll: true,
  inactivityMs: 120000,
  heartbeatIntervalMs: 1000,
  activityCheckIntervalMs: 60000,
  minActivityScore: 1,
  tickOpenSeconds: true,
  groupMode: "origin",
  groupPathDepth: 1,
  groupPrefix: ""
};

export const CONFIG_KEY = "ogTimeTabConfig";

export async function loadConfig() {
  const { [CONFIG_KEY]: stored } = await chrome.storage.local.get(CONFIG_KEY);
  return { ...DEFAULT_CONFIG, ...stored };
}

export async function saveConfig(partial) {
  const current = await loadConfig();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}
