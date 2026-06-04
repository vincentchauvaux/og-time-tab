import { dateKey, getEntries, getLiveState } from "./lib/storage.js";
import { formatDurationShort, formatDurationFull } from "./lib/format-duration.js";
import { formatGroupLabel } from "./lib/grouping.js";

const SESSION_CHART_BUCKET_MINUTES = 60;
let todaySessionsChart = null;

async function render() {
  const [live, entries] = await Promise.all([getLiveState(), getEntries()]);
  const focused = live.tabs?.find((t) => t.isFocused);
  const focusedEl = document.getElementById("focused");
  if (focused) {
    focusedEl.classList.remove("hidden");
    document.getElementById("focused-title").textContent = focused.title;
    document.getElementById("focused-url").textContent = focused.url;
    const openEl = document.getElementById("focused-open");
    const activeEl = document.getElementById("focused-active");
    openEl.textContent = formatDurationShort(focused.openSeconds);
    openEl.title = formatDurationFull(focused.openSeconds);
    activeEl.textContent = formatDurationShort(focused.activeSeconds);
    activeEl.title = formatDurationFull(focused.activeSeconds);
  } else {
    focusedEl.classList.add("hidden");
  }

  const tabs = live.tabs || [];
  const groups = groupLiveTabs(tabs);
  updateTabsCount(groups, tabs);

  const ul = document.getElementById("tabs-ul");
  ul.innerHTML = "";
  for (const g of groups) {
    const li = document.createElement("li");
    if (g.isFocused) li.classList.add("active-tab");
    const sub =
      g.tabs.length === 1
        ? escapeHtml(g.tabs[0].title)
        : `${g.tabs.length} onglets`;
    const activeDot = g.tabs.some((t) => t.isActive) ? " ●" : "";
    li.innerHTML = `
      <div class="row"><span class="name">${escapeHtml(g.label)}</span></div>
      <div class="sub">${sub}</div>
      <div class="times" title="Ouvert: ${escapeAttr(formatDurationFull(g.openSeconds))} · Actif: ${escapeAttr(formatDurationFull(g.activeSeconds))}">O: ${formatDurationShort(g.openSeconds)} · A: ${formatDurationShort(g.activeSeconds)}${activeDot}</div>
    `;
    ul.appendChild(li);
  }

  renderTodaySessionsChart(live, entries);
}

function showPopupFatalError(err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("OG Time Tab: erreur popup:", err);
  const ul = document.getElementById("tabs-ul");
  if (ul) {
    ul.innerHTML = `<li style="color:#f8d7da;background:rgba(220,53,69,0.14);border:1px solid rgba(220,53,69,0.35);padding:8px 10px;border-radius:10px;">
      Une erreur empêche l’affichage. Ouvrez la console de l’extension pour le détail. (${escapeHtml(message || "Erreur inconnue")})
    </li>`;
  }
  const focusedEl = document.getElementById("focused");
  if (focusedEl) focusedEl.classList.add("hidden");
}

async function safeRender() {
  try {
    await render();
  } catch (err) {
    showPopupFatalError(err);
  }
}

function groupLiveTabs(tabs) {
  const map = new Map();
  for (const t of tabs) {
    const key = t.groupKey || t.url || "?";
    if (!map.has(key)) {
      map.set(key, {
        groupKey: key,
        label: formatGroupLabel(key),
        tabs: [],
        openSeconds: 0,
        activeSeconds: 0,
        isFocused: false
      });
    }
    const g = map.get(key);
    g.tabs.push(t);
    g.openSeconds += t.openSeconds;
    g.activeSeconds += t.activeSeconds;
    if (t.isFocused) g.isFocused = true;
  }
  return [...map.values()].sort((a, b) => b.activeSeconds - a.activeSeconds);
}

function updateTabsCount(groups, tabs) {
  const el = document.getElementById("tabs-count");
  const nGroups = groups.length;
  const nTabs = tabs.length;
  if (nGroups === 0) {
    el.textContent = "";
    el.classList.add("is-empty");
    el.removeAttribute("aria-label");
    return;
  }
  el.classList.remove("is-empty");
  let text;
  if (nTabs > nGroups) {
    text = `${nGroups} groupe${nGroups > 1 ? "s" : ""} · ${nTabs} onglet${nTabs > 1 ? "s" : ""}`;
  } else {
    text = `(${nGroups})`;
  }
  el.textContent = text;
  el.setAttribute("aria-label", text.replace(/[()]/g, ""));
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function clamp(min, value, max) {
  return Math.max(min, Math.min(max, value));
}

function addWeightedToBuckets(bucket, startMs, endMs, openSeconds, activeSeconds) {
  if (!(endMs > startMs)) return;
  const day = new Date(startMs);
  day.setHours(0, 0, 0, 0);
  const dayStart = day.getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const safeStart = clamp(dayStart, startMs, dayEnd);
  const safeEnd = clamp(dayStart, endMs, dayEnd);
  if (!(safeEnd > safeStart)) return;
  const durationMs = safeEnd - safeStart;
  const openRate = toFiniteNumber(openSeconds, 0) / Math.max(1, durationMs / 1000);
  const activeRate = toFiniteNumber(activeSeconds, 0) / Math.max(1, durationMs / 1000);

  let cursor = safeStart;
  while (cursor < safeEnd) {
    const minuteOfDay = ((cursor - dayStart) / 60000) | 0;
    const hourBucket = Math.max(
      0,
      Math.min(
        bucket.open.length - 1,
        Math.floor(minuteOfDay / SESSION_CHART_BUCKET_MINUTES)
      )
    );
    const nextHour =
      dayStart + (hourBucket + 1) * SESSION_CHART_BUCKET_MINUTES * 60 * 1000;
    const segmentEnd = Math.min(safeEnd, nextHour);
    const sec = (segmentEnd - cursor) / 1000;
    bucket.open[hourBucket] += sec * openRate;
    bucket.active[hourBucket] += sec * activeRate;
    cursor = segmentEnd;
  }
}

function buildTodaySessionsSeries(entries, live) {
  const now = new Date();
  const todayKey = dateKey(now.getTime());
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
  const labels = Array.from(
    { length: (24 * 60) / SESSION_CHART_BUCKET_MINUTES },
    (_, i) => `${String(i).padStart(2, "0")}h`
  );
  const bucket = {
    labels,
    open: labels.map(() => 0),
    active: labels.map(() => 0)
  };

  for (const entry of entries || []) {
    if (entry?.date !== todayKey) continue;
    const rawStart = toMs(entry.start);
    const rawEnd = toMs(entry.end);
    if (!(rawEnd > rawStart)) continue;
    const startMs = clamp(dayStartMs, rawStart, dayEndMs);
    const endMs = clamp(dayStartMs, rawEnd, dayEndMs);
    if (!(endMs > startMs)) continue;
    addWeightedToBuckets(bucket, startMs, endMs, entry.openSeconds, entry.activeSeconds);
  }

  for (const tab of live?.tabs || []) {
    const rawStart = toMs(tab.segmentStart);
    if (!Number.isFinite(rawStart)) continue;
    const openSeconds = toFiniteNumber(tab.openSeconds, 0);
    const activeSeconds = toFiniteNumber(tab.activeSeconds, 0);
    if (openSeconds <= 0 && activeSeconds <= 0) continue;
    const approxEnd = rawStart + Math.max(openSeconds, activeSeconds) * 1000;
    const endMs = clamp(dayStartMs, approxEnd, dayEndMs);
    const startMs = clamp(dayStartMs, rawStart, dayEndMs);
    if (!(endMs > startMs)) continue;
    addWeightedToBuckets(bucket, startMs, endMs, openSeconds, activeSeconds);
  }

  return bucket;
}

function renderTodaySessionsChart(live, entries) {
  const emptyEl = document.getElementById("today-sessions-empty");
  const canvas = document.getElementById("today-sessions-chart");
  const series = buildTodaySessionsSeries(entries, live);
  const hasData =
    series.open.some((v) => v > 0.2) || series.active.some((v) => v > 0.2);
  emptyEl.classList.toggle("hidden", hasData);

  const chartData = {
    labels: series.labels,
    datasets: [
      {
        label: "Ouvert",
        data: series.open,
        borderColor: "#6b7280",
        backgroundColor: "rgba(107, 114, 128, 0.28)",
        borderWidth: 1,
        pointRadius: 0,
        tension: 0.25,
        fill: true
      },
      {
        label: "Actif",
        data: series.active,
        borderColor: "#28a745",
        backgroundColor: "rgba(40, 167, 69, 0.30)",
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.25,
        fill: true
      }
    ]
  };

  if (!todaySessionsChart) {
    todaySessionsChart = new Chart(canvas, {
      type: "line",
      data: chartData,
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: "#9aa0a6", boxWidth: 10, boxHeight: 10 } },
          tooltip: {
            callbacks: {
              label(ctx) {
                return `${ctx.dataset.label}: ${formatDurationFull(Math.round(ctx.parsed.y || 0))}`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: "#9aa0a6",
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 6
            },
            grid: { color: "rgba(255,255,255,0.06)" }
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: "#9aa0a6",
              callback(v) {
                return formatDurationShort(Number(v) || 0);
              }
            },
            grid: { color: "rgba(255,255,255,0.06)" }
          }
        }
      }
    });
    return;
  }

  todaySessionsChart.data.labels = chartData.labels;
  todaySessionsChart.data.datasets[0].data = chartData.datasets[0].data;
  todaySessionsChart.data.datasets[1].data = chartData.datasets[1].data;
  todaySessionsChart.update("none");
}

safeRender();
setInterval(safeRender, 1000);
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "LIVE_UPDATE") safeRender();
});
