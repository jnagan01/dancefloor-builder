import { tierOf, usableForHardRule, type MetaSource } from "./metaConfidence";

/**
 * Per-attribute metadata provenance for event rows and the online metadata cache.
 * Provenance records where a value came from; it is never a guarantee that the value belongs to the exact
 * recording (identity is decided by the exact-file matcher). Unknown stays unknown: no attribute is invented.
 */
export const META_ATTRS = ["bpm", "year", "genre", "energy", "danceability", "popularity", "valence", "camelot"] as const;
export type MetaAttr = (typeof META_ATTRS)[number];
export type MetaProv = Partial<Record<MetaAttr, MetaSource>>;
export type ProvRow = { metaSource?: string; metaProv?: MetaProv; catalogueDecade?: string } & { [K in MetaAttr]?: unknown };

const RANK: Record<string, number> = { user: 6, measured: 5, tags: 4, virtualdj: 4, provider: 3, catalogue: 2, filename: 1, estimate: 1, ai: 1, unknown: 0 };
export const sourceRank = (s: MetaSource | undefined) => RANK[s ?? "unknown"] ?? 0;
const has = (v: unknown) => v !== undefined && v !== null && v !== "" && !(typeof v === "number" && !Number.isFinite(v));
const SOURCES = new Set(Object.keys(RANK));

/** Source of one attribute. Legacy rows without per-attribute provenance fall back conservatively to estimates. */
export function attrSource(row: ProvRow, attr: MetaAttr): MetaSource {
  if (!has(row[attr])) return "unknown";
  const p = row.metaProv?.[attr];
  if (p && SOURCES.has(p)) return p;
  // Legacy row labels were set by whichever step ran first and could mix provider values with AI fills.
  return row.metaSource === "AI" ? "ai" : "estimate";
}

/**
 * Merge incoming attribute values: a value replaces the current one only when its source ranks higher
 * (user edit > measured > file tags > provider > catalogue > estimates/AI > unknown). Ties keep the current value,
 * so user edits and earlier verified values are never overwritten by AI estimates. Missing values never erase.
 */
export function mergeMeta<T extends ProvRow>(row: T, values: { [K in MetaAttr]?: unknown }, src: MetaSource | MetaProv): T {
  let next: T | null = null;
  for (const attr of META_ATTRS) {
    const v = values[attr];
    if (!has(v)) continue;
    const incoming: MetaSource = typeof src === "string" ? src : src[attr] ?? "estimate";
    if (incoming === "unknown") continue;
    const cur = attrSource(next ?? row, attr);
    if (sourceRank(incoming) <= sourceRank(cur)) continue;
    next ??= { ...row, metaProv: { ...(row.metaProv ?? legacyProv(row)) } };
    (next as Record<string, unknown>)[attr] = v;
    next.metaProv![attr] = incoming;
  }
  return next ?? row;
}

/** Provenance for a freshly created row whose present values all come from one source. */
export function withProv<T extends ProvRow>(row: T, src: MetaSource): T {
  const metaProv: MetaProv = { ...(row.metaProv ?? {}) };
  for (const attr of META_ATTRS) if (has(row[attr]) && !metaProv[attr]) metaProv[attr] = src;
  return { ...row, metaProv };
}

function legacyProv(row: ProvRow): MetaProv {
  const p: MetaProv = {};
  for (const attr of META_ATTRS) if (has(row[attr])) p[attr] = attrSource(row, attr);
  return p;
}

/** Truthful row label from per-attribute sources; "Online" only when every known value is provider-backed. */
export function metaLabel(row: ProvRow): ProvRow["metaSource"] {
  if (!row.metaProv) return row.metaSource;
  const srcs = META_ATTRS.filter(a => has(row[a])).map(a => attrSource(row, a));
  if (!srcs.length) return row.metaSource;
  if (srcs.every(s => s === "ai")) return "AI";
  if (srcs.some(s => tierOf(s, true) !== "verified")) return "Estimated";
  if (srcs.every(s => s === "catalogue")) return "Library";
  if (srcs.some(s => s === "tags" || s === "virtualdj")) return row.metaSource === "Library" ? "Library" : "VirtualDJ";
  if (srcs.every(s => s === "provider")) return "Online";
  return "Estimated";
}

export interface StrictLimits { bpmRange?: readonly [number, number]; decades?: readonly string[] }
/**
 * Strict user BPM/decade limits for automatic additions: only verified evidence within the limit passes.
 * AI guesses and unknown values never satisfy a strict limit.
 */
export function strictLimitFailure(row: ProvRow, limits: StrictLimits): null | "bpm" | "decade" {
  if (limits.bpmRange) {
    const src = attrSource(row, "bpm"), v = row.bpm;
    if (!usableForHardRule(src, has(v), "bpm") || typeof v !== "number" || v < limits.bpmRange[0] || v > limits.bpmRange[1]) return "bpm";
  }
  if (limits.decades?.length) {
    const src = attrSource(row, "year"), v = row.year;
    // The curated catalogue records a decade without an exact year; that is accepted as-is (never AI-derived).
    if (!has(v) && row.catalogueDecade) return limits.decades.includes(row.catalogueDecade) ? null : "decade";
    if (!usableForHardRule(src, has(v), "year") || typeof v !== "number" || !limits.decades.includes(`${Math.floor(v / 10) * 10}s`)) return "decade";
  }
  return null;
}

// ---- online metadata cache (single text `source` column; no schema change) ----
const CODE: Record<string, string> = { provider: "p", ai: "a", estimate: "e", user: "u", measured: "m" };
const DECODE: Record<string, MetaSource> = { p: "provider", a: "ai", e: "estimate", u: "user", m: "measured" };
const ATTR_CODE: Record<MetaAttr, string> = { bpm: "b", year: "y", genre: "g", energy: "n", danceability: "d", popularity: "o", valence: "v", camelot: "k" };

/** "v2|<summary>|b=p,y=a,..." — readable by this version; legacy rows keep their plain summary label. */
export function encodeCacheSource(summary: string, prov: MetaProv): string {
  const parts = META_ATTRS.filter(a => prov[a] && CODE[prov[a]!]).map(a => `${ATTR_CODE[a]}=${CODE[prov[a]!]}`);
  return `v2|${summary}|${parts.join(",")}`;
}

/**
 * Decode a cached row's per-attribute provenance. Legacy summaries are read conservatively: the old pipeline
 * could fill gaps with AI estimates under a provider label, so any attribute it may have estimated is "estimate".
 */
export function decodeCacheSource(raw: string | null | undefined, present: { [K in MetaAttr]?: unknown }): { summary: string; prov: MetaProv } {
  const prov: MetaProv = {};
  const s = raw ?? "";
  if (s.startsWith("v2|")) {
    const [, summary = "none", codes = ""] = s.split("|");
    const byCode = Object.fromEntries(Object.entries(ATTR_CODE).map(([a, c]) => [c, a as MetaAttr]));
    for (const pair of codes.split(",")) {
      const [c, v] = pair.split("=");
      const attr = byCode[c ?? ""];
      if (attr && DECODE[v ?? ""] && has(present[attr])) prov[attr] = DECODE[v!];
    }
    for (const a of META_ATTRS) if (has(present[a]) && !prov[a]) prov[a] = "estimate";
    return { summary, prov };
  }
  // Legacy labels never recorded which attribute came from where (and title fallbacks could hit another song).
  for (const a of META_ATTRS) if (has(present[a])) prov[a] = s === "AI" ? "ai" : "estimate";
  return { summary: s || "none", prov };
}
