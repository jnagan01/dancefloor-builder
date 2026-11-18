/** Untrusted RPC hints are bounded, generation-local scheduling advice, never a global quota. */
export const PROVIDER_INTERVAL_MS = 50;
// Long valid hints may close this generation's lane; never extend its eight-minute hard ceiling.
export const MAX_PROVIDER_COOLDOWN_MS = 480_000;
export interface ProviderPressure { pressure: number; cooldownMs: number }
export interface MetadataPacing { reccobeats?: ProviderPressure; musicbrainz?: ProviderPressure }
export function boundedPressure(value?: ProviderPressure): ProviderPressure {
  const bound = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : 0;
  return { pressure: bound(value?.pressure, 6), cooldownMs: bound(value?.cooldownMs, MAX_PROVIDER_COOLDOWN_MS) };
}
export function capturePacing(pacing: MetadataPacing | undefined, now: number) {
  return Object.fromEntries(Object.entries(pacing ?? {}).filter(([key]) => key === 'reccobeats' || key === 'musicbrainz').map(([key, value]) => {
    const p = boundedPressure(value); return [key, { pressure: p.pressure, until: now + p.cooldownMs }];
  })) as Partial<Record<keyof MetadataPacing, { pressure: number; until: number }>>;
}
export function remainingPacing(pacing: ReturnType<typeof capturePacing>, now: number): MetadataPacing {
  return Object.fromEntries(Object.entries(pacing).map(([key, p]) => [key, { pressure: p.pressure, cooldownMs: Math.max(0, p.until - now) }]));
}