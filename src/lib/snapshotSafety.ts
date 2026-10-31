import { z } from "zod";
import { validateTiming, boundedNumber, MAX_EVENT_MINUTES } from "./inputSafety";

const song = z.object({ artist: z.string(), song: z.string() }).passthrough();
const inputs = z.object({
  songs: z.array(song).default([]), hours: z.string().default("3"),
  artistsInput: z.string().default(""), genresInput: z.string().default(""), decades: z.array(z.string()).default([]),
  notes: z.string().default(""), doNotPlayInput: z.string().default(""), expand: z.boolean().default(false), eventName: z.string().default(""),
  buffer: z.number().optional(), minutes: z.string().optional(),
  listType: z.enum(["dance", "cocktail", "dinner"]).optional(),
  vibe: z.string().optional(), eventType: z.string().optional(), homeKey: z.string().optional(),
  bpmRange: z.tuple([z.number(), z.number()]).optional(), danceRange: z.tuple([z.number(), z.number()]).optional(),
  split: z.object({ warmUp: z.number(), transition: z.number(), peak: z.number() }).optional(),
}).passthrough();
const lists = z.object({
  warmUp: z.array(song).default([]), transition: z.array(song).default([]), peak: z.array(song).default([]),
  selections: z.record(z.string(), z.object({ paths: z.array(z.string()), excluded: z.boolean().optional(), confirmed: z.boolean().optional() }).passthrough()).optional(),
}).passthrough();
export function readEventSnapshot(value: unknown) {
  const parsed = z.object({ inputs, lists }).passthrough().safeParse(value);
  if (!parsed.success) throw new Error("This saved event contains unreadable fields. Original data has been preserved; no automatic changes will be saved.");
  let problem: string | null = null;
  try {
    validateTiming(parsed.data.inputs.hours, parsed.data.inputs.buffer ?? 2, parsed.data.inputs.split);
    if (parsed.data.inputs.minutes !== undefined) boundedNumber(parsed.data.inputs.minutes, MAX_EVENT_MINUTES, "List minutes");
  } catch (e) { problem = `${(e as Error).message} This older event is read-only until you explicitly correct its settings.`; }
  return { snapshot: parsed.data, problem };
}