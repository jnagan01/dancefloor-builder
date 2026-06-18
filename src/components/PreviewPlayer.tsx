import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, Loader2, Music } from "lucide-react";

export interface PreviewTarget {
  artist: string;
  song: string;
}

interface ITunesResult {
  trackName: string;
  artistName: string;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackViewUrl?: string;
}

export function PreviewPlayer({
  target,
  onOpenChange,
}: {
  target: PreviewTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ITunesResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!target) return;
    setLoading(true);
    setError(null);
    setResults([]);
    setSelected(0);
    const term = encodeURIComponent(`${target.artist} ${target.song}`.trim());
    const url = `https://itunes.apple.com/search?term=${term}&entity=song&limit=5`;
    fetch(url)
      .then((r) => r.json())
      .then((data: { results: ITunesResult[] }) => {
        const withPreview = (data.results || []).filter((r) => r.previewUrl);
        if (withPreview.length === 0) {
          setError("No preview available for this track.");
        }
        setResults(withPreview);
      })
      .catch(() => setError("Couldn't reach preview service."))
      .finally(() => setLoading(false));
  }, [target]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.load();
      audioRef.current.play().catch(() => {});
    }
  }, [selected, results]);

  const current = results[selected];
  const ytUrl = target
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${target.artist} ${target.song}`)}`
    : "#";

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">
            {target ? `${target.artist} — ${target.song}` : "Preview"}
          </DialogTitle>
          <DialogDescription>30-second preview from Apple Music</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading preview…
          </div>
        ) : error ? (
          <div className="space-y-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button asChild variant="outline" size="sm">
              <a href={ytUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" /> Search on YouTube
              </a>
            </Button>
          </div>
        ) : current ? (
          <div className="space-y-3">
            <div className="flex gap-3">
              {current.artworkUrl100 ? (
                <img
                  src={current.artworkUrl100.replace("100x100", "300x300")}
                  alt={current.trackName}
                  className="h-20 w-20 rounded border"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded border bg-muted">
                  <Music className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{current.trackName}</p>
                <p className="truncate text-sm text-muted-foreground">{current.artistName}</p>
                {current.collectionName && (
                  <p className="truncate text-xs text-muted-foreground">{current.collectionName}</p>
                )}
              </div>
            </div>
            <audio
              ref={audioRef}
              controls
              autoPlay
              src={current.previewUrl}
              className="w-full"
            />
            {results.length > 1 && (
              <div className="flex flex-wrap gap-1">
                {results.map((r, i) => (
                  <Button
                    key={i}
                    size="sm"
                    variant={i === selected ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => setSelected(i)}
                  >
                    Match {i + 1}
                  </Button>
                ))}
              </div>
            )}
            {current.trackViewUrl && (
              <Button asChild variant="ghost" size="sm" className="w-full">
                <a href={current.trackViewUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1 h-4 w-4" /> Open in Apple Music
                </a>
              </Button>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
