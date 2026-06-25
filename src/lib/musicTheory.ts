/**
 * Pure helpers for harmonic + tempo aware sequencing.
 *
 * - Camelot conversion (so any DJ-style key string is comparable)
 * - Camelot wheel distance for "compatible key" checks
 * - BPM proximity scoring for smooth transitions
 *
 * These are deterministic and side-effect-free so they're cheap to call
 * inside the variety re-ranker.
 */

// Canonical Camelot wheel positions.
const CAMELOT_MAP: Record<string, string> = {
  // Minor (A row)
  "Abm": "1A", "G#m": "1A",
  "Ebm": "2A", "D#m": "2A",
  "Bbm": "3A", "A#m": "3A",
  "Fm": "4A",
  "Cm": "5A",
  "Gm": "6A",
  "Dm": "7A",
  "Am": "8A",
  "Em": "9A",
  "Bm": "10A",
  "F#m": "11A", "Gbm": "11A",
  "C#m": "12A", "Dbm": "12A",
  // Major (B row)
  "B": "1B",
  "F#": "2B", "Gb": "2B",
  "Db": "3B", "C#": "3B",
  "Ab": "4B", "G#": "4B",
  "Eb": "5B", "D#": "5B",
  "Bb": "6B", "A#": "6B",
  "F": "7B",
  "C": "8B",
  "G": "9B",
  "D": "10B",
  "A": "11B",
  "E": "12B",
};

/**
 * Best-effort conversion of common key strings (musical or already-Camelot)
 * into Camelot notation. Returns undefined if unrecognized.
 */
export function toCamelot(input?: string | null): string | undefined {
  if (!input) return undefined;
  const raw = String(input).trim();
  if (!raw) return undefined;
  // Already Camelot ("8A", "10B")
  const direct = raw.match(/^(\d{1,2})\s*([AB])$/i);
  if (direct) {
    const n = Math.max(1, Math.min(12, parseInt(direct[1], 10)));
    return `${n}${direct[2].toUpperCase()}`;
  }
  // Normalize musical: strip "major"/"minor" words, accept "m"/"min" for minor.
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(/\b(major|maj)\b/gi, "").replace(/\b(minor|min)\b/gi, "m").trim();
  s = s.replace(/\s+/g, "");
  // Capitalize root, keep accidental/quality.
  const m = s.match(/^([A-Ga-g])([#b]?)(m?)$/);
  if (!m) return undefined;
  const root = m[1].toUpperCase() + (m[2] || "") + (m[3] ? "m" : "");
  return CAMELOT_MAP[root];
}

/**
 * Distance on the Camelot wheel between two keys. Smaller = more compatible.
 * Returns 0 for identical, 1 for adjacent/relative (smooth mix), up to 6.
 * Returns Infinity if either key can't be parsed.
 */
export function camelotDistance(a?: string, b?: string): number {
  const ca = toCamelot(a);
  const cb = toCamelot(b);
  if (!ca || !cb) return Infinity;
  const am = ca.match(/^(\d{1,2})([AB])$/)!;
  const bm = cb.match(/^(\d{1,2})([AB])$/)!;
  const an = parseInt(am[1], 10);
  const bn = parseInt(bm[1], 10);
  const al = am[2];
  const bl = bm[2];
  // Wheel distance (1-12, wraps).
  const raw = Math.abs(an - bn);
  const ring = Math.min(raw, 12 - raw);
  // Same row (both A or both B): ring distance.
  // Different row at same number (relative key): treat as 1 (smooth).
  if (al === bl) return ring;
  if (an === bn) return 1;
  return ring + 1;
}

/** BPM proximity 0..1 (1 = identical, 0 = ≥12% apart). */
export function bpmCloseness(a?: number, b?: number): number {
  if (!a || !b || a <= 0 || b <= 0) return 0.5;
  const diff = Math.abs(a - b) / Math.max(a, b);
  if (diff >= 0.12) return 0;
  return 1 - diff / 0.12;
}

/** Parse a BPM string/number into a number, or undefined. */
export function parseBpm(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (isFinite(n) && n > 0) return n;
  }
  return undefined;
}
