import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "./WorkspaceContext";
import { supportsTagWriting } from "@/lib/desktopBridge";
import { resolveExportPath, cleanBpm } from "@/lib/virtualDj";
import type { VdjTrack } from "@/lib/virtualDj";

const FIELDS = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "genre", label: "Genre" },
  { key: "year", label: "Year" },
  { key: "bpm", label: "BPM" },
  { key: "key", label: "Key" },
] as const;
type Key = (typeof FIELDS)[number]["key"] | "comment";
type Form = Record<Key, string>;

const toForm = (t: VdjTrack): Form => ({
  title: t.title ?? "", artist: t.artist ?? "", album: t.album ?? "", genre: t.genre ?? "",
  year: t.year ?? "", bpm: cleanBpm(t.bpm) ?? "", key: t.key ?? "", comment: t.comment ?? "",
});


export function TrackTagEditor({ target, onClose }: { target: { source: number; index: number } | null; onClose: () => void }) {
  const { sources, saveTrackTags } = useWorkspace();
  const track = target ? sources[target.source]?.tracks[target.index] : null;
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  useEffect(() => setCanWrite(supportsTagWriting()), []);
  useEffect(() => { setForm(track ? toForm(track) : null); }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!target || !track || !form) return;
    const original = toForm(track);
    const patch: Partial<Record<Key, string>> = {};
    for (const k of Object.keys(form) as Key[]) if (form[k].trim() !== original[k].trim()) patch[k] = form[k].trim();
    if (!Object.keys(patch).length) { onClose(); return; }
    setSaving(true);
    const res = await saveTrackTags(target.source, target.index, patch);
    setSaving(false);
    if (!res.ok) { toast.error(res.error ?? "Couldn't save the changes"); return; }
    toast.success("Saved to the music file");
    onClose();
  }

  return (
    <Dialog open={!!track} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Song details</DialogTitle>
          <DialogDescription className="break-all text-xs">
            {track ? resolveExportPath(track.filePath) ?? track.filePath : ""}
          </DialogDescription>
        </DialogHeader>
        {form && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f.key} className={`block text-sm ${f.key === "title" || f.key === "artist" ? "sm:col-span-2" : ""}`}>
                  {f.label}
                  <Input className="mt-1" value={form[f.key]} disabled={!canWrite || saving} maxLength={500}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                </label>
              ))}
            </div>
            <label className="block text-sm">Comment
              <Textarea className="mt-1" rows={2} value={form.comment} disabled={!canWrite || saving} maxLength={500}
                onChange={(e) => setForm({ ...form, comment: e.target.value })} />
            </label>
            <p className="text-xs text-muted-foreground">
              {canWrite
                ? "Saving writes these details into the music file itself. A backup of the old details is kept on your Mac. In VirtualDJ, right-click the song and choose Reload tag to see the changes."
                : "Song details can only be edited in the Mac app, because it saves changes into the music files on your computer."}
              {track && !track.fromTags && " This song's details are currently read from its file name."}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={saving}>{canWrite ? "Cancel" : "Close"}</Button>
              {canWrite && <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save to file"}</Button>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
