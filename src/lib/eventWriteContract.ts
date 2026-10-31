/** A strictly advancing proposed token; the existing database trigger may replace it. */
export function nextEventVersion(expected: string, now = Date.now()) {
  const previous = Date.parse(expected);
  if (!Number.isFinite(previous)) throw new Error("Reopen this event to read a valid saved version.");
  return new Date(Math.max(now, previous + 1)).toISOString();
}
/** Atomic timestamp AND payload comparison: the existing trigger owns updated_at. */
export async function writeEventConditionally(db: any, owner: string, request: {
  id: string; create: boolean; expectedUpdatedAt: string | null; name: string; inputs: unknown; lists: unknown; expectedSnapshot?: unknown;
}) {
  const payload = { name: request.name, inputs: request.inputs, lists: request.lists };
  if (request.create) {
    const { error } = await db.from("workflow_history").upsert({ id: request.id, user_id: owner, ...payload }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error("Could not confirm event creation. Keep the local recovery copy and retry.");
  } else {
    if (!request.expectedUpdatedAt) throw new Error("Reopen this event before saving to check its latest version.");
    const baseline = request.expectedSnapshot as typeof payload | undefined;
    if (!baseline) throw new Error("This recovery copy has no original version contents. Save it as a new event instead; nothing was overwritten.");
    if (baseline) {
    const { data, error } = await db.from("workflow_history").update({ ...payload, updated_at: nextEventVersion(request.expectedUpdatedAt) })
      .eq("id", request.id).eq("user_id", owner).eq("updated_at", request.expectedUpdatedAt)
      .eq("name", baseline.name).eq("inputs", JSON.stringify(baseline.inputs)).eq("lists", JSON.stringify(baseline.lists)).select("id, updated_at").maybeSingle();
    if (error) throw new Error("Could not confirm event changes. Keep the local recovery copy and retry.");
    if (data) return { id: data.id as string, updatedAt: data.updated_at as string };
    }
  }
  const { data: row, error } = await db.from("workflow_history").select("id, updated_at, name, inputs, lists").eq("id", request.id).eq("user_id", owner).maybeSingle();
  if (error || !row) throw new Error("Save outcome is unknown. The local recovery copy has been kept.");
  // Lost response / idempotent create: acknowledge only the same exact payload.
  if (stableJson({ name: row.name, inputs: row.inputs, lists: row.lists }) !== stableJson(payload)) throw new Error("This event changed elsewhere. Reopen it or save the recovery copy as a new event; nothing was overwritten.");
  return { id: row.id as string, updatedAt: row.updated_at as string };
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}