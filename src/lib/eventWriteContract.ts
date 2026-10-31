/** A strictly advancing proposed token; the existing database trigger may replace it. */
export function nextEventVersion(expected: string, now = Date.now()) {
  const previous = Date.parse(expected);
  if (!Number.isFinite(previous)) throw new Error("Reopen this event to read a valid saved version.");
  return new Date(Math.max(now, previous + 1)).toISOString();
}
import { EVENT_REVISION_FIELD, eventRevision, withEventRevision } from "./eventRevision";
/** Compact atomic marker comparison; legacy initialization also compares its observed timestamp. */
export async function writeEventConditionally(db: any, owner: string, request: {
  id: string; create: boolean; expectedUpdatedAt: string | null; name: string; inputs: unknown; lists: unknown; expectedRevision?: string | null; writeRevision?: string;
}) {
  if (!request.writeRevision || request.expectedRevision === undefined || (request.expectedRevision !== null && request.expectedRevision === request.writeRevision)) throw new Error("Missing or reused event revision. Reopen or save recovery as a new event; nothing was overwritten.");
  const payload = { name: request.name, inputs: withEventRevision(request.inputs, request.writeRevision), lists: request.lists };
  if (request.create) {
    const { error } = await db.from("workflow_history").upsert({ id: request.id, user_id: owner, ...payload }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error("Could not confirm event creation. Keep the local recovery copy and retry.");
  } else {
    if (!request.expectedUpdatedAt) throw new Error("Reopen this event before saving to check its latest version.");
    let query = db.from("workflow_history").update(payload).eq("id", request.id).eq("user_id", owner);
    // -> (JSON, not ->> text) distinguishes a missing property from a persisted JSON null.
    query = request.expectedRevision === null
      ? query.is(`inputs->${EVENT_REVISION_FIELD}`, null).eq("updated_at", request.expectedUpdatedAt)
      : query.eq(`inputs->>${EVENT_REVISION_FIELD}`, request.expectedRevision);
    const { data, error } = await query.select("id, updated_at, inputs").maybeSingle();
    if (error) throw new Error("Could not confirm event changes. Keep the local recovery copy and retry.");
    if (data) return { id: data.id as string, updatedAt: data.updated_at as string, revision: eventRevision(data.inputs) };
  }
  const { data: row, error } = await db.from("workflow_history").select("id, updated_at, name, inputs, lists").eq("id", request.id).eq("user_id", owner).maybeSingle();
  if (error || !row) throw new Error("Save outcome is unknown. The local recovery copy has been kept.");
  // Lost response / idempotent create: acknowledge only the same exact payload.
  if (eventRevision(row.inputs) !== request.writeRevision || stableJson({ name: row.name, inputs: row.inputs, lists: row.lists }) !== stableJson(payload)) throw new Error("This event changed elsewhere. Reopen it or save the recovery copy as a new event; nothing was overwritten.");
  return { id: row.id as string, updatedAt: row.updated_at as string, revision: eventRevision(row.inputs) };
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
/** History renames are same-row writes too: capture a marker and rotate it atomically. */
export async function renameEventConditionally(db: any, owner: string, id: string, name: string) {
  const { data: row, error } = await db.from("workflow_history").select("id, name, inputs, lists, updated_at").eq("id", id).eq("user_id", owner).maybeSingle();
  if (error || !row) throw new Error("Could not read this event before renaming it.");
  return writeEventConditionally(db, owner, { id, create: false, expectedUpdatedAt: row.updated_at,
    expectedRevision: eventRevision(row.inputs), writeRevision: crypto.randomUUID(), name, inputs: row.inputs, lists: row.lists });
}