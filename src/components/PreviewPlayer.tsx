import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, Loader2, Music } from "lucide-react";

export interface PreviewTarget {
  artist: string;
  song: string;
  /** Optional VirtualDJ library filePath to play the actual local file when connected. */
  filePath?: string;
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
  resolveLocalFile,
  resolveLocalMatch,
}: {
  target: PreviewTarget | null;
  onOpenChange: (open: boolean) => void;
  /** Returns a File for a given query when the user has connected their music folder. */
  resolveLocalFile?: (query: { artist?: string; title?: string; filePath?: string }) => File | undefined;
  /** Same as resolveLocalFile but also reports match confidence. */
  resolveLocalMatch?: (query: { artist?: string; title?: string; filePath?: string }) =>
    | { file: File; score: number; versionMatch: boolean; exact: boolean }
    | undefined;
}) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ITunesResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const localMatch = useMemo(() => {
    if (!target) return undefined;
    const q = { artist: target.artist, title: target.song, filePath: target.filePath };
    if (resolveLocalMatch) return resolveLocalMatch(q);
    const f = resolveLocalFile?.(q);
    return f ? { file: f, score: 1, versionMatch: true, exact: true } : undefined;
  }, [target, resolveLocalFile, resolveLocalMatch]);

  const localFile = localMatch?.file;
  const lowConfidence = Boolean(localMatch && !localMatch.exact && localMatch.score < 0.82);
  const versionDiffers = Boolean(localMatch && !localMatch.exact && !localMatch.versionMatch);

  const localUrl = useMemo(() => (localFile ? URL.createObjectURL(localFile) : null), [localFile]);
  useEffect(() => {
    return () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [localUrl]);


  // Only hit iTunes when we don't have a local file
  useEffect(() => {
    if (!target || localFile) return;
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
        if (withPreview.length === 0) setError("No preview available for this track.");
        setResults(withPreview);
      })
      .catch(() => setError("Couldn't reach preview service."))
      .finally(() => setLoading(false));
  }, [target, localFile]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.load();
      audioRef.current.play().catch(() => {});
    }
  }, [selected, results, localUrl]);

  const current = results[selected];
  const ytUrl = target
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${target.artist} ${target.song}`)}`
    : "#";

  // Tail filename for display — prefer the file we actually resolved.
  const fileName = localFile?.name || (target?.filePath ? target.filePath.split(/[\\/]/).pop() : undefined);

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">
            {target ? `${target.artist} — ${target.song}` : "Preview"}
          </DialogTitle>
          <DialogDescription>
            {localFile
              ? "Playing local file from your connected music folder"
              : target?.filePath
              ? "Local file not found in connected folder — falling back to Apple Music preview"
              : "30-second preview from Apple Music"}
          </DialogDescription>
        </DialogHeader>

        {localFile && localUrl ? (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="truncate font-medium">{fileName}</p>
              <p className="truncate text-xs text-muted-foreground">{target?.filePath}</p>
              {(lowConfidence || versionDiffers) && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  {versionDiffers
                    ? "Closest file is a different version (remix/edit) — confirm before exporting."
                    : "Close match, not exact — confirm this is the right file."}
                </p>
              )}
            </div>
            <audio ref={audioRef} controls autoPlay src={localUrl} className="w-full" />
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading preview…
          </div>
        ) : error ? (
          <div className="space-y-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            {target?.filePath && (
              <p className="text-xs text-muted-foreground">
                Connect your music folder to play <span className="font-mono">{fileName}</span> directly.
              </p>
            )}
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
            <audio ref={audioRef} controls autoPlay src={current.previewUrl} className="w-full" />
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
