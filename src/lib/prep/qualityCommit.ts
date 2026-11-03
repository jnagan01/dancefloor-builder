import { STALE, type PrepOwner, type PrepState } from "./prepStore";
import type { PrepKnowledge } from "./knowledge";
import { addQualitySample, type QualitySample } from "./quality";

/**
 * Saves a review sample for exactly this owner. Success is reported only after the store committed the write
 * AND the same account/session is still active; any failure or stale owner returns the message instead.
 */
export async function commitQualitySample(
  store: { update(o: PrepOwner, change: (k: PrepKnowledge) => PrepKnowledge): Promise<PrepKnowledge>; get(): PrepState },
  owner: PrepOwner | null, sample: Omit<QualitySample, "id" | "createdAt">,
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  if (!owner) return { ok: false, message: "Sign in to save review samples." };
  try { await store.update(owner, k => addQualitySample(k, sample)); }
  catch (e) { return { ok: false, message: (e as Error).message || "The sample wasn't saved." }; }
  const now = store.get();
  if (now.account !== owner.account || now.generation !== owner.generation) return { ok: false, message: STALE };
  return { ok: true, count: sample.candidates.length };
}
