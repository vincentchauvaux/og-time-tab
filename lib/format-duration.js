/** Seconde = unité de base ; mois = 30 j, année = 12 mois (simplifié). */
const SEC = 1;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 12 * MONTH;

const FULL_UNITS = [
  { label: "an", size: YEAR },
  { label: "mois", size: MONTH },
  { label: "j", size: DAY },
  { label: "h", size: HOUR },
  { label: "min", size: MIN },
  { label: "s", size: SEC },
];

/**
 * Affichage compact : une seule unité (la plus grande pertinente).
 * @param {number} sec
 * @returns {string}
 */
export function formatDurationShort(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < MIN) return `${s} s`;
  if (s < HOUR) return `${Math.floor(s / MIN)} min`;
  if (s < DAY) return `${Math.floor(s / HOUR)} h`;
  if (s < MONTH) return `${Math.floor(s / DAY)} j`;
  if (s < YEAR) return `${Math.floor(s / MONTH)} mois`;
  return `${Math.floor(s / YEAR)} an`;
}

/**
 * Infobulle / title : toutes les unités non nulles (ex. « 1 h 12 min 34 s »).
 * @param {number} sec
 * @returns {string}
 */
export function formatDurationFull(sec) {
  let remain = Math.max(0, Math.round(sec));
  if (remain === 0) return "0 s";

  const parts = [];
  for (const { label, size } of FULL_UNITS) {
    if (remain < size && size !== SEC) continue;
    const n = size === SEC ? remain : Math.floor(remain / size);
    if (n > 0) {
      parts.push(`${n} ${label}`);
      remain -= n * size;
    }
  }
  return parts.join(" ");
}

/** @param {number} ms */
export function formatDurationMsShort(ms) {
  return formatDurationShort(Math.round(ms / 1000));
}

/** @param {number} ms */
export function formatDurationMsFull(ms) {
  return formatDurationFull(Math.round(ms / 1000));
}

/** Valeur numérique Chart.js (barres, doughnut). */
export function formatChartTooltipValue(context) {
  const parsed = context.parsed;
  let value;
  if (parsed && typeof parsed === "object") {
    const horizontal = context.chart?.options?.indexAxis === "y";
    value = horizontal ? (parsed.x ?? parsed.y) : (parsed.y ?? parsed.x);
  } else {
    value = parsed ?? context.raw;
  }
  if (typeof value === "object" && value != null) value = value.y ?? value.x;
  const n = Number(value);
  return Number.isFinite(n) ? formatDurationFull(n) : "";
}
