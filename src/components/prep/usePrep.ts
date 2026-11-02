import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { prepStore } from "@/lib/prep/prepStore";
import type { PrepKnowledge } from "@/lib/prep/knowledge";

/**
 * Account-scoped preparation knowledge. Mutations are bound to the account AND session
 * generation of the render that created them; a callback from an older render (after sign-out,
 * account switch or signing in again) is rejected by the store before it can write.
 */
export function usePrep() {
  const store = prepStore();
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const { account, generation } = state;
  /** Returns null on success or the error message (not toasted). */
  const tryMutate = useCallback(async (change: (k: PrepKnowledge) => PrepKnowledge): Promise<string | null> => {
    if (!account) return "Sign in to save preparation notes.";
    try { await store.update({ account, generation }, change); return null; }
    catch (e) { return (e as Error).message; }
  }, [store, account, generation]);
  const mutate = useCallback(async (change: (k: PrepKnowledge) => PrepKnowledge): Promise<boolean> => {
    const error = await tryMutate(change);
    if (error) toast.error(error);
    return !error;
  }, [tryMutate]);
  return { state, owner: account ? { account, generation } : null, knowledge: state.knowledge, ready: state.status === "ready", mutate, tryMutate };
}
