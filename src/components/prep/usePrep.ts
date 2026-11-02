import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { prepStore } from "@/lib/prep/prepStore";
import type { PrepKnowledge } from "@/lib/prep/knowledge";

/** Account-scoped preparation knowledge; mutations are fenced to the account captured at call time. */
export function usePrep() {
  const store = prepStore();
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const mutate = useCallback(async (change: (k: PrepKnowledge) => PrepKnowledge): Promise<boolean> => {
    const account = store.get().account;
    if (!account) { toast.error("Sign in to save preparation notes."); return false; }
    try { await store.update(account, change); return true; }
    catch (e) { toast.error((e as Error).message); return false; }
  }, [store]);
  return { state, knowledge: state.knowledge, ready: state.status === "ready", mutate };
}
