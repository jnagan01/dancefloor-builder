// Frozen 9780e18 fresh automatic gate, for synthetic before/after only.
import type { EventFit, FitFacts } from '@/lib/prep/eventFit';
import { tierOf } from '@/lib/prep/metaConfidence';
export function baselineDanceFailure(fit: EventFit | undefined, f: FitFacts = {}) {
  if (!fit?.avoidSlow) return undefined;
  const strong = new Set(['provider', 'measured', 'user', 'tags', 'virtualdj']);
  const e = f.energy, d = f.danceability;
  if (f.community?.slowTags.length) return 'Conflicting slow evidence';
  const supported = e !== undefined && d !== undefined && tierOf(f.energySource, true) !== 'unknown' && tierOf(f.danceabilitySource, true) !== 'unknown' && e >= 5 && d >= 5 && (e >= 7 || d >= 7);
  const groove = d !== undefined && strong.has(f.danceabilitySource ?? '') && d >= 7 && (e === undefined || e > 4);
  const tags = !!f.community?.upbeatTags.length && !(e !== undefined && e <= 4) && !(d !== undefined && d <= 4);
  return supported || groove || tags ? undefined : 'Unestablished dance suitability';
}