/** Explicit limits for new calculations; legacy snapshots are kept read-only if outside them. */
export const MAX_EVENT_HOURS = 24;
export const MAX_EVENT_MINUTES = 1440;
export const MAX_BUFFER = 4;
export function boundedNumber(value: unknown, max: number, name: string, min = 0): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return n;
}
export function displayNumber(value: unknown, max: number): number {
  try { return boundedNumber(value, max, "Value"); } catch { return 0; }
}
/** Display-only fallback; never change stored legacy values. */
export function displayBuffer(value: unknown): number {
  try { return boundedNumber(value, MAX_BUFFER, "Song buffer", 1); } catch { return 2; }
}
export function validateTiming(hours: unknown, buffer: unknown, split?: { warmUp: number; transition: number; peak: number }) {
  boundedNumber(hours, MAX_EVENT_HOURS, "Event hours");
  boundedNumber(buffer, MAX_BUFFER, "Song buffer", 1);
  if (split) {
    for (const v of Object.values(split)) boundedNumber(v, MAX_EVENT_MINUTES, "Section minutes");
    boundedNumber(split.warmUp + split.transition + split.peak, MAX_EVENT_MINUTES, "Total section minutes");
  }
}