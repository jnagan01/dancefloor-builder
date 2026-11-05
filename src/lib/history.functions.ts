import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { writeEventConditionally, renameEventConditionally } from "./eventWriteContract";
import { withEventRevision } from "./eventRevision";
import type { Json } from "@/integrations/supabase/types";

export { inputsSchema, listsSchema } from "./eventSchemas";
import { inputsSchema, listsSchema, parseSafeSaveRequest } from "./eventSchemas";

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
      .select("id, name, created_at, updated_at, lists, inputs")
      .order("created_at", { ascending: false });
    if (error) throw dbError("listWorkflows", error);
    return (data ?? []).map((r) => {
      const lists = (r.lists ?? {}) as { warmUp?: unknown[]; transition?: unknown[]; peak?: unknown[] };
      const inputs = (r.inputs ?? {}) as { listType?: string };
      const warmUp = Array.isArray(lists.warmUp) ? lists.warmUp.length : 0;
      const transition = Array.isArray(lists.transition) ? lists.transition.length : 0;
      const peak = Array.isArray(lists.peak) ? lists.peak.length : 0;
      const stored = inputs.listType;
      const listType: "dance" | "cocktail" | "dinner" =
        stored === "cocktail" || stored === "dinner" || stored === "dance"
          ? stored
          : warmUp > 0 && transition === 0 && peak === 0
            ? "cocktail"
            : "dance";
      return {
        id: r.id as string,
        name: r.name as string,
        created_at: r.created_at as string,
        listType,
        counts: { warmUp, transition, peak },
      };
    });
  });

export const getWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.guid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("workflow_history")
      .select("id, name, created_at, updated_at, inputs, lists")
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
        inputs: JSON.parse(JSON.stringify(withEventRevision(data.inputs, crypto.randomUUID()))) as Json,
        lists: JSON.parse(JSON.stringify(data.lists)) as Json,
      })
      .select("id")
      .single();
    if (error) throw dbError("saveWorkflow", error);
    return { id: row.id as string };
  });

export const updateWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; name: string; inputs: unknown; lists: unknown }) => z.object({
    id: z.guid(), name: z.string().min(1).max(200), inputs: inputsSchema, lists: listsSchema,
  }).parse(data))
  .handler(async ({ data, context }) => {
    // Obsolete endpoint has no expected revision; never allow it to bypass the safe writer.
    throw new Error("Reopen this event and use automatic saving. This older save action cannot safely update it.");
  });

export const renameWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; name: string }) =>
    z.object({ id: z.guid(), name: z.string().min(1).max(200) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await renameEventConditionally(context.supabase, context.userId, data.id, data.name);
    return { ok: true };
  });

export const deleteWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.guid() }).parse(data))
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

/** Retry-safe endpoint: same UUID for creation, atomic expected-version update for existing events. */
export const saveWorkflowSafely = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => parseSafeSaveRequest(data))
  .handler(async ({ data, context }) => writeEventConditionally(context.supabase, context.userId, data));
