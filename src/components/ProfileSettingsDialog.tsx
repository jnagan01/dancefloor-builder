import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Check, Database, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useProfileSettings } from "@/hooks/useProfileSettings";

const DECADE_OPTIONS = ["1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Tracks currently loaded from the saved library in this session. */
  savedTrackCount: number;
  savedAt: number | null;
  sourceLabels: string[];
  onForgetLibrary: () => void;
  onUpdateLibrary: () => void;
}

export function ProfileSettingsDialog(props: Props) {
  const { open, onOpenChange, savedTrackCount, savedAt, sourceLabels, onForgetLibrary, onUpdateLibrary } = props;
  const { settings, loading, save } = useProfileSettings();

  const [displayName, setDisplayName] = useState("");
  const [djAlias, setDjAlias] = useState("");
  const [hours, setHours] = useState("3");
  const [decades, setDecades] = useState<string[]>([]);
  const [expand, setExpand] = useState(false);
  const [favorites, setFavorites] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setDisplayName(settings.display_name ?? "");
    setDjAlias(settings.dj_alias ?? "");
    setHours(settings.default_hours ?? "3");
    setDecades(settings.default_decades ?? []);
    setExpand(!!settings.default_expand);
    setFavorites(settings.favorite_artists ?? "");
  }, [settings]);

  function toggleDecade(d: string) {
    setDecades((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function handleSave() {
    setSaving(true);
    const ok = await save({
      display_name: displayName.trim() || null,
      dj_alias: djAlias.trim() || null,
      default_hours: hours.trim() || "3",
      default_decades: decades,
      default_expand: expand,
      favorite_artists: favorites,
    });
    setSaving(false);
    if (ok) {
      toast.success("Profile settings saved");
      onOpenChange(false);
    } else {
      toast.error("Could not save your settings. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Profile &amp; settings</DialogTitle>
          <DialogDescription>
            These preferences follow your account, so every new event starts the way you like it.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your profile…
          </div>
        ) : (
          <div className="space-y-6">
            {/* Saved library */}
            <section className="rounded-md border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Database className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Saved music library
                </span>
              </div>
              {savedTrackCount > 0 ? (
                <>
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-emerald-500" />
                    <span className="font-medium">{savedTrackCount.toLocaleString()} tracks saved</span>
                    {savedAt ? (
                      <span className="text-xs text-muted-foreground">
                        · last updated {new Date(savedAt).toLocaleString()}
                      </span>
                    ) : null}
                    <Badge variant="secondary" className="text-xs">loads automatically</Badge>
                  </p>
                  {sourceLabels.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {sourceLabels.slice(0, 6).map((s, i) => (
                        <li key={i} className="truncate">• {s}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={onUpdateLibrary}>
                      Update / add music
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onForgetLibrary}>
                      <Trash2 className="mr-1 h-4 w-4" /> Forget saved library
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Your track list is remembered. To play songs inside the app, reconnect your music folder once per visit.
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm text-muted-foreground">
                    No library saved yet. Add your music and it will be remembered for next time.
                  </p>
                  <Button size="sm" className="mt-3" onClick={onUpdateLibrary}>
                    Add music
                  </Button>
                </>
              )}
            </section>

            {/* DJ details */}
            <section className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ps-name">Your name</Label>
                <Input id="ps-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Joe Nagan" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ps-alias">DJ / company name</Label>
                <Input id="ps-alias" value={djAlias} onChange={(e) => setDjAlias(e.target.value)} placeholder="Exceptional Entertainment" />
              </div>
            </section>

            {/* Defaults */}
            <section className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ps-hours">Default dance floor length (hours)</Label>
                <Input id="ps-hours" type="number" min="1" max="8" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} className="sm:max-w-[160px]" />
              </div>
              <div className="space-y-1.5">
                <Label>Default decades</Label>
                <div className="flex flex-wrap gap-2">
                  {DECADE_OPTIONS.map((d) => {
                    const on = decades.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDecade(d)}
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                          on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="pr-4">
                  <Label htmlFor="ps-expand">Song expansion on by default</Label>
                  <p className="text-xs text-muted-foreground">Fill out each list with extra recommendations automatically.</p>
                </div>
                <Switch id="ps-expand" checked={expand} onCheckedChange={setExpand} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ps-fav">Favorite artists</Label>
                <Textarea
                  id="ps-fav"
                  value={favorites}
                  onChange={(e) => setFavorites(e.target.value)}
                  placeholder="Bruno Mars, Beyoncé, Earth Wind & Fire"
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">Used first when expanding lists. Separate names with commas.</p>
              </div>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Save settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
