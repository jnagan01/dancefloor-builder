import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { offlineBridge, type OfflineStatus } from "@/lib/offlineAccess";
import { toast } from "sonner";
import { WifiOff } from "lucide-react";

export function OfflineSettings() {
  const workspace = useWorkspace(), { user } = useAuth();
  const [native, setNative] = useState(false), [status, setStatus] = useState<OfflineStatus | null>(null), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const bridge = offlineBridge(); setNative(!!bridge); setStatus(null);
    const mine = ++generation.current;
    if (bridge && user) void bridge.status(user.id).then(s => { if (generation.current === mine) setStatus(s); }).catch(() => {});
  }, [user?.id]);
  if (!native) return null;
  const prepare = async () => {
    setBusy(true); const mine = generation.current;
    try { const s = await workspace.prepareOffline(); if (generation.current === mine) { setStatus(s); toast.success(`Offline access ready: ${s.events} events, ${s.tracks?.toLocaleString()} tracks.`); } }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section id="offline" className="space-y-3 border-b border-border pb-8">
    <h2 className="font-display text-lg">Offline access</h2>
    <p className="text-xs text-muted-foreground">Saves your events and music library on this Mac so you can open them, confirm tracks and export VirtualDJ playlists without internet (File › Open Offline Workspace). Audio and sign-in details are never saved. Signing out removes offline access.</p>
    <p className="text-sm" role="status">{status?.prepared ? `Prepared ${new Date(status.preparedAt!).toLocaleString()} · ${status.events} events · ${status.tracks?.toLocaleString()} tracks. Changes made after this time aren't included until you prepare again.` : status?.error ? `Offline copy problem: ${status.error}` : "Not prepared on this Mac yet."}</p>
    <Button size="sm" disabled={busy || !user} onClick={() => void prepare()}><WifiOff className="mr-2 size-4" />{busy ? "Preparing…" : "Prepare offline access"}</Button>
  </section>;
}
