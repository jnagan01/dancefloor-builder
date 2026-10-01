import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertTriangle, ExternalLink, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { createSpotifyPlaylist, addSpotifyTracks } from "@/lib/spotifyExport.functions";

export interface SpotifyExportJob {
  /** Playlist name to create on Spotify. */
  name: string;
  description?: string;
  /** Uploaded artist/title only — never local file names or tags. */
  songs: { artist: string; song: string }[];
}

const BATCH = 10;

export function SpotifyExportDialog({ job, onClose }: { job: SpotifyExportJob | null; onClose: () => void }) {
  const createPlaylist = useServerFn(createSpotifyPlaylist);
  const addTracks = useServerFn(addSpotifyTracks);
  const [phase, setPhase] = useState<"idle" | "creating" | "adding" | "done" | "error">("idle");
  const [done, setDone] = useState(0);
  const [current, setCurrent] = useState("");
  const [added, setAdded] = useState(0);
  const [missed, setMissed] = useState<{ artist: string; song: string; reason: string }[]>([]);
  const [url, setUrl] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const running = useRef(false);

  const run = useCallback(
    async (j: SpotifyExportJob) => {
      setPhase("creating");
      setDone(0);
      setAdded(0);
      setMissed([]);
      setUrl(undefined);
      setError(undefined);
      const created = await createPlaylist({ data: { name: j.name.slice(0, 100), description: j.description } });
      if (!created.playlistId) {
        setError(created.error ?? "Spotify could not create the playlist.");
        setPhase("error");
        return;
      }
      setUrl(created.url);
      setPhase("adding");
      let totalAdded = 0;
      const allMissed: { artist: string; song: string; reason: string }[] = [];
      for (let i = 0; i < j.songs.length; i += BATCH) {
        const batch = j.songs.slice(i, i + BATCH);
        setCurrent(`${batch[0]?.artist} — ${batch[0]?.song}`);
        const res = await addTracks({ data: { playlistId: created.playlistId, songs: batch } });
        if (res.error) {
          setError(res.error);
          setPhase("error");
          return;
        }
        totalAdded += res.added;
        allMissed.push(...res.missed);
        setAdded(totalAdded);
        setMissed([...allMissed]);
        setDone(Math.min(i + batch.length, j.songs.length));
      }
      setCurrent("");
      setPhase("done");
    },
    [createPlaylist, addTracks],
  );

  useEffect(() => {
    if (!job || running.current) return;
    running.current = true;
    void run(job).finally(() => {
      running.current = false;
    });
  }, [job, run]);

  const total = job?.songs.length ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const busy = phase === "creating" || phase === "adding";

  return (
    <Dialog
      open={!!job}
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {phase === "done" ? "Playlist exported to Spotify" : phase === "error" ? "Export stopped" : "Exporting to Spotify"}
          </DialogTitle>
          <DialogDescription>{job?.name}</DialogDescription>
        </DialogHeader>

        {busy && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {phase === "creating" ? "Creating the public playlist…" : `Adding songs (${done} of ${total})…`}
            </p>
            <Progress value={phase === "creating" ? 2 : pct} />
            {current && <p className="truncate text-xs text-muted-foreground">{current}</p>}
          </div>
        )}

        {phase === "error" && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success" />
              <div>
                <p className="font-medium">
                  {missed.length === 0 ? `All ${added} songs added` : `${added} of ${total} songs added`}
                </p>
                <p className="text-xs text-muted-foreground">Playlist is public on your Spotify account.</p>
              </div>
            </div>

            {missed.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  {missed.length} song{missed.length === 1 ? "" : "s"} not added
                </p>
                <div className="max-h-56 space-y-1 overflow-auto rounded-md border p-2">
                  {missed.map((m, i) => (
                    <div key={`${m.artist}-${m.song}-${i}`} className="text-sm">
                      <span className="font-medium">{m.artist}</span> — {m.song}
                      <span className="ml-1 text-xs text-muted-foreground">({m.reason})</span>
                    </div>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(missed.map((m) => `${m.artist} - ${m.song}`).join("\n"))
                      .then(() => toast.success("Copied"));
                  }}
                >
                  <Copy className="mr-1 h-4 w-4" /> Copy list
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {url && (
            <Button variant="secondary" onClick={() => window.open(url, "_blank", "noopener")}>
              <ExternalLink className="mr-1 h-4 w-4" /> Open in Spotify
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
