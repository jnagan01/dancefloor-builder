import { useEffect, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { supabase } from '@/integrations/supabase/client';
import { diagnosticStore } from '@/lib/generationDiagnostics/store';
import { sendGenerationDiagnostics } from '@/lib/generationDiagnostics/relay.functions';
import { copyDiagnostics, MESSAGES } from '@/lib/generationDiagnostics/schema';
import { diagnosticVersionLabel } from '@/lib/generationDiagnostics/version';
import { activityDuration } from '@/lib/generationDiagnostics/duration';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { History, Copy } from 'lucide-react';

/** App-wide delivery survives page navigation; no event/library store dependencies. */
export function GenerationDiagnosticDelivery() {
  const send = useServerFn(sendGenerationDiagnostics);
  useEffect(() => {
    const store = diagnosticStore(); let disposed = false, transition = 0;
    store.setSender(runs => send({ data: { runs } }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { transition++; void store.activate(session?.user.id ?? null); });
    const observed = transition;
    void supabase.auth.getSession().then(({ data }) => { if (!disposed && transition === observed) void store.activate(data.session?.user.id ?? null); }).catch(() => {});
    const flush = () => { if (navigator.onLine) void store.flush(); };
    const timer = setInterval(flush, 60_000);
    window.addEventListener('online', flush);
    return () => { disposed = true; data.subscription.unsubscribe(); clearInterval(timer); window.removeEventListener('online', flush); store.setSender(undefined); void store.activate(null); };
  }, [send]);
  return null;
}

const names = { warmUp: 'Warm Up', transition: 'Transition', peak: 'Peak' };
const statuses = { running: 'Running', completed: 'Completed', warnings: 'Completed with warnings', short: 'Preparation short', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' };
export function GenerationActivity({ account }: { account: string | null }) {
  const [open, setOpen] = useState(false), [, refresh] = useState(0), [copyState, setCopyState] = useState('');
  useEffect(() => diagnosticStore().subscribe(() => refresh(n => n + 1)), []);
  const state = diagnosticStore().get();
  const rows = state.account === account ? state.rows : [];
  return <>
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><History className="size-4" />Recent generation activity</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>Recent generation activity</DialogTitle><DialogDescription>Recent preparation results on this device.</DialogDescription></DialogHeader>
      {state.memoryOnly && <p role="status" className="text-sm text-destructive">Activity cannot be saved on this device right now. It will be lost when this page closes.</p>}
      {state.malformed && <p role="status" className="text-sm text-muted-foreground">Some older activity could not be read. It has been left unchanged.</p>}
      {!rows.length && <p className="text-sm text-muted-foreground">No recent generation activity.</p>}
      {rows.map(({ run, delivery }) => <details key={run.id} className="border-b border-border py-3">
        <summary className="cursor-pointer text-sm"><span className="font-medium">{statuses[run.status]}</span> · {new Date(run.startedAt).toLocaleString()}<span className="block text-muted-foreground">{delivery === 'sent' ? 'Sent' : delivery === 'not configured' ? 'Not configured' : delivery === 'retry later' ? 'Retry later' : 'Queued'}</span></summary>
        <div className="space-y-2 pt-3 text-sm">
          <p className="break-all text-muted-foreground">{diagnosticVersionLabel(run.version)} · Web build {run.build}</p>
          <p>{run.requested} requests · {activityDuration(run.elapsedMs / 1000)} elapsed</p>
          {run.coverage.filter(s => s.targetSeconds > 0).map(s => <p key={s.section}>{names[s.section]}: {activityDuration(s.achievedSeconds)} / {activityDuration(s.targetSeconds)}</p>)}
          {run.notices.map((n, i) => <p key={i}>{MESSAGES[n.code]} {n.count > 1 ? `(${n.count})` : ''}</p>)}
          <Button variant="outline" size="sm" onClick={async () => {
            setCopyState('');
            try { await navigator.clipboard.writeText(copyDiagnostics(run)); if (diagnosticStore().get().account === account) setCopyState('Diagnostics copied'); }
            catch { if (diagnosticStore().get().account === account) setCopyState('Copy unavailable. Please try again.'); }
          }}><Copy className="size-4" />Copy diagnostics</Button>
        </div>
      </details>)}
      <p role="status" className="text-sm text-muted-foreground">{copyState}</p>
    </DialogContent></Dialog>
  </>;
}