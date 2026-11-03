export interface PreparationInputs { ownedOnlyExpansion?: boolean; includeSeasonalTracks?: boolean; requireCleanVersions?: boolean; eventType?: string }
export interface PolicyTrack { artist?: string; song?: string; title?: string; filePath?: string; genre?: string; remix?: string; comment?: string; tags?: string[]; explicit?: boolean }
export const DEFAULTS: Required<Omit<PreparationInputs, 'eventType'>>;
export function cleanEvidence(track?: PolicyTrack): 'clean' | 'dirty' | 'unknown' | 'conflicting';
export function requiresClean(inputs?: PreparationInputs): boolean;
export function needsPolicyConsumer(inputs?: PreparationInputs): boolean;
export function cleanReason(track: PolicyTrack | undefined, required: boolean | 'strict'): string | null;
export function seasonal(track: PolicyTrack): boolean;
export function intended(song: PolicyTrack, track: PolicyTrack): boolean;
export function intendedKey(song: PolicyTrack): string;
export function buildResolver(tracks: PolicyTrack[], inputs?: PreparationInputs): { resolve(song: PolicyTrack): number | undefined; allowed(song: PolicyTrack): boolean };
export function omissionText(summary: { excluded: number; unapproved: number; missing: number; cleanBlocked: number }): string;