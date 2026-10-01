import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  listWorkflows,
  getWorkflow,
  saveWorkflow,
  renameWorkflow,
  deleteWorkflow,
} from "@/lib/history.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { History, Save, RotateCcw, LogOut, LogIn, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { Song } from "@/lib/danceFloor";

export interface WorkflowSnapshot {
  inputs: {
    songs: Song[];
    hours: string;
    artistsInput: string;
    genresInput: string;
    decades: string[];
    notes: string;
    doNotPlayInput: string;
    vibe?: string;
    expand: boolean;
    buffer?: number;
    listType?: "dance" | "cocktail" | "dinner";
    minutes?: string;
    eventName: string;
  };
  lists: {
    warmUp: Array<Song & { fromUpload?: boolean }>;
    transition: Array<Song & { fromUpload?: boolean }>;
    peak: Array<Song & { fromUpload?: boolean }>;
    selections?: Record<string, { paths: string[]; excluded?: boolean }>;
  };
}

interface Props {
  hasGeneratedLists: boolean;
  getSnapshot: () => WorkflowSnapshot;
  applySnapshot: (s: WorkflowSnapshot) => void;
  resetWorkflow: () => void;
}

export function DjAccountBar({ hasGeneratedLists, getSnapshot, applySnapshot, resetWorkflow }: Props) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [saveOpen, setSaveOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/auth", replace: true });
  }

  if (loading) return <div className="text-sm text-muted-foreground">…</div>;

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setResetOpen(true)}>
          <RotateCcw className="h-4 w-4 mr-1" /> New workflow
        </Button>
        <Button asChild size="sm">
          <Link to="/auth">
            <LogIn className="h-4 w-4 mr-1" /> Sign in to save history
          </Link>
        </Button>
        <ResetDialog
          open={resetOpen}
          onOpenChange={setResetOpen}
          hasUnsaved={hasGeneratedLists}
          canSave={false}
          onReset={() => {
            resetWorkflow();
            toast.success("Started a fresh workflow");
            setResetOpen(false);
          }}
          onSaveAndReset={() => { /* unreachable */ }}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {hasGeneratedLists && (
        <Button variant="outline" size="sm" onClick={() => setSaveOpen(true)}>
          <Save className="h-4 w-4 mr-1" /> Save to history
        </Button>
      )}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm">
            <History className="h-4 w-4 mr-1" /> History
          </Button>
        </SheetTrigger>
        <HistorySheet
          open={historyOpen}
          applySnapshot={(s) => {
            applySnapshot(s);
            setHistoryOpen(false);
          }}
        />
      </Sheet>
      <Button variant="outline" size="sm" onClick={() => setResetOpen(true)}>
        <RotateCcw className="h-4 w-4 mr-1" /> New workflow
      </Button>
      <div className="text-xs text-muted-foreground hidden sm:block max-w-[160px] truncate">
        {user.email}
      </div>
      <Button variant="ghost" size="sm" onClick={handleSignOut}>
        <LogOut className="h-4 w-4" />
      </Button>

      <SaveDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        getSnapshot={getSnapshot}
      />
      <ResetDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        hasUnsaved={hasGeneratedLists}
        canSave={true}
        onReset={() => {
          resetWorkflow();
          toast.success("Started a fresh workflow");
          setResetOpen(false);
        }}
        onSaveAndReset={() => {
          setResetOpen(false);
          setSaveOpen(true);
        }}
      />
    </div>
  );
}

function SaveDialog({
  open,
  onOpenChange,
  getSnapshot,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  getSnapshot: () => WorkflowSnapshot;
}) {
  const save = useServerFn(saveWorkflow);
  const qc = useQueryClient();
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) {
      const d = new Date();
      setName(`Workflow — ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const snap = getSnapshot();
      return save({ data: { name: name.trim(), inputs: snap.inputs, lists: snap.lists } });
    },
    onSuccess: () => {
      toast.success("Saved to history");
      qc.invalidateQueries({ queryKey: ["workflowHistory"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Could not save"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save workflow</DialogTitle>
          <DialogDescription>Save the current inputs and generated lists to your history.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="wf-name">Name</Label>
          <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!name.trim() || mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetDialog({
  open,
  onOpenChange,
  hasUnsaved,
  canSave,
  onReset,
  onSaveAndReset,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hasUnsaved: boolean;
  canSave: boolean;
  onReset: () => void;
  onSaveAndReset: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a new workflow?</DialogTitle>
          <DialogDescription>
            This clears your current uploads, preferences, and generated lists. {hasUnsaved && canSave ? "Save first so you don't lose it?" : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {hasUnsaved && canSave && (
            <Button variant="secondary" onClick={onSaveAndReset}>Save first</Button>
          )}
          <Button variant="destructive" onClick={onReset}>Reset</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistorySheet({
  open,
  applySnapshot,
}: {
  open: boolean;
  applySnapshot: (s: WorkflowSnapshot) => void;
}) {
  const list = useServerFn(listWorkflows);
  const get = useServerFn(getWorkflow);
  const rename = useServerFn(renameWorkflow);
  const del = useServerFn(deleteWorkflow);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["workflowHistory"],
    queryFn: () => list(),
    enabled: open,
  });

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function handleLoad(id: string) {
    try {
      const row = await get({ data: { id } });
      const r = row as unknown as { inputs: WorkflowSnapshot["inputs"]; lists: WorkflowSnapshot["lists"] };
      applySnapshot({ inputs: r.inputs, lists: r.lists });
      toast.success("Loaded workflow");
    } catch (e) {
      toast.error((e as Error).message || "Could not load");
    }
  }

  async function handleDelete(id: string) {
    try {
      await del({ data: { id } });
      qc.invalidateQueries({ queryKey: ["workflowHistory"] });
      toast.success("Deleted");
    } catch (e) {
      toast.error((e as Error).message || "Could not delete");
    }
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) return;
    try {
      await rename({ data: { id, name: renameValue.trim() } });
      setRenamingId(null);
      qc.invalidateQueries({ queryKey: ["workflowHistory"] });
      toast.success("Renamed");
    } catch (e) {
      toast.error((e as Error).message || "Could not rename");
    }
  }

  return (
    <SheetContent className="w-full sm:max-w-md overflow-y-auto">
      <SheetHeader>
        <SheetTitle>Your workflow history</SheetTitle>
      </SheetHeader>
      <div className="mt-4 space-y-3">
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {error && <div className="text-sm text-destructive">Failed to load history.</div>}
        {data && data.length === 0 && (
          <div className="text-sm text-muted-foreground">No saved workflows yet. Generate lists and click "Save to history".</div>
        )}
        {data?.map((entry) => (
          <div key={entry.id} className="rounded-md border p-3 space-y-2">
            {renamingId === entry.id ? (
              <div className="flex gap-2">
                <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={200} />
                <Button size="sm" onClick={() => handleRename(entry.id)}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>Cancel</Button>
              </div>
            ) : (
              <>
                <div className="font-medium text-sm">{entry.name}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(entry.created_at).toLocaleString()} · {entry.counts.warmUp}/{entry.counts.transition}/{entry.counts.peak} songs
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" onClick={() => handleLoad(entry.id)}>Load</Button>
                  <Button size="sm" variant="outline" onClick={() => { setRenamingId(entry.id); setRenameValue(entry.name); }}>
                    <Pencil className="h-3 w-3 mr-1" /> Rename
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(entry.id)}>
                    <Trash2 className="h-3 w-3 mr-1" /> Delete
                  </Button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </SheetContent>
  );
}
