/** Row names and snapshot eventName must describe the same event. */
export function isGeneratedEventName(rowName: string, storedName: unknown) {
  return typeof storedName !== 'string' || !storedName.trim() ? /^Event — /.test(rowName) : false;
}
/** Display name on open: a history rename (row name) wins over an older snapshot eventName; read-only, never saved by itself. */
export function openedEventName(rowName: unknown, storedName: unknown): string {
  const stored = typeof storedName === 'string' ? storedName : '';
  if (typeof rowName !== 'string' || !rowName.trim()) return stored;
  if (!stored.trim()) return isGeneratedEventName(rowName, stored) ? stored : rowName;
  return stored.trim().slice(0, 200) === rowName ? stored : rowName;
}
/** Rename writes only eventName inside inputs; every other field (including unknown JSON) is kept by reference. */
export function renamedInputs(inputs: unknown, name: string): unknown {
  return inputs && typeof inputs === 'object' && !Array.isArray(inputs) ? { ...(inputs as Record<string, unknown>), eventName: name } : inputs;
}
