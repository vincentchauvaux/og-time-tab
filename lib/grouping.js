/**
 * Clé de regroupement pour les onglets (même bloc calendrier).
 * @param {string} url
 * @param {{ groupMode: string, groupPathDepth: number, groupPrefix: string }} config
 */
export function getGroupKey(url, config) {
  const cfg = config || { groupMode: "origin", groupPathDepth: 1, groupPrefix: "" };
  if (!url || url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
    return "system";
  }
  try {
    const normalized = normalizeParsedUrl(new URL(url));
    const host = normalized.host;
    const origin = normalized.origin;
    switch (cfg.groupMode) {
      case "custom":
        return normalizeCustomPrefix(cfg.groupPrefix) || host;
      case "domain":
        return toRegistrableDomain(host);
      case "prefix": {
        const parts = normalizePath(normalized.pathname).split("/").filter(Boolean);
        const depth = Math.max(1, cfg.groupPathDepth || 1);
        const path = parts.slice(0, depth).join("/");
        return `${origin}/${path}`;
      }
      case "origin":
      default:
        return origin;
    }
  } catch {
    return url;
  }
}

/**
 * Normalisation défensive d'une clé déjà persistée pour les stats.
 * @param {string} rawKey
 * @param {{ groupMode: string, groupPathDepth: number, groupPrefix: string }} config
 */
export function normalizeGroupKeyForStats(rawKey, config) {
  const raw = sanitizeStatsRawKey(rawKey);
  if (!raw) return "";
  if (raw === "system") return "system";
  try {
    return getGroupKey(raw, config);
  } catch {
    /* ignore */
  }
  try {
    return getGroupKey(`https://${raw}`, config);
  } catch {
    return fallbackNormalizeKey(raw, config);
  }
}

/**
 * Clé canonique unique pour agrégation stats (doughnut + légende + insights).
 * Origin : même hôte (+ port non standard) → une clé HTTPS (fusion http/https).
 * Domain : eTLD+1. Prefix/custom : clé mode inchangée.
 * @param {string} rawKey
 * @param {{ groupMode: string, groupPathDepth: number, groupPrefix: string }} config
 */
export function normalizeStatsGroupKey(rawKey, config) {
  const modeKey = normalizeGroupKeyForStats(rawKey, config);
  if (!modeKey || modeKey === "system") return modeKey;
  const cfg = config || { groupMode: "origin", groupPathDepth: 1, groupPrefix: "" };
  if (cfg.groupMode === "prefix" || cfg.groupMode === "custom") {
    return sanitizeStatsRawKey(modeKey);
  }
  const host = extractHostFromGroupKey(modeKey);
  if (!host) return modeKey;
  if (cfg.groupMode === "domain") {
    return toRegistrableDomain(host);
  }
  return buildStatsOriginCanonicalKey(modeKey, host);
}

function extractHostFromGroupKey(groupKey) {
  const raw = sanitizeStatsRawKey(groupKey);
  if (!raw || raw === "system") return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      return normalizeHost(new URL(raw).hostname);
    } catch {
      return "";
    }
  }
  const noTail = raw.split(/[/?#]/, 1)[0] || raw;
  const noUserInfo = noTail.includes("@") ? noTail.split("@").pop() : noTail;
  const hostOnly = noUserInfo.startsWith("[")
    ? noUserInfo
    : noUserInfo.replace(/:\d+$/, "");
  return normalizeHost(hostOnly);
}

function buildStatsOriginCanonicalKey(modeKey, host) {
  void modeKey;
  // Clé origin stats canonique : host unique, sans port, protocole figé.
  return `https://${host}`;
}

function fallbackNormalizeKey(raw, config) {
  const cfg = config || { groupMode: "origin", groupPathDepth: 1, groupPrefix: "" };
  const compact = sanitizeStatsRawKey(raw).split(/[?#]/, 1)[0].trim();
  if (!compact) return "";
  const lower = compact.toLowerCase();
  const hostCandidate = extractHostFromGroupKey(lower);
  switch (cfg.groupMode) {
    case "custom":
      return normalizeCustomPrefix(cfg.groupPrefix) || hostCandidate || lower;
    case "domain":
      return toRegistrableDomain(hostCandidate || lower);
    case "origin":
      return hostCandidate ? `https://${hostCandidate}` : lower;
    case "prefix":
    default:
      return compact.replace(/\/+$/, "");
  }
}

function sanitizeStatsRawKey(value) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim();
}

function normalizeParsedUrl(u) {
  const protocol = normalizeProtocol(u.protocol);
  const host = normalizeHost(u.hostname);
  const port = normalizePort(protocol, u.port);
  const pathname = normalizePath(u.pathname);
  return {
    protocol,
    host,
    port,
    pathname,
    origin: `${protocol}//${host}${port ? `:${port}` : ""}`
  };
}

function normalizeHost(hostname) {
  let host = String(hostname || "").trim().toLowerCase();
  host = host.replace(/\.+$/, "");
  return host.startsWith("www.") ? host.slice(4) : host;
}

function normalizeProtocol(protocol) {
  const p = String(protocol || "https:").trim().toLowerCase();
  if (p === "http:" || p === "https:") return p;
  return "https:";
}

function normalizePort(protocol, port) {
  const p = String(port || "").trim();
  if (!p) return "";
  if ((protocol === "https:" && p === "443") || (protocol === "http:" && p === "80")) {
    return "";
  }
  return p;
}

function normalizePath(pathname) {
  const p = String(pathname || "/").replace(/\/{2,}/g, "/");
  if (!p || p === "/") return "/";
  return p.replace(/\/+$/, "");
}

function normalizeCustomPrefix(prefix) {
  const raw = String(prefix || "").trim();
  if (!raw) return "";
  const noFragment = raw.split("#", 1)[0];
  const noQuery = noFragment.split("?", 1)[0];
  try {
    const normalized = normalizeParsedUrl(new URL(noQuery));
    if (normalized.pathname === "/") return normalized.origin;
    return `${normalized.origin}${normalized.pathname}`;
  } catch {
    return noQuery.replace(/\/+$/, "");
  }
}

function toRegistrableDomain(host) {
  const h = normalizeHost(host);
  if (!h || isIpAddress(h) || h === "localhost") return h;
  const labels = h.split(".").filter(Boolean);
  if (labels.length <= 2) return h;
  const suffix2 = `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
  if (KNOWN_SECOND_LEVEL_SUFFIXES.has(suffix2) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

function isIpAddress(host) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":");
}

const KNOWN_SECOND_LEVEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "com.br",
  "com.mx",
  "co.jp",
  "ne.jp",
  "com.sg",
  "com.tr",
  "com.ar",
  "com.cn",
  "com.tw"
]);

/** Retire un préfixe `www.` (insensible à la casse) pour l'affichage. */
function stripWwwHostname(host) {
  if (!host) return host;
  return host.replace(/^www\./i, "");
}

/** Libellé lisible pour affichage (panneau, popup, modal). */
export function formatGroupLabel(groupKey) {
  if (!groupKey || groupKey === "system") return "Système";
  if (groupKey.startsWith("http://") || groupKey.startsWith("https://")) {
    try {
      const u = new URL(groupKey);
      return stripWwwHostname(u.hostname) || groupKey;
    } catch {
      return groupKey;
    }
  }
  return stripWwwHostname(groupKey);
}
