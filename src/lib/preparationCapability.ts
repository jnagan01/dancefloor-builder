import { needsPolicyConsumer, type PreparationInputs } from './preparationPolicy';

export const POLICY_UPDATE_GUIDANCE = 'Update the desktop app in Settings → Desktop app updates before activating or restoring these preparation choices. Existing events, backups and the normal update path remain available; no policy is removed.';

type PolicyHost = { electronVirtualDJ?: { isAvailable?: boolean }; electronOffline?: { preparationPolicyVersion?: number } };
/** Explicit packaged capability, never available-update semver. Browsers enforce policy themselves. */
export function supportsPreparationPolicy(host: PolicyHost | undefined = typeof window === 'undefined' ? undefined : window as PolicyHost): boolean {
  return host?.electronVirtualDJ?.isAvailable !== true || host.electronOffline?.preparationPolicyVersion === 1;
}
export function assertPreparationActivation(inputs: PreparationInputs, host?: PolicyHost): void {
  if (needsPolicyConsumer(inputs) && !supportsPreparationPolicy(host)) throw Error(POLICY_UPDATE_GUIDANCE);
}