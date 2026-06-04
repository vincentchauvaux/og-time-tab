/**
 * Couleurs stables par groupKey pour les graphiques stats (thème sombre).
 * Hash préféré par clé ; déduplication stricte par vue (teintes distinctes).
 */

/** Palette 24 teintes visuellement distinctes (un seul vert, pas de doublons proches). */
export const CHART_GROUP_PALETTE = [
  "#0d6efd",
  "#fd7e14",
  "#6f42c1",
  "#dc3545",
  "#17a2b8",
  "#ffc107",
  "#e83e8c",
  "#5c9eff",
  "#ff9f43",
  "#c77dff",
  "#adb5bd",
  "#28a745",
  "#f472b6",
  "#b45309",
  "#7c3aed",
  "#0891b2",
  "#be123c",
  "#ca8a04",
  "#2563eb",
  "#c026d3",
  "#475569",
  "#059669",
  "#ea580c",
  "#4f46e5"
];

export const CHART_EMPTY_SEGMENT_COLOR = "#6c757d";

const GOLDEN_ANGLE = 137.508;

/**
 * Hash déterministe (djb2 xor) → entier non signé.
 * @param {string} groupKey
 */
export function hashGroupKey(groupKey) {
  const s = String(groupKey ?? "");
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

/**
 * Index palette préféré (stable) pour un groupKey.
 * @param {string} groupKey
 * @returns {number}
 */
export function preferredPaletteIndex(groupKey) {
  return hashGroupKey(groupKey) % CHART_GROUP_PALETTE.length;
}

/**
 * Couleur HSL distincte pour un slot (repli au-delà de la palette fixe).
 * @param {number} slot
 * @returns {string}
 */
export function distinctColorForSlot(slot) {
  const hue = (slot * GOLDEN_ANGLE + 17) % 360;
  const lightness = 48 + (slot % 3) * 5;
  return `hsl(${hue}, 68%, ${lightness}%)`;
}

/**
 * Premier index dont la couleur hex n'est pas déjà utilisée dans la vue.
 * @param {number} preferred
 * @param {Set<string>} usedColors
 * @returns {string}
 */
function pickColorForView(preferred, usedColors) {
  const n = CHART_GROUP_PALETTE.length;
  for (let offset = 0; offset < n; offset++) {
    const idx = (preferred + offset) % n;
    const color = CHART_GROUP_PALETTE[idx];
    if (!usedColors.has(color)) return color;
  }
  let slot = usedColors.size;
  for (let guard = 0; guard < 64; guard++) {
    const color = distinctColorForSlot(slot);
    slot++;
    if (!usedColors.has(color)) return color;
  }
  return distinctColorForSlot(preferred);
}

/**
 * Couleur hex stable pour un site / groupe (hors contexte d'une liste affichée).
 * @param {string} groupKey
 * @returns {string}
 */
export function getColorForGroupKey(groupKey) {
  return CHART_GROUP_PALETTE[preferredPaletteIndex(groupKey)];
}

/**
 * Couleurs uniques pour les groupKeys d'une même vue (jour, semaine, légende, créneau).
 * Préfère le hash ; en collision visuelle (même hex déjà pris), prend la prochaine teinte libre.
 * @param {{ groupKey: string }[]} items
 * @returns {Map<string, string>}
 */
export function assignColorsForItems(items) {
  const map = new Map();
  if (!items?.length) return map;

  const usedColors = new Set();

  for (const item of items) {
    const groupKey = item.groupKey ?? "";
    if (map.has(groupKey)) continue;

    const preferred = preferredPaletteIndex(groupKey);
    const color = pickColorForView(preferred, usedColors);
    usedColors.add(color);
    map.set(groupKey, color);
  }

  return map;
}

/**
 * Couleurs des segments doughnut alignées sur `items[].groupKey`.
 * @param {{ groupKey: string }[]} items
 * @returns {string[]}
 */
export function colorsForGroupItems(items) {
  if (!items?.length) return [CHART_EMPTY_SEGMENT_COLOR];
  const colorMap = assignColorsForItems(items);
  return items.map(
    (item) => colorMap.get(item.groupKey) ?? getColorForGroupKey(item.groupKey)
  );
}
