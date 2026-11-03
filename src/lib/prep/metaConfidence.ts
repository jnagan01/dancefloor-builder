import type { FieldSource } from "./filters";

/**
 * Source-aware per-attribute confidence. Values only influence ranking weight and wording; they are not
 * accuracy percentages. Only verified sources may satisfy hard rules (clean requirement, BPM/decade limits).
 */
export type MetaSource = FieldSource | "measured" | "provider" | "user" | "ai" | "unknown";
export type ConfidenceTier = "verified" | "estimate" | "unknown";

export function tierOf(src: MetaSource | undefined, hasValue: boolean): ConfidenceTier {
  if (!hasValue || !src || src === "unknown") return "unknown";
  if (src === "ai" || src === "estimate") return "estimate";
  return "verified"; // measured, user, file tags, VirtualDJ, provider, curated catalogue
}

/** Ranking weight per tier: verified evidence counts fully, AI/heuristic estimates count weakly, unknown never. */
export const TIER_WEIGHT: Record<ConfidenceTier, number> = { verified: 1, estimate: 0.35, unknown: 0 };

const LABEL: Record<string, string> = {
  tags: "file tags", virtualdj: "VirtualDJ", filename: "filename label", estimate: "estimate", catalogue: "built-in catalogue",
  measured: "measured", provider: "music data provider", user: "your edit", ai: "AI estimate", unknown: "unknown",
};
export const sourceLabel = (src: MetaSource | undefined) => LABEL[src ?? "unknown"] ?? "unknown";

/** Hard rules accept only verified evidence; AI-guessed explicit/clean/BPM/year never count as confirmed.
 * The curated catalogue counts for release year/genre only, never for clean/explicit or tempo. */
export const usableForHardRule = (src: MetaSource | undefined, hasValue: boolean, attr?: string) =>
  tierOf(src, hasValue) === "verified" && (src !== "catalogue" || attr === "year" || attr === "genre");

/** Source of an event row's attribute from its metaSource label (generation pipeline). */
export function rowSource(metaSource: string | undefined): MetaSource {
  switch (metaSource) {
    case "VirtualDJ": return "virtualdj";
    case "Online": return "provider";
    case "Library": return "tags";
    case "AI": return "ai";
    case undefined: return "unknown";
    default: return "estimate";
  }
}
