import { z } from "zod";
import { validateTiming, boundedNumber, MAX_EVENT_MINUTES, MAX_BUFFER } from "./inputSafety";

/**
 * Event snapshot + safe-save request contract. Pure (zod only) so the server function, the browser and the
 * isolated native fixtures validate with the SAME rules; a fixture that skipped this would hide contract drift.
 */
export const songSchema = z.object({
  artist: z.string().max(300),
  song: z.string().max(300),
  fromUpload: z.boolean().optional(),
  energy: z.number().optional(), danceability: z.number().optional(), popularity: z.number().optional(), valence: z.number().optional(),
  bpm: z.number().optional(), camelot: z.string().optional(), genre: z.string().optional(), year: z.number().optional(),
  mood: z.string().optional(), explicit: z.boolean().optional(), metaSource: z.string().optional(),
  metaProv: z.record(z.string().max(20), z.string().max(20)).optional(),
  stretched: z.boolean().optional(), naturalSection: z.string().optional(), reused: z.boolean().optional(),
  waveRole: z.string().optional(), placementReason: z.string().optional(), aiSuggestion: z.boolean().optional(),
  aiReason: z.string().optional(), fromLibrary: z.boolean().optional(),
  // Optional plain-language ranking reasons for automatic additions; older snapshots omit it.
  rankWhy: z.string().max(1000).optional(),
}).passthrough();

export const inputsSchema = z.object({
  songs: z.array(songSchema).max(2000),
  hours: z.string().max(10),
  artistsInput: z.string().max(5000),
  genresInput: z.string().max(2000),
  decades: z.array(z.string().max(20)).max(20),
  notes: z.string().max(5000),
  doNotPlayInput: z.string().max(20000),
  vibe: z.string().max(40).optional(),
  bpmRange: z.tuple([z.number().min(60).max(180), z.number().min(60).max(180)]).refine(([a, b]) => a <= b).optional(),
  danceRange: z.tuple([z.number().min(1).max(10), z.number().min(1).max(10)]).refine(([a, b]) => a <= b).optional(),
  expand: z.boolean(),
  // Same bounds as validateTiming: 1× (no extra preparation) is a valid, default choice for new events.
  buffer: z.number().int().min(1).max(MAX_BUFFER).optional(),
  eventName: z.string().max(200),
  listType: z.enum(["dance", "cocktail", "dinner"]).optional(),
  minutes: z.string().max(10).optional(),
  eventType: z.string().max(40).optional(), homeKey: z.string().max(10).optional(),
  split: z.object({ warmUp: z.number(), transition: z.number(), peak: z.number() }).optional(),
}).passthrough().superRefine((value, ctx) => {
  try { validateTiming(value.hours, value.buffer ?? 2, value.split); if (value.minutes !== undefined) boundedNumber(value.minutes, MAX_EVENT_MINUTES, "List minutes"); }
  catch (e) { ctx.addIssue({ code: "custom", message: (e as Error).message }); }
});

export const listsSchema = z.object({
  warmUp: z.array(songSchema).max(2000),
  transition: z.array(songSchema).max(2000),
  peak: z.array(songSchema).max(2000),
  selections: z.record(z.string(), z.object({ paths: z.array(z.string().max(2000)).max(100), excluded: z.boolean().optional() }).passthrough()).optional(),
}).passthrough();

export const safeSaveRequestSchema = z.object({
  id: z.string().uuid(), create: z.boolean(), expectedUpdatedAt: z.string().nullable(),
  expectedRevision: z.string().uuid().nullable(), writeRevision: z.string().uuid(),
  name: z.string().min(1).max(200), inputs: inputsSchema, lists: listsSchema,
});

/** Prefix the client recognises as a safe, already-sanitized save rejection. */
export const SAVE_REJECTED_PREFIX = "Save rejected before writing:";

/** Validates a safe-save request. Rejections name only field locations (never values or backend details). */
export function parseSafeSaveRequest(data: unknown) {
  const parsed = safeSaveRequestSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  const fields = [...new Set(parsed.error.issues.map(i => i.path.filter(p => typeof p === "string").map((p, n, a) => (a[n - 1] === "selections" || a[n - 1] === "metaProv" ? "*" : p)).join(".") || "request"))].slice(0, 3);
  throw new Error(`${SAVE_REJECTED_PREFIX} ${fields.join(", ")} not accepted. Nothing was changed online; your recovery copy is kept.`);
}
