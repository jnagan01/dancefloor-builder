import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Music2, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getSpotifyConnection, startSpotifyAuth, disconnectSpotify } from "@/lib/spotifyExport.functions";

export function SpotifySection() {
  const getConn = useServerFn(getSpotifyConnection);
  const startAuth = useServerFn(startSpotifyAuth);
  const disconnect = useServerFn(disconnectSpotify);
  const [state, setState] = useState<{ connected: boolean; displayName?: string; configured: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await getConn({}));
    } catch {
      setState({ connected: false, configured: true });
    }
  }, [getConn]);

  useEffect(() => {
    void load();
    const status = new URLSearchParams(window.location.search).get("spotify");
    if (status === "connected") toast.success("Spotify account connected");
    else if (status === "denied") toast.error("Spotify sign-in was cancelled");
    else if (status === "error") toast.error("Spotify sign-in failed. Please try again.");
    if (status) window.history.replaceState({}, "", window.location.pathname + "#spotify");
  }, [load]);

  return (
    <section id="spotify" className="space-y-4 border-b border-border pb-8">
      <h2 className="font-display text-lg">Spotify account</h2>
      <p className="text-sm text-muted-foreground">
        Connect your Spotify account to send finished lists straight to Spotify. New playlists are created as public.
      </p>
      <div className="space-y-3 rounded-xl border border-border/70 p-4">
        <p className="text-sm">
          {state === null
            ? "Checking…"
            : state.connected
              ? `Connected as ${state.displayName ?? "your Spotify account"}`
              : "Not connected"}
        </p>
        <div className="flex flex-wrap gap-2">
          {state?.connected ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await disconnect({});
                setBusy(false);
                toast.success("Spotify disconnected");
                void load();
              }}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || state === null}
              onClick={async () => {
                setBusy(true);
                const res = await startAuth({ data: { origin: window.location.origin } });
                setBusy(false);
                if (res.url) window.location.href = res.url;
                else toast.error(res.error ?? "Could not start the Spotify sign-in.");
              }}
            >
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Music2 className="mr-2 size-4" />} Connect
              Spotify
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
