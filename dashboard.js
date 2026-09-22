import { getEntries, getLiveState } from "./lib/storage.js";
import {
  formatGroupLabel,
  getGroupKey,
  normalizeGroupKeyForStats,
  normalizeStatsGroupKey
} from "./lib/grouping.js";
import { loadConfig } from "./lib/config.js";
import {
  formatDurationShort,
  formatDurationFull,
  formatDurationMsShort,
  formatDurationMsFull,
  formatChartTooltipValue
} from "./lib/format-duration.js";
import {
  assignColorsForItems,
  colorsForGroupItems,
  getColorForGroupKey,
  CHART_EMPTY_SEGMENT_COLOR
} from "./lib/chart-colors.js";

/** Plage affichée du calendrier (heure locale, créneaux de 30 min). */
const CALENDAR_DAY_START_HOUR = 0;
const CALENDAR_DAY_END_HOUR = 24;
const SLOT_MIN = 30;
const SLOT_H_BASE = 32;
/** Hauteur visuelle minimale d'un bloc en mode empile (minutes sur l'echelle du calendrier). */
const MIN_BLOCK_MINUTES = 15;
/** Hauteur visuelle minimale en mode Actif (sessions courtes) — détail au survol. */
const ACTIVE_MIN_VISUAL_MINUTES = 2;
/** Seuil minimal de temps actif pour afficher une carte en mode Actif. */
const ACTIVE_MIN_DISPLAY_SECONDS = 30;
/** Hauteur minimale d'une carte Actif isolée (px) : titre seul. */
const ACTIVE_SINGLE_READABLE_MIN_PX = 22;
/** Hauteur minimale d'une ligne dans un bloc Actif fusionné (px). */
const ACTIVE_FUSED_LINE_MIN_PX = 22;
/** Padding interne bloc Actif fusionné (px). */
const ACTIVE_FUSED_PAD_PX = 6;
/** Hauteur minimale des cartes dans une rangée horizontale (px). */
const STACK_SLOT_CARD_MIN_PX = 28;
/** Ecart max (min) pour fusionner des sessions en mode empile. */
const STACK_CLUSTER_GAP_MIN = 5;
/** Seuil de blocs dans un meme creneau 15 min avant fusion forcee (mode empile). */
const MAX_STACK_BLOCKS_PER_BIN = 10;
/** Hauteur en px correspondant à un créneau de `SLOT_MIN` minutes (piloté par le zoom vertical). */
let slotHPx = SLOT_H_BASE;
const CALENDAR_START_MIN = CALENDAR_DAY_START_HOUR * 60;
const CALENDAR_END_MIN = CALENDAR_DAY_END_HOUR * 60;
const SLOTS_PER_DAY = (CALENDAR_END_MIN - CALENDAR_START_MIN) / SLOT_MIN;
const STATS_METRIC_STORAGE = "ogTimeTabStatsMetric";
const STATS_DAY_STORAGE = "ogTimeTabStatsDay";
const CALENDAR_ZOOM_Y_STORAGE = "ogTimeTabCalendarZoomY";
const CALENDAR_METRIC_STORAGE = "ogTimeTabCalendarMetric";
/** @deprecated migre vers `ogTimeTabCalendarMetric` */
const CALENDAR_VIEW_MODE_STORAGE = "ogTimeTabCalendarViewMode";
const CALENDAR_ZOOM_Y_MIN = 0.5;
const CALENDAR_ZOOM_Y_MAX = 4;
/** Zoom par défaut sans préférence session : semaine courante vs autres semaines. */
const CALENDAR_ZOOM_Y_DEFAULT_PRESENT = 4;
const CALENDAR_ZOOM_Y_DEFAULT_OTHER = 1;
/** Cartes site visibles côte à côte au même créneau (mode empilé). */
const STACK_SITE_VISIBLE_MAX = 4;
/** Mode Actif : max cartes visibles par créneau (le reste en « +N »). */
const ACTIVE_SITE_VISIBLE_MAX = 2;
const LIVE_END_GRACE_MS = 15000;
/** Créneau de regroupement layout mode Actif (aligné sur 15 min comme Ouvert). */
const ACTIVE_STACK_BIN_MINUTES = 15;
/** Fusion de rafales actives du même site si écart ≤ N minutes. */
const ACTIVE_MERGE_GAP_MINUTES = 20;
/** Ecart (px) entre cartes dans une rangée `.stack-slot-row`. */
const STACK_SITE_SLOT_GAP_PX = 4;
/** Binning du mini chart des modales calendrier (minutes). */
const MODAL_DAY_CHART_BUCKET_MINUTES = 15;
const MODAL_WEEK_CHART_BUCKET_MINUTES = 30;
const STATS_ACTIVITY_TIMELINE_BUCKET_MINUTES = 60;
const TIMELINE_SCOPE_WEEK = "week";
const TIMELINE_SCOPE_DAY = "day";

function toFiniteSeconds(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Garantit l'invariant UI : Actif ⊆ Ouvert.
 * Certaines sources live anciennes ou partielles peuvent omettre `openSeconds`.
 */
function coerceOpenActiveSeconds(openSeconds, activeSeconds) {
  const a = toFiniteSeconds(activeSeconds, 0);
  const o = toFiniteSeconds(openSeconds, a);
  return { openSeconds: Math.max(o, a), activeSeconds: a };
}

/**
 * Métriques O/A pour une carte site : union temporelle des plages d'ouverture
 * (évite le double comptage des onglets parallèles du même site).
 * @param {object[]} members
 * @returns {{ openSeconds: number, activeSeconds: number }}
 */
function memberOpenActiveMetrics(members) {
  const list = members || [];
  if (!list.length) return { openSeconds: 0, activeSeconds: 0 };
  const nowTs = Date.now();
  /** @type {{ startMs: number, endMs: number }[]} */
  const openIntervals = [];
  let activeSum = 0;
  let openSumFallback = 0;
  for (const m of list) {
    const secs = coerceOpenActiveSeconds(m.openSeconds, m.activeSeconds);
    activeSum += secs.activeSeconds;
    openSumFallback += secs.openSeconds;
    const startMs = toTimestamp(m.start);
    let endMs = toTimestamp(m.end);
    if (m.isLive) endMs = Math.max(endMs || 0, nowTs);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      openIntervals.push({ startMs, endMs });
    } else if (secs.openSeconds > 0 && Number.isFinite(startMs)) {
      openIntervals.push({
        startMs,
        endMs: startMs + secs.openSeconds * 1000
      });
    }
  }
  const openUnion = unionDurationSeconds(mergeIntervals(openIntervals));
  const openSeconds = openUnion > 0 ? openUnion : openSumFallback;
  return {
    openSeconds,
    activeSeconds: Math.min(openSeconds, activeSum)
  };
}

function isTrackableStatsUrl(url) {
  if (!url) return false;
  return !url.startsWith("chrome://") && !url.startsWith("chrome-extension://");
}

function normalizeLegacyGroupKey(rawGroupKey, config) {
  return normalizeGroupKeyForStats(rawGroupKey, config);
}

function cleanStatsToken(value) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim();
}

function normalizeStatsLabelKey(groupKey) {
  const rawLabel = cleanStatsToken(formatGroupLabel(groupKey));
  if (!rawLabel) return "";
  return rawLabel.toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");
}

function resolveStatsGroupKey(record, config) {
  const url = cleanStatsToken(record?.url || "");
  const legacy = cleanStatsToken(record?.groupKey || "");
  let raw;
  if (isTrackableStatsUrl(url)) {
    raw = getGroupKey(url, config);
  } else {
    raw = normalizeLegacyGroupKey(legacy, config);
    if (!raw && legacy && !/^[a-z][a-z0-9+.-]*:\/\//i.test(legacy)) {
      raw = normalizeLegacyGroupKey(`https://${legacy}`, config);
    }
  }
  if (!raw) return "system";
  const canonical = normalizeStatsGroupKey(raw, config) || normalizeStatsGroupKey(url, config);
  return canonical || "system";
}

function normalizeEntriesForStats(entries, config) {
  return (entries || []).map((e) => ({
    ...e,
    groupKey: resolveStatsGroupKey(e, config)
  }));
}

function normalizeLiveForStats(live, config) {
  const tabs = (live?.tabs || []).map((t) => ({
    ...t,
    groupKey: resolveStatsGroupKey(t, config)
  }));
  return { ...(live || {}), tabs };
}

/** @type {"active"|"open"} */
let statsMetricMode = loadStatsMetricMode();
/** Jour selectionne pour la carte « Repartition par jour » (YYYY-MM-DD, fuseau local). */
const savedStatsDay = loadStatsSelectedDay();
let statsSelectedDay = savedStatsDay || dateKeyFromTs(Date.now());
let statsDayInitialized = Boolean(savedStatsDay);
/** @type {"week"|"day"} */
let statsInsightsScope = "week";
/** Clés jour alignées sur les barres du graphique 14 j (clic barre  ·  sélection). */
let dailyChartDateKeys = [];

let weekStart = startOfWeek(new Date());
/** @type {object[]} */
let renderedBlocks = [];
/** @type {import('./lib/storage.js').TimeEntry[]} */
let cachedEntries = [];
let cachedLive = { tabs: [], updatedAt: 0 };
let statsGroupingConfig = null;
/** @type {Record<string, import('chart.js').Chart>} */
const charts = {};
/** Snapshot des données stats - évite destroy/recreate et animations en boucle */
let statsDataSnapshot = "";
let lastWeekStartTs = null;
let timeAxisBuilt = false;
let calendarZoomY = 1;
/** @type {Date[]|null} */
let cachedDays = null;
/** Structure calendrier (positions / regroupements) - évite recréation DOM */
let calendarStructureSnapshot = "";
/** Métriques live (durées) - mise à jour in-place */
let calendarMetricsSnapshot = "";
/** @type {Map<string, HTMLElement>} */
const blockDomByKey = new Map();
/** Rangées flex pour plusieurs sites au même créneau (mode empilé). */
const stackSlotRowDomByKey = new Map();
/** @type {object[]} */
let displayItems = [];
let openPickerDomKey = null;
/** @type {"open"|"active"} */
let calendarMetric = loadCalendarMetric();
/** Groupes dépliés dans le panneau courant : `${domKey}\u001f${groupKey}` */
const pickerExpandedGroups = new Set();
/** Structure liste panneau (groupes + onglets) - évite innerHTML si seules les durées changent */
let pickerListStructureSnapshot = "";
/** Clés `groupKey` des légendes doughnut - évite innerHTML si seules les durées changent */
const doughnutLegendStructureKeys = { week: "", day: "" };
/** @type {ReturnType<typeof setTimeout>|null} */
let doughnutResizeTimer = null;

const DISTRIBUTION_WEEK = {
  dualMetric: true,
  chartKeys: ["groupsActive", "groupsOpen"],
  canvasIds: ["chart-groups-active", "chart-groups-open"],
  legendId: "doughnut-legend",
  legendStateKey: "week"
};
const DISTRIBUTION_DAY = {
  dualMetric: false,
  chartKey: "groupsDay",
  canvasId: "chart-groups-day",
  legendId: "doughnut-legend-day",
  legendStateKey: "day"
};

const weekLabel = document.getElementById("week-label");
const dayHeaders = document.getElementById("day-headers");
const gridCols = document.getElementById("grid-cols");
const blocksLayer = document.getElementById("blocks-layer");
const timeAxis = document.getElementById("time-axis");
const gridScroll = document.getElementById("grid-scroll");
const nowLine = document.getElementById("now-line");
/** @type {number|null} */
let lastAutoScrollWeek = null;
const weekNav = document.getElementById("week-nav");
const blockModal = document.getElementById("block-modal");
const modalTitle = document.getElementById("modal-title");
const modalStats = document.getElementById("modal-stats");
const modalSessionsList = document.getElementById("modal-sessions-list");
const modalDayChartWrap = document.getElementById("modal-day-chart-wrap");
const modalDayChartCanvas = document.getElementById("modal-day-chart");
const modalDayChartEmpty = document.getElementById("modal-day-chart-empty");
let modalDayChart = null;
const blockPicker = document.getElementById("block-picker");
const blockPickerHeading = document.getElementById("block-picker-heading");
const blockPickerList = document.getElementById("block-picker-list");
const eraseModal = document.getElementById("erase-modal");
const eraseAmount = document.getElementById("erase-amount");
const eraseUnit = document.getElementById("erase-unit");
const eraseConfirmText = document.getElementById("erase-confirm-text");
const eraseConfirmBtn = document.getElementById("erase-confirm-btn");
const calendarZoomSlider = document.getElementById("calendar-zoom-y");
const calendarZoomValue = document.getElementById("calendar-zoom-y-value");
calendarZoomY = loadCalendarZoomY();
applyCalendarMetricUi();

document.querySelectorAll(".calendar-metric-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const metric = btn.getAttribute("data-calendar-metric");
    if (metric === "open" || metric === "active") setCalendarMetric(metric);
  });
});
applyCalendarZoomY(calendarZoomY, {
  preserveScroll: false,
  scrollToNow: isCurrentWeekDisplayed()
});

if (calendarZoomSlider) {
  calendarZoomSlider.value = String(calendarZoomY);
  calendarZoomSlider.addEventListener("input", (e) => {
    const raw = Number((/** @type {HTMLInputElement} */ (e.target)).value);
    const v = Math.min(
      CALENDAR_ZOOM_Y_MAX,
      Math.max(CALENDAR_ZOOM_Y_MIN, Number.isFinite(raw) ? raw : resolveCalendarZoomY())
    );
    calendarZoomY = v;
    try {
      sessionStorage.setItem(CALENDAR_ZOOM_Y_STORAGE, String(v));
    } catch {
      /* ignore */
    }
    applyCalendarZoomY(v, { scrollToNow: true, preserveScroll: true });
    scheduleBlockPickerReposition();
  });
}

if (gridScroll) {
  gridScroll.addEventListener("scroll", scheduleBlockPickerReposition, { passive: true });
}
window.addEventListener("resize", scheduleBlockPickerReposition, { passive: true });

const FILL_CHART_KEYS = ["daily", "activityTimeline"];
let fillChartResizeTimer = null;

function scheduleFillChartResize() {
  if (fillChartResizeTimer) clearTimeout(fillChartResizeTimer);
  fillChartResizeTimer = setTimeout(() => {
    fillChartResizeTimer = null;
    for (const key of FILL_CHART_KEYS) {
      if (charts[key]) charts[key].resize();
    }
  }, 150);
}

window.addEventListener("resize", scheduleFillChartResize, { passive: true });

document.getElementById("erase-data-btn").addEventListener("click", openEraseModal);
eraseModal.querySelectorAll("[data-close-erase-modal]").forEach((el) => {
  el.addEventListener("click", closeEraseModal);
});
eraseAmount.addEventListener("input", updateEraseConfirmText);
eraseUnit.addEventListener("change", updateEraseConfirmText);
eraseConfirmBtn.addEventListener("click", confirmErase);

document.getElementById("prev-week").addEventListener("click", () => {
  weekStart = addDays(weekStart, -7);
  render();
});
document.getElementById("next-week").addEventListener("click", () => {
  weekStart = addDays(weekStart, 7);
  render();
});
document.getElementById("today-btn").addEventListener("click", goToCurrentWeek);
document.getElementById("stats-goto-today").addEventListener("click", goToCurrentWeek);

document.getElementById("stats-day-prev")?.addEventListener("click", () => shiftStatsSelectedDay(-1));
document.getElementById("stats-day-next")?.addEventListener("click", () => shiftStatsSelectedDay(1));
document.getElementById("stats-day-picker")?.addEventListener("change", (e) => {
  const v = /** @type {HTMLInputElement} */ (e.target).value;
  if (v) setStatsSelectedDay(v);
});

function goToCurrentWeek() {
  weekStart = startOfWeek(new Date());
  setStatsSelectedDay(dateKeyFromTs(Date.now()), { skipRender: true });
  statsDataSnapshot = "";
  calendarStructureSnapshot = "";
  calendarMetricsSnapshot = "";
  lastAutoScrollWeek = null;
  render();
}

document.querySelectorAll(".main-tab").forEach((btn) => {
  btn.addEventListener("click", () => setMainTab(btn.dataset.tab));
});

document.querySelectorAll(".chart-card--day .stats-metric-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.metric;
    if (mode !== "active" && mode !== "open") return;
    if (mode === statsMetricMode) return;
    setStatsMetricMode(mode);
  });
});

document.getElementById("stats-day-export-csv")?.addEventListener("click", () => {
  exportStatsDaySummaryCsv();
});

document.querySelectorAll(".chart-card--insights .stats-metric-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const scope = btn.dataset.insightsScope;
    if (scope !== "week" && scope !== "day") return;
    if (scope === statsInsightsScope) return;
    setStatsInsightsScope(scope);
  });
});

blockModal.querySelectorAll("[data-close-modal]").forEach((el) => {
  el.addEventListener("click", closeModal);
});
modalSessionsList.addEventListener("click", (e) => {
  if (e.target instanceof Element && e.target.closest("a.modal-external-link")) {
    e.stopPropagation();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!eraseModal.classList.contains("hidden")) {
    closeEraseModal();
    return;
  }
  if (!blockPicker.classList.contains("hidden")) {
    closeBlockPicker();
    return;
  }
  if (!blockModal.classList.contains("hidden")) closeModal();
});

function openEraseModal() {
  updateEraseConfirmText();
  eraseModal.classList.remove("hidden");
  eraseAmount.focus();
  eraseAmount.select();
}

function closeEraseModal() {
  eraseModal.classList.add("hidden");
  eraseConfirmBtn.disabled = false;
  eraseConfirmBtn.textContent = "Effacer";
}

function erasePeriodPhrase(amount, unit) {
  const n = Math.max(1, Math.floor(Number(amount)) || 1);
  if (unit === "minutes") {
    return n === 1 ? "la dernire minute" : `les ${n} dernires minutes`;
  }
  if (unit === "hours") {
    return n === 1 ? "la dernire heure" : `les ${n} dernires heures`;
  }
  return n === 1 ? "le dernier jour" : `les ${n} derniers jours`;
}

function updateEraseConfirmText() {
  const amount = Math.max(1, Math.floor(Number(eraseAmount.value)) || 1);
  eraseAmount.value = String(amount);
  const unit = eraseUnit.value;
  const phrase = erasePeriodPhrase(amount, unit);
  eraseConfirmText.textContent = `Voulez-vous vraiment effacer ${phrase} ?`;
}

async function confirmErase() {
  const amount = Math.max(1, Math.floor(Number(eraseAmount.value)) || 1);
  const unit = eraseUnit.value;
  if (unit !== "minutes" && unit !== "hours" && unit !== "days") return;

  eraseConfirmBtn.disabled = true;
  eraseConfirmBtn.textContent = "Effacement...";

  try {
    const res = await chrome.runtime.sendMessage({
      type: "ERASE_DATA",
      amount,
      unit
    });
    if (!res?.ok) {
      eraseConfirmText.textContent = "Impossible d'effacer les donnees. Reessayez.";
      eraseConfirmBtn.disabled = false;
      eraseConfirmBtn.textContent = "Effacer";
      return;
    }
    closeEraseModal();
    statsDataSnapshot = "";
    calendarStructureSnapshot = "";
    calendarMetricsSnapshot = "";
    await render();
  } catch {
    eraseConfirmText.textContent = "Erreur de communication avec l'extension.";
    eraseConfirmBtn.disabled = false;
    eraseConfirmBtn.textContent = "Effacer";
  }
}

document.addEventListener("click", (e) => {
  if (blockPicker.classList.contains("hidden")) return;
  const t = /** @type {Node} */ (e.target);
  if (blockPicker.contains(t)) return;
  if (t instanceof Element && t.closest(".block.consolidated")) return;
  closeBlockPicker();
});

function loadStatsMetricMode() {
  try {
    const v = sessionStorage.getItem(STATS_METRIC_STORAGE);
    if (v === "open" || v === "active") return v;
  } catch {
    /* sessionStorage indisponible */
  }
  return "active";
}

/** @param {"active"|"open"} mode */
function setStatsMetricMode(mode) {
  statsMetricMode = mode;
  try {
    sessionStorage.setItem(STATS_METRIC_STORAGE, mode);
  } catch {
    /* ignore */
  }
  statsDataSnapshot = "";
  updateStatsMetricToggleUi();
  updateStatsChartTitles();
  renderCharts();
}

/** @param {"week"|"day"} scope */
function setStatsInsightsScope(scope) {
  statsInsightsScope = scope;
  updateInsightsScopeToggleUi();
  updateStatsChartTitles();
  // On rerender pour rafraichir les valeurs (surtout quand le jour change).
  statsDataSnapshot = "";
  renderCharts();
}

function formatBucketMinutesLabel(minutes) {
  if (minutes >= 60) return `${Math.round(minutes / 60)} h`;
  return `${minutes} min`;
}

function getTimelineBucketMinutes(scope) {
  if (scope === TIMELINE_SCOPE_WEEK || scope === TIMELINE_SCOPE_DAY) {
    return STATS_ACTIVITY_TIMELINE_BUCKET_MINUTES;
  }
  return STATS_ACTIVITY_TIMELINE_BUCKET_MINUTES;
}

function updateStatsMetricToggleUi() {
  document.querySelectorAll(".chart-card--day .stats-metric-btn").forEach((btn) => {
    const on = btn.dataset.metric === statsMetricMode;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function updateInsightsScopeToggleUi() {
  document.querySelectorAll(".chart-card--insights .stats-metric-btn").forEach((btn) => {
    const on = btn.dataset.insightsScope === statsInsightsScope;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const weekEl = document.getElementById("week-insights");
  const dayEl = document.getElementById("day-insights");
  if (weekEl) weekEl.hidden = statsInsightsScope !== "week";
  if (dayEl) dayEl.hidden = statsInsightsScope !== "day";
}

function statsMetricLabel() {
  return statsMetricMode === "open" ? "Ouvert" : "Actif";
}

function loadStatsSelectedDay() {
  try {
    const v = sessionStorage.getItem(STATS_DAY_STORAGE);
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  } catch {
    /* sessionStorage indisponible */
  }
  return null;
}

/** @returns {number|null} */
function readSavedCalendarZoomY() {
  try {
    const raw = sessionStorage.getItem(CALENDAR_ZOOM_Y_STORAGE);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= CALENDAR_ZOOM_Y_MIN && n <= CALENDAR_ZOOM_Y_MAX) return n;
  } catch {
    /* sessionStorage indisponible */
  }
  return null;
}

function hasSavedCalendarZoomY() {
  return readSavedCalendarZoomY() !== null;
}

function defaultCalendarZoomYForDisplayedWeek() {
  return isCurrentWeekDisplayed() ? CALENDAR_ZOOM_Y_DEFAULT_PRESENT : CALENDAR_ZOOM_Y_DEFAULT_OTHER;
}

function resolveCalendarZoomY() {
  const saved = readSavedCalendarZoomY();
  if (saved !== null) return saved;
  return defaultCalendarZoomYForDisplayedWeek();
}

function loadCalendarZoomY() {
  return resolveCalendarZoomY();
}

/** Sans clé `ogTimeTabCalendarZoomY` : 400 % sur la semaine courante, 100 % ailleurs. */
function syncCalendarZoomForDisplayedWeek() {
  if (hasSavedCalendarZoomY()) return;
  const target = defaultCalendarZoomYForDisplayedWeek();
  if (Math.abs(calendarZoomY - target) < 1e-6) return;
  applyCalendarZoomY(target, {
    preserveScroll: false,
    scrollToNow: isCurrentWeekDisplayed()
  });
}

function loadCalendarMetric() {
  try {
    const v = sessionStorage.getItem(CALENDAR_METRIC_STORAGE);
    if (v === "open" || v === "active") return v;
    const legacy = sessionStorage.getItem(CALENDAR_VIEW_MODE_STORAGE);
    if (legacy === "stack") return "open";
    if (legacy === "unstack") return "active";
  } catch {
    /* sessionStorage indisponible */
  }
  return "open";
}

function applyCalendarMetricUi() {
  document.querySelectorAll(".calendar-metric-btn").forEach((btn) => {
    const m = btn.getAttribute("data-calendar-metric");
    const on = m === calendarMetric;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const wrap = document.querySelector(".calendar-wrap");
  if (wrap) {
    wrap.classList.toggle("mode-active", calendarMetric === "active");
    wrap.classList.toggle("mode-open", calendarMetric === "open");
  }
}

/** @param {"open"|"active"} metric */
function setCalendarMetric(metric) {
  if (metric !== "open" && metric !== "active") return;
  if (metric === calendarMetric) return;
  calendarMetric = metric;
  try {
    sessionStorage.setItem(CALENDAR_METRIC_STORAGE, metric);
  } catch {
    /* ignore */
  }
  applyCalendarMetricUi();
  closeBlockPicker();
  calendarStructureSnapshot = "";
  calendarMetricsSnapshot = "";
  renderBlocks(renderedBlocks);
}

/**
 * Applique le zoom vertical sur le calendrier (recalcule grille + axe horaire + blocs).
 * @param {number} zoom
 * @param {{ preserveScroll?: boolean, scrollToNow?: boolean }} [options]
 */
function applyCalendarZoomY(zoom, options = {}) {
  const { preserveScroll = true, scrollToNow = false } = options;
  const z = Math.min(CALENDAR_ZOOM_Y_MAX, Math.max(CALENDAR_ZOOM_Y_MIN, Number(zoom) || 1));

  calendarZoomY = z;
  slotHPx = SLOT_H_BASE * calendarZoomY;

  document.documentElement.style.setProperty("--slot-h", `${slotHPx}px`);

  if (calendarZoomSlider) {
    calendarZoomSlider.value = String(calendarZoomY);
    const pct = Math.round(calendarZoomY * 100);
    calendarZoomSlider.setAttribute("aria-valuenow", String(pct));
    calendarZoomSlider.setAttribute("aria-valuetext", `${pct} pour cent`);
  }
  if (calendarZoomValue) calendarZoomValue.textContent = `${Math.round(calendarZoomY * 100)}%`;

  // Préserve la position de scroll (relatif), afin d'éviter un saut visuel.
  let scrollRatio = 0;
  if (preserveScroll && gridScroll) {
    const denom = gridScroll.scrollHeight - gridScroll.clientHeight;
    scrollRatio = denom > 0 ? gridScroll.scrollTop / denom : 0;
  }

  // Le zoom modifie la conversion min · px, donc l'axe horaire doit être recréé.
  buildTimeAxis();
  timeAxisBuilt = true;

  // Mets  jour la hauteur des colonnes déjà construites.
  if (gridCols) {
    gridCols.querySelectorAll(".col").forEach((col) => {
      col.style.minHeight = `${SLOTS_PER_DAY * slotHPx}px`;
    });
  }

  // Repositionne les blocs existants sans recharger les données.
  if (cachedDays && displayItems?.length && blockDomByKey.size > 0) {
    syncCalendarBlocks(displayItems, true);
    if (nowLine && !nowLine.hidden) updateNowLine(cachedDays);
  }

  if (!gridScroll) return;

  const today = new Date();
  const daysForScroll = cachedDays;
  const canScrollToNow =
    scrollToNow &&
    daysForScroll &&
    daysForScroll.some((d) => sameDay(d, today));

  if (canScrollToNow) {
    scrollCalendarToNow(daysForScroll);
  } else if (preserveScroll) {
    const denom2 = gridScroll.scrollHeight - gridScroll.clientHeight;
    gridScroll.scrollTop = denom2 > 0 ? scrollRatio * denom2 : 0;
  }
}

function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatStatsDayLabel(dayKey) {
  return parseDateKey(dayKey).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function csvEscapeCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatCsvDateTime(ts) {
  const d = new Date(toTimestamp(ts));
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

/**
 * Toutes les sessions du jour sélectionné (historique + live) pour export CSV.
 * @param {string} dayKey
 * @param {object[]} entries
 * @param {{ tabs?: object[] }} live
 */
function collectDaySummaryRows(dayKey, entries, live) {
  const rows = [];
  const nowTs = Date.now();
  for (const e of entries || []) {
    if (e.date !== dayKey) continue;
    const secs = coerceOpenActiveSeconds(e.openSeconds, e.activeSeconds);
    rows.push({
      date: dayKey,
      titre: e.title || "",
      url: e.url || "",
      groupe: e.groupKey || "",
      debut: formatCsvDateTime(e.start),
      fin: formatCsvDateTime(e.end),
      ouvert_secondes: secs.openSeconds,
      actif_secondes: secs.activeSeconds,
      ouvert: formatDurationShort(secs.openSeconds),
      actif: formatDurationShort(secs.activeSeconds),
      source: "historique"
    });
  }
  for (const t of live?.tabs || []) {
    const tabDay = dateKeyFromTs(t.segmentStart || t.openedAt);
    if (tabDay !== dayKey) continue;
    const secs = coerceOpenActiveSeconds(t.openSeconds, t.activeSeconds);
    rows.push({
      date: dayKey,
      titre: t.title || "",
      url: t.url || "",
      groupe: t.groupKey || "",
      debut: formatCsvDateTime(t.segmentStart || t.openedAt),
      fin: formatCsvDateTime(nowTs),
      ouvert_secondes: secs.openSeconds,
      actif_secondes: secs.activeSeconds,
      ouvert: formatDurationShort(secs.openSeconds),
      actif: formatDurationShort(secs.activeSeconds),
      source: "live"
    });
  }
  rows.sort((a, b) => String(a.debut).localeCompare(String(b.debut)));
  return rows;
}

function buildDaySummaryCsv(rows) {
  const headers = [
    "date",
    "titre",
    "url",
    "groupe",
    "debut",
    "fin",
    "ouvert_secondes",
    "actif_secondes",
    "ouvert",
    "actif",
    "source"
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscapeCell(row[h])).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

function downloadTextFile(filename, text, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Export CSV de toutes les sessions du jour affiché (Répartition par jour). */
function exportStatsDaySummaryCsv() {
  const dayKey = statsSelectedDay;
  const rows = collectDaySummaryRows(dayKey, cachedEntries, cachedLive);
  const csv = buildDaySummaryCsv(rows);
  downloadTextFile(`og-time-tab-resume-${dayKey}.csv`, csv);
}

/** @param {string} dayKey @param {{ skipRender?: boolean }} [options] */
function setStatsSelectedDay(dayKey, options = {}) {
  statsSelectedDay = dayKey;
  try {
    sessionStorage.setItem(STATS_DAY_STORAGE, dayKey);
  } catch {
    /* ignore */
  }
  updateStatsChartTitles();
  if (!options.skipRender) {
    statsDataSnapshot = "";
    renderCharts();
  }
}

function shiftStatsSelectedDay(delta) {
  const d = parseDateKey(statsSelectedDay);
  d.setDate(d.getDate() + delta);
  setStatsSelectedDay(dateKeyFromTs(d.getTime()));
}

function dayMetricTotal(dayKey, entries, live) {
  let open = 0;
  let active = 0;
  for (const e of entries) {
    if (e.date !== dayKey) continue;
    open += e.openSeconds;
    active += e.activeSeconds;
  }
  for (const t of live.tabs || []) {
    const dk = dateKeyFromTs(t.segmentStart || t.openedAt);
    if (dk !== dayKey) continue;
    open += t.openSeconds;
    active += t.activeSeconds;
  }
  return open + active;
}

function pickDefaultStatsDay(entries, live) {
  const today = dateKeyFromTs(Date.now());
  if (dayMetricTotal(today, entries, live) > 0) return today;
  const daily = aggregateLast14Days(entries, live);
  for (let i = daily.dateKeys.length - 1; i >= 0; i--) {
    if (daily.openValues[i] + daily.activeValues[i] > 0) return daily.dateKeys[i];
  }
  return today;
}

function updateStatsChartTitles() {
  const label = statsMetricLabel();
  const dailyTitle = document.getElementById("chart-daily-title");
  if (dailyTitle) dailyTitle.textContent = "Temps réel par jour (14 jours)";
  const groupsTitle = document.getElementById("chart-groups-title");
  if (groupsTitle) groupsTitle.textContent = `Répartition par site / groupe (${formatWeekRangeLabel()})`;
  const dayTitle = document.getElementById("chart-day-title");
  if (dayTitle) {
    dayTitle.textContent = `Répartition par jour - ${formatStatsDayLabel(statsSelectedDay)} (${label.toLowerCase()})`;
  }
  const picker = document.getElementById("stats-day-picker");
  if (picker instanceof HTMLInputElement) picker.value = statsSelectedDay;

  const insightsTitle = document.getElementById("insights-title");
  if (insightsTitle) {
    insightsTitle.textContent = statsInsightsScope === "day" ? "Insights jour" : "Insights semaine";
  }
  const timelineTitle = document.getElementById("chart-activity-timeline-title");
  const timelineScope = statsInsightsScope === TIMELINE_SCOPE_DAY ? TIMELINE_SCOPE_DAY : TIMELINE_SCOPE_WEEK;
  const bucketMinutes = getTimelineBucketMinutes(timelineScope);
  const bucketLabel = formatBucketMinutesLabel(bucketMinutes);
  if (timelineTitle) {
    timelineTitle.textContent =
      statsInsightsScope === "day"
        ? `Chronologie activité (profil bucket ${bucketLabel} - ${formatStatsDayLabel(statsSelectedDay)})`
        : `Chronologie activité (profil temporel bucket ${bucketLabel} - ${formatWeekRangeLabel()})`;
  }
}

function setMainTab(tab) {
  document.querySelectorAll(".main-tab").forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.getElementById("panel-calendar").classList.toggle("active", tab === "calendar");
  document.getElementById("panel-calendar").hidden = tab !== "calendar";
  document.getElementById("panel-stats").classList.toggle("active", tab === "stats");
  document.getElementById("panel-stats").hidden = tab !== "stats";
  weekNav.hidden = false;
  if (tab === "stats") {
    updateStatsMetricToggleUi();
    updateStatsChartTitles();
    statsDataSnapshot = "";
    renderCharts();
  }
}

function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDayHeader(d) {
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

function formatClock(ts) {
  return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function toTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/** Minutes depuis minuit en fuseau local. */
function localMinutesFromTs(ts) {
  const d = new Date(toTimestamp(ts));
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function clampCalendarMinutes(minutes) {
  return Math.max(CALENDAR_START_MIN, Math.min(CALENDAR_END_MIN, minutes));
}

function timeToY(minutesFromMidnight) {
  return ((minutesFromMidnight - CALENDAR_START_MIN) / SLOT_MIN) * slotHPx;
}

/** Pixels correspondant à `MIN_BLOCK_MINUTES` sur la grille (demi-créneau si SLOT_MIN = 30). */
function minBlockHeightPx() {
  return (MIN_BLOCK_MINUTES / SLOT_MIN) * slotHPx;
}

/** Plancher visuel mode Actif (sessions courtes cliquables). */
function activeMinBlockHeightPx() {
  return Math.max(
    (ACTIVE_MIN_VISUAL_MINUTES / SLOT_MIN) * slotHPx,
    ACTIVE_SINGLE_READABLE_MIN_PX
  );
}

/** Hauteur minimale d'un bloc Actif fusionné selon le nombre de lignes. */
function activeFusedMinHeightPx(lineCount) {
  const n = Math.max(1, lineCount);
  return (
    ACTIVE_FUSED_PAD_PX * 2 +
    n * ACTIVE_FUSED_LINE_MIN_PX +
    Math.max(0, n - 1) * 2
  );
}

function calendarBlockMinHeightPx() {
  return calendarMetric === "open" ? minBlockHeightPx() : activeMinBlockHeightPx();
}

/**
 * Calcule top/hauteur en ancrant la fin réelle (bas = endMin).
 * Si la durée réelle est plus courte que le plancher lisible, on étend vers le haut
 * (pas vers le bas) pour ne pas dépasser visuellement l'heure de fin.
 */
function layoutBlockVerticalRange(startMin, endMin, useMinBlockHeight, minHeightPxOverride) {
  const start = clampCalendarMinutes(startMin);
  const end = clampCalendarMinutes(endMin);
  const topBase = timeToY(start);
  const endY = timeToY(end);
  const realDurationPx = Math.max(0, endY - topBase);
  const minH = useMinBlockHeight
    ? minHeightPxOverride ?? calendarBlockMinHeightPx()
    : 0;
  const height = Math.max(realDurationPx, minH);
  const top = height > realDurationPx ? endY - height : topBase;
  const realHeightFrac =
    height <= 0 ? 1 : Math.min(1, Math.max(0, realDurationPx / height));
  return { top, height, realHeightFrac, visualEndMin: end, visualStartMin: start };
}

function formatClockFromMinutes(minutesFromMidnight) {
  const total = Math.round(minutesFromMidnight);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function buildTimeAxis() {
  timeAxis.innerHTML = "";
  document.documentElement.style.setProperty("--calendar-slots", String(SLOTS_PER_DAY));
  document.documentElement.style.setProperty("--slot-h", `${slotHPx}px`);
  document.documentElement.style.setProperty("--block-min-h", `${minBlockHeightPx()}px`);
  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    const el = document.createElement("div");
    el.style.height = `${slotHPx}px`;
    const slotStartMin = CALENDAR_START_MIN + i * SLOT_MIN;
    if (slotStartMin % 60 === 0) {
      const h = Math.floor(slotStartMin / 60);
      el.textContent = `${String(h).padStart(2, "0")}:00`;
    }
    timeAxis.appendChild(el);
  }
}

function buildGridColumns() {
  const today = new Date();
  dayHeaders.innerHTML = "";
  gridCols.innerHTML = "";
  blockDomByKey.forEach((el) => el.remove());
  blockDomByKey.clear();
  stackSlotRowDomByKey.forEach((row) => row.remove());
  stackSlotRowDomByKey.clear();
  closeBlockPicker();

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    days.push(d);

    const head = document.createElement("div");
    head.className = "day" + (sameDay(d, today) ? " today" : "");
    head.textContent = formatDayHeader(d);
    dayHeaders.appendChild(head);

    const col = document.createElement("div");
    col.className = "col" + (sameDay(d, today) ? " today" : "");
    col.dataset.dayIndex = String(i);
    col.style.minHeight = `${SLOTS_PER_DAY * slotHPx}px`;
    gridCols.appendChild(col);
  }

  const end = addDays(weekStart, 6);
  weekLabel.textContent = `${weekStart.toLocaleDateString("fr-FR")} - ${end.toLocaleDateString("fr-FR")}`;
  return days;
}

function collectBlocks(entries, live) {
  const blocks = [];
  const weekEnd = addDays(weekStart, 7).getTime();

  for (const e of entries) {
    if (e.end < weekStart.getTime() || e.start >= weekEnd) continue;
    const secs = coerceOpenActiveSeconds(e.openSeconds, e.activeSeconds);
    blocks.push({
      title: e.title,
      url: e.url,
      groupKey: e.groupKey,
      start: e.start,
      end: e.end,
      activeSeconds: secs.activeSeconds,
      openSeconds: secs.openSeconds,
      date: e.date,
      isLive: false,
      entryId: e.id
    });
  }

  for (const t of live.tabs || []) {
    const start = t.segmentStart || t.openedAt;
    const nowTs = Date.now();
    if (start > nowTs) continue;
    const secs = coerceOpenActiveSeconds(t.openSeconds, t.activeSeconds);
    const approxEndTs = Math.min(nowTs, toTimestamp(start) + secs.openSeconds * 1000);
    const isLiveNow = approxEndTs >= nowTs - LIVE_END_GRACE_MS;
    if (approxEndTs <= toTimestamp(start)) continue;
    blocks.push({
      title: t.title,
      url: t.url,
      groupKey: t.groupKey,
      start,
      end: approxEndTs,
      activeSeconds: secs.activeSeconds,
      openSeconds: secs.openSeconds,
      lastActivityAt: t.lastActivityAt || null,
      date: dateKeyFromTs(start),
      isLive: isLiveNow,
      entryId: null
    });
  }

  return blocks;
}

function dateKeyFromTs(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function blockMemberKey(b, index) {
  if (b.entryId) return `e:${b.entryId}`;
  if (b.isLive) return `live:${b.url}:${b.start}`;
  return `i:${index}:${b.start}:${b.url}`;
}

/** Timestamp local depuis minutes depuis minuit pour une colonne jour. */
function minutesToTimestamp(dayIdx, minutes) {
  const colDay = addDays(weekStart, dayIdx);
  colDay.setHours(0, 0, 0, 0);
  return colDay.getTime() + minutes * 60000;
}

/**
 * Tronque un bloc a l'heure courante (plage ouverte) pour le calendrier.
 * Retourne null si le debut est strictement futur ou si la duree visible est nulle.
 */
function normalizeBlockOpenRange(b, dayIdx, nowTs = Date.now()) {
  const start = toTimestamp(b.start);
  let end = toTimestamp(b.end);
  if (start > nowTs) return null;
  if (end > nowTs) end = nowTs;
  if (end <= start) return null;
  const vr = visualRangeForDayColumn(start, end, dayIdx);
  return {
    ...b,
    start,
    end,
    visualStartMin: vr.visualStartMin,
    visualEndMin: vr.visualEndMin,
    displayStart: start,
    displayEnd: end
  };
}

/**
 * Plage visuelle mode Actif : duree et position basees sur le temps actif uniquement
 * (pas la plage d'ouverture de l'onglet). Ancrage sur lastActivityAt si disponible, sinon fin de session.
 */
function normalizeBlockActiveRange(b, dayIdx, nowTs = Date.now()) {
  const openNorm = normalizeBlockOpenRange(b, dayIdx, nowTs);
  if (!openNorm || openNorm.activeSeconds < ACTIVE_MIN_DISPLAY_SECONDS) return null;

  const activeMinutes = openNorm.activeSeconds / 60;
  const openStartMin = openNorm.visualStartMin;
  const openEndMin = openNorm.visualEndMin;

  let activeEndMin = openEndMin;
  if (b.lastActivityAt) {
    const colDay = addDays(weekStart, dayIdx);
    colDay.setHours(0, 0, 0, 0);
    const actMin = (toTimestamp(b.lastActivityAt) - colDay.getTime()) / 60000;
    activeEndMin = clampCalendarMinutes(Math.min(openEndMin, Math.max(openStartMin, actMin)));
  }

  let activeStartMin = activeEndMin - activeMinutes;
  if (activeStartMin < openStartMin) {
    activeStartMin = openStartMin;
    activeEndMin = Math.min(openEndMin, activeStartMin + activeMinutes);
  }
  activeEndMin = Math.max(activeStartMin, activeEndMin);

  return {
    ...openNorm,
    visualStartMin: activeStartMin,
    visualEndMin: activeEndMin,
    displayStart: minutesToTimestamp(dayIdx, activeStartMin),
    displayEnd: minutesToTimestamp(dayIdx, activeEndMin)
  };
}

/** Normalise un bloc selon la metrique calendrier courante (Ouvert ou Actif). */
function normalizeBlockForCalendar(b, dayIdx, nowTs = Date.now()) {
  return calendarMetric === "active"
    ? normalizeBlockActiveRange(b, dayIdx, nowTs)
    : normalizeBlockOpenRange(b, dayIdx, nowTs);
}

/** Range de minutes visuelles pour une colonne jour (alignee sur minuit local de la colonne). */
function visualRangeForDayColumn(startTs, endTs, dayIdx) {
  const colDay = addDays(weekStart, dayIdx);
  colDay.setHours(0, 0, 0, 0);
  const dayMidTs = colDay.getTime();
  const start = toTimestamp(startTs);
  const end = toTimestamp(endTs);
  const startMin = (start - dayMidTs) / 60000;
  const endMin = (end - dayMidTs) / 60000;
  const visualStartMin = clampCalendarMinutes(startMin);
  let visualEndMin = clampCalendarMinutes(endMin);
  if (visualEndMin < visualStartMin) visualEndMin = visualStartMin;
  return { visualStartMin, visualEndMin };
}

/** Plage etendue pour le clustering (mode Ouvert : min 15 min ; Actif : duree active reelle). */
function clusterVisualRange(b) {
  const start = b.visualStartMin;
  let end = b.visualEndMin;
  if (calendarMetric === "open" && end - start < MIN_BLOCK_MINUTES) {
    end = start + MIN_BLOCK_MINUTES;
  }
  return { visualStartMin: start, visualEndMin: end };
}

function blocksTimeOverlap(a, b) {
  return a.visualStartMin < b.visualEndMin && b.visualStartMin < a.visualEndMin;
}

/** Fusionne les rafales actives du même site si elles sont proches (vue Actif plus lisible). */
function mergeSameSiteActiveBlocks(dayBlocks) {
  if (!dayBlocks.length) return dayBlocks;
  const sorted = [...dayBlocks].sort((a, b) => a.visualStartMin - b.visualStartMin);
  /** @type {object[]} */
  const out = [];
  let cur = null;
  for (const b of sorted) {
    const key = b.groupKey || "?";
    const gap = cur ? b.visualStartMin - cur.visualEndMin : Infinity;
    const segment = {
      visualStartMin: b.visualStartMin,
      visualEndMin: b.visualEndMin,
      activeSeconds: b.activeSeconds || 0
    };
    if (!cur || cur.groupKey !== key || gap > ACTIVE_MERGE_GAP_MINUTES) {
      if (cur) out.push(cur);
      cur = {
        ...b,
        activeSegments: b.activeSegments?.length ? [...b.activeSegments] : [segment]
      };
      continue;
    }
    cur.activeSeconds = (cur.activeSeconds || 0) + (b.activeSeconds || 0);
    cur.openSeconds = (cur.openSeconds || 0) + (b.openSeconds || 0);
    cur.visualEndMin = Math.max(cur.visualEndMin, b.visualEndMin);
    cur.end = Math.max(cur.end, b.end);
    if (!cur.activeSegments) cur.activeSegments = [];
    if (b.activeSegments?.length) cur.activeSegments.push(...b.activeSegments);
    else cur.activeSegments.push(segment);
    if (b.lastActivityAt && (!cur.lastActivityAt || b.lastActivityAt > cur.lastActivityAt)) {
      cur.lastActivityAt = b.lastActivityAt;
    }
    if (b.isLive) cur.isLive = true;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Segments actifs (minutes colonne) pour une carte site — union visuelle des rafales.
 * @param {object} item
 * @returns {{ visualStartMin: number, visualEndMin: number }[]}
 */
function collectActiveSegmentsForItem(item) {
  /** @type {{ visualStartMin: number, visualEndMin: number }[]} */
  const raw = [];
  for (const m of item.members || []) {
    if (Array.isArray(m.activeSegments) && m.activeSegments.length) {
      for (const seg of m.activeSegments) {
        if (seg.visualEndMin > seg.visualStartMin) {
          raw.push({
            visualStartMin: seg.visualStartMin,
            visualEndMin: seg.visualEndMin
          });
        }
      }
    } else if (m.visualEndMin > m.visualStartMin) {
      raw.push({
        visualStartMin: m.visualStartMin,
        visualEndMin: m.visualEndMin
      });
    }
  }
  if (!raw.length) return [];
  const sorted = raw.sort((a, b) => a.visualStartMin - b.visualStartMin);
  const merged = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.visualStartMin <= cur.visualEndMin) {
      cur.visualEndMin = Math.max(cur.visualEndMin, s.visualEndMin);
      continue;
    }
    merged.push(cur);
    cur = { ...s };
  }
  merged.push(cur);
  return merged;
}

/**
 * Série O/A pour mini-graphique carte Actif (buckets sur la plage visuelle).
 * @param {object} item
 * @returns {{ open: number[], active: number[] } | null}
 */
function buildActiveCardSparkSeries(item) {
  const spanStart = item.visualStartMin;
  const spanEnd = item.visualEndMin;
  const span = spanEnd - spanStart;
  if (!(span > 0)) return null;

  const targetBuckets = 28;
  const bucketMin = Math.max(0.5, span / targetBuckets);
  const n = Math.max(2, Math.ceil(span / bucketMin));
  const open = new Array(n).fill(0);
  const active = new Array(n).fill(0);

  const addCoverage = (arr, fromMin, toMin) => {
    const a = Math.max(spanStart, fromMin);
    const b = Math.min(spanEnd, toMin);
    if (!(b > a)) return;
    const i0 = Math.max(0, Math.floor((a - spanStart) / bucketMin));
    const i1 = Math.min(n - 1, Math.floor((b - spanStart - 1e-9) / bucketMin));
    for (let i = i0; i <= i1; i++) {
      const bucketStart = spanStart + i * bucketMin;
      const bucketEnd = Math.min(spanEnd, bucketStart + bucketMin);
      const overlap = Math.min(b, bucketEnd) - Math.max(a, bucketStart);
      if (overlap > 0) arr[i] += overlap / Math.max(bucketEnd - bucketStart, 1e-9);
    }
  };

  for (const m of item.members || []) {
    const colDay = addDays(weekStart, item.dayIdx ?? 0);
    colDay.setHours(0, 0, 0, 0);
    const dayMid = colDay.getTime();
    const oStart = m.start != null ? (toTimestamp(m.start) - dayMid) / 60000 : m.visualStartMin;
    const oEnd = m.isLive
      ? (Date.now() - dayMid) / 60000
      : m.end != null
      ? (toTimestamp(m.end) - dayMid) / 60000
      : m.visualEndMin;
    addCoverage(open, oStart, oEnd);
  }

  for (const seg of collectActiveSegmentsForItem(item)) {
    addCoverage(active, seg.visualStartMin, seg.visualEndMin);
  }

  // Cap 0..1 et garantir A ≤ O par bucket.
  for (let i = 0; i < n; i++) {
    open[i] = Math.min(1, open[i]);
    active[i] = Math.min(open[i], Math.min(1, active[i]));
  }
  return { open, active };
}

/** Chemin SVG aire (x = intensité 0..100, y = temps 0..100 haut→bas). */
function sparkSeriesToAreaPath(values) {
  const n = values.length;
  if (!n) return "";
  const parts = [`M 0 0`];
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : (i / (n - 1)) * 100;
    const x = Math.max(0, Math.min(100, values[i] * 100));
    parts.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  parts.push(`L 0 100 Z`);
  return parts.join(" ");
}

/**
 * Mini-graphique O/A vertical dans la carte Actif (style modal, timeline haut → bas).
 * @param {HTMLElement} el
 * @param {object} item
 */
function syncActiveStripes(el, item) {
  let layer = el.querySelector(".block-active-spark");
  if (calendarMetric !== "active" || item.type === "stack-overflow") {
    if (layer) layer.remove();
    el.querySelector(".block-active-stripes")?.remove();
    return;
  }
  const series = buildActiveCardSparkSeries(item);
  if (!series || (!series.open.some((v) => v > 0.02) && !series.active.some((v) => v > 0.02))) {
    if (layer) layer.remove();
    return;
  }

  const structKey = `${series.open.map((v) => v.toFixed(2)).join(",")}|${series.active
    .map((v) => v.toFixed(2))
    .join(",")}`;
  if (!layer) {
    el.querySelector(".block-active-stripes")?.remove();
    layer = document.createElement("div");
    layer.className = "block-active-spark";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = `<svg class="block-active-spark-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
      <path class="block-active-spark-open"></path>
      <path class="block-active-spark-active"></path>
    </svg>`;
    el.prepend(layer);
  }
  if (layer.dataset.sparkKey === structKey) return;
  layer.dataset.sparkKey = structKey;
  const openPath = layer.querySelector(".block-active-spark-open");
  const activePath = layer.querySelector(".block-active-spark-active");
  if (openPath) openPath.setAttribute("d", sparkSeriesToAreaPath(series.open));
  if (activePath) activePath.setAttribute("d", sparkSeriesToAreaPath(series.active));
}

function siteVisibleMaxForMetric() {
  return calendarMetric === "active" ? ACTIVE_SITE_VISIBLE_MAX : STACK_SITE_VISIBLE_MAX;
}

function blocksStackClusterable(a, b) {
  const ar = clusterVisualRange(a);
  const br = clusterVisualRange(b);
  const g = STACK_CLUSTER_GAP_MIN;
  return ar.visualStartMin < br.visualEndMin + g && br.visualStartMin < ar.visualEndMin + g;
}

function clusterBlocksOverlap(a, b) {
  return blocksStackClusterable(a, b);
}

/** @param {object[]} dayBlocks */
function clusterDayBlocks(dayBlocks) {
  const n = dayBlocks.length;
  const parent = dayBlocks.map((_, i) => i);
  const find = (i) => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };
  const union = (i, j) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (clusterBlocksOverlap(dayBlocks[i], dayBlocks[j])) union(i, j);
    }
  }
  const clusters = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(dayBlocks[i]);
  }
  return consolidateDenseStackClusters([...clusters.values()]);
}

/** Fusionne les clusters trop nombreux dans le meme creneau de 15 min (mode empile). */
function consolidateDenseStackClusters(clusters) {
  let current = clusters;
  let changed = true;
  while (changed) {
    changed = false;
    /** @type {Map<number, number[]>} */
    const byBin = new Map();
    for (let i = 0; i < current.length; i++) {
      const start = Math.min(...current[i].map((b) => b.visualStartMin));
      const bin = Math.floor(start / MIN_BLOCK_MINUTES) * MIN_BLOCK_MINUTES;
      if (!byBin.has(bin)) byBin.set(bin, []);
      byBin.get(bin).push(i);
    }
    for (const indices of byBin.values()) {
      if (indices.length <= MAX_STACK_BLOCKS_PER_BIN) continue;
      const merged = indices.flatMap((i) => current[i]);
      const keep = current.filter((_, i) => !indices.includes(i));
      keep.push(merged);
      current = keep;
      changed = true;
      break;
    }
  }
  return current;
}

/** @param {object[]} sessions */
function groupSessionsByGroupKey(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const key = s.groupKey || "?";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return [...map.entries()].map(([groupKey, members]) => ({ groupKey, members }));
}

/** @param {object[]} members */
function dedupeBlockMembers(members) {
  const seen = new Set();
  const out = [];
  for (const m of members) {
    const id = blockMemberKey(m, m.blockIndex);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(m);
  }
  return out;
}

function stackSiteCardTitle(item) {
  if (item.groupKey) {
    const label = formatGroupLabel(item.groupKey);
    if (item.count <= 1) return label;
    return `${label} · ${item.count} onglets`;
  }
  return item.count === 1 ? "1 onglet" : `${item.count} onglets`;
}

/** @param {number} dayIdx @param {object[]} members @param {string} groupKey */
function buildStackSiteGroupItem(dayIdx, members, groupKey) {
  const sorted = [...members].sort((a, c) => c.activeSeconds - a.activeSeconds);
  const keys = sorted.map((m) => blockMemberKey(m, m.blockIndex)).sort();
  const visualStartMin = Math.min(...sorted.map((m) => m.visualStartMin));
  // Garde de cohérence: la carte ne dépasse jamais la borne max de ses sessions source.
  const visualEndMin = Math.max(...sorted.map((m) => m.visualEndMin));
  const domKey = `gs:${dayIdx}:${groupKey}:${keys.join("|")}`;
  return {
    type: "group",
    groupKey,
    domKey,
    dayIdx,
    members: sorted,
    blockIndices: sorted.map((m) => m.blockIndex),
    start: Math.min(...sorted.map((m) => m.start)),
    end: Math.max(...sorted.map((m) => m.end)),
    displayStart: minutesToTimestamp(dayIdx, visualStartMin),
    displayEnd: minutesToTimestamp(dayIdx, visualEndMin),
    visualStartMin,
    visualEndMin,
    count: sorted.length
  };
}

/**
 * 1 carte par site (groupKey) par creneau 15 min.
 * @param {number} dayIdx
 * @param {object[]} clusters
 * @param {"open"|"active"} metric
 */
function buildMetricDisplayItems(dayIdx, clusters, metric) {
  const slotBinMinutes = metric === "active" ? ACTIVE_STACK_BIN_MINUTES : MIN_BLOCK_MINUTES;
  /** @type {Map<string, object[]>} */
  const byBinSite = new Map();
  for (const cluster of clusters) {
    for (const { groupKey, members } of groupSessionsByGroupKey(cluster)) {
      if (metric === "active") {
        const totalActive = members.reduce((s, m) => s + m.activeSeconds, 0);
        if (totalActive < ACTIVE_MIN_DISPLAY_SECONDS) continue;
      }
      const bin =
        Math.floor(Math.min(...members.map((m) => m.visualStartMin)) / slotBinMinutes) *
        slotBinMinutes;
      const k = `${bin}\u0000${groupKey}`;
      if (!byBinSite.has(k)) byBinSite.set(k, []);
      byBinSite.get(k).push(...members);
    }
  }
  const items = [];
  for (const [, raw] of byBinSite) {
    const members = dedupeBlockMembers(raw);
    const groupKey = members[0]?.groupKey || "?";
    items.push(buildStackSiteGroupItem(dayIdx, members, groupKey));
  }
  return items;
}

/** Mode Ouvert : tous les onglets ouverts, plage ouverture. */
function buildOpenDisplayItems(dayIdx, clusters) {
  return buildMetricDisplayItems(dayIdx, clusters, "open");
}

/** Mode Actif : plage visuelle = segments actifs uniquement. */
function buildActiveDisplayItems(dayIdx, clusters) {
  return buildMetricDisplayItems(dayIdx, clusters, "active");
}

function activeGroupItemsOverlap(a, b) {
  return a.visualStartMin < b.visualEndMin && b.visualStartMin < a.visualEndMin;
}

/** @param {object[]} groupItems */
function buildActiveFusedItem(groupItems) {
  const lines = [...groupItems].sort((a, b) => {
    if (a.visualStartMin !== b.visualStartMin) return a.visualStartMin - b.visualStartMin;
    return (a.groupKey || "").localeCompare(b.groupKey || "");
  });
  const dayIdx = lines[0].dayIdx;
  const visualStartMin = Math.min(...lines.map((l) => l.visualStartMin));
  const visualEndMin = Math.max(...lines.map((l) => l.visualEndMin));
  const domKey = `af:${dayIdx}:${lines
    .map((l) => l.domKey)
    .sort()
    .join("|")}`;
  return {
    type: "active-fused",
    domKey,
    dayIdx,
    lines,
    lineCount: lines.length,
    start: Math.min(...lines.map((l) => l.start)),
    end: Math.max(...lines.map((l) => l.end)),
    displayStart: minutesToTimestamp(dayIdx, visualStartMin),
    displayEnd: minutesToTimestamp(dayIdx, visualEndMin),
    visualStartMin,
    visualEndMin
  };
}

/**
 * Mode Actif : blocs qui se chevauchent → un seul bloc fusionné (lignes chronologiques).
 * @param {object[]} items
 * @returns {object[]}
 */
function fuseOverlappingActiveItems(items) {
  const groups = items.filter((it) => it.type === "group");
  const others = items.filter((it) => it.type !== "group");
  if (groups.length === 0) return items;

  const n = groups.length;
  const parent = groups.map((_, i) => i);
  const find = (i) => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };
  const union = (i, j) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (activeGroupItemsOverlap(groups[i], groups[j])) union(i, j);
    }
  }

  /** @type {Map<number, object[]>} */
  const clusters = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(groups[i]);
  }

  const out = [];
  for (const cluster of clusters.values()) {
    if (cluster.length === 1) {
      clearStackSlotRowProps(cluster[0]);
      clearLaneProps(cluster[0]);
      out.push(cluster[0]);
      continue;
    }
    for (const it of cluster) {
      clearStackSlotRowProps(it);
      clearLaneProps(it);
    }
    out.push(buildActiveFusedItem(cluster));
  }
  return [...out, ...others];
}

function clearStackSlotRowProps(it) {
  delete it.stackSlotKey;
  delete it.stackLaneCount;
  delete it.stackSlotStartMin;
  delete it.stackSlotEndMin;
  delete it.slotAccentColor;
  delete it.lane;
  delete it.laneCount;
  delete it.stackLane;
  delete it.stackLayout;
  delete it.stackHidden;
}

function clearLaneProps(it) {
  delete it.lane;
  delete it.laneCount;
}

function stackLayoutBinMinutes() {
  return calendarMetric === "active" ? ACTIVE_STACK_BIN_MINUTES : MIN_BLOCK_MINUTES;
}

/** @param {object[]} group @param {string} stackSlotKey @param {number} slotStartMin @param {number} slotEndMin */
function buildStackSlotOverflowItem(group, stackSlotKey, slotStartMin, slotEndMin) {
  const dayIdx = group[0].dayIdx;
  const binMinutes = stackLayoutBinMinutes();
  const bin = Math.floor(slotStartMin / binMinutes) * binMinutes;
  return {
    type: "stack-overflow",
    domKey: `stack-overflow:${stackSlotKey}`,
    dayIdx,
    stackSlotKey,
    stackSlotStartMin: slotStartMin,
    stackSlotEndMin: slotEndMin,
    stackLaneCount: group.length,
    slotItems: group.slice(),
    overflowExtra: group.length - siteVisibleMaxForMetric(),
    start: Math.min(...group.map((it) => it.start)),
    end: Math.max(...group.map((it) => it.end)),
    visualStartMin: slotStartMin,
    visualEndMin: slotEndMin,
    bin
  };
}

/**
 * Même créneau 15 min : rangée horizontale (max 4 cartes + « +N »).
 * @param {object[]} items
 * @returns {object[]}
 */
function assignStackSiteLayout(items) {
  const binMinutes = stackLayoutBinMinutes();
  const visibleMax = siteVisibleMaxForMetric();
  /* Actif utilise les lanes horizontales (ex-Ouvert) ; pile verticale désactivée. */
  const useActiveColumn = false;
  /** @type {Map<string, object[]>} */
  const bySlot = new Map();
  for (const it of items) {
    if (it.type !== "group") continue;
    const bin = Math.floor(it.visualStartMin / binMinutes) * binMinutes;
    const k = `${it.dayIdx}:${bin}`;
    if (!bySlot.has(k)) bySlot.set(k, []);
    bySlot.get(k).push(it);
  }
  const out = [];
  const slotted = new Set();
  for (const [slotKey, group] of bySlot) {
    for (const it of group) slotted.add(it);
    if (group.length <= 1) {
      clearStackSlotRowProps(group[0]);
      clearLaneProps(group[0]);
      out.push(group[0]);
      continue;
    }
    group.sort((a, b) => {
      const aA = a.members.reduce((s, m) => s + m.activeSeconds, 0);
      const bA = b.members.reduce((s, m) => s + m.activeSeconds, 0);
      if (bA !== aA) return bA - aA;
      return (a.groupKey || "").localeCompare(b.groupKey || "");
    });
    const slotStartMin = Math.min(...group.map((it) => it.visualStartMin));
    const slotEndMin = Math.max(...group.map((it) => it.visualEndMin));
    const visibleCount = Math.min(visibleMax, group.length);
    const slotColorMap = assignColorsForItems(group.map((it) => ({ groupKey: it.groupKey || "?" })));
    const n = group.length;
    const laneTotal = visibleCount + (n > visibleMax ? 1 : 0);
    for (let i = 0; i < visibleCount; i++) {
      const it = group[i];
      clearStackSlotRowProps(it);
      if (useActiveColumn) {
        it.stackSlotKey = slotKey;
        it.stackSlotStartMin = slotStartMin;
        it.stackSlotEndMin = slotEndMin;
        it.stackLaneCount = laneTotal;
      }
      it.lane = i;
      it.laneCount = laneTotal;
      it.slotAccentColor = slotColorMap.get(it.groupKey || "?");
      out.push(it);
    }
    if (n > visibleMax) {
      const overflow = buildStackSlotOverflowItem(group, slotKey, slotStartMin, slotEndMin);
      clearStackSlotRowProps(overflow);
      if (useActiveColumn) {
        overflow.stackLaneCount = laneTotal;
      }
      overflow.lane = visibleCount;
      overflow.laneCount = laneTotal;
      out.push(overflow);
    }
  }
  for (const it of items) {
    if (!slotted.has(it)) out.push(it);
  }
  return out;
}

function buildDisplayItems(blocks) {
  const nowTs = Date.now();
  const indexed = blocks.map((b, i) => ({ ...b, blockIndex: i }));
  const byDay = new Map();
  for (const b of indexed) {
    const dayIdx = dayIndexForBlock(b);
    if (dayIdx < 0 || dayIdx > 6) continue;
    const block = normalizeBlockForCalendar(b, dayIdx, nowTs);
    if (!block) continue;
    if (!byDay.has(dayIdx)) byDay.set(dayIdx, []);
    byDay.get(dayIdx).push(block);
  }

  const items = [];
  for (const [dayIdx, dayBlocks] of byDay) {
    if (dayBlocks.length === 0) continue;
    let blocksForDay = dayBlocks;
    if (calendarMetric === "active") {
      blocksForDay = mergeSameSiteActiveBlocks(dayBlocks);
    }
    const clusters = clusterDayBlocks(blocksForDay);
    const dayItems =
      calendarMetric === "active"
        ? buildActiveDisplayItems(dayIdx, clusters)
        : buildOpenDisplayItems(dayIdx, clusters);
    /* Présentation inversée (v1.0.84) : Actif = côte à côte (ex-Ouvert) ; Ouvert = fusion (ex-Actif). */
    items.push(
      ...(calendarMetric === "active"
        ? assignStackSiteLayout(dayItems)
        : fuseOverlappingActiveItems(dayItems))
    );
  }
  return items;
}

function calendarStructurePayload(items) {
  return JSON.stringify(
    items.map((it) => ({
      k: it.domKey,
      t: it.type,
      d: it.dayIdx,
      s: Math.round(it.visualStartMin),
      e: Math.round(it.visualEndMin),
      ...(it.type === "group"
        ? {
            c: it.count,
            gk: it.groupKey || "",
            m: it.members.map((m) => blockMemberKey(m, m.blockIndex)).sort(),
            sc: it.stackLaneCount ?? 1,
            sk: it.stackSlotKey || "",
            ln: it.lane ?? 0,
            lc: it.laneCount ?? 1
          }
        : it.type === "active-fused"
        ? {
            n: it.lineCount ?? it.lines?.length ?? 0,
            m: (it.lines || []).map((l) => l.domKey).sort()
          }
        : it.type === "stack-overflow"
        ? {
            c: it.overflowExtra,
            sk: it.stackSlotKey || ""
          }
        : {
            b: blockMemberKey(it.block, it.blockIndex)
          })
    }))
  );
}

function calendarMetricsPayload(items) {
  return JSON.stringify(
    items.map((it) => {
      if (it.type === "stack-overflow") {
        return { k: it.domKey, overflow: it.overflowExtra ?? 0 };
      }
      if (it.type === "active-fused") {
        return {
          k: it.domKey,
          rows: (it.lines || []).map((line) => ({
            k: line.domKey,
            gk: line.groupKey || "",
            a: line.members.reduce((s, m) => s + m.activeSeconds, 0),
            o: line.members.reduce((s, m) => s + m.openSeconds, 0),
            s: line.visualStartMin,
            e: line.visualEndMin
          }))
        };
      }
      if (it.type === "single") {
        const b = it.block;
        return { k: it.domKey, a: b.activeSeconds, o: b.openSeconds, end: b.end, title: b.title };
      }
      return {
        k: it.domKey,
        rows: it.members.map((m) => ({
          i: m.blockIndex,
          a: m.activeSeconds,
          o: m.openSeconds,
          end: m.end,
          title: m.title,
          url: m.url
        }))
      };
    })
  );
}

function blockLayout(item, cols, gridRect, options = {}) {
  const col = cols[item.dayIdx];
  if (!col) return null;

  const useSharedStackSlot =
    item.type === "group" &&
    (item.stackLaneCount ?? 0) > 1 &&
    item.stackSlotStartMin != null &&
    item.stackSlotEndMin != null;

  const startMin = useSharedStackSlot
    ? item.stackSlotStartMin
    : item.visualStartMin ?? localMinutesFromTs(item.start);
  const endMin = useSharedStackSlot
    ? item.stackSlotEndMin
    : item.visualEndMin ?? localMinutesFromTs(item.end);
  const useOpenMin = options.useMinBlockHeight ?? true;
  let minHeightOverride = options.minHeightPx;
  if (minHeightOverride == null && item.type === "active-fused") {
    minHeightOverride = activeFusedMinHeightPx(item.lineCount ?? item.lines?.length ?? 1);
  }
  const vertical = layoutBlockVerticalRange(startMin, endMin, useOpenMin, minHeightOverride);
  const top = vertical.top;
  const height = vertical.height;
  const colWidth = col.offsetWidth || gridRect.width / 7;
  const innerWidth = colWidth - 6;
  const colLeft = col.offsetLeft - gridCols.offsetLeft;

  const lane = item.lane ?? 0;
  const laneCount = item.laneCount ?? 1;
  if (laneCount > 1) {
    const laneW = innerWidth / laneCount;
    return {
      top,
      height,
      left: colLeft + lane * laneW + 2,
      width: Math.max(8, laneW - 4),
      realHeightFrac: vertical.realHeightFrac,
      visualEndMin: vertical.visualEndMin,
      visualStartMin: vertical.visualStartMin
    };
  }

  return {
    top,
    height,
    left: colLeft + 2,
    width: innerWidth - 4,
    realHeightFrac: vertical.realHeightFrac,
    visualEndMin: vertical.visualEndMin,
    visualStartMin: vertical.visualStartMin
  };
}

const BLOCK_Z_BASE = 10;
const BLOCK_Z_MAX = 80;
const BLOCK_Z_HOVER_OFFSET = 100;
const BLOCK_Z_HOVER_MAX = 89;

function blockBaseZ(orderIndex) {
  const raw = BLOCK_Z_BASE + (orderIndex || 0);
  return raw > BLOCK_Z_MAX ? BLOCK_Z_MAX : raw;
}

function blockHoverZ(baseZ) {
  const raw = baseZ + BLOCK_Z_HOVER_OFFSET;
  const clamped = raw > BLOCK_Z_HOVER_MAX ? BLOCK_Z_HOVER_MAX : raw;
  return clamped;
}

/** Position de la rangée flex pour plusieurs sites au même créneau (mode empilé). */
function stackSlotRowLayout(item, cols, gridRect) {
  const col = cols[item.dayIdx];
  if (!col) return null;

  const startMin =
    item.stackSlotStartMin ?? item.visualStartMin ?? localMinutesFromTs(item.start);
  const endMin = item.stackSlotEndMin ?? item.visualEndMin ?? localMinutesFromTs(item.end);
  const useMinH = calendarMetric === "open";
  const vertical = layoutBlockVerticalRange(startMin, endMin, useMinH);
  if (calendarMetric === "active" && (item.laneCount ?? 0) > 1) {
    const cardCount = item.laneCount ?? 1;
    const stackMinH =
      cardCount * STACK_SLOT_CARD_MIN_PX + Math.max(0, cardCount - 1) * STACK_SITE_SLOT_GAP_PX;
    vertical.height = Math.max(vertical.height, stackMinH);
  }
  const colWidth = col.offsetWidth || gridRect.width / 7;
  const innerWidth = colWidth - 6;
  const colLeft = col.offsetLeft - gridCols.offsetLeft;
  return {
    top: vertical.top,
    height: vertical.height,
    left: colLeft + 2,
    width: innerWidth - 4,
    realHeightFrac: vertical.realHeightFrac,
    visualEndMin: vertical.visualEndMin,
    visualStartMin: vertical.visualStartMin
  };
}

function usesStackSlotRow(item) {
  if (!item.stackSlotKey) return false;
  if (item.type === "stack-overflow") return true;
  return item.type === "group" && (item.laneCount ?? 0) > 1;
}

function ensureStackSlotRow(stackSlotKey, layout) {
  let row = stackSlotRowDomByKey.get(stackSlotKey);
  if (!row) {
    row = document.createElement("div");
    row.className = "stack-slot-row";
    row.dataset.stackSlotKey = stackSlotKey;
    stackSlotRowDomByKey.set(stackSlotKey, row);
    blocksLayer.appendChild(row);
  }
  if (layout) applyBlockLayout(row, layout);
  return row;
}

function detachFromStackSlotRow(el) {
  const parent = el.parentElement;
  if (parent?.classList.contains("stack-slot-row")) {
    parent.removeChild(el);
    const key = parent.dataset.stackSlotKey;
    if (key && parent.childElementCount === 0) {
      parent.remove();
      stackSlotRowDomByKey.delete(key);
    }
  }
}

function syncStackSlotRows(usedKeys) {
  for (const [key, row] of stackSlotRowDomByKey) {
    if (!usedKeys.has(key)) {
      row.remove();
      stackSlotRowDomByKey.delete(key);
    }
  }
}

function activityRatio(activeSeconds, openSeconds) {
  const safeOpenSeconds = Math.max(toFiniteSeconds(openSeconds, 0), 1);
  const safeActiveSeconds = toFiniteSeconds(activeSeconds, 0);
  return Math.min(1, Math.max(0, safeActiveSeconds / safeOpenSeconds));
}

function applyBlockActivityStyle(el, activeSeconds, openSeconds) {
  const ratio = activityRatio(activeSeconds, openSeconds);
  el.style.setProperty("--activity-ratio", String(ratio));
  // Rouge 0 0  ·  vert 0 120 (HSL), interpolation continue sans quantification.
  }

function formatTimeRange(start, end, options = {}) {
  const s = toTimestamp(start);
  let e = toTimestamp(end);
  if (options.clampToNow) {
    const nowTs = Date.now();
    if (e > nowTs) e = nowTs;
  }
  return `${formatClock(s)} - ${formatClock(e)}`;
}

function fillRatio(activeSeconds, openSeconds) {
  return activityRatio(activeSeconds, openSeconds) * 100;
}

function applyBlockLayout(el, layout) {
  if (!layout) return;
  el.style.left = `${layout.left}px`;
  el.style.width = `${layout.width}px`;
  el.style.top = `${layout.top}px`;
  el.style.height = `${layout.height}px`;
  const frac = layout.realHeightFrac ?? 1;
  el.style.setProperty("--block-real-frac", String(frac));
  el.classList.toggle("block-readability-pad", frac < 0.999);
  el.classList.toggle("block--short", calendarMetric === "active" && layout.height < 40);
  const endTimeEl = el.querySelector(".block-end-time");
  if (endTimeEl && layout.visualEndMin != null) {
    endTimeEl.textContent = formatClockFromMinutes(layout.visualEndMin);
    endTimeEl.hidden = calendarMetric === "active" || layout.height < 40;
  }
}

function updateConsolidatedBlockContent(el, item) {
  el.className = "block consolidated";
  if (calendarMetric === "active") el.classList.add("block-active-compact");
  else el.classList.remove("block-active-compact");
  delete el.dataset.blockIndex;
  el.dataset.domKey = item.domKey;
  const label = stackSiteCardTitle(item);
  const titleEl = el.querySelector(".block-title");
  const urlEl = el.querySelector(".block-url");
  const metaEl = el.querySelector(".block-meta");
  const { openSeconds: totalO, activeSeconds: totalA } = memberOpenActiveMetrics(item.members);
  applyConsolidatedBlockStyle(el, item, totalA, totalO);
  const toggle = el.querySelector(".block-picker-toggle");
  if (toggle) toggle.remove();
  const hasLive = item.members.some((m) => m.isLive);
  const rangeStart = item.displayStart ?? item.start;
  const rangeEnd = item.displayEnd ?? item.end;
  const timeRange = formatTimeRange(rangeStart, rangeEnd, { clampToNow: hasLive });
  if (calendarMetric === "active") {
    const siteLabel = item.groupKey ? formatGroupLabel(item.groupKey) : label;
    if (titleEl) titleEl.textContent = siteLabel;
    if (urlEl) urlEl.textContent = formatDurationShort(totalA);
    if (metaEl) metaEl.textContent = timeRange;
  } else {
    const siteLabel = item.groupKey ? formatGroupLabel(item.groupKey) : label;
    if (titleEl) titleEl.textContent = siteLabel;
    if (urlEl) urlEl.textContent = timeRange;
    if (metaEl) {
      metaEl.textContent = `A ${formatDurationShort(totalA)} · O ${formatDurationShort(totalO)}`;
    }
  }
  const siteHint = item.groupKey ? `\nSite: ${item.groupKey}` : "";
  el.title = `${label}${siteHint}\n${timeRange}\nActif: ${formatDurationFull(totalA)} · Ouvert: ${formatDurationFull(totalO)}\nClic : détail site (modal)`;
  syncActiveStripes(el, item);
}

function updateActiveFusedBlockContent(el, item) {
  el.className = "block consolidated active-fused-block";
  delete el.dataset.blockIndex;
  el.dataset.domKey = item.domKey;
  const lines = [...(item.lines || [])].sort((a, b) => {
    if (a.visualStartMin !== b.visualStartMin) return a.visualStartMin - b.visualStartMin;
    return (a.groupKey || "").localeCompare(b.groupKey || "");
  });
  let totalA = 0;
  let totalO = 0;
  for (const line of lines) {
    const m = memberOpenActiveMetrics(line.members);
    totalA += m.activeSeconds;
    totalO += m.openSeconds;
  }
  applyConsolidatedBlockStyle(el, item, totalA, totalO);

  const linesEl = el.querySelector(".active-fused-lines");
  if (!linesEl) return;

  const structKey = lines.map((l) => l.domKey).join("|");
  const colorMap = assignColorsForItems(lines.map((l) => ({ groupKey: l.groupKey || "?" })));

  if (el.dataset.fusedStruct !== structKey) {
    linesEl.innerHTML = "";
    for (const lineItem of lines) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "active-fused-line";
      row.dataset.lineDomKey = lineItem.domKey;
      const accent = colorMap.get(lineItem.groupKey || "?");
      if (accent) row.style.setProperty("--site-accent", accent);
      row.innerHTML = `<span class="active-fused-site"></span><span class="active-fused-dur"></span><span class="active-fused-time"></span>`;
      linesEl.appendChild(row);
    }
    el.dataset.fusedStruct = structKey;
  }

  const rowEls = linesEl.querySelectorAll(".active-fused-line");
  lines.forEach((lineItem, i) => {
    const row = rowEls[i];
    if (!row) return;
    const siteEl = row.querySelector(".active-fused-site");
    const durEl = row.querySelector(".active-fused-dur");
    const timeEl = row.querySelector(".active-fused-time");
    const { openSeconds: lineO, activeSeconds: lineA } = memberOpenActiveMetrics(lineItem.members);
    const hasLive = lineItem.members.some((m) => m.isLive);
    const rangeStart = lineItem.displayStart ?? lineItem.start;
    const rangeEnd = lineItem.displayEnd ?? lineItem.end;
    const timeRange = formatTimeRange(rangeStart, rangeEnd, { clampToNow: hasLive });
    const siteLabel = lineItem.groupKey ? formatGroupLabel(lineItem.groupKey) : stackSiteCardTitle(lineItem);
    if (siteEl) siteEl.textContent = siteLabel;
    if (durEl) {
      durEl.textContent =
        calendarMetric === "open"
          ? `A ${formatDurationShort(lineA)} · O ${formatDurationShort(lineO)}`
          : formatDurationShort(lineA);
    }
    if (timeEl) timeEl.textContent = timeRange;
    applyBlockActivityStyle(row, lineA, lineO);
    row.title = `${siteLabel}\n${timeRange}\nActif: ${formatDurationFull(lineA)} · Ouvert: ${formatDurationFull(lineO)}\nClic : détail site`;
  });

  const rangeStart = item.displayStart ?? item.start;
  const rangeEnd = item.displayEnd ?? item.end;
  el.title = `${lines.length} sites en parallèle\n${formatTimeRange(rangeStart, rangeEnd)}\nActif total: ${formatDurationFull(totalA)}`;
}

function updateStackOverflowBlockContent(el, item) {
  el.className = "block consolidated stack-slot-more stack-slot-card";
  delete el.dataset.blockIndex;
  el.dataset.domKey = item.domKey;
  const slotItems = item.slotItems || [];
  const totalA = slotItems.reduce(
    (sum, siteItem) => sum + (siteItem.members || []).reduce((s, m) => s + m.activeSeconds, 0),
    0
  );
  const totalO = slotItems.reduce(
    (sum, siteItem) => sum + (siteItem.members || []).reduce((s, m) => s + m.openSeconds, 0),
    0
  );
  applyConsolidatedBlockStyle(el, item, totalA, totalO);
  const labelEl = el.querySelector(".stack-slot-more-label");
  const extra = item.overflowExtra ?? 0;
  const label = extra > 0 ? `+${extra}` : "+";
  if (labelEl) labelEl.textContent = label;
  const total = item.slotItems?.length ?? 0;
  el.title = `${total} sites au même créneau\nClic : voir tous les sites`;
}

/** Bordure calendrier toujours pilotée par le ratio d'activité (rouge -> vert). */
function applyConsolidatedBlockStyle(el, item, activeSeconds, openSeconds) {
  void item;
  el.style.removeProperty("borderColor");
  applyBlockActivityStyle(el, activeSeconds, openSeconds);
}

function createBlockShell(item) {
  const el = document.createElement("div");
  el.tabIndex = 0;
  el.dataset.domKey = item.domKey;
  el.innerHTML = `<div class="block-title"></div>
    <div class="block-url"></div>
    <div class="block-meta"></div>
    <span class="block-end-marker" aria-hidden="true"><span class="block-end-time"></span></span>`;
  if (item.type === "single") {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      closeBlockPicker();
      openBlockModal(item.blockIndex);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        closeBlockPicker();
        openBlockModal(item.blockIndex);
      }
    });
  } else if (item.type === "active-fused") {
    el.classList.add("consolidated", "active-fused-block");
    el.innerHTML = `<div class="active-fused-lines" role="list"></div>
    <span class="block-end-marker" aria-hidden="true"><span class="block-end-time"></span></span>`;
    const linesRoot = el.querySelector(".active-fused-lines");
    linesRoot?.addEventListener("click", (e) => {
      const row = e.target instanceof Element ? e.target.closest(".active-fused-line") : null;
      if (!row) return;
      e.stopPropagation();
      const lineKey = row.dataset.lineDomKey;
      const fused = displayItems.find((x) => x.domKey === el.dataset.domKey && x.type === "active-fused");
      const line = fused?.lines?.find((l) => l.domKey === lineKey);
      if (line) openStackSiteCardModal(line);
    });
  } else if (item.type === "stack-overflow") {
    el.classList.add("consolidated", "stack-slot-more");
    el.innerHTML = `<div class="stack-slot-more-label" aria-hidden="true"></div>`;
    const openOverflow = () => {
      const k = el.dataset.domKey || item.domKey;
      const it = displayItems.find((x) => x.domKey === k && x.type === "stack-overflow");
      if (it) openStackSlotSitesModal(it);
    };
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openOverflow();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openOverflow();
      }
    });
  } else {
    el.classList.add("consolidated");
    el.innerHTML = `<div class="block-title"></div>
    <div class="block-url"></div>
    <div class="block-meta"></div>
    <span class="block-end-marker" aria-hidden="true"><span class="block-end-time"></span></span>`;

    const latestGroupItem = () => {
      const k = el.dataset.domKey || item.domKey;
      const it = displayItems.find((x) => x.domKey === k);
      if (!it) return null;
      if (it.type !== "group") return null;
      return it;
    };

    el.addEventListener("click", (e) => {
      if (e.target instanceof Element && e.target.closest("a")) return;
      e.stopPropagation();
      const it = latestGroupItem();
      if (!it) return;
      openStackSiteCardModal(it);
    });

    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      const it = latestGroupItem() || item;
      openStackSiteCardModal(it);
    });
  }

  el.addEventListener("mouseenter", () => {
    const base = Number(el.dataset.baseZ || el.style.zIndex || BLOCK_Z_BASE);
    const baseZ = Number.isFinite(base) && base > 0 ? base : BLOCK_Z_BASE;
    el.dataset.baseZ = String(baseZ);
    el.style.zIndex = String(blockHoverZ(baseZ));
  });

  el.addEventListener("mouseleave", () => {
    if (el.dataset.baseZ) {
      el.style.zIndex = el.dataset.baseZ;
    }
  });

  return el;
}

function pickerExpandKey(domKey, groupKey) {
  return `${domKey}\u001f${groupKey}`;
}

function clearPickerExpandedForDomKey(domKey) {
  for (const k of pickerExpandedGroups) {
    if (k.startsWith(`${domKey}\u001f`)) pickerExpandedGroups.delete(k);
  }
}

const BLOCK_PICKER_GAP = 4;
const BLOCK_PICKER_MARGIN = 8;
const BLOCK_PICKER_MAX_WIDTH = 360;
const BLOCK_PICKER_VH_MAX = 0.75;
const BLOCK_PICKER_MAX_HEIGHT_PX = 520;
const BLOCK_PICKER_MIN_HEIGHT = 200;
const BLOCK_PICKER_REPOSITION_MS = 50;

/** @type {HTMLElement|null} */
let blockPickerAnchorEl = null;
/** @type {ReturnType<typeof setTimeout>|null} */
let blockPickerRepositionTimer = null;

function resetBlockPickerInlineStyles() {
  blockPicker.style.width = "";
  blockPicker.style.maxWidth = "";
  blockPicker.style.maxHeight = "";
  blockPicker.style.top = "";
  blockPicker.style.left = "";
  blockPicker.style.visibility = "";
  blockPicker.style.pointerEvents = "";
}

/** Zone visible du calendrier (#grid-scroll) dans le viewport. */
function getBlockPickerClipRect() {
  const sr = gridScroll.getBoundingClientRect();
  return {
    top: Math.max(0, sr.top),
    bottom: Math.min(window.innerHeight, sr.bottom),
    left: Math.max(0, sr.left),
    right: Math.min(window.innerWidth, sr.right)
  };
}

/** Colonne jour (.col) contenant la carte ancre. */
function getBlockPickerColumnRect(anchorEl) {
  const colEl = anchorEl.closest(".col");
  return colEl ? colEl.getBoundingClientRect() : anchorEl.getBoundingClientRect();
}

/**
 * Ancre le panneau #block-picker au bloc : sous le bloc par defaut, flip au-dessus si
 * la hauteur naturelle depasse l'espace sous le bloc dans #grid-scroll ; largeur et
 * max-height contraintes a la colonne et au cote choisi.
 * @param {HTMLElement} [anchorEl]
 */
function positionBlockPicker(anchorEl) {
  const el = anchorEl || blockPickerAnchorEl;
  if (!el || blockPicker.classList.contains("hidden")) return;

  const blockRect = el.getBoundingClientRect();
  const colRect = getBlockPickerColumnRect(el);
  const clip = getBlockPickerClipRect();

  const colInner = colRect.width - BLOCK_PICKER_MARGIN;
  const width = Math.min(
    BLOCK_PICKER_MAX_WIDTH,
    Math.max(160, Math.min(colInner, Math.floor(colRect.width * 0.95)))
  );
  blockPicker.style.width = `${width}px`;
  blockPicker.style.maxWidth = `${width}px`;

  const vhCap = Math.floor(window.innerHeight * BLOCK_PICKER_VH_MAX);
  const heightCap = Math.min(vhCap, BLOCK_PICKER_MAX_HEIGHT_PX);
  blockPicker.style.maxHeight = `${heightCap}px`;
  blockPicker.style.visibility = "hidden";
  blockPicker.style.pointerEvents = "none";

  const naturalH = Math.min(blockPicker.scrollHeight, heightCap);

  const belowStart = blockRect.bottom + BLOCK_PICKER_GAP;
  const belowEnd = Math.min(colRect.bottom, clip.bottom) - BLOCK_PICKER_MARGIN;
  const spaceBelow = Math.max(0, belowEnd - belowStart);

  const aboveEnd = blockRect.top - BLOCK_PICKER_GAP;
  const aboveStart = Math.max(colRect.top, clip.top) + BLOCK_PICKER_MARGIN;
  const spaceAbove = Math.max(0, aboveEnd - aboveStart);

  const placeAbove =
    naturalH > spaceBelow && spaceAbove > spaceBelow;
  const sideSpace = placeAbove ? spaceAbove : spaceBelow;
  const usableSide = Math.max(sideSpace, BLOCK_PICKER_MIN_HEIGHT);
  const maxH = Math.min(
    heightCap,
    Math.max(BLOCK_PICKER_MIN_HEIGHT, Math.min(naturalH, usableSide))
  );
  blockPicker.style.maxHeight = `${maxH}px`;

  const renderedH = blockPicker.offsetHeight;

  let top = placeAbove
    ? blockRect.top - BLOCK_PICKER_GAP - renderedH
    : blockRect.bottom + BLOCK_PICKER_GAP;

  let left = Math.max(colRect.left + BLOCK_PICKER_MARGIN / 2, blockRect.left);
  left = Math.min(left, colRect.right - width - BLOCK_PICKER_MARGIN / 2);

  const clipPad = BLOCK_PICKER_MARGIN;
  if (top < clip.top + clipPad) top = clip.top + clipPad;
  if (top + renderedH > clip.bottom - clipPad) {
    top = Math.max(clip.top + clipPad, clip.bottom - clipPad - renderedH);
  }

  blockPicker.style.top = `${top}px`;
  blockPicker.style.left = `${left}px`;
  blockPicker.style.visibility = "";
  blockPicker.style.pointerEvents = "";
}

function scheduleBlockPickerReposition() {
  if (!blockPickerAnchorEl || blockPicker.classList.contains("hidden")) return;
  if (blockPickerRepositionTimer != null) clearTimeout(blockPickerRepositionTimer);
  blockPickerRepositionTimer = setTimeout(() => {
    blockPickerRepositionTimer = null;
    positionBlockPicker();
  }, BLOCK_PICKER_REPOSITION_MS);
}

function closeBlockPicker() {
  if (openPickerDomKey) clearPickerExpandedForDomKey(openPickerDomKey);
  blockPicker.classList.add("hidden");
  openPickerDomKey = null;
  blockPickerAnchorEl = null;
  if (blockPickerRepositionTimer != null) {
    clearTimeout(blockPickerRepositionTimer);
    blockPickerRepositionTimer = null;
  }
  pickerListStructureSnapshot = "";
  blockDomByKey.forEach((el) => el.classList.remove("is-open"));
  resetBlockPickerInlineStyles();
}

/** @param {object} item @param {HTMLElement} anchorEl */
function openBlockPicker(item, anchorEl) {
  closeModal();
  initPickerExpandedGroups(item);
  openPickerDomKey = item.domKey;
  blockPickerAnchorEl = anchorEl;
  pickerListStructureSnapshot = "";
  blockDomByKey.forEach((el, key) => {
    el.classList.toggle("is-open", key === item.domKey && el.classList.contains("consolidated"));
  });
  syncOpenBlockPickerList(item);
  blockPicker.classList.remove("hidden");
  positionBlockPicker(anchorEl);
  requestAnimationFrame(() => {
    positionBlockPicker(anchorEl);
    requestAnimationFrame(() => positionBlockPicker(anchorEl));
  });
}

function toggleBlockPicker(item, anchorEl) {
  if (openPickerDomKey === item.domKey) {
    closeBlockPicker();
    return;
  }
  openBlockPicker(item, anchorEl);
}

/** @typedef {{ groupKey: string, label: string, members: object[], activeSeconds: number, openSeconds: number }} PickerGroup */

/** @param {object[]} members */
function buildPickerGroups(members) {
  const map = new Map();
  for (const m of members) {
    const key = m.groupKey || "?";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  }
  /** @type {PickerGroup[]} */
  const groups = [];
  for (const [groupKey, tabs] of map) {
    groups.push({
      groupKey,
      label: formatGroupLabel(groupKey),
      members: tabs,
      activeSeconds: tabs.reduce((s, t) => s + t.activeSeconds, 0),
      openSeconds: tabs.reduce((s, t) => s + t.openSeconds, 0)
    });
  }
  groups.sort((a, b) => b.activeSeconds - a.activeSeconds);
  return groups;
}

function pickerRowColorClass(activeSeconds, openSeconds) {
  return openSeconds > 0 && activeSeconds / openSeconds < 0.25 ? " red" : "";
}

function appendPickerFill(li, activeSeconds, openSeconds, maxActive) {
  const ratioOpen = fillRatio(activeSeconds, openSeconds);
  const ratioMax = Math.min(100, (activeSeconds / maxActive) * 100);
  const widthPct = ratioOpen > 0 ? ratioOpen : ratioMax;
  const fill = document.createElement("span");
  fill.className = "block-picker-fill";
  fill.style.width = `${widthPct}%`;
  li.appendChild(fill);
}

/** @param {object} item */
function pickerShowsFlatTabs(item) {
  if (item.type === "group" && item.groupKey) return true;
  if (item.groupKey) return true;
  return buildPickerGroups(item.members || []).length === 1;
}

/** @param {object} item Onglets triés (actif desc) pour liste plate mono-site. */
function pickerFlatTabs(item) {
  return [...(item.members || [])].sort((a, c) => c.activeSeconds - a.activeSeconds);
}

function initPickerExpandedGroups(item) {
  clearPickerExpandedForDomKey(item.domKey);
  if (pickerShowsFlatTabs(item)) return;
  for (const g of buildPickerGroups(item.members || [])) {
    if (g.members.length > 1) {
      pickerExpandedGroups.add(pickerExpandKey(item.domKey, g.groupKey));
    }
  }
}

function pickerTotals(item) {
  const { openSeconds, activeSeconds } = memberOpenActiveMetrics(item.members || []);
  return { totalA: activeSeconds, totalO: openSeconds };
}

function pickerListStructureKey(item) {
  if (pickerShowsFlatTabs(item)) {
    return `flat:${[...(item.members || [])].map((m) => m.blockIndex).sort((a, b) => a - b).join(",")}`;
  }
  const groups = buildPickerGroups(item.members);
  return groups
    .map((g) => `${g.groupKey}:${[...g.members].map((m) => m.blockIndex).sort((a, b) => a - b).join(",")}`)
    .join("|");
}

/** Modal détail site pour une carte calendrier (Ouvert / Actif). */
function openStackSiteCardModal(item) {
  if (!item?.members?.length) return;
  closeBlockPicker();

  const sorted = [...item.members].sort((a, c) => c.activeSeconds - a.activeSeconds);
  const primary = sorted[0];
  const groupKey = item.groupKey || primary.groupKey || "?";
  const { openSeconds: totalO, activeSeconds: totalA } = memberOpenActiveMetrics(sorted);
  const inactive = Math.max(0, totalO - totalA);
  const durationMs = item.end - item.start;
  const dayKey =
    primary.date ||
    (item.dayIdx != null
      ? dateKeyFromTs(addDays(weekStart, item.dayIdx).getTime())
      : dateKeyFromTs(item.start));

  modalTitle.textContent = item.groupKey ? formatGroupLabel(groupKey) : stackSiteCardTitle(item);
  modalStats.innerHTML = `
    <dt>URL</dt><dd>${modalLinkHtml(shortUrl(primary.url), primary.url)}</dd>
    <dt>Groupe</dt><dd>${modalLinkHtml(groupKey, groupKey)}</dd>
    <dt>Plage</dt><dd>${formatClock(item.start)} - ${formatClock(item.end)}</dd>
    <dt>Durée (plage)</dt><dd title="${formatDurationMsFull(durationMs)}">${formatDurationMsShort(durationMs)}</dd>
    <dt>Temps ouvert</dt><dd title="${formatDurationFull(totalO)}">${formatDurationShort(totalO)}</dd>
    <dt>Temps actif</dt><dd title="${formatDurationFull(totalA)}">${formatDurationShort(totalA)}</dd>
    <dt>Inactif (O · A)</dt><dd title="${formatDurationFull(inactive)}">${formatDurationShort(inactive)}</dd>
  `;

  modalSessionsList.innerHTML = "";
  const h3 = blockModal.querySelector(".modal-sessions h3");
  if (h3) h3.textContent = "Schéma de la journée (même groupe)";
  setModalDayChartVisible(true);
  renderModalDayChart(groupKey, dayKey);

  const slotHeading = document.createElement("li");
  slotHeading.className = "modal-sessions-heading";
  slotHeading.textContent = sorted.length === 1 ? "Onglet du créneau" : "Onglets du créneau";
  modalSessionsList.appendChild(slotHeading);

  for (const m of sorted) {
    const li = document.createElement("li");
    li.className = "modal-session-tab";
    li.tabIndex = 0;
    const oShort = formatDurationShort(m.openSeconds);
    const aShort = formatDurationShort(m.activeSeconds);
    li.innerHTML = `<strong>${escapeHtml(m.title || "Sans titre")}</strong><br><span class="modal-session-url">${modalLinkHtml(shortUrl(m.url), m.url, { stopBubble: true })}</span><br>O ${oShort} · A ${aShort}`;
    li.title = `${m.title}\n${m.url}\nOuvert: ${formatDurationFull(m.openSeconds)} · Actif: ${formatDurationFull(m.activeSeconds)}`;
    const openTab = () => openBlockModal(m.blockIndex);
    li.addEventListener("click", openTab);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openTab();
      }
    });
    modalSessionsList.appendChild(li);
  }

  blockModal.classList.remove("hidden");
}

/** Modal liste de tous les sites d'un créneau (carte « +N »). */
function openStackSlotSitesModal(item) {
  const sites = item?.slotItems || [];
  if (!sites.length) return;
  closeBlockPicker();
  closeModal();

  const sorted = [...sites].sort(
    (a, b) =>
      b.members.reduce((s, m) => s + m.activeSeconds, 0) -
      a.members.reduce((s, m) => s + m.activeSeconds, 0)
  );
  const totalA = sorted.reduce((s, it) => s + memberOpenActiveMetrics(it.members).activeSeconds, 0);
  const totalO = sorted.reduce((s, it) => s + memberOpenActiveMetrics(it.members).openSeconds, 0);
  const inactive = Math.max(0, totalO - totalA);
  const slotStart = Math.min(...sorted.map((it) => it.start));
  const slotEnd = Math.max(...sorted.map((it) => it.end));

  modalTitle.textContent = `${sorted.length} sites`;
  modalStats.innerHTML = `
    <dt>Créneau</dt><dd>${formatClock(slotStart)} - ${formatClock(slotEnd)}</dd>
    <dt>Sites</dt><dd>${sorted.length}</dd>
    <dt>Temps ouvert (total)</dt><dd title="${formatDurationFull(totalO)}">${formatDurationShort(totalO)}</dd>
    <dt>Temps actif (total)</dt><dd title="${formatDurationFull(totalA)}">${formatDurationShort(totalA)}</dd>
    <dt>Inactif (O · A)</dt><dd title="${formatDurationFull(inactive)}">${formatDurationShort(inactive)}</dd>
  `;

  modalSessionsList.innerHTML = "";
  setModalDayChartVisible(false);
  destroyModalDayChart();
  const h3 = blockModal.querySelector(".modal-sessions h3");
  if (h3) h3.textContent = "Sites du créneau";

  const heading = document.createElement("li");
  heading.className = "modal-sessions-heading";
  heading.textContent = "Clic sur un site pour le détail";
  modalSessionsList.appendChild(heading);

  for (const siteItem of sorted) {
    const li = document.createElement("li");
    li.className = "modal-session-tab";
    li.tabIndex = 0;
    const { openSeconds: o, activeSeconds: a } = memberOpenActiveMetrics(siteItem.members);
    const label = siteItem.groupKey
      ? formatGroupLabel(siteItem.groupKey)
      : stackSiteCardTitle(siteItem);
    li.innerHTML = `<strong>${escapeHtml(label)}</strong><br>O ${formatDurationShort(o)} · A ${formatDurationShort(a)} · ${siteItem.count} onglet${siteItem.count > 1 ? "s" : ""}`;
    li.title = `${label}\nClic : détail du site`;
    const openSite = () => openStackSiteCardModal(siteItem);
    li.addEventListener("click", openSite);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openSite();
      }
    });
    modalSessionsList.appendChild(li);
  }

  blockModal.classList.remove("hidden");
}

/** @param {object} item Bloc consolidé « N onglets » */
function openClusterModal(item) {
  if (!item?.members?.length) return;
  closeBlockPicker();
  closeModal();

  if (item.groupKey) {
    openStackSiteCardModal(item);
    return;
  }

  const { openSeconds: totalO, activeSeconds: totalA } = memberOpenActiveMetrics(item.members);
  const inactive = Math.max(0, totalO - totalA);
  const label = stackSiteCardTitle(item);

  modalTitle.textContent = label;
  modalStats.innerHTML = `
    <dt>Créneau</dt><dd>${formatClock(item.start)} - ${formatClock(item.end)}</dd>
    <dt>Onglets</dt><dd>${label}</dd>
    <dt>Temps ouvert (total)</dt><dd title="${formatDurationFull(totalO)}">${formatDurationShort(totalO)}</dd>
    <dt>Temps actif (total)</dt><dd title="${formatDurationFull(totalA)}">${formatDurationShort(totalA)}</dd>
    <dt>Inactif (O · A)</dt><dd title="${formatDurationFull(inactive)}">${formatDurationShort(inactive)}</dd>
  `;

  const sorted = [...item.members].sort((a, c) => c.activeSeconds - a.activeSeconds);
  modalSessionsList.innerHTML = "";
  setModalDayChartVisible(false);
  destroyModalDayChart();
  const heading = document.createElement("li");
  heading.className = "modal-sessions-heading";
  heading.textContent = "Onglets du créneau";
  modalSessionsList.appendChild(heading);

  for (const m of sorted) {
    const li = document.createElement("li");
    li.className = "modal-session-tab";
    li.tabIndex = 0;
    const oShort = formatDurationShort(m.openSeconds);
    const aShort = formatDurationShort(m.activeSeconds);
    li.innerHTML = `<strong>${escapeHtml(m.title || "Sans titre")}</strong><br><span class="modal-session-url">${modalLinkHtml(shortUrl(m.url), m.url, { stopBubble: true })}</span><br>O ${oShort} · A ${aShort}`;
    li.title = `${m.title}\n${m.url}\nOuvert: ${formatDurationFull(m.openSeconds)} · Actif: ${formatDurationFull(m.activeSeconds)}`;
    const openTab = () => openBlockModal(m.blockIndex);
    li.addEventListener("click", openTab);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openTab();
      }
    });
    modalSessionsList.appendChild(li);
  }

  blockModal.classList.remove("hidden");
}

/** @param {PickerGroup} group @param {object} slotItem */
function openPickerGroupModal(group, slotItem) {
  const tabLabel = group.members.length === 1 ? "1 onglet" : `${group.members.length} onglets`;
  modalTitle.textContent = group.label;
  const inactive = Math.max(0, group.openSeconds - group.activeSeconds);

  modalStats.innerHTML = `
    <dt>Groupe (clé)</dt><dd>${modalLinkHtml(group.groupKey, group.groupKey)}</dd>
    <dt>Créneau</dt><dd>${formatClock(slotItem.start)} - ${formatClock(slotItem.end)}</dd>
    <dt>Onglets dans ce créneau</dt><dd>${tabLabel}</dd>
    <dt>Temps ouvert (total)</dt><dd title="${formatDurationFull(group.openSeconds)}">${formatDurationShort(group.openSeconds)}</dd>
    <dt>Temps actif (total)</dt><dd title="${formatDurationFull(group.activeSeconds)}">${formatDurationShort(group.activeSeconds)}</dd>
    <dt>Inactif (O  ·  A)</dt><dd title="${formatDurationFull(inactive)}">${formatDurationShort(inactive)}</dd>
  `;

  const sorted = [...group.members].sort((a, c) => c.activeSeconds - a.activeSeconds);
  modalSessionsList.innerHTML = "";
  setModalDayChartVisible(false);
  destroyModalDayChart();
  const heading = document.createElement("li");
  heading.className = "modal-sessions-heading";
  heading.textContent = "Onglets du créneau";
  modalSessionsList.appendChild(heading);

  for (const m of sorted) {
    const li = document.createElement("li");
    li.className = "modal-session-tab";
    li.tabIndex = 0;
    const oShort = formatDurationShort(m.openSeconds);
    const aShort = formatDurationShort(m.activeSeconds);
    li.innerHTML = `<strong>${escapeHtml(m.title || "Sans titre")}</strong><br><span class="modal-session-url">${modalLinkHtml(shortUrl(m.url), m.url, { stopBubble: true })}</span><br>O ${oShort} · A ${aShort}`;
    li.title = `${m.title}\n${m.url}\nOuvert: ${formatDurationFull(m.openSeconds)}  Actif: ${formatDurationFull(m.activeSeconds)}`;
    const openTab = () => openBlockModal(m.blockIndex);
    li.addEventListener("click", openTab);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openTab();
      }
    });
    modalSessionsList.appendChild(li);
  }

  blockModal.classList.remove("hidden");
}

function updatePickerHeading(item, groups) {
  const { totalA, totalO } = pickerTotals(item);
  const range = `${formatClock(item.start)} - ${formatClock(item.end)}`;
  const metrics = `A ${formatDurationShort(totalA)} · O ${formatDurationShort(totalO)}`;
  if (item.groupKey) {
    blockPickerHeading.textContent = `${formatGroupLabel(item.groupKey)} · ${range} · ${metrics}`;
    return;
  }
  if (groups.length === 1) {
    blockPickerHeading.textContent = `${groups[0].label} · ${range} · ${metrics}`;
    return;
  }
  const siteWord = groups.length === 1 ? "site" : "sites";
  blockPickerHeading.textContent = `${groups.length} ${siteWord} · ${range} · ${metrics}`;
}

function setPickerRowMetrics(li, activeSeconds, openSeconds, maxActive) {
  const fill = li.querySelector(".block-picker-fill");
  if (fill) fill.remove();
  appendPickerFill(li, activeSeconds, openSeconds, maxActive);
  const meta = li.querySelector(".block-picker-meta");
  if (meta) {
    meta.textContent = `A ${formatDurationShort(activeSeconds)} · O ${formatDurationShort(openSeconds)}`;
  }
}

/** Mise à jour in-place des durées / barres sans recréer la liste (préserve is-expanded). */
function updateBlockPickerListMetrics(item) {
  const groups = buildPickerGroups(item.members);
  const maxActive = Math.max(1, ...groups.map((g) => g.activeSeconds));
  updatePickerHeading(item, groups);

  if (pickerShowsFlatTabs(item)) {
    const tabs = pickerFlatTabs(item);
    const tabMaxActive = Math.max(1, ...tabs.map((m) => m.activeSeconds));
    for (const m of tabs) {
      const row = blockPickerList.querySelector(`[data-block-index="${m.blockIndex}"]`);
      if (!row) {
        renderBlockPickerList(item);
        return;
      }
      const childRed = pickerRowColorClass(m.activeSeconds, m.openSeconds);
      row.classList.toggle("red", Boolean(childRed));
      setPickerRowMetrics(row, m.activeSeconds, m.openSeconds, tabMaxActive);
      row.title = `${m.title}\n${m.url}`;
    }
    return;
  }

  for (const g of groups) {
    const li = blockPickerList.querySelector(`[data-group-key="${cssEscapeAttr(g.groupKey)}"]`);
    if (!li) {
      renderBlockPickerList(item);
      return;
    }
    const isRed = pickerRowColorClass(g.activeSeconds, g.openSeconds);
    li.classList.toggle("red", Boolean(isRed));
    setPickerRowMetrics(li, g.activeSeconds, g.openSeconds, maxActive);

    const tabSub =
      g.members.length === 1
        ? g.members[0].title || "Sans titre"
        : `${g.members.length} onglets`;
    li.title = `${g.groupKey}\n${tabSub}\nActif: ${formatDurationFull(g.activeSeconds)} · Ouvert: ${formatDurationFull(g.openSeconds)}`;

    const childUl = li.querySelector(".block-picker-children");
    if (!childUl) continue;
    const childSorted = [...g.members].sort((a, c) => c.activeSeconds - a.activeSeconds);
    for (const m of childSorted) {
      const child = childUl.querySelector(`[data-block-index="${m.blockIndex}"]`);
      if (!child) {
        renderBlockPickerList(item);
        return;
      }
      const childRed = pickerRowColorClass(m.activeSeconds, m.openSeconds);
      child.classList.toggle("red", Boolean(childRed));
      setPickerRowMetrics(child, m.activeSeconds, m.openSeconds, maxActive);
      child.title = `${m.title}\n${m.url}`;
    }
  }
}

function cssEscapeAttr(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function syncOpenBlockPickerList(item) {
  const structKey = pickerListStructureKey(item);
  if (structKey !== pickerListStructureSnapshot) {
    pickerListStructureSnapshot = structKey;
    renderBlockPickerList(item);
    scheduleBlockPickerReposition();
  } else {
    updateBlockPickerListMetrics(item);
  }
}

/** @param {object} item @param {PickerGroup[]} groups @param {boolean} flat */
function buildPickerColorMap(item, groups, flat) {
  const keys = [];
  if (flat) {
    for (const m of pickerFlatTabs(item)) {
      keys.push({ groupKey: m.groupKey || "?" });
    }
  } else {
    for (const g of groups) {
      keys.push({ groupKey: g.groupKey });
      for (const m of g.members) {
        keys.push({ groupKey: m.groupKey || "?" });
      }
    }
  }
  return assignColorsForItems(keys);
}

/** @param {HTMLElement} row @param {string} groupKey @param {Map<string, string>} colorMap */
function applyPickerRowAccent(row, groupKey, colorMap) {
  const color = colorMap.get(groupKey) ?? getColorForGroupKey(groupKey);
  row.style.borderLeft = `3px solid ${color}`;
}

function createPickerTabRow(m, maxActive, flatTop = false, colorMap = null) {
  const row = document.createElement("li");
  const childRed = pickerRowColorClass(m.activeSeconds, m.openSeconds);
  row.className = flatTop ? `block-picker-item${childRed}` : `block-picker-child${childRed}`;
  const gk = m.groupKey || "?";
  if (colorMap) applyPickerRowAccent(row, gk, colorMap);
  row.tabIndex = 0;
  row.dataset.blockIndex = String(m.blockIndex);
  appendPickerFill(row, m.activeSeconds, m.openSeconds, maxActive);
  const body = document.createElement("div");
  body.className = "block-picker-body";
  body.innerHTML = `
    <div class="block-picker-title">${escapeHtml(m.title || "Sans titre")}</div>
    <div class="block-picker-url">${escapeHtml(shortUrl(m.url))}</div>
    <div class="block-picker-meta">A ${formatDurationShort(m.activeSeconds)} · O ${formatDurationShort(m.openSeconds)}</div>
  `;
  row.appendChild(body);
  row.title = `${m.title}\n${m.url}`;
  const openTab = (ev) => {
    ev.stopPropagation();
    closeBlockPicker();
    openBlockModal(m.blockIndex);
  };
  row.addEventListener("click", openTab);
  row.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      openTab(ev);
    }
  });
  return row;
}

function renderBlockPickerList(item) {
  const members = item.members || [];
  const groups = buildPickerGroups(members);
  const domKey = item.domKey;
  const flat = pickerShowsFlatTabs(item);

  updatePickerHeading(item, groups);
  blockPickerList.innerHTML = "";
  blockPickerList.classList.toggle("block-picker-list--flat", flat);
  const colorMap = buildPickerColorMap(item, groups, flat);

  if (flat) {
    const tabs = pickerFlatTabs(item);
    const tabMaxActive = Math.max(1, ...tabs.map((m) => m.activeSeconds), 1);
    for (const m of tabs) {
      blockPickerList.appendChild(createPickerTabRow(m, tabMaxActive, true, colorMap));
    }
    pickerListStructureSnapshot = pickerListStructureKey(item);
    return;
  }

  const maxActive = Math.max(1, ...groups.map((g) => g.activeSeconds));

  for (const g of groups) {
    const li = document.createElement("li");
    const isRed = pickerRowColorClass(g.activeSeconds, g.openSeconds);
    li.className = `block-picker-item${isRed}${g.members.length > 1 ? " has-children" : ""}`;
    li.tabIndex = 0;
    li.dataset.groupKey = g.groupKey;
    applyPickerRowAccent(li, g.groupKey, colorMap);
    appendPickerFill(li, g.activeSeconds, g.openSeconds, maxActive);

    const body = document.createElement("div");
    body.className = "block-picker-body";
    const tabSub =
      g.members.length === 1
        ? escapeHtml(g.members[0].title || "Sans titre")
        : `${g.members.length} onglets`;
    body.innerHTML = `
      <div class="block-picker-title">${escapeHtml(g.label)}</div>
      <div class="block-picker-url">${tabSub}</div>
      <div class="block-picker-meta">A ${formatDurationShort(g.activeSeconds)} · O ${formatDurationShort(g.openSeconds)}</div>
    `;
    li.appendChild(body);

    li.title = `${g.groupKey}\n${tabSub}\nActif: ${formatDurationFull(g.activeSeconds)} · Ouvert: ${formatDurationFull(g.openSeconds)}`;

    const expandKey = pickerExpandKey(domKey, g.groupKey);

    const openGroup = (e) => {
      if (e.target instanceof Element && e.target.closest(".block-picker-expand, .block-picker-children")) return;
      e.stopPropagation();
      openPickerGroupModal(g, item);
    };
    li.addEventListener("click", openGroup);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openGroup(e);
      }
    });

    if (g.members.length > 1) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "block-picker-expand";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Afficher les onglets du groupe");
      const chevron = document.createElement("span");
      chevron.className = "icon-chevron";
      chevron.setAttribute("aria-hidden", "true");
      toggle.appendChild(chevron);
      const stopPickerBubble = (e) => e.stopPropagation();
      toggle.addEventListener("mousedown", stopPickerBubble);
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = li.classList.toggle("is-expanded");
        if (open) pickerExpandedGroups.add(expandKey);
        else pickerExpandedGroups.delete(expandKey);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
      li.appendChild(toggle);

      const childUl = document.createElement("ul");
      childUl.className = "block-picker-children";
      childUl.addEventListener("mousedown", stopPickerBubble);
      childUl.addEventListener("click", stopPickerBubble);
      const childSorted = [...g.members].sort((a, c) => c.activeSeconds - a.activeSeconds);
      for (const m of childSorted) {
        childUl.appendChild(createPickerTabRow(m, maxActive, false, colorMap));
      }
      li.appendChild(childUl);

      if (pickerExpandedGroups.has(expandKey)) {
        li.classList.add("is-expanded");
        toggle.setAttribute("aria-expanded", "true");
      }
    }

    blockPickerList.appendChild(li);
  }
  pickerListStructureSnapshot = pickerListStructureKey(item);
}

function applyStackSlotCardLayout(el, rowLayout) {
  el.classList.add("stack-slot-card");
  el.style.left = "";
  el.style.top = "";
  el.style.width = "";
  if (calendarMetric === "active") {
    el.style.height = "";
    el.style.flex = "0 0 auto";
  } else if (rowLayout) {
    el.style.height = `${rowLayout.height}px`;
    el.style.flex = "";
  }
}

/** @param {HTMLElement} el @param {object} item @param {NodeListOf<Element>} cols @param {DOMRect} gridRect @param {boolean} forceLayout */
function renderStackBlocks(el, item, cols, gridRect, forceLayout) {
  if (item.type === "stack-overflow") {
    updateStackOverflowBlockContent(el, item);
  } else if (item.type === "active-fused") {
    updateActiveFusedBlockContent(el, item);
  } else {
    updateConsolidatedBlockContent(el, item);
    if (openPickerDomKey === item.domKey) syncOpenBlockPickerList(item);
  }

  if (usesStackSlotRow(item)) {
    const rowLayout = stackSlotRowLayout(item, cols, gridRect);
    const row = ensureStackSlotRow(item.stackSlotKey, rowLayout);
    if (el.parentElement !== row) row.appendChild(el);
    applyStackSlotCardLayout(el, rowLayout);
    el.dataset.layoutReady = "1";
    return;
  }

  detachFromStackSlotRow(el);
  el.classList.remove("stack-slot-card");
  el.style.height = "";
  if (el.parentElement !== blocksLayer) blocksLayer.appendChild(el);

  const layout = blockLayout(item, cols, gridRect, {
    useMinBlockHeight: true
  });
  if (forceLayout || !el.dataset.layoutReady) {
    applyBlockLayout(el, layout);
    el.dataset.layoutReady = "1";
  } else if (layout) {
    applyBlockLayout(el, layout);
  }
}

function syncCalendarBlocks(items, forceLayout) {
  const cols = gridCols.querySelectorAll(".col");
  const gridRect = gridCols.getBoundingClientRect();
  const nextKeys = new Set(items.map((it) => it.domKey));
  const usedStackSlotKeys = new Set();

  const zOrder = new Map();
  const sortedForZ = items.slice().sort((a, b) => {
    const aStart =
      a.visualStartMin != null ? a.visualStartMin : localMinutesFromTs(a.start);
    const bStart =
      b.visualStartMin != null ? b.visualStartMin : localMinutesFromTs(b.start);
    return aStart - bStart;
  });
  sortedForZ.forEach((it, idx) => {
    zOrder.set(it.domKey, idx);
  });

  if (openPickerDomKey && !nextKeys.has(openPickerDomKey)) closeBlockPicker();

  for (const item of items) {
    if (usesStackSlotRow(item) && item.stackSlotKey) usedStackSlotKeys.add(item.stackSlotKey);
    let el = blockDomByKey.get(item.domKey);
    if (!el) {
      el = createBlockShell(item);
      blockDomByKey.set(item.domKey, el);
      blocksLayer.appendChild(el);
    } else if (el.dataset.itemType !== item.type) {
      const newEl = createBlockShell(item);
      el.replaceWith(newEl);
      blockDomByKey.set(item.domKey, newEl);
      el = newEl;
    }
    el.dataset.itemType = item.type;

    const orderIndex = zOrder.get(item.domKey) ?? 0;
    const baseZ = blockBaseZ(orderIndex);
    el.dataset.baseZ = String(baseZ);
    el.style.zIndex = String(baseZ);

    renderStackBlocks(el, item, cols, gridRect, forceLayout);
  }

  for (const [key, el] of blockDomByKey) {
    if (!nextKeys.has(key)) {
      detachFromStackSlotRow(el);
      el.remove();
      blockDomByKey.delete(key);
    }
  }
  syncStackSlotRows(usedStackSlotKeys);
}

function dayIndexFor(ts) {
  const d = new Date(toTimestamp(ts));
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    if (sameDay(d, addDays(weekStart, i))) return i;
  }
  return -1;
}

function dayIndexForDateKey(key) {
  const d = parseDateKey(key);
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    if (sameDay(d, addDays(weekStart, i))) return i;
  }
  return -1;
}

/** Colonne calendrier : privilegie `date` si aligne avec le jour local de `start`. */
function dayIndexForBlock(b) {
  const byStart = dayIndexFor(b.start);
  if (b.date) {
    const idx = dayIndexForDateKey(b.date);
    if (idx >= 0) {
      const colDay = addDays(weekStart, idx);
      const startDay = new Date(toTimestamp(b.start));
      if (sameDay(colDay, startDay)) return idx;
    }
  }
  return byStart;
}

function scrollCalendarToNow(days) {
  if (!gridScroll) return;
  const today = new Date();
  if (!days.some((d) => sameDay(d, today))) return;
  const top = timeToY(localMinutesFromTs(today.getTime()));
  const target = top - gridScroll.clientHeight * 0.28;
  gridScroll.scrollTop = Math.max(0, target);
}

function autoScrollToNowIfNeeded(days) {
  const weekTs = weekStart.getTime();
  const today = new Date();
  const isCurrentWeek = days.some((d) => sameDay(d, today));
  if (!isCurrentWeek) {
    lastAutoScrollWeek = null;
    return;
  }
  if (lastAutoScrollWeek === weekTs) return;
  lastAutoScrollWeek = weekTs;
  scrollCalendarToNow(days);
}

function renderBlocks(blocks) {
  renderedBlocks = blocks;
  displayItems = buildDisplayItems(blocks);

  const structure = calendarStructurePayload(displayItems);
  const metrics = calendarMetricsPayload(displayItems);
  const structureChanged = structure !== calendarStructureSnapshot;
  const metricsChanged = metrics !== calendarMetricsSnapshot;

  if (!structureChanged && !metricsChanged) return;

  calendarStructureSnapshot = structure;
  calendarMetricsSnapshot = metrics;
  syncCalendarBlocks(displayItems, structureChanged);
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.slice(0, 40);
  } catch {
    return url || "";
  }
}

function openBlockModal(index) {
  const b = renderedBlocks[index];
  if (!b) return;

  closeBlockPicker();

  modalTitle.textContent = b.title || "Sans titre";
  const durationMs = b.end - b.start;
  const inactive = Math.max(0, b.openSeconds - b.activeSeconds);

  modalStats.innerHTML = `
    <dt>URL</dt><dd>${modalLinkHtml(b.url, b.url)}</dd>
    <dt>Groupe</dt><dd>${modalLinkHtml(b.groupKey, b.groupKey)}</dd>
    <dt>Plage</dt><dd>${formatClock(b.start)} - ${formatClock(b.end)}</dd>
    <dt>Durée (plage)</dt><dd title="${formatDurationMsFull(durationMs)}">${formatDurationMsShort(durationMs)}</dd>
    <dt>Temps ouvert</dt><dd title="${formatDurationFull(b.openSeconds)}">${formatDurationShort(b.openSeconds)}</dd>
    <dt>Temps actif</dt><dd title="${formatDurationFull(b.activeSeconds)}">${formatDurationShort(b.activeSeconds)}</dd>
    <dt>Inactif (O  ·  A)</dt><dd title="${formatDurationFull(inactive)}">${formatDurationShort(inactive)}</dd>
    ${b.isLive ? "<dt>0tat</dt><dd>En cours (temps réel)</dd>" : ""}
  `;

  const dayKey = b.date || dateKeyFromTs(b.start);
  const h3 = blockModal.querySelector(".modal-sessions h3");
  if (h3) h3.textContent = "Schéma de la journée (même groupe)";
  setModalDayChartVisible(true);
  renderModalDayChart(b.groupKey || "?", dayKey);
  modalSessionsList.innerHTML = "";

  blockModal.classList.remove("hidden");
}

function closeModal() {
  blockModal.classList.add("hidden");
  destroyModalDayChart();
  setModalDayChartVisible(true);
  modalSessionsList.hidden = false;
  if (modalDayChartEmpty) modalDayChartEmpty.textContent = "Aucune session à afficher pour ce groupe ce jour.";
  const h3 = blockModal.querySelector(".modal-sessions h3");
  if (h3) h3.textContent = "Schéma de la journée (même groupe)";
}

function updateNowLine(days) {
  const today = new Date();
  const idx = days.findIndex((d) => sameDay(d, today));
  if (idx < 0) {
    nowLine.hidden = true;
    return;
  }
  const min = clampCalendarMinutes(localMinutesFromTs(today.getTime()));
  const top = timeToY(min);
  const cols = gridCols.querySelectorAll(".col");
  const col = cols[idx];
  if (!col) return;
  nowLine.hidden = false;
  nowLine.style.top = `${top}px`;
  nowLine.style.left = `${col.offsetLeft - gridCols.offsetLeft}px`;
  nowLine.style.width = `${col.offsetWidth}px`;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

/** Normalise et valide URL / clé de groupe - http(s) uniquement, pas de javascript: */
function toSafeHref(urlOrGroupKey) {
  const raw = String(urlOrGroupKey || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    return null;
  }
  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * Lien modal sécurisé (nouvel onglet) ou texte Échapp si href invalide.
 * @param {string} displayText
 * @param {string} urlOrGroupKey
 * @param {{ stopBubble?: boolean }} [opts]
 */
function modalLinkHtml(displayText, urlOrGroupKey, opts = {}) {
  const href = toSafeHref(urlOrGroupKey);
  const text = escapeHtml(displayText ?? urlOrGroupKey ?? "");
  if (!href) return text;
  const classAttr = opts.stopBubble ? ' class="modal-external-link"' : "";
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${classAttr}>${text}</a>`;
}

function setModalDayChartVisible(visible) {
  if (modalDayChartWrap) modalDayChartWrap.classList.toggle("is-hidden", !visible);
}

function destroyModalDayChart() {
  if (modalDayChart) {
    modalDayChart.destroy();
    modalDayChart = null;
  }
}

function toFiniteMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function clampMs(min, value, max) {
  return Math.max(min, Math.min(max, value));
}

function addWeightedToModalDayBuckets(bucket, dayStartMs, dayEndMs, startMs, endMs, openSeconds, activeSeconds) {
  if (!(endMs > startMs)) return;
  const safeStart = clampMs(dayStartMs, startMs, dayEndMs);
  const safeEnd = clampMs(dayStartMs, endMs, dayEndMs);
  if (!(safeEnd > safeStart)) return;
  const durationMs = safeEnd - safeStart;
  const safeOpen = toFiniteSeconds(openSeconds, 0);
  const safeActive = toFiniteSeconds(activeSeconds, 0);
  const openRate = safeOpen / Math.max(1, durationMs / 1000);
  const activeRate = safeActive / Math.max(1, durationMs / 1000);

  let cursor = safeStart;
  while (cursor < safeEnd) {
    const minuteOfDay = ((cursor - dayStartMs) / 60000) | 0;
    const bucketIndex = Math.max(
      0,
      Math.min(bucket.open.length - 1, Math.floor(minuteOfDay / MODAL_DAY_CHART_BUCKET_MINUTES))
    );
    const nextBucket =
      dayStartMs + (bucketIndex + 1) * MODAL_DAY_CHART_BUCKET_MINUTES * 60 * 1000;
    const segmentEnd = Math.min(safeEnd, nextBucket);
    const sec = (segmentEnd - cursor) / 1000;
    bucket.open[bucketIndex] += sec * openRate;
    bucket.active[bucketIndex] += sec * activeRate;
    cursor = segmentEnd;
  }
}

function buildTemporalLabels(rangeStartMs, rangeEndMs, bucketMinutes, includeDayPrefix = false) {
  const totalBuckets = Math.max(1, Math.ceil((rangeEndMs - rangeStartMs) / (bucketMinutes * 60 * 1000)));
  return Array.from({ length: totalBuckets }, (_, i) => {
    const ts = rangeStartMs + i * bucketMinutes * 60 * 1000;
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    if (!includeDayPrefix) return `${hh}:${mm}`;
    const day = d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
    return `${day} ${hh}:${mm}`;
  });
}

function normalizeFrWeekdayShortLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.$/, "");
}

function weekdayShortFrFromTs(ts) {
  return normalizeFrWeekdayShortLabel(
    new Date(ts).toLocaleDateString("fr-FR", { weekday: "short" })
  );
}

function resolveTemporalTickDataIndex(value, index, ticks) {
  if (Number.isFinite(Number(value))) return Number(value);
  const tick = Array.isArray(ticks) ? ticks[index] : null;
  if (tick && Number.isFinite(Number(tick.value))) return Number(tick.value);
  return Number(index) || 0;
}

function formatTemporalTooltipTitle(rangeStartMs, bucketMinutes, dataIndex) {
  const ts = rangeStartMs + dataIndex * bucketMinutes * 60 * 1000;
  const d = new Date(ts);
  const weekday = weekdayShortFrFromTs(ts);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${weekday} ${day}/${month} ${hh}:${mm}`;
}

function makeTemporalTickCallback(scope, rangeStartMs, bucketMinutes) {
  return function temporalTickCallback(value, index, ticks) {
    const bucketIndex = resolveTemporalTickDataIndex(value, index, ticks);
    const ts = rangeStartMs + bucketIndex * bucketMinutes * 60 * 1000;
    if (scope === "week") {
      const dayKey = dateKeyFromTs(ts);
      if (bucketIndex <= 0) return weekdayShortFrFromTs(ts);
      const prevTs = ts - bucketMinutes * 60 * 1000;
      const prevDayKey = dateKeyFromTs(prevTs);
      return prevDayKey === dayKey ? "" : weekdayShortFrFromTs(ts);
    }
    const d = new Date(ts);
    const minute = d.getMinutes();
    const hour = d.getHours();
    if (minute !== 0) return "";
    const stepHours = bucketMinutes <= 30 ? 2 : 1;
    if (hour % stepHours !== 0) return "";
    return `${String(hour).padStart(2, "0")}h`;
  };
}

function temporalAxisTicks(scope, rangeStartMs, bucketMinutes, maxTicksLimit) {
  return {
    color: "#9aa0a6",
    maxRotation: 0,
    autoSkip: false,
    maxTicksLimit,
    callback: makeTemporalTickCallback(scope, rangeStartMs, bucketMinutes)
  };
}

function createTemporalBucket(rangeStartMs, rangeEndMs, bucketMinutes, includeDayPrefix = false) {
  const labels = buildTemporalLabels(rangeStartMs, rangeEndMs, bucketMinutes, includeDayPrefix);
  return {
    labels,
    open: labels.map(() => 0),
    active: labels.map(() => 0),
    rangeStartMs,
    rangeEndMs,
    bucketMinutes
  };
}

function addWeightedToTemporalBucket(bucket, startMs, endMs, openSeconds, activeSeconds) {
  if (!(endMs > startMs)) return;
  const safeStart = clampMs(bucket.rangeStartMs, startMs, bucket.rangeEndMs);
  const safeEnd = clampMs(bucket.rangeStartMs, endMs, bucket.rangeEndMs);
  if (!(safeEnd > safeStart)) return;
  const durationMs = safeEnd - safeStart;
  const safeOpen = toFiniteSeconds(openSeconds, 0);
  const safeActive = toFiniteSeconds(activeSeconds, 0);
  const openRate = safeOpen / Math.max(1, durationMs / 1000);
  const activeRate = safeActive / Math.max(1, durationMs / 1000);
  const bucketMs = bucket.bucketMinutes * 60 * 1000;

  let cursor = safeStart;
  while (cursor < safeEnd) {
    const bucketIndex = Math.max(
      0,
      Math.min(bucket.open.length - 1, Math.floor((cursor - bucket.rangeStartMs) / bucketMs))
    );
    const nextBucket = bucket.rangeStartMs + (bucketIndex + 1) * bucketMs;
    const segmentEnd = Math.min(safeEnd, nextBucket);
    const sec = (segmentEnd - cursor) / 1000;
    bucket.open[bucketIndex] += sec * openRate;
    bucket.active[bucketIndex] += sec * activeRate;
    cursor = segmentEnd;
  }
}

function collectModalGroupSessionsForDay(groupKey, dayKey) {
  const sessions = [];
  for (const e of cachedEntries) {
    if (e.groupKey !== groupKey || e.date !== dayKey) continue;
    sessions.push({
      start: e.start,
      end: e.end,
      openSeconds: e.openSeconds,
      activeSeconds: e.activeSeconds
    });
  }
  const now = Date.now();
  for (const t of cachedLive.tabs || []) {
    if (t.groupKey !== groupKey) continue;
    const startMs = toFiniteMs(t.segmentStart || t.openedAt);
    if (!Number.isFinite(startMs)) continue;
    const dk = dateKeyFromTs(startMs);
    if (dk !== dayKey) continue;
    const openSeconds = toFiniteSeconds(t.openSeconds, 0);
    const activeSeconds = toFiniteSeconds(t.activeSeconds, 0);
    if (openSeconds <= 0 && activeSeconds <= 0) continue;
    const approxEnd = startMs + Math.max(openSeconds, activeSeconds) * 1000;
    sessions.push({
      start: startMs,
      end: Math.max(startMs + 1000, Math.min(now, approxEnd)),
      openSeconds,
      activeSeconds
    });
  }
  return sessions;
}

function buildModalDayChartSeries(groupKey, dayKey) {
  const day = parseDateKey(dayKey);
  day.setHours(0, 0, 0, 0);
  const dayStartMs = day.getTime();
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
  const bucketsCount = (24 * 60) / MODAL_DAY_CHART_BUCKET_MINUTES;
  const labels = Array.from({ length: bucketsCount }, (_, i) => {
    const totalMin = i * MODAL_DAY_CHART_BUCKET_MINUTES;
    const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
    const mm = String(totalMin % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  });
  const bucket = {
    labels,
    open: labels.map(() => 0),
    active: labels.map(() => 0),
    rangeStartMs: dayStartMs,
    bucketMinutes: MODAL_DAY_CHART_BUCKET_MINUTES
  };
  const sessions = collectModalGroupSessionsForDay(groupKey, dayKey);
  for (const s of sessions) {
    const startMs = toFiniteMs(s.start);
    const endMs = toFiniteMs(s.end);
    if (!(endMs > startMs)) continue;
    addWeightedToModalDayBuckets(
      bucket,
      dayStartMs,
      dayEndMs,
      startMs,
      endMs,
      s.openSeconds,
      s.activeSeconds
    );
  }
  return bucket;
}

function buildTemporalSeriesFromSessions(
  sessions,
  rangeStartMs,
  rangeEndMs,
  bucketMinutes,
  includeDayPrefix = false
) {
  const bucket = createTemporalBucket(rangeStartMs, rangeEndMs, bucketMinutes, includeDayPrefix);
  for (const s of sessions) {
    const startMs = toFiniteMs(s.start);
    const endMs = toFiniteMs(s.end);
    if (!(endMs > startMs)) continue;
    addWeightedToTemporalBucket(bucket, startMs, endMs, s.openSeconds, s.activeSeconds);
  }
  return bucket;
}

function renderModalTemporalChart({
  labels,
  open,
  active,
  rangeStartMs = 0,
  bucketMinutes = MODAL_DAY_CHART_BUCKET_MINUTES,
  xScope = null,
  xWeekdayOnly = false,
  maxTicksLimit = 8,
  yTickFormatter = (v) => formatDurationShort(Number(v) || 0)
}) {
  if (!modalDayChartCanvas || !modalDayChartEmpty) return;
  const hasData = open.some((v) => v > 0.2) || active.some((v) => v > 0.2);
  modalDayChartEmpty.classList.toggle("hidden", hasData);

  const temporalScope = xScope || (xWeekdayOnly ? "week" : "day");
  const chartData = {
    labels,
    datasets: [
      {
        label: "Ouvert",
        data: open,
        borderColor: "#6b7280",
        backgroundColor: "rgba(107, 114, 128, 0.22)",
        borderWidth: 1.1,
        pointRadius: 0,
        tension: 0.2,
        fill: true
      },
      {
        label: "Actif",
        data: active,
        borderColor: "#28a745",
        backgroundColor: "rgba(40, 167, 69, 0.24)",
        borderWidth: 1.4,
        pointRadius: 0,
        tension: 0.2,
        fill: true
      }
    ]
  };

  if (!modalDayChart) {
    modalDayChart = new Chart(modalDayChartCanvas, {
      type: "line",
      data: chartData,
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: { color: "#9aa0a6", boxWidth: 10, boxHeight: 10 }
          },
          tooltip: {
            callbacks: {
              title(items) {
                if (!items || !items.length) return undefined;
                const idx = Number(items[0].dataIndex) || 0;
                return formatTemporalTooltipTitle(rangeStartMs, bucketMinutes, idx);
              },
              label(ctx) {
                return `${ctx.dataset.label}: ${formatDurationFull(Math.round(ctx.parsed.y || 0))}`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: temporalAxisTicks(temporalScope, rangeStartMs, bucketMinutes, maxTicksLimit),
            grid: { color: "rgba(255,255,255,0.06)" }
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: "#9aa0a6",
              callback(v) {
                return yTickFormatter(v);
              }
            },
            grid: { color: "rgba(255,255,255,0.06)" }
          }
        }
      }
    });
    return;
  }

  modalDayChart.data.labels = chartData.labels;
  modalDayChart.data.datasets[0].data = chartData.datasets[0].data;
  modalDayChart.data.datasets[1].data = chartData.datasets[1].data;
  modalDayChart.options.scales.x.ticks = temporalAxisTicks(
    temporalScope,
    rangeStartMs,
    bucketMinutes,
    maxTicksLimit
  );
  if (!modalDayChart.options.plugins.tooltip.callbacks) {
    modalDayChart.options.plugins.tooltip.callbacks = {};
  }
  modalDayChart.options.plugins.tooltip.callbacks.title = (items) => {
    if (!items || !items.length) return "";
    const idx = Number(items[0].dataIndex) || 0;
    return formatTemporalTooltipTitle(rangeStartMs, bucketMinutes, idx);
  };
  modalDayChart.update("none");
}

function renderModalDayChart(groupKey, dayKey) {
  const series = buildModalDayChartSeries(groupKey, dayKey);
  renderModalTemporalChart({
    labels: series.labels,
    open: series.open,
    active: series.active,
    rangeStartMs: series.rangeStartMs,
    bucketMinutes: series.bucketMinutes,
    xScope: "day",
    maxTicksLimit: 8
  });
}

const chartColors = {
  green: "#28a745",
  greenDim: "rgba(40, 167, 69, 0.55)",
  muted: "#9aa0a6",
  grid: "#2c313c",
  text: "#e8eaed"
};

/** @param {{ items?: { groupKey: string }[] }} groups */
function doughnutSegmentColors(groups) {
  return colorsForGroupItems(groups.items);
}

function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { labels: { color: chartColors.text } },
      tooltip: {
        callbacks: {
          label(context) {
            const label = context.dataset.label || "";
            const value = formatChartTooltipValue(context);
            return label ? `${label}: ${value}` : value;
          }
        }
      }
    },
    scales: {
      x: {
        ticks: { color: chartColors.muted },
        grid: { color: chartColors.grid }
      },
      y: {
        ticks: { color: chartColors.muted },
        grid: { color: chartColors.grid }
      }
    }
  };
}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

function labelsStructureKey(labels) {
  return `${labels.length}:${labels.join("\0")}`;
}

function statsPayloadSnapshot(daily, groups, dayGroups, weekInsights, dayInsights) {
  const groupsPayload = groups.dualMetric
    ? {
        dual: true,
        labels: groups.labels,
        active: groups.activeValues,
        open: groups.openValues
      }
    : { labels: groups.labels, values: groups.values };
  return JSON.stringify({
    metric: statsMetricMode,
    selectedDay: statsSelectedDay,
    insightsScope: statsInsightsScope,
    daily: { labels: daily.labels, open: daily.openValues, active: daily.activeValues },
    groups: groupsPayload,
    dayGroups: { labels: dayGroups.labels, values: dayGroups.values },
    weekInsights,
    dayInsights,
    weekStart: weekStart.getTime()
  });
}

function chartNeedsRecreate(chart, structureKey) {
  if (!chart) return true;
  return chart._ogStructureKey !== structureKey;
}

function markChartStructure(chart, structureKey) {
  chart._ogStructureKey = structureKey;
}

/** Mise à jour sans animation (rafrachissement périodique). */
function updateChartQuiet(chart) {
  chart.update("none");
}

function entryMetricSeconds(entry, mode) {
  const secs = coerceOpenActiveSeconds(entry.openSeconds, entry.activeSeconds);
  return mode === "open" ? secs.openSeconds : secs.activeSeconds;
}

function tabMetricSeconds(tab, mode) {
  const secs = coerceOpenActiveSeconds(tab.openSeconds, tab.activeSeconds);
  return mode === "open" ? secs.openSeconds : secs.activeSeconds;
}

function buildDayMetricsMap(startDay, numDays) {
  const map = new Map();
  const start = new Date(startDay);
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i < numDays; i++) {
    const d = addDays(start, i);
    const dayStartMs = d.getTime();
    const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
    const effectiveEndMs = Math.min(dayEndMs, Date.now());
    map.set(dateKeyFromTs(d.getTime()), {
      openSeconds: 0,
      activeSeconds: 0,
      label: d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
      dayStartMs,
      dayEndMs: effectiveEndMs,
      openIntervals: [],
      activeIntervals: []
    });
  }
  return map;
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = intervals
    .map((it) => ({ startMs: it.startMs, endMs: it.endMs }))
    .filter((it) => Number.isFinite(it.startMs) && Number.isFinite(it.endMs) && it.endMs > it.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (!sorted.length) return [];
  const merged = [];
  let curStart = sorted[0].startMs;
  let curEnd = sorted[0].endMs;
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    if (it.startMs <= curEnd) {
      curEnd = Math.max(curEnd, it.endMs);
      continue;
    }
    merged.push({ startMs: curStart, endMs: curEnd });
    curStart = it.startMs;
    curEnd = it.endMs;
  }
  merged.push({ startMs: curStart, endMs: curEnd });
  return merged;
}

function pushEntryIntervalsByDate(map, entries) {
  for (const e of entries) {
    const row = map.get(e.date);
    if (!row) continue;
    const secs = coerceOpenActiveSeconds(e.openSeconds, e.activeSeconds);
    const startMs = toTimestamp(e.start);
    const endMs = toTimestamp(e.end);
    const openWindow = clipIntervalToWindow(startMs, endMs, row.dayStartMs, row.dayEndMs);
    if (!openWindow) continue;
    row.openIntervals.push(openWindow);
    const activeSpanMs = Math.min(openWindow.endMs - openWindow.startMs, secs.activeSeconds * 1000);
    if (activeSpanMs <= 0) continue;
    row.activeIntervals.push({
      startMs: openWindow.endMs - activeSpanMs,
      endMs: openWindow.endMs
    });
  }
}

/** Onglets encore ouverts : comptés sur le jour du segment, seulement si ce jour est dans la carte. */
function pushLiveIntervalsByDate(map, live) {
  for (const t of live.tabs || []) {
    const dayKey = dateKeyFromTs(t.segmentStart || t.openedAt);
    const row = map.get(dayKey);
    if (!row) continue;
    const secs = coerceOpenActiveSeconds(t.openSeconds, t.activeSeconds);
    const startMs = toTimestamp(t.segmentStart || t.openedAt);
    const endMs = Date.now();
    const openWindow = clipIntervalToWindow(startMs, endMs, row.dayStartMs, row.dayEndMs);
    if (!openWindow) continue;
    row.openIntervals.push(openWindow);
    const anchor = Number.isFinite(Number(t.lastActivityAt))
      ? Math.min(openWindow.endMs, Math.max(openWindow.startMs, toTimestamp(t.lastActivityAt)))
      : openWindow.endMs;
    const activeSpanMs = Math.min(openWindow.endMs - openWindow.startMs, secs.activeSeconds * 1000);
    if (activeSpanMs <= 0) continue;
    row.activeIntervals.push({
      startMs: Math.max(openWindow.startMs, anchor - activeSpanMs),
      endMs: anchor
    });
  }
}

function finalizeDayMetricsUnion(map) {
  for (const row of map.values()) {
    const daySpanSeconds = Math.max(0, Math.round((row.dayEndMs - row.dayStartMs) / 1000));
    row.openIntervals = mergeIntervals(row.openIntervals);
    row.activeIntervals = mergeIntervals(row.activeIntervals);
    const openUnion = Math.min(daySpanSeconds, unionDurationSeconds(row.openIntervals));
    const activeUnion = Math.min(openUnion, unionDurationSeconds(row.activeIntervals));
    row.openSeconds = openUnion;
    row.activeSeconds = Math.min(openUnion, activeUnion);
  }
}

function sumDayMetrics(map) {
  let open = 0;
  let active = 0;
  for (const row of map.values()) {
    open += row.openSeconds;
    active += row.activeSeconds;
  }
  return { open, active };
}

function aggregateLast14Days(entries, live) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const map = buildDayMetricsMap(addDays(today, -13), 14);
  pushEntryIntervalsByDate(map, entries);
  pushLiveIntervalsByDate(map, live);
  finalizeDayMetricsUnion(map);
  const keys = [...map.keys()];
  return {
    labels: keys.map((k) => map.get(k).label),
    dateKeys: keys,
    openValues: keys.map((k) => map.get(k).openSeconds),
    activeValues: keys.map((k) => map.get(k).activeSeconds)
  };
}

function buildDayMetricsMapForDateKeys(dayKeys, nowTs = Date.now()) {
  const map = new Map();
  const ordered = [...dayKeys]
    .map((key) => ({ key, day: parseDateKey(key) }))
    .filter((x) => x.day instanceof Date && Number.isFinite(x.day.getTime()))
    .sort((a, b) => a.day.getTime() - b.day.getTime());
  for (const { key, day } of ordered) {
    day.setHours(0, 0, 0, 0);
    const dayStartMs = day.getTime();
    const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
    map.set(key, {
      openSeconds: 0,
      activeSeconds: 0,
      label: day.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
      dayStartMs,
      dayEndMs: Math.min(dayEndMs, nowTs),
      openIntervals: [],
      activeIntervals: []
    });
  }
  return map;
}

function buildUnifiedDayMetricsForDateKeys(dayKeys, entries, live, nowTs = Date.now()) {
  const map = buildDayMetricsMapForDateKeys(dayKeys, nowTs);
  pushEntryIntervalsByDate(map, entries);
  pushLiveIntervalsByDate(map, live);
  finalizeDayMetricsUnion(map);
  return map;
}

function weekDateKeys() {
  const keys = new Set();
  for (let i = 0; i < 7; i++) {
    keys.add(dateKeyFromTs(addDays(weekStart, i).getTime()));
  }
  return keys;
}

function truncateChartLabel(text, max = 36) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max - 1)}&`;
}

function mergeDistributionRowsByLabel(items) {
  const rows = new Map();
  for (const item of items || []) {
    const labelKey = normalizeStatsLabelKey(item.groupKey || item.label || "");
    if (!labelKey) continue;
    const base = rows.get(labelKey);
    if (!base) {
      rows.set(labelKey, { ...item, label: formatGroupLabel(item.groupKey) });
      continue;
    }
    base.activeSeconds = (base.activeSeconds || 0) + (item.activeSeconds || 0);
    base.openSeconds = (base.openSeconds || 0) + (item.openSeconds || 0);
    base.seconds = (base.seconds || 0) + (item.seconds || 0);
  }
  return [...rows.values()];
}

function assertNoDuplicateDistributionLabels(items) {
  const merged = mergeDistributionRowsByLabel(items);
  if (merged.length !== items.length) {
    console.warn("OG Time Tab: doublons de libellés stats détectés puis fusionnés");
  }
  return merged;
}

function showDashboardFatalError(err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("OG Time Tab: erreur fatale dashboard:", err);

  let banner = document.getElementById("og-fatal-error");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "og-fatal-error";
    banner.setAttribute("role", "status");
    banner.style.cssText = [
      "position: sticky",
      "top: 0",
      "z-index: 9999",
      "background: rgba(220, 53, 69, 0.14)",
      "border-bottom: 1px solid rgba(220, 53, 69, 0.35)",
      "color: #f8d7da",
      "padding: 10px 12px",
      "font-size: 13px",
      "line-height: 1.35"
    ].join(";");
    document.body.prepend(banner);
  }

  banner.textContent =
    "Une erreur empêche l’affichage du dashboard. Ouvrez la console DevTools de l’extension pour le détail. " +
    `(${message || "Erreur inconnue"})`;
}

function buildStatsWindowForDateKeys(dateKeys, nowTs = Date.now()) {
  const ordered = [...(dateKeys instanceof Set ? dateKeys : dateKeys)]
    .map((key) => parseDateKey(key))
    .filter((d) => d instanceof Date && Number.isFinite(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  if (!ordered.length) {
    return { windowStartMs: nowTs, windowEndMs: nowTs, windowSpanSeconds: 0 };
  }
  const first = ordered[0];
  first.setHours(0, 0, 0, 0);
  const last = ordered[ordered.length - 1];
  last.setHours(0, 0, 0, 0);
  const windowStartMs = first.getTime();
  const windowEndMs = Math.min(last.getTime() + 24 * 60 * 60 * 1000, nowTs);
  const windowSpanSeconds = Math.max(0, Math.round((windowEndMs - windowStartMs) / 1000));
  return { windowStartMs, windowEndMs, windowSpanSeconds };
}

function createGroupMetricRow(canonicalKey) {
  return {
    groupKey: canonicalKey,
    label: formatGroupLabel(canonicalKey),
    openSeconds: 0,
    activeSeconds: 0,
    seconds: 0,
    openIntervals: [],
    activeIntervals: []
  };
}

function pushGroupMetricIntervals(
  row,
  startMs,
  endMs,
  openSeconds,
  activeSeconds,
  windowStartMs,
  windowEndMs,
  lastActivityAt
) {
  const openWindow = clipIntervalToWindow(startMs, endMs, windowStartMs, windowEndMs);
  if (!openWindow) return;
  row.openIntervals.push(openWindow);
  const activeSpanMs = Math.min(openWindow.endMs - openWindow.startMs, activeSeconds * 1000);
  if (activeSpanMs <= 0) return;
  const anchor = Number.isFinite(Number(lastActivityAt))
    ? Math.min(openWindow.endMs, Math.max(openWindow.startMs, toTimestamp(lastActivityAt)))
    : openWindow.endMs;
  row.activeIntervals.push({
    startMs: Math.max(openWindow.startMs, anchor - activeSpanMs),
    endMs: anchor
  });
}

function finalizeGroupMetricRow(row, windowSpanSeconds) {
  row.openIntervals = mergeIntervals(row.openIntervals);
  row.activeIntervals = mergeIntervals(row.activeIntervals);
  row.openSeconds = Math.min(windowSpanSeconds, unionDurationSeconds(row.openIntervals));
  row.activeSeconds = Math.min(row.openSeconds, unionDurationSeconds(row.activeIntervals));
  delete row.openIntervals;
  delete row.activeIntervals;
}

function mergeGroupMetricRows(target, source) {
  if (!target.openIntervals) {
    target.openIntervals = [];
    target.activeIntervals = [];
  }
  target.openIntervals.push(...(source.openIntervals || []));
  target.activeIntervals.push(...(source.activeIntervals || []));
}

/**
 * Agrégation stats par clé canonique (source unique doughnut + légende).
 * Union temporelle par groupe (évite le double comptage onglets parallèles).
 * @param {Set<string>|string[]} dateKeys
 * @param {object[]} entries
 * @param {{ tabs?: object[] }} live
 * @param {{ groupMode: string, groupPathDepth: number, groupPrefix: string }} config
 * @param {{ dualMetric?: boolean, metric?: "active"|"open" }} [options]
 */
function aggregateByGroupKey(dateKeys, entries, live, config, options = {}) {
  const { dualMetric = false, metric = "active" } = options;
  const allowed = dateKeys instanceof Set ? dateKeys : new Set(dateKeys);
  const nowTs = Date.now();
  const { windowStartMs, windowEndMs, windowSpanSeconds } = buildStatsWindowForDateKeys(
    allowed,
    nowTs
  );
  /** @type {Map<string, { groupKey: string, label: string, activeSeconds: number, openSeconds: number, seconds: number, openIntervals: object[], activeIntervals: object[] }>} */
  const byCanonical = new Map();

  const addRecord = (record, isLive = false) => {
    const raw = cleanStatsToken(record.groupKey || resolveStatsGroupKey(record, config) || "");
    const canonicalKey = normalizeStatsGroupKey(raw, config) || "";
    if (!canonicalKey || canonicalKey === "system") return;
    let row = byCanonical.get(canonicalKey);
    if (!row) {
      row = createGroupMetricRow(canonicalKey);
      byCanonical.set(canonicalKey, row);
    }
    const secs = coerceOpenActiveSeconds(record.openSeconds, record.activeSeconds);
    const startMs = toTimestamp(record.start ?? record.segmentStart ?? record.openedAt);
    const endMs = isLive ? nowTs : toTimestamp(record.end);
    pushGroupMetricIntervals(
      row,
      startMs,
      endMs,
      secs.openSeconds,
      secs.activeSeconds,
      windowStartMs,
      windowEndMs,
      isLive ? record.lastActivityAt : undefined
    );
  };

  for (const e of entries) {
    if (!allowed.has(e.date)) continue;
    addRecord(e, false);
  }
  for (const t of live.tabs || []) {
    const dayKey = dateKeyFromTs(t.segmentStart || t.openedAt);
    if (!allowed.has(dayKey)) continue;
    addRecord(t, true);
  }

  const byLabel = new Map();
  for (const row of byCanonical.values()) {
    const labelKey = normalizeStatsLabelKey(row.groupKey);
    if (!labelKey) continue;
    const target = byLabel.get(labelKey);
    if (!target) {
      byLabel.set(labelKey, {
        groupKey: row.groupKey,
        label: row.label,
        openIntervals: [...row.openIntervals],
        activeIntervals: [...row.activeIntervals]
      });
      continue;
    }
    mergeGroupMetricRows(target, row);
  }

  const finalized = [];
  for (const row of byLabel.values()) {
    finalizeGroupMetricRow(row, windowSpanSeconds);
    row.seconds = dualMetric
      ? row.activeSeconds
      : metric === "open"
      ? row.openSeconds
      : row.activeSeconds;
    finalized.push(row);
  }

  const sorted = finalized
    .sort((a, b) => {
      const score = (x) =>
        dualMetric ? Math.max(x.activeSeconds, x.openSeconds) : x.seconds;
      return score(b) - score(a);
    })
    .slice(0, 8);

  const deduped = assertNoDuplicateDistributionLabels(sorted);

  if (dualMetric) {
    const items = deduped.map((row) => ({
      groupKey: row.groupKey,
      label: row.label,
      activeSeconds: row.activeSeconds,
      openSeconds: row.openSeconds,
      seconds: row.activeSeconds
    }));
    const hasData = items.length > 0;
    return {
      dualMetric: true,
      labels: hasData ? items.map((i) => truncateChartLabel(i.label)) : ["Aucune donnée"],
      activeValues: hasData ? items.map((i) => i.activeSeconds) : [1],
      openValues: hasData ? items.map((i) => i.openSeconds) : [1],
      values: hasData ? items.map((i) => i.activeSeconds) : [1],
      items
    };
  }

  const items = deduped.map((row) => ({
    groupKey: row.groupKey,
    label: row.label,
    seconds: row.seconds
  }));
  return {
    labels: items.length ? items.map((i) => truncateChartLabel(i.label)) : ["Aucune donnée"],
    values: items.length ? items.map((i) => i.seconds) : [1],
    items
  };
}

function aggregateWeekByGroupDual(entries, live, config) {
  return aggregateByGroupKey(weekDateKeys(), entries, live, config, { dualMetric: true });
}

function aggregateDayByGroup(dayKey, entries, live, mode, config) {
  return aggregateByGroupKey(new Set([dayKey]), entries, live, config, { metric: mode });
}

/**
 * Insights hebdomadaires (semaine affichée = `weekStart`, agrégation v1.0.14).
 * @returns {object}
 */
function aggregateWeekInsights(entries, live) {
  const inWeek = weekDateKeys();
  const dayMap = buildUnifiedDayMetricsForDateKeys(inWeek, entries, live);
  const insights = computeInsightsForRange({ dayKeys: inWeek }, entries, live);

  let busiestDay = null;
  for (const [dateKey, row] of dayMap) {
    if (!busiestDay || row.activeSeconds > busiestDay.activeSeconds) {
      busiestDay = {
        dateKey,
        label: row.label,
        activeSeconds: row.activeSeconds,
        openSeconds: row.openSeconds
      };
    }
  }
  if (busiestDay && busiestDay.activeSeconds <= 0) busiestDay = null;

  return { ...insights, busiestDay };
}

function buildInsightsRangeWindow(dayKeys) {
  const ordered = [...dayKeys]
    .map((key) => ({ key, start: parseDateKey(key).getTime() }))
    .filter((x) => Number.isFinite(x.start))
    .sort((a, b) => a.start - b.start);
  if (!ordered.length) {
    const now = Date.now();
    return { startMs: now, endMs: now };
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const startMs = ordered[0].start;
  let endMs = ordered[ordered.length - 1].start + dayMs;
  const todayStartMs = new Date().setHours(0, 0, 0, 0);
  const todayCapMs = Date.now();
  const includesToday = ordered.some((x) => x.start === todayStartMs);
  if (includesToday) endMs = Math.min(endMs, todayCapMs);
  return { startMs, endMs };
}

function clipIntervalToWindow(startMs, endMs, windowStartMs, windowEndMs) {
  const safeStart = Math.max(windowStartMs, toTimestamp(startMs));
  const safeEnd = Math.min(windowEndMs, toTimestamp(endMs));
  if (!(safeEnd > safeStart)) return null;
  return { startMs: safeStart, endMs: safeEnd };
}

function unionDurationSeconds(intervals) {
  if (!intervals.length) return 0;
  const sorted = intervals
    .map((it) => ({ startMs: it.startMs, endMs: it.endMs }))
    .filter((it) => Number.isFinite(it.startMs) && Number.isFinite(it.endMs) && it.endMs > it.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (!sorted.length) return 0;
  let totalMs = 0;
  let curStart = sorted[0].startMs;
  let curEnd = sorted[0].endMs;
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    if (it.startMs <= curEnd) {
      curEnd = Math.max(curEnd, it.endMs);
      continue;
    }
    totalMs += curEnd - curStart;
    curStart = it.startMs;
    curEnd = it.endMs;
  }
  totalMs += curEnd - curStart;
  return Math.max(0, Math.round(totalMs / 1000));
}

/**
 * Compute insights pour une plage de jours (clés locales YYYY-MM-DD).
 * @param {{ dayKeys: Set<string> }} range
 * @param {object[]} entries
 * @param {any} live
 */
function computeInsightsForRange(range, entries, live) {
  const dayKeys = range.dayKeys;
  const totals = { open: 0, active: 0 };
  const unifiedDayMap = buildUnifiedDayMetricsForDateKeys(dayKeys, entries, live);

  /** @type {Map<string, { groupKey: string, openSeconds: number, activeSeconds: number, titles: Set<string> }>} */
  const byGroup = new Map();
  /** @type {Map<string, { groupKey: string, title: string, url: string, openSeconds: number, activeSeconds: number }>} */
  const byTab = new Map();
  let firstTs = null;
  let lastTs = null;

  const addRecord = (rec) => {
    const gk = rec.groupKey || "?";
    let g = byGroup.get(gk);
    if (!g) {
      g = { groupKey: gk, openSeconds: 0, activeSeconds: 0, titles: new Set() };
      byGroup.set(gk, g);
    }
    g.openSeconds += rec.openSeconds;
    g.activeSeconds += rec.activeSeconds;
    if (rec.title) g.titles.add(rec.title);

    const tabKey = `${gk}\u001f${rec.title || ""}\u001f${rec.url || ""}`;
    let tab = byTab.get(tabKey);
    if (!tab) {
      tab = { groupKey: gk, title: rec.title || "", url: rec.url || "", openSeconds: 0, activeSeconds: 0 };
      byTab.set(tabKey, tab);
    }
    tab.openSeconds += rec.openSeconds;
    tab.activeSeconds += rec.activeSeconds;

    if (typeof rec.start === "number") {
      if (firstTs == null || rec.start < firstTs) firstTs = rec.start;
    }
    if (typeof rec.end === "number") {
      if (lastTs == null || rec.end > lastTs) lastTs = rec.end;
    }
  };

  for (const e of entries) {
    if (!dayKeys.has(e.date)) continue;
    const secs = coerceOpenActiveSeconds(e.openSeconds, e.activeSeconds);
    const startMs = toTimestamp(e.start);
    const endMs = toTimestamp(e.end);
    addRecord({
      groupKey: e.groupKey,
      title: e.title,
      url: e.url,
      openSeconds: secs.openSeconds,
      activeSeconds: secs.activeSeconds,
      start: startMs,
      end: endMs
    });
  }
  for (const t of live.tabs || []) {
    const dayKey = dateKeyFromTs(t.segmentStart || t.openedAt);
    if (!dayKeys.has(dayKey)) continue;
    const secs = coerceOpenActiveSeconds(t.openSeconds, t.activeSeconds);
    const startMs = toTimestamp(t.segmentStart || t.openedAt);
    const endMs = Date.now();
    addRecord({
      groupKey: t.groupKey,
      title: t.title,
      url: t.url,
      openSeconds: secs.openSeconds,
      activeSeconds: secs.activeSeconds,
      start: startMs,
      end: endMs
    });
  }

  const unifiedTotals = sumDayMetrics(unifiedDayMap);
  totals.open = unifiedTotals.open;
  totals.active = Math.min(unifiedTotals.open, unifiedTotals.active);

  const pickTop = (list, field) => {
    if (!list.length) return null;
    return [...list].sort((a, b) => b[field] - a[field])[0];
  };

  const groupsList = [...byGroup.values()];
  const tabsList = [...byTab.values()];
  const topActiveGroup = pickTop(groupsList, "activeSeconds");
  const topOpenGroup = pickTop(groupsList, "openSeconds");
  const topActiveTab = pickTop(tabsList, "activeSeconds");
  const topOpenTab = pickTop(tabsList, "openSeconds");

  const topSites = groupsList
    .filter((g) => g.activeSeconds > 0)
    .sort((a, b) => b.activeSeconds - a.activeSeconds)
    .slice(0, 3)
    .map((g) => ({
      groupKey: g.groupKey,
      label: formatGroupLabel(g.groupKey),
      activeSeconds: g.activeSeconds
    }));

  const ratioPercent = totals.open > 0 ? Math.round((totals.active / totals.open) * 100) : null;
  const focusPercent =
    totals.active > 0 && topActiveGroup
      ? Math.round((topActiveGroup.activeSeconds / totals.active) * 100)
      : null;

  const enrichGroup = (g) => {
    if (!g) return null;
    const titles = [...g.titles];
    return {
      groupKey: g.groupKey,
      label: formatGroupLabel(g.groupKey),
      openSeconds: g.openSeconds,
      activeSeconds: g.activeSeconds,
      singleTitle: titles.length === 1 ? titles[0] : null
    };
  };

  const enrichTab = (t) => {
    if (!t) return null;
    return {
      groupKey: t.groupKey,
      label: formatGroupLabel(t.groupKey),
      title: t.title,
      url: t.url,
      openSeconds: t.openSeconds,
      activeSeconds: t.activeSeconds
    };
  };

  return {
    totals,
    ratioPercent,
    focusPercent,
    topActiveGroup: enrichGroup(topActiveGroup),
    topOpenGroup: enrichGroup(topOpenGroup),
    topActiveTab: enrichTab(topActiveTab),
    topOpenTab: enrichTab(topOpenTab),
    topSites,
    distinctGroups: byGroup.size,
    distinctTabs: byTab.size,
    timeRange: firstTs != null && lastTs != null ? { firstTs, lastTs } : null
  };
}

function aggregateDayInsights(dayKey, entries, live) {
  return computeInsightsForRange({ dayKeys: new Set([dayKey]) }, entries, live);
}

const dailyChartDatasets = [
  { label: "Ouvert", backgroundColor: chartColors.greenDim, dataKey: "openValues" },
  { label: "Actif", backgroundColor: chartColors.green, dataKey: "activeValues" }
];

function maxOfArrays(...lists) {
  let m = 0;
  for (const list of lists) {
    for (const v of list) {
      if (v > m) m = v;
    }
  }
  return m;
}

/** Axe Y lisible même sans données (évite un canvas  vide ). */
function yScaleForValues(maxValue) {
  const base = {
    beginAtZero: true,
    ticks: { color: chartColors.muted, callback: (v) => formatDurationShort(v) },
    grid: { color: chartColors.grid }
  };
  if (maxValue <= 0) return { ...base, suggestedMax: 3600 };
  return base;
}

function createDailyChart(canvas, daily) {
  dailyChartDateKeys = daily.dateKeys || [];
  const yMax = maxOfArrays(daily.openValues, daily.activeValues);
  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: daily.labels,
      datasets: dailyChartDatasets.map((ds) => ({
        label: ds.label,
        data: daily[ds.dataKey],
        backgroundColor: ds.backgroundColor
      }))
    },
    options: {
      ...chartDefaults(),
      animation: false,
      maintainAspectRatio: false,
      onClick: (_ev, elements) => {
        if (!elements?.length) return;
        const idx = elements[0].index;
        const key = dailyChartDateKeys[idx];
        if (key) setStatsSelectedDay(key);
      },
      scales: {
        x: { stacked: false, ticks: { color: chartColors.muted, maxRotation: 45 }, grid: { color: chartColors.grid } },
        y: yScaleForValues(yMax)
      }
    }
  });
  markChartStructure(chart, labelsStructureKey(daily.labels));
  scheduleFillChartResize();
  return chart;
}

function buildStatsActivityTimeline(entries, live) {
  const timelineScope = statsInsightsScope === TIMELINE_SCOPE_DAY ? TIMELINE_SCOPE_DAY : TIMELINE_SCOPE_WEEK;
  const isDayScope = timelineScope === TIMELINE_SCOPE_DAY;
  const bucketMinutes = getTimelineBucketMinutes(timelineScope);
  const start = isDayScope ? parseDateKey(statsSelectedDay) : new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const rangeStartMs = start.getTime();
  const dayCount = isDayScope ? 1 : 7;
  const dayKeys = new Set();
  for (let i = 0; i < dayCount; i++) {
    dayKeys.add(dateKeyFromTs(addDays(start, i).getTime()));
  }
  const dayMap = buildUnifiedDayMetricsForDateKeys(dayKeys, entries, live);
  const orderedRows = [...dayMap.values()].sort((a, b) => a.dayStartMs - b.dayStartMs);
  // Chronologie activity: toujours en valeurs bucket (non cumul), pour jour et semaine.
  const rangeEndMs = rangeStartMs + dayCount * 24 * 60 * 60 * 1000;
  const bucket = createTemporalBucket(rangeStartMs, rangeEndMs, bucketMinutes, false);
  const bucketMs = bucketMinutes * 60 * 1000;
  const openDelta = Array.from({ length: bucket.open.length }, () => 0);
  const activeDelta = Array.from({ length: bucket.active.length }, () => 0);
  const addIntervals = (intervals, target) => {
    for (const interval of intervals) {
      const clipped = clipIntervalToWindow(interval.startMs, interval.endMs, rangeStartMs, rangeEndMs);
      if (!clipped) continue;
      let cursor = clipped.startMs;
      while (cursor < clipped.endMs) {
        const bucketIndex = Math.max(
          0,
          Math.min(target.length - 1, Math.floor((cursor - rangeStartMs) / bucketMs))
        );
        const nextBucket = rangeStartMs + (bucketIndex + 1) * bucketMs;
        const segmentEnd = Math.min(clipped.endMs, nextBucket);
        const deltaSec = (segmentEnd - cursor) / 1000;
        target[bucketIndex] += deltaSec;
        cursor = segmentEnd;
      }
    }
  };
  for (const row of orderedRows) {
    addIntervals(row?.openIntervals || [], openDelta);
    addIntervals(row?.activeIntervals || [], activeDelta);
  }
  for (let i = 0; i < bucket.open.length; i++) {
    openDelta[i] = Math.max(0, openDelta[i]);
    activeDelta[i] = Math.min(openDelta[i], Math.max(0, activeDelta[i]));
  }
  bucket.open = [...openDelta];
  bucket.active = [...activeDelta];
  return {
    ...bucket,
    openDelta,
    activeDelta,
    timelineScope
  };
}

function activityTimelineSeriesLabels(scope) {
  return {
    open: "Ouvert (bucket 1 h)",
    active: "Actif (bucket 1 h)"
  };
}

function timelinePointRadiusForIndex(data, dataIndex, baseRadius = 1.5) {
  if (!Array.isArray(data)) return 0;
  const current = Number(data[dataIndex]);
  if (!Number.isFinite(current)) return 0;
  const prev = dataIndex > 0 ? Number(data[dataIndex - 1]) : Number.NaN;
  const next = dataIndex + 1 < data.length ? Number(data[dataIndex + 1]) : Number.NaN;
  const sameAsPrev = Number.isFinite(prev) && Math.abs(prev - current) < 0.001;
  const sameAsNext = Number.isFinite(next) && Math.abs(next - current) < 0.001;
  // Masque les points sur les segments plats internes (effet "collier de perles").
  if (sameAsPrev && sameAsNext) return 0;
  return baseRadius;
}

function activityTimelinePointRadius(ctx, hover = false) {
  const dataIndex = Number(ctx?.dataIndex);
  if (!Number.isInteger(dataIndex) || dataIndex < 0) return hover ? 4 : 1.5;
  const data = ctx?.dataset?.data;
  const baseRadius = hover ? 4 : 1.5;
  return timelinePointRadiusForIndex(data, dataIndex, baseRadius);
}

function formatTimelineBucketRange(rangeStartMs, rangeEndMs, bucketMinutes, dataIndex) {
  const startMs = rangeStartMs + dataIndex * bucketMinutes * 60 * 1000;
  const endMs = Math.min(rangeEndMs, startMs + bucketMinutes * 60 * 1000);
  return `${formatClock(startMs)}-${formatClock(endMs)}`;
}

function createActivityTimelineChart(canvas, timeline) {
  const timelineScope = timeline.timelineScope || (statsInsightsScope === "day" ? "day" : "week");
  const seriesLabels = activityTimelineSeriesLabels(timelineScope);
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: timeline.labels,
      datasets: [
        {
          label: seriesLabels.open,
          data: timeline.open,
          borderColor: chartColors.muted,
          backgroundColor: "rgba(154, 160, 166, 0.18)",
          borderWidth: 1.1,
          pointRadius: (ctx) => activityTimelinePointRadius(ctx, false),
          pointHoverRadius: (ctx) => activityTimelinePointRadius(ctx, true),
          tension: 0.12,
          fill: true
        },
        {
          label: seriesLabels.active,
          data: timeline.active,
          borderColor: chartColors.green,
          backgroundColor: "rgba(40, 167, 69, 0.2)",
          borderWidth: 1.4,
          pointRadius: (ctx) => activityTimelinePointRadius(ctx, false),
          pointHoverRadius: (ctx) => activityTimelinePointRadius(ctx, true),
          tension: 0.12,
          fill: true
        }
      ]
    },
    options: {
      ...chartDefaults(),
      animation: false,
      maintainAspectRatio: false,
      plugins: {
        ...chartDefaults().plugins,
        tooltip: {
          ...chartDefaults().plugins.tooltip,
          callbacks: {
            ...(chartDefaults().plugins.tooltip?.callbacks || {}),
            title(items) {
              if (!items || !items.length) return "";
              const idx = Number(items[0].dataIndex) || 0;
              return formatTemporalTooltipTitle(timeline.rangeStartMs, timeline.bucketMinutes, idx);
            },
            label(ctx) {
              const value = Math.round(Number(ctx.parsed?.y) || 0);
              const prefix = ctx.datasetIndex === 0 ? "Ouvert (bucket 1 h)" : "Actif (bucket 1 h)";
              return `${prefix}: ${formatDurationFull(value)}`;
            },
            afterBody(items) {
              if (!items || !items.length) return [];
              const idx = Number(items[0].dataIndex) || 0;
              const point = timeline.openDelta?.[idx] || 0;
              const pointActive = timeline.activeDelta?.[idx] || 0;
              return [
                `Créneau: ${formatTimelineBucketRange(timeline.rangeStartMs, timeline.rangeEndMs, timeline.bucketMinutes, idx)}`,
                `Delta: A ${formatDurationShort(Math.round(pointActive))} · O ${formatDurationShort(Math.round(point))}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          ticks:
            timelineScope === "day"
              ? { ...temporalAxisTicks(timelineScope, timeline.rangeStartMs, timeline.bucketMinutes, 24), autoSkip: false }
              : temporalAxisTicks(timelineScope, timeline.rangeStartMs, timeline.bucketMinutes, 14),
          grid: { color: chartColors.grid }
        },
        y: yScaleForValues(maxOfArrays(timeline.open, timeline.active))
      }
    }
  });
  markChartStructure(chart, labelsStructureKey(timeline.labels));
  scheduleFillChartResize();
  return chart;
}

function upsertActivityTimelineChart(timeline) {
  const canvas = document.getElementById("chart-activity-timeline");
  if (!canvas) return;
  const key = labelsStructureKey(timeline.labels);
  if (chartNeedsRecreate(charts.activityTimeline, key)) {
    destroyChart("activityTimeline");
    charts.activityTimeline = createActivityTimelineChart(canvas, timeline);
    scheduleFillChartResize();
    return;
  }
  const timelineScope = timeline.timelineScope || (statsInsightsScope === "day" ? "day" : "week");
  const seriesLabels = activityTimelineSeriesLabels(timelineScope);
  charts.activityTimeline.data.labels = timeline.labels;
  charts.activityTimeline.data.datasets[0].label = seriesLabels.open;
  charts.activityTimeline.data.datasets[1].label = seriesLabels.active;
  charts.activityTimeline.data.datasets[0].data = timeline.open;
  charts.activityTimeline.data.datasets[1].data = timeline.active;
  charts.activityTimeline.options.scales.y = yScaleForValues(maxOfArrays(timeline.open, timeline.active));
  charts.activityTimeline.options.scales.x.ticks =
    timelineScope === "day"
      ? { ...temporalAxisTicks(timelineScope, timeline.rangeStartMs, timeline.bucketMinutes, 24), autoSkip: false }
      : temporalAxisTicks(timelineScope, timeline.rangeStartMs, timeline.bucketMinutes, 14);
  if (!charts.activityTimeline.options.plugins.tooltip.callbacks) {
    charts.activityTimeline.options.plugins.tooltip.callbacks = {};
  }
  charts.activityTimeline.options.plugins.tooltip.callbacks.title = (items) => {
    if (!items || !items.length) return "";
    const idx = Number(items[0].dataIndex) || 0;
    return formatTemporalTooltipTitle(timeline.rangeStartMs, timeline.bucketMinutes, idx);
  };
  charts.activityTimeline.options.plugins.tooltip.callbacks.label = (ctx) => {
    const value = Math.round(Number(ctx.parsed?.y) || 0);
    const prefix = ctx.datasetIndex === 0 ? "Ouvert (bucket 1 h)" : "Actif (bucket 1 h)";
    return `${prefix}: ${formatDurationFull(value)}`;
  };
  charts.activityTimeline.options.plugins.tooltip.callbacks.afterBody = (items) => {
    if (!items || !items.length) return [];
    const idx = Number(items[0].dataIndex) || 0;
    const point = timeline.openDelta?.[idx] || 0;
    const pointActive = timeline.activeDelta?.[idx] || 0;
    return [
      `Créneau: ${formatTimelineBucketRange(timeline.rangeStartMs, timeline.rangeEndMs, timeline.bucketMinutes, idx)}`,
      `Delta: A ${formatDurationShort(Math.round(pointActive))} · O ${formatDurationShort(Math.round(point))}`
    ];
  };
  markChartStructure(charts.activityTimeline, key);
  updateChartQuiet(charts.activityTimeline);
  scheduleFillChartResize();
}

function scheduleDoughnutChartResize() {
  if (doughnutResizeTimer) clearTimeout(doughnutResizeTimer);
  doughnutResizeTimer = setTimeout(() => {
    doughnutResizeTimer = null;
    const keys = [...DISTRIBUTION_WEEK.chartKeys, DISTRIBUTION_DAY.chartKey];
    for (const key of keys) {
      if (charts[key]) charts[key].resize();
    }
  }, 150);
}

function createDoughnutChart(canvas, groups) {
  const labels = groups.labels.length ? groups.labels : ["Aucune donnée"];
  const values = groups.values.length ? groups.values : [1];
  const segmentColors = doughnutSegmentColors(groups);
  const chart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: segmentColors,
        borderColor: chartColors.grid,
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1,
      animation: false,
      plugins: {
        ...chartDefaults().plugins,
        legend: { display: false }
      }
    }
  });
  markChartStructure(chart, labelsStructureKey(labels));
  return chart;
}

function doughnutLegendExternalLinkHtml(groupKey) {
  const href = toSafeHref(groupKey);
  if (!href) return "";
  const label = escapeHtml(formatGroupLabel(groupKey));
  return `<a class="doughnut-legend-external" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="Ouvrir le site" aria-label="Ouvrir ${label} dans un nouvel onglet" tabindex="-1"><span class="icon-external" aria-hidden="true"></span></a>`;
}

/** Largeur % stricte pour barres légende (secondes brutes / max échelle liste). */
function legendBarFillWidthPercent(seconds, scaleMax) {
  const sec = toFiniteSeconds(seconds, 0);
  const max = toFiniteSeconds(scaleMax, 0);
  if (sec <= 0 || max <= 0) return 0;
  return Math.min(100, (sec / max) * 100);
}

function applyDoughnutLegendBarFill(el, seconds, scaleMax, color) {
  if (!el) return;
  const pct = legendBarFillWidthPercent(seconds, scaleMax);
  el.style.width = `${pct}%`;
  el.style.minWidth = pct > 0 ? "1px" : "0";
  el.style.background = color;
}

/** @param {string} legendId @param {"day"|"week"} scope */
function bindDoughnutLegendClicks(legendId, scope) {
  if (doughnutLegendClickBound[scope]) return;
  const el = document.getElementById(legendId);
  if (!el) return;
  doughnutLegendClickBound[scope] = true;

  const openFromRow = (row) => {
    const groupKey = row.dataset.groupKey;
    if (!groupKey) return;
    if (scope === "day") openGroupModalForDay(groupKey, statsSelectedDay);
    else openWeekInsightModal({ kind: "group", groupKey, title: "", url: "" });
  };

  el.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest(".doughnut-legend-external")) return;
    const row = e.target instanceof Element ? e.target.closest(".doughnut-legend-row") : null;
    if (!row) return;
    openFromRow(row);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target instanceof Element && e.target.closest(".doughnut-legend-external")) return;
    const row = e.target instanceof Element ? e.target.closest(".doughnut-legend-row") : null;
    if (!row) return;
    e.preventDefault();
    openFromRow(row);
  });
}

/** Lgende HTML sous le doughnut (sites + durée ; mode dual = A et O cte  cte). */
function renderDoughnutLegend(groups, legendId, legendStateKey, dualMetric = false) {
  const el = document.getElementById(legendId);
  if (!el) return;

  const items = groups.items || [];
  if (!items.length) {
    el.replaceChildren();
    el.hidden = true;
    doughnutLegendStructureKeys[legendStateKey] = "";
    return;
  }

  const colorMap = assignColorsForItems(items);
  const legendColor = (groupKey) => colorMap.get(groupKey) ?? CHART_EMPTY_SEGMENT_COLOR;

  el.hidden = false;
  const structureKey = `v2:${dualMetric ? "dual:" : "single:"}${items.map((i) => i.groupKey).join("\0")}`;
  if (structureKey !== doughnutLegendStructureKeys[legendStateKey]) {
    doughnutLegendStructureKeys[legendStateKey] = structureKey;
    if (dualMetric) {
      el.innerHTML = items
        .map(
          (item, idx) => `
      <li class="doughnut-legend-row" role="button" tabindex="0" data-legend-index="${idx}" data-group-key="${escapeHtml(item.groupKey)}" aria-label="Détails pour ${escapeHtml(item.label)}">
        <span class="doughnut-legend-swatch" style="background:${legendColor(item.groupKey)}" aria-hidden="true"></span>
        <div class="doughnut-legend-main">
          <div class="doughnut-legend-head">
            <span class="doughnut-legend-site" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
            <div class="doughnut-legend-metrics">
              <span class="doughnut-legend-badge doughnut-legend-badge--active" data-metric="active"></span>
              <span class="doughnut-legend-badge doughnut-legend-badge--open" data-metric="open"></span>
              ${doughnutLegendExternalLinkHtml(item.groupKey)}
            </div>
          </div>
          <div class="doughnut-legend-bars-dual" aria-hidden="true">
            <div class="doughnut-legend-bar"><span class="doughnut-legend-bar-fill doughnut-legend-bar-fill--active"></span></div>
            <div class="doughnut-legend-bar"><span class="doughnut-legend-bar-fill doughnut-legend-bar-fill--open"></span></div>
          </div>
        </div>
      </li>`
        )
        .join("");
    } else {
      el.innerHTML = items
        .map(
          (item, idx) => `
      <li class="doughnut-legend-row" role="button" tabindex="0" data-legend-index="${idx}" data-group-key="${escapeHtml(item.groupKey)}" aria-label="Détails pour ${escapeHtml(item.label)}">
        <span class="doughnut-legend-swatch" style="background:${legendColor(item.groupKey)}" aria-hidden="true"></span>
        <div class="doughnut-legend-main">
          <div class="doughnut-legend-head">
            <span class="doughnut-legend-site" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
            <span class="doughnut-legend-duration"></span>
            ${doughnutLegendExternalLinkHtml(item.groupKey)}
          </div>
          <div class="doughnut-legend-bar" aria-hidden="true">
            <span class="doughnut-legend-bar-fill"></span>
          </div>
        </div>
      </li>`
        )
        .join("");
    }
  }

  if (dualMetric) {
    // Échelle commune : max Ouvert de la liste (barres A et O comparables entre elles et entre lignes).
    const scaleMax = items.reduce((m, i) => Math.max(m, i.openSeconds), 0) || 1;
    const rows = el.querySelectorAll(".doughnut-legend-row");
    items.forEach((item, idx) => {
      const row = rows[idx];
      if (!row) return;
      const badgeA = row.querySelector('[data-metric="active"]');
      const badgeO = row.querySelector('[data-metric="open"]');
      if (badgeA) {
        badgeA.textContent = `A ${formatDurationShort(item.activeSeconds)}`;
        badgeA.title = `Actif : ${formatDurationFull(item.activeSeconds)}`;
      }
      if (badgeO) {
        badgeO.textContent = `O ${formatDurationShort(item.openSeconds)}`;
        badgeO.title = `Ouvert : ${formatDurationFull(item.openSeconds)}`;
      }
      const fillA = row.querySelector(".doughnut-legend-bar-fill--active");
      const fillO = row.querySelector(".doughnut-legend-bar-fill--open");
      applyDoughnutLegendBarFill(fillA, item.activeSeconds, scaleMax, legendColor(item.groupKey));
      applyDoughnutLegendBarFill(fillO, item.openSeconds, scaleMax, legendColor(item.groupKey));
    });
    bindDoughnutLegendClicks(legendId, legendStateKey);
    return;
  }

  const maxSec = items.reduce((m, i) => Math.max(m, i.seconds), 0) || 1;
  const rows = el.querySelectorAll(".doughnut-legend-row");
  items.forEach((item, idx) => {
    const row = rows[idx];
    if (!row) return;
    const dur = row.querySelector(".doughnut-legend-duration");
    if (dur) {
      dur.textContent = formatDurationShort(item.seconds);
      dur.title = formatDurationFull(item.seconds);
    }
    const fill = row.querySelector(".doughnut-legend-bar-fill");
    applyDoughnutLegendBarFill(fill, item.seconds, maxSec, legendColor(item.groupKey));
  });

  bindDoughnutLegendClicks(legendId, legendStateKey);
}

function upsertDailyChart(daily) {
  const canvas = document.getElementById("chart-daily");
  dailyChartDateKeys = daily.dateKeys || [];
  const key = labelsStructureKey(daily.labels);
  if (chartNeedsRecreate(charts.daily, key)) {
    destroyChart("daily");
    charts.daily = createDailyChart(canvas, daily);
    scheduleFillChartResize();
    return;
  }
  charts.daily.data.labels = daily.labels;
  dailyChartDatasets.forEach((ds, i) => {
    charts.daily.data.datasets[i].data = daily[ds.dataKey];
  });
  markChartStructure(charts.daily, key);
  updateChartQuiet(charts.daily);
  scheduleFillChartResize();
}

function upsertSingleDistributionChart(groups, card) {
  const canvas = document.getElementById(card.canvasId);
  const labels = groups.labels.length ? groups.labels : ["Aucune donnée"];
  const values = groups.values.length ? groups.values : [1];
  const key = labelsStructureKey(labels);
  if (chartNeedsRecreate(charts[card.chartKey], key)) {
    destroyChart(card.chartKey);
    charts[card.chartKey] = createDoughnutChart(canvas, groups);
    renderDoughnutLegend(groups, card.legendId, card.legendStateKey, false);
    scheduleDoughnutChartResize();
    return;
  }
  charts[card.chartKey].data.labels = labels;
  charts[card.chartKey].data.datasets[0].data = values;
  charts[card.chartKey].data.datasets[0].backgroundColor = doughnutSegmentColors(groups);
  markChartStructure(charts[card.chartKey], key);
  updateChartQuiet(charts[card.chartKey]);
  renderDoughnutLegend(groups, card.legendId, card.legendStateKey, false);
  scheduleDoughnutChartResize();
}

function upsertDualDistributionCharts(groups, card) {
  const labels = groups.labels.length ? groups.labels : ["Aucune donnée"];
  const activeValues = groups.activeValues?.length ? groups.activeValues : [1];
  const openValues = groups.openValues?.length ? groups.openValues : [1];
  const key = labelsStructureKey(labels);
  const [activeKey, openKey] = card.chartKeys;
  const [activeCanvasId, openCanvasId] = card.canvasIds;

  const upsertOne = (chartKey, canvasId, values) => {
    const canvas = document.getElementById(canvasId);
    const payload = { labels, values, items: groups.items };
    if (chartNeedsRecreate(charts[chartKey], key)) {
      destroyChart(chartKey);
      charts[chartKey] = createDoughnutChart(canvas, payload);
      return;
    }
    charts[chartKey].data.labels = labels;
    charts[chartKey].data.datasets[0].data = values;
    charts[chartKey].data.datasets[0].backgroundColor = doughnutSegmentColors(payload);
    markChartStructure(charts[chartKey], key);
    updateChartQuiet(charts[chartKey]);
  };

  const recreate =
    chartNeedsRecreate(charts[activeKey], key) || chartNeedsRecreate(charts[openKey], key);
  if (recreate) {
    destroyChart(activeKey);
    destroyChart(openKey);
  }
  upsertOne(activeKey, activeCanvasId, activeValues);
  upsertOne(openKey, openCanvasId, openValues);
  renderDoughnutLegend(groups, card.legendId, card.legendStateKey, true);
  scheduleDoughnutChartResize();
}

function renderDistributionCard(groups, card) {
  if (card.dualMetric) upsertDualDistributionCharts(groups, card);
  else upsertSingleDistributionChart(groups, card);
}

let weekInsightsClickBound = false;
let dayInsightsClickBound = false;
const doughnutLegendClickBound = { day: false, week: false };

function insightDurationAttrs(seconds) {
  const short = formatDurationShort(seconds);
  const full = formatDurationFull(seconds);
  return `title="${escapeHtml(full)}"`;
}

function renderWeekInsights(insights) {
  const root = document.getElementById("week-insights");
  if (!root) return;

  const { totals } = insights;
  const hasData = totals.open > 0 || totals.active > 0;

  if (!hasData) {
    root.innerHTML = `
      <div class="insight-tile insight-tile--empty">
        <span class="insight-icon" aria-hidden="true"> - </span>
        <div class="insight-body">
          <div class="insight-label">Semaine affichée</div>
          <div class="insight-value">Aucune donnée pour cette semaine</div>
          <div class="insight-sub">${escapeHtml(formatWeekRangeLabel())}</div>
        </div>
      </div>`;
    return;
  }

  const parts = [];

  parts.push(`
    <div class="insight-tile insight-tile--empty">
      <span class="insight-icon" aria-hidden="true">-</span>
      <div class="insight-body">
        <div class="insight-label">Temps réel total</div>
        <div class="insight-value" ${insightDurationAttrs(totals.open)}>O ${formatDurationShort(totals.open)} · A ${formatDurationShort(totals.active)}</div>
        <div class="insight-sub" title="Ouvert: ${formatDurationFull(totals.open)} · Actif: ${formatDurationFull(totals.active)}">${formatWeekRangeLabel()}</div>
      </div>
    </div>`);

  if (insights.topActiveGroup) {
    const g = insights.topActiveGroup;
    const sub = g.singleTitle ? escapeHtml(g.singleTitle) : "Regroupé par site / groupe";
    parts.push(`
      <div class="insight-tile insight-tile--clickable" role="listitem" data-insight-kind="group" data-group-key="${escapeHtml(g.groupKey)}" tabindex="0">
        <span class="insight-icon" aria-hidden="true">&</span>
        <div class="insight-body">
          <div class="insight-label">Plus actif (site)</div>
          <div class="insight-value" ${insightDurationAttrs(g.activeSeconds)}>${escapeHtml(g.label)}  ${formatDurationShort(g.activeSeconds)}</div>
          <div class="insight-sub">${sub}</div>
        </div>
      </div>`);
  }

  if (insights.topOpenGroup) {
    const g = insights.topOpenGroup;
    const sub = g.singleTitle ? escapeHtml(g.singleTitle) : "Durée ouverte cumule";
    parts.push(`
      <div class="insight-tile insight-tile--clickable" role="listitem" data-insight-kind="group" data-group-key="${escapeHtml(g.groupKey)}" tabindex="0">
        <span class="insight-icon" aria-hidden="true"></span>
        <div class="insight-body">
          <div class="insight-label">Plus ouvert (site)</div>
          <div class="insight-value" ${insightDurationAttrs(g.openSeconds)}>${escapeHtml(g.label)}  ${formatDurationShort(g.openSeconds)}</div>
          <div class="insight-sub">${sub}</div>
        </div>
      </div>`);
  }

  if (insights.focusPercent != null && insights.topActiveGroup) {
    parts.push(`
      <div class="insight-tile insight-tile--clickable" role="listitem" data-insight-kind="group" data-group-key="${escapeHtml(insights.topActiveGroup.groupKey)}" tabindex="0">
        <span class="insight-icon" aria-hidden="true">}</span>
        <div class="insight-body">
          <div class="insight-label">Focus</div>
          <div class="insight-value">${insights.focusPercent} % du temps actif</div>
          <div class="insight-sub">sur ${escapeHtml(insights.topActiveGroup.label)}</div>
        </div>
      </div>`);
  }

  if (insights.busiestDay) {
    const d = insights.busiestDay;
    parts.push(`
      <div class="insight-tile insight-tile--empty" role="listitem">
        <span class="insight-icon" aria-hidden="true"></span>
        <div class="insight-body">
          <div class="insight-label">Jour le plus actif</div>
          <div class="insight-value" ${insightDurationAttrs(d.activeSeconds)}>${escapeHtml(d.label)}  ${formatDurationShort(d.activeSeconds)}</div>
          <div class="insight-sub" title="Ouvert: ${formatDurationFull(d.openSeconds)}">O ${formatDurationShort(d.openSeconds)} ce jour-là</div>
        </div>
      </div>`);
  }

  const ratioLine =
    insights.ratioPercent != null
      ? `Ratio actif / ouvert : ${insights.ratioPercent} %`
      : "Ratio actif / ouvert :  - ";
  const countLine = `${insights.distinctGroups} groupe${insights.distinctGroups > 1 ? "s" : ""}  ${insights.distinctTabs} onglet${insights.distinctTabs > 1 ? "s" : ""}`;

  let sitesHtml = "";
  if (insights.topSites.length) {
    sitesHtml = `<div class="insight-sites">${insights.topSites
      .map(
        (s, i) =>
          `<div class="insight-site-row insight-site-row--link" role="listitem" data-insight-kind="group" data-group-key="${escapeHtml(s.groupKey)}" tabindex="0"><span>${i + 1}. ${escapeHtml(s.label)}</span><span ${insightDurationAttrs(s.activeSeconds)}>${formatDurationShort(s.activeSeconds)}</span></div>`
      )
      .join("")}</div>`;
  }

  parts.push(`
    <div class="insight-tile insight-tile--empty" role="listitem">
      <span class="insight-icon" aria-hidden="true">0</span>
      <div class="insight-body">
        <div class="insight-label">Synthèse</div>
        <div class="insight-value">${escapeHtml(ratioLine)}</div>
        <div class="insight-sub">${escapeHtml(countLine)}</div>
        ${sitesHtml ? `<div class="insight-label" style="margin-top:8px">Top sites (actif)</div>${sitesHtml}` : ""}
      </div>
    </div>`);

  if (insights.topActiveTab && insights.topActiveTab.activeSeconds > 0) {
    const t = insights.topActiveTab;
    const showTab =
      !insights.topActiveGroup?.singleTitle ||
      t.title !== insights.topActiveGroup.singleTitle;
    if (showTab && t.title) {
      parts.splice(2, 0, `
        <div class="insight-tile insight-tile--clickable" role="listitem" data-insight-kind="tab" data-group-key="${escapeHtml(t.groupKey)}" data-title="${escapeHtml(t.title)}" data-url="${escapeHtml(t.url)}" tabindex="0">
          <span class="insight-icon" aria-hidden="true">}</span>
          <div class="insight-body">
            <div class="insight-label">Onglet le plus actif</div>
            <div class="insight-value" ${insightDurationAttrs(t.activeSeconds)}>${escapeHtml(t.title)}  ${formatDurationShort(t.activeSeconds)}</div>
            <div class="insight-sub">${escapeHtml(t.label)}</div>
          </div>
        </div>`);
    }
  }

  root.innerHTML = parts.join("");

  if (!weekInsightsClickBound) {
    weekInsightsClickBound = true;
    root.addEventListener("click", (e) => {
      const row = e.target instanceof Element ? e.target.closest("[data-insight-kind]") : null;
      if (!row) return;
      openWeekInsightModal({
        kind: row.dataset.insightKind,
        groupKey: row.dataset.groupKey,
        title: row.dataset.title || "",
        url: row.dataset.url || ""
      });
    });
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const row = e.target instanceof Element ? e.target.closest("[data-insight-kind]") : null;
      if (!row) return;
      e.preventDefault();
      openWeekInsightModal({
        kind: row.dataset.insightKind,
        groupKey: row.dataset.groupKey,
        title: row.dataset.title || "",
        url: row.dataset.url || ""
      });
    });
  }
}

function renderDayInsights(dayKey, insights) {
  const root = document.getElementById("day-insights");
  if (!root) return;

  const { totals } = insights;
  const hasData = totals.open > 0 || totals.active > 0;

  if (!hasData) {
    root.innerHTML = `
      <div class="insight-tile insight-tile--empty">
        <span class="insight-icon" aria-hidden="true">-</span>
        <div class="insight-body">
          <div class="insight-label">Jour sélectionné</div>
          <div class="insight-value">Aucune donnée pour ce jour</div>
          <div class="insight-sub">${escapeHtml(formatStatsDayLabel(dayKey))}</div>
        </div>
      </div>`;
    return;
  }

  const parts = [];
  parts.push(`
    <div class="insight-tile insight-tile--empty">
      <span class="insight-icon" aria-hidden="true">-</span>
      <div class="insight-body">
        <div class="insight-label">Temps réel total (jour)</div>
        <div class="insight-value" ${insightDurationAttrs(totals.open)}>O ${formatDurationShort(totals.open)} · A ${formatDurationShort(totals.active)}</div>
        <div class="insight-sub" title="Ouvert: ${formatDurationFull(totals.open)} · Actif: ${formatDurationFull(totals.active)}">${escapeHtml(formatStatsDayLabel(dayKey))}</div>
      </div>
    </div>`);

  if (insights.topActiveGroup) {
    const g = insights.topActiveGroup;
    parts.push(`
      <div class="insight-tile insight-tile--clickable" role="listitem" data-day-group-key="${escapeHtml(g.groupKey)}" tabindex="0">
        <span class="insight-icon" aria-hidden="true">&</span>
        <div class="insight-body">
          <div class="insight-label">Plus actif (site)</div>
          <div class="insight-value" ${insightDurationAttrs(g.activeSeconds)}>${escapeHtml(g.label)}  ${formatDurationShort(g.activeSeconds)}</div>
          <div class="insight-sub">${g.singleTitle ? escapeHtml(g.singleTitle) : "Regroupé par site / groupe"}</div>
        </div>
      </div>`);
  }

  if (insights.topOpenGroup) {
    const g = insights.topOpenGroup;
    parts.push(`
      <div class="insight-tile insight-tile--clickable" role="listitem" data-day-group-key="${escapeHtml(g.groupKey)}" tabindex="0">
        <span class="insight-icon" aria-hidden="true"></span>
        <div class="insight-body">
          <div class="insight-label">Plus ouvert (site)</div>
          <div class="insight-value" ${insightDurationAttrs(g.openSeconds)}>${escapeHtml(g.label)}  ${formatDurationShort(g.openSeconds)}</div>
          <div class="insight-sub">${g.singleTitle ? escapeHtml(g.singleTitle) : "Durée ouverte cumulée"}</div>
        </div>
      </div>`);
  }

  if (insights.focusPercent != null && insights.topActiveGroup) {
    parts.push(`
      <div class="insight-tile insight-tile--clickable" role="listitem" data-day-group-key="${escapeHtml(insights.topActiveGroup.groupKey)}" tabindex="0">
        <span class="insight-icon" aria-hidden="true">}</span>
        <div class="insight-body">
          <div class="insight-label">Focus</div>
          <div class="insight-value">${insights.focusPercent} % du temps actif</div>
          <div class="insight-sub">sur ${escapeHtml(insights.topActiveGroup.label)}</div>
        </div>
      </div>`);
  }

  const ratioLine =
    insights.ratioPercent != null
      ? `Ratio actif / ouvert : ${insights.ratioPercent} %`
      : "Ratio actif / ouvert :  - ";
  const countLine = `${insights.distinctGroups} groupe${insights.distinctGroups > 1 ? "s" : ""} · ${insights.distinctTabs} onglet${insights.distinctTabs > 1 ? "s" : ""}`;

  let sitesHtml = "";
  if (insights.topSites.length) {
    sitesHtml = `<div class="insight-sites">${insights.topSites
      .map(
        (s, i) =>
          `<div class="insight-site-row insight-site-row--link" role="listitem" data-day-group-key="${escapeHtml(s.groupKey)}" tabindex="0"><span>${i + 1}. ${escapeHtml(s.label)}</span><span ${insightDurationAttrs(s.activeSeconds)}>${formatDurationShort(s.activeSeconds)}</span></div>`
      )
      .join("")}</div>`;
  }

  let rangeLine = "";
  if (insights.timeRange) {
    rangeLine = `${formatClock(insights.timeRange.firstTs)} - ${formatClock(insights.timeRange.lastTs)}`;
  }

  parts.push(`
    <div class="insight-tile insight-tile--empty" role="listitem">
      <span class="insight-icon" aria-hidden="true">0</span>
      <div class="insight-body">
        <div class="insight-label">Synthèse</div>
        <div class="insight-value">${escapeHtml(ratioLine)}</div>
        <div class="insight-sub">${escapeHtml(countLine)}${rangeLine ? ` · ${escapeHtml(rangeLine)}` : ""}</div>
        ${sitesHtml ? `<div class="insight-label" style="margin-top:8px">Top sites (actif)</div>${sitesHtml}` : ""}
      </div>
    </div>`);

  root.innerHTML = parts.join("");

  if (!dayInsightsClickBound) {
    dayInsightsClickBound = true;
    const openFromEl = (el) => {
      const gk = el.dataset.dayGroupKey;
      if (!gk) return;
      openGroupModalForDay(gk, statsSelectedDay);
    };
    root.addEventListener("click", (e) => {
      const el = e.target instanceof Element ? e.target.closest("[data-day-group-key]") : null;
      if (!el) return;
      openFromEl(el);
    });
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = e.target instanceof Element ? e.target.closest("[data-day-group-key]") : null;
      if (!el) return;
      e.preventDefault();
      openFromEl(el);
    });
  }
}

/** Modal détail groupe pour un jour (`statsSelectedDay` ou autre `YYYY-MM-DD`). */
function openGroupModalForDay(groupKey, dayKey) {
  if (!groupKey || !dayKey) return;
  closeBlockPicker();

  const label = formatGroupLabel(groupKey);
  modalTitle.textContent = label;

  let totalO = 0;
  let totalA = 0;
  /** @type {object[]} */
  const sessions = [];

  const matchesEntry = (e) => e.date === dayKey && e.groupKey === groupKey;

  for (const e of cachedEntries) {
    if (!matchesEntry(e)) continue;
    totalO += e.openSeconds;
    totalA += e.activeSeconds;
    sessions.push({
      title: e.title,
      url: e.url,
      start: e.start,
      end: e.end,
      openSeconds: e.openSeconds,
      activeSeconds: e.activeSeconds,
      isLive: false
    });
  }

  Promise.resolve(cachedLive).then((liveState) => {
    for (const t of liveState.tabs || []) {
      const dk = dateKeyFromTs(t.segmentStart || t.openedAt);
      if (dk !== dayKey) continue;
      const gk = t.groupKey;
      if (gk !== groupKey) continue;
      totalO += t.openSeconds;
      totalA += t.activeSeconds;
      sessions.push({
        title: t.title,
        url: t.url,
        start: t.segmentStart || t.openedAt,
        end: Date.now(),
        openSeconds: t.openSeconds,
        activeSeconds: t.activeSeconds,
        isLive: true
      });
    }

    const inactive = Math.max(0, totalO - totalA);
    modalStats.innerHTML = `
      <dt>Groupe</dt><dd>${modalLinkHtml(groupKey, groupKey)}</dd>
      <dt>Jour</dt><dd>${escapeHtml(formatStatsDayLabel(dayKey))}</dd>
      <dt>Temps ouvert</dt><dd title="${formatDurationFull(totalO)}">${formatDurationShort(totalO)}</dd>
      <dt>Temps actif</dt><dd title="${formatDurationFull(totalA)}">${formatDurationShort(totalA)}</dd>
      <dt>Inactif (O  ·  A)</dt><dd title="${formatDurationFull(inactive)}">${formatDurationShort(inactive)}</dd>
    `;

    modalSessionsList.innerHTML = "";
    modalSessionsList.hidden = false;
    if (modalDayChartEmpty) modalDayChartEmpty.textContent = "Aucune session à afficher pour ce groupe ce jour.";
    setModalDayChartVisible(false);
    destroyModalDayChart();
    const heading = document.createElement("li");
    heading.className = "modal-sessions-heading";
    heading.textContent = "Sessions / onglets ce jour";
    modalSessionsList.appendChild(heading);

    if (sessions.length === 0) {
      const li = document.createElement("li");
      li.textContent = "Aucune session pour ce groupe sur ce jour.";
      modalSessionsList.appendChild(li);
    } else {
      sessions.sort((a, b) => b.activeSeconds - a.activeSeconds || a.start - b.start);
      for (const s of sessions) {
        const li = document.createElement("li");
        li.className = "modal-session-tab";
        const oShort = formatDurationShort(s.openSeconds);
        const aShort = formatDurationShort(s.activeSeconds);
        const endLabel = s.isLive ? "en cours" : formatClock(s.end);
        const timeLine = `${formatClock(s.start)} - ${endLabel} · O ${oShort} · A ${aShort}`;
        li.innerHTML = `<strong>${escapeHtml(s.title || "Sans titre")}</strong><br><span class="modal-session-url">${s.url ? modalLinkHtml(shortUrl(s.url), s.url, { stopBubble: true }) : " - "}</span><br>${escapeHtml(timeLine)}`;
        li.title = `${s.title || ""}\n${s.url || ""}\nOuvert: ${formatDurationFull(s.openSeconds)}  Actif: ${formatDurationFull(s.activeSeconds)}`;
        modalSessionsList.appendChild(li);
      }
    }

    const h3 = blockModal.querySelector(".modal-sessions h3");
    if (h3) h3.textContent = "Sessions du groupe (jour selectionne)";

    blockModal.classList.remove("hidden");
  });
}

function openWeekInsightModal({ kind, groupKey, title, url }) {
  if (!groupKey) return;
  closeBlockPicker();

  const inWeek = weekDateKeys();
  const label = formatGroupLabel(groupKey);
  modalTitle.textContent = kind === "tab" && title ? title : label;

  let totalO = 0;
  let totalA = 0;
  const sessions = [];

  const matches = (e) => {
    if (!inWeek.has(e.date)) return false;
    if (e.groupKey !== groupKey) return false;
    if (kind === "tab" && title && e.title !== title) return false;
    if (kind === "tab" && url && e.url !== url) return false;
    return true;
  };

  for (const e of cachedEntries) {
    if (!matches(e)) continue;
    totalO += e.openSeconds;
    totalA += e.activeSeconds;
    sessions.push(e);
  }

  Promise.resolve(cachedLive).then((liveState) => {
    for (const t of liveState.tabs || []) {
      const dayKey = dateKeyFromTs(t.segmentStart || t.openedAt);
      if (!inWeek.has(dayKey)) continue;
      const gk = t.groupKey;
      if (gk !== groupKey) continue;
      if (kind === "tab" && title && t.title !== title) continue;
      if (kind === "tab" && url && t.url !== url) continue;
      totalO += t.openSeconds;
      totalA += t.activeSeconds;
      sessions.push({
        title: t.title,
        url: t.url,
        start: t.segmentStart || t.openedAt,
        end: Date.now(),
        openSeconds: t.openSeconds,
        activeSeconds: t.activeSeconds,
        isLive: true
      });
    }

    const inactive = Math.max(0, totalO - totalA);
    modalStats.innerHTML = `
      <dt>Groupe</dt><dd>${modalLinkHtml(groupKey, groupKey)}</dd>
      ${kind === "tab" && url ? `<dt>URL</dt><dd>${modalLinkHtml(url, url)}</dd>` : ""}
      <dt>Semaine</dt><dd>${escapeHtml(formatWeekRangeLabel())}</dd>
      <dt>Temps ouvert</dt><dd title="${formatDurationFull(totalO)}">${formatDurationShort(totalO)}</dd>
      <dt>Temps actif</dt><dd title="${formatDurationFull(totalA)}">${formatDurationShort(totalA)}</dd>
      <dt>Inactif (O  ·  A)</dt><dd title="${formatDurationFull(inactive)}">${formatDurationShort(inactive)}</dd>
    `;

    modalSessionsList.innerHTML = "";
    destroyModalDayChart();
    modalSessionsList.hidden = true;
    if (modalDayChartEmpty) {
      modalDayChartEmpty.textContent = "Aucune session à afficher pour cette sélection sur la semaine affichée.";
    }
    sessions.sort((a, b) => a.start - b.start);
    const rangeStartMs = weekStart.getTime();
    const rangeEndMs = addDays(weekStart, 7).getTime();
    const weekSeries = buildTemporalSeriesFromSessions(
      sessions,
      rangeStartMs,
      rangeEndMs,
      MODAL_WEEK_CHART_BUCKET_MINUTES,
      true
    );
    setModalDayChartVisible(true);
    renderModalTemporalChart({
      labels: weekSeries.labels,
      open: weekSeries.open,
      active: weekSeries.active,
      rangeStartMs: weekSeries.rangeStartMs,
      bucketMinutes: weekSeries.bucketMinutes,
      xScope: "week",
      xWeekdayOnly: true,
      maxTicksLimit: 10
    });

    const h3 = blockModal.querySelector(".modal-sessions h3");
    if (h3) {
      h3.textContent =
        kind === "tab"
          ? "Chronologie de l'onglet (semaine affichée)"
          : "Chronologie du groupe (semaine affichée)";
    }

    blockModal.classList.remove("hidden");
  });
}

function isCurrentWeekDisplayed() {
  return weekStart.getTime() === startOfWeek(new Date()).getTime();
}

function formatWeekRangeLabel() {
  const end = addDays(weekStart, 6);
  return `${weekStart.toLocaleDateString("fr-FR")} - ${end.toLocaleDateString("fr-FR")}`;
}

function updateStatsEmptyState(daily, groups, insights) {
  const banner = document.getElementById("stats-empty");
  const message = document.getElementById("stats-empty-message");
  const todayBtn = document.getElementById("stats-goto-today");
  if (!banner || !message || !todayBtn) return;

  const dailyTotal =
    daily.openValues.reduce((a, v) => a + v, 0) + daily.activeValues.reduce((a, v) => a + v, 0);
  const weekTotal = insights.totals.open + insights.totals.active;
  const groupsTotal = groups.dualMetric
    ? (groups.activeValues || []).reduce((a, v) => a + v, 0) +
      (groups.openValues || []).reduce((a, v) => a + v, 0)
    : groups.values.reduce((a, v) => a + v, 0);
  const onCurrentWeek = isCurrentWeekDisplayed();

  let text = "";
  let showToday = false;

  if (dailyTotal === 0 && weekTotal === 0 && groupsTotal === 0) {
    if (!onCurrentWeek) {
      text =
        `Aucune donnée pour la semaine affichée (${formatWeekRangeLabel()}). ` +
        "Les insights, le doughnut et la semaine affichée utilisent cette semaine - pas les 14 derniers jours.";
      showToday = true;
    } else {
      text =
        "Aucune donnée pour cette période. Naviguez sur des onglets web (hors pages chrome://) pour commencer le suivi, " +
        "ou vérifiez si vous avez utilis  Effacer les données  récemment.";
    }
  } else if (weekTotal === 0 && groupsTotal === 0 && dailyTotal > 0 && !onCurrentWeek) {
    text =
      `Pas de temps enregistr pour la semaine affichée (${formatWeekRangeLabel()}), ` +
      "mais des données existent sur les 14 derniers jours.";
    showToday = true;
  }

  if (text) {
    message.textContent = text;
    todayBtn.classList.toggle("hidden", !showToday);
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
    todayBtn.classList.add("hidden");
  }
}

async function renderCharts() {
  const Chart = window.Chart;
  if (!Chart || document.getElementById("panel-stats").hidden) return;

  if (!statsGroupingConfig) {
    statsGroupingConfig = await loadConfig();
  }

  if (charts.openActive) destroyChart("openActive");

  const live = cachedLive;
  const config = statsGroupingConfig;
  if (!statsDayInitialized) {
    statsSelectedDay = pickDefaultStatsDay(cachedEntries, live);
    try {
      sessionStorage.setItem(STATS_DAY_STORAGE, statsSelectedDay);
    } catch {
      /* ignore */
    }
    statsDayInitialized = true;
    updateStatsChartTitles();
  }

  const daily = aggregateLast14Days(cachedEntries, live);
  const groups = aggregateWeekByGroupDual(cachedEntries, live, config);
  const dayGroups = aggregateDayByGroup(statsSelectedDay, cachedEntries, live, statsMetricMode, config);
  const weekInsights = aggregateWeekInsights(cachedEntries, live);
  const dayInsights = aggregateDayInsights(statsSelectedDay, cachedEntries, live);
  const activityTimeline = buildStatsActivityTimeline(cachedEntries, live);

  updateStatsEmptyState(daily, groups, weekInsights);

  const snapshot = statsPayloadSnapshot(daily, groups, dayGroups, weekInsights, dayInsights);
  const weekInsightsEl = document.getElementById("week-insights");
  const dayInsightsEl = document.getElementById("day-insights");
  if (
    snapshot === statsDataSnapshot &&
    charts.daily &&
    charts.groupsActive &&
    charts.groupsOpen &&
    charts.groupsDay &&
    charts.activityTimeline &&
    weekInsightsEl &&
    dayInsightsEl
  ) {
    updateInsightsScopeToggleUi();
    return;
  }
  statsDataSnapshot = snapshot;

  upsertDailyChart(daily);
  renderDistributionCard(groups, DISTRIBUTION_WEEK);
  renderDistributionCard(dayGroups, DISTRIBUTION_DAY);
  upsertActivityTimelineChart(activityTimeline);
  scheduleFillChartResize();
  updateInsightsScopeToggleUi();
  renderWeekInsights(weekInsights);
  renderDayInsights(statsSelectedDay, dayInsights);
}

async function render() {
  if (!timeAxisBuilt) {
    buildTimeAxis();
    timeAxisBuilt = true;
  }

  const weekTs = weekStart.getTime();
  if (weekTs !== lastWeekStartTs) {
    cachedDays = buildGridColumns();
    lastWeekStartTs = weekTs;
    statsDataSnapshot = "";
    updateStatsChartTitles();
    doughnutLegendStructureKeys.week = "";
    doughnutLegendStructureKeys.day = "";
    calendarStructureSnapshot = "";
    calendarMetricsSnapshot = "";
    blockDomByKey.forEach((el) => el.remove());
    blockDomByKey.clear();
    stackSlotRowDomByKey.forEach((row) => row.remove());
    stackSlotRowDomByKey.clear();
    closeBlockPicker();
    syncCalendarZoomForDisplayedWeek();
  }

  const rawEntries = await getEntries();
  const rawLive = await getLiveState();
  if (!statsGroupingConfig) {
    statsGroupingConfig = await loadConfig();
  }
  cachedEntries = normalizeEntriesForStats(rawEntries, statsGroupingConfig);
  cachedLive = normalizeLiveForStats(rawLive, statsGroupingConfig);
  const live = cachedLive;
  const blocks = collectBlocks(cachedEntries, live);
  const days = cachedDays || buildGridColumns();
  requestAnimationFrame(() => {
    renderBlocks(blocks);
    updateNowLine(days);
    autoScrollToNowIfNeeded(days);
  });
  if (!document.getElementById("panel-stats").hidden) safeRenderCharts();
}

updateStatsMetricToggleUi();
updateInsightsScopeToggleUi();
updateStatsChartTitles();
safeRender();
setInterval(safeRender, 2000);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.ogTimeTabConfig) {
      statsGroupingConfig = null;
      statsDataSnapshot = "";
      doughnutLegendStructureKeys.week = "";
      doughnutLegendStructureKeys.day = "";
    }
    safeRender();
  }
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "LIVE_UPDATE") safeRender();
});

async function safeRender() {
  try {
    await render();
  } catch (err) {
    showDashboardFatalError(err);
  }
}

async function safeRenderCharts() {
  try {
    await renderCharts();
  } catch (err) {
    showDashboardFatalError(err);
  }
}
