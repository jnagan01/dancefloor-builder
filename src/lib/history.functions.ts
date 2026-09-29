import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const songSchema = z.object({
  artist: z.string().min(1).max(300),
  song: z.string().min(1).max(300),
  fromUpload: z.boolean().optional(),
  energy: z.number().optional(), danceability: z.number().optional(), popularity: z.number().optional(), valence: z.number().optional(),
  bpm: z.number().optional(), camelot: z.string().optional(), genre: z.string().optional(), year: z.number().optional(),
  mood: z.string().optional(), explicit: z.boolean().optional(), metaSource: z.string().optional(),
  stretched: z.boolean().optional(), naturalSection: z.string().optional(), reused: z.boolean().optional(),
  waveRole: z.string().optional(), placementReason: z.string().optional(), aiSuggestion: z.boolean().optional(),
  aiReason: z.string().optional(), fromLibrary: z.boolean().optional(),
});

const inputsSchema = z.object({
  songs: z.array(songSchema).max(2000),
  hours: z.string().max(10),
  artistsInput: z.string().max(5000),
  genresInput: z.string().max(2000),
  decades: z.array(z.string().max(20)).max(20),
  notes: z.string().max(5000),
  doNotPlayInput: z.string().max(20000),
  expand: z.boolean(),
  buffer: z.number().int().min(2).max(4).optional(),
  eventName: z.string().max(200),
});

const listsSchema = z.object({
  warmUp: z.array(songSchema).max(2000),
  transition: z.array(songSchema).max(2000),
  peak: z.array(songSchema).max(2000),
  selections: z.record(z.string(), z.object({ paths: z.array(z.string().max(2000)).max(100), excluded: z.boolean().optional() })).optional(),
});

function dbError(op: string, error: { message: string; code?: string }): Error {
  console.error(`[history.functions] ${op} failed:`, error.message, error.code ?? "");
  if (error.code === "PGRST116") return new Error("Not found.");
  return new Error("An error occurred. Please try again.");
}

export const listWorkflows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("workflow_history")
      .select("id, name, created_at, updated_at, lists")
      .order("created_at", { ascending: false });
    if (error) throw dbError("listWorkflows", error);
    return (data ?? []).map((r) => {
      const lists = (r.lists ?? {}) as { warmUp?: unknown[]; transition?: unknown[]; peak?: unknown[] };
      return {
        id: r.id as string,
        name: r.name as string,
        created_at: r.created_at as string,
        counts: {
          warmUp: Array.isArray(lists.warmUp) ? lists.warmUp.length : 0,
          transition: Array.isArray(lists.transition) ? lists.transition.length : 0,
          peak: Array.isArray(lists.peak) ? lists.peak.length : 0,
        },
      };
    });
  });

export const getWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("workflow_history")
      .select("id, name, created_at, inputs, lists")
      .eq("id", data.id)
      .single();
    if (error) throw dbError("getWorkflow", error);
    return row;
  });

export const saveWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { name: string; inputs: unknown; lists: unknown }) =>
    z
      .object({
        name: z.string().min(1).max(200),
        inputs: inputsSchema,
        lists: listsSchema,
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("workflow_history")
      .insert({
        user_id: userId,
        name: data.name,
        inputs: data.inputs,
        lists: data.lists,
      })
      .select("id")
      .single();
    if (error) throw dbError("saveWorkflow", error);
    return { id: row.id as string };
  });

export const updateWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; name: string; inputs: unknown; lists: unknown }) => z.object({
    id: z.string().uuid(), name: z.string().min(1).max(200), inputs: inputsSchema, lists: listsSchema,
  }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("workflow_history")
      .update({ name: data.name, inputs: data.inputs, lists: data.lists, updated_at: new Date().toISOString() })
      .eq("id", data.id).eq("user_id", context.userId).select("id").maybeSingle();
    if (error) throw dbError("updateWorkflow", error);
    if (!row) throw new Error("Event not found.");
    return { id: row.id };
  });

export const renameWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; name: string }) =>
    z.object({ id: z.string().uuid(), name: z.string().min(1).max(200) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("workflow_history")
      .update({ name: data.name })
      .eq("id", data.id);
    if (error) throw dbError("renameWorkflow", error);
    return { ok: true };
  });

export const deleteWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("workflow_history").delete().eq("id", data.id);
    if (error) throw dbError("deleteWorkflow", error);
    return { ok: true };
  });

/** Songs that recur most across the signed-in user's saved event lists. */
export const listMostRequested = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("workflow_history")
      .select("id, inputs, lists")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw dbError("listMostRequested", error);

    const tally = new Map<string, { artist: string; song: string; events: number }>();
    for (const row of data ?? []) {
      const inputs = (row.inputs ?? {}) as { songs?: Array<{ artist?: string; song?: string }> };
      const seen = new Set<string>();
      for (const s of Array.isArray(inputs.songs) ? inputs.songs : []) {
        const artist = String(s?.artist ?? "").trim();
        const song = String(s?.song ?? "").trim();
        if (!artist || !song) continue;
        const key = `${artist.toLowerCase()}|${song.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const prev = tally.get(key);
        if (prev) prev.events += 1;
        else tally.set(key, { artist, song, events: 1 });
      }
    }
    return [...tally.values()]
      .sort((a, b) => b.events - a.events || a.song.localeCompare(b.song))
      .slice(0, 10);
  });
