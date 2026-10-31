/** Reserved application field; all other JSON properties remain user-owned. */
export const EVENT_REVISION_FIELD = "__setarchitect_write_revision_v1";
export function eventRevision(inputs: unknown): string | null {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) throw new Error("Event inputs are unreadable; nothing was overwritten.");
  if (!Object.hasOwn(inputs, EVENT_REVISION_FIELD)) return null;
  const value = (inputs as Record<string, unknown>)[EVENT_REVISION_FIELD];
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error("The reserved event revision field is invalid; original data was preserved.");
  return value;
}
export function withEventRevision(inputs: unknown, revision: string) {
  if (!/^[0-9a-f-]{36}$/i.test(revision)) throw new Error("Invalid event write revision; nothing was overwritten.");
  eventRevision(inputs); // Fail closed if a preexisting value conflicts with the reserved namespace.
  return { ...(inputs as Record<string, unknown>), [EVENT_REVISION_FIELD]: revision };
}