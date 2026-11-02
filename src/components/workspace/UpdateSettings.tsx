import { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
type Status = { phase: string; percent?: number; version?: string; error?: string };
type Bridge = { status(): Promise<Status>; check(): Promise<Status>; install(): Promise<Status>; cancel(): Promise<Status>; subscribe(callback: (state: Status) => void): () => void };
export function UpdateSettings() {
  const [bridge, setBridge] = useState<Bridge | null>(null);
  const [state, setState] = useState<Status>({ phase: "idle" });
  useEffect(() => {
    const api = (window as Window & { electronUpdates?: Bridge }).electronUpdates;
    if (!api) return;
    setBridge(api);
    const unsubscribe = api.subscribe(setState);
    void api.status().then(setState).catch(error => setState({ phase: "failed", error: error.message }));
    return unsubscribe;
  }, []);
  if (!bridge) return null;
  const busy = ["checking", "downloading", "preserving", "installing", "staging-failed", "preservation-failed"].includes(state.phase);
  const act = (operation: () => Promise<Status>) => { void operation().then(setState).catch(error => setState({ phase: "failed", error: error.message })); };
  return <section className="space-y-4 border-b border-border pb-8"><h2 className="font-display text-lg">Desktop app updates</h2><p role="status" className={state.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{state.phase === "downloading" ? `Downloading ${state.version} · ${Math.round(state.percent ?? 0)}%` : state.phase === "preserving" ? "Preserving your latest work…" : state.phase === "installing" ? "Installing and restarting…" : state.phase === "available" ? `Version ${state.version} available` : state.phase === "current" ? "Your Mac app is up to date." : state.phase === "checking" ? "Checking for updates…" : state.phase === "cancelled" ? "Download cancelled. Nothing installed." : state.error || ""}</p>{state.phase === "downloading" && <progress className="w-full accent-primary" value={state.percent ?? 0} max={100} aria-label="Update download progress" />}<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => act(() => bridge.check())}><RefreshCw className="mr-2 size-4" />Check for updates</Button>{["available", "cancelled"].includes(state.phase) && <Button onClick={() => act(() => bridge.install())}><Download className="mr-2 size-4" />Update now</Button>}{state.phase === "downloading" && <Button variant="outline" onClick={() => act(() => bridge.cancel())}><X className="mr-2 size-4" />Cancel download</Button>}</div></section>;
}