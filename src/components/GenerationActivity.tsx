import { useEffect, useRef, useState } from 'react';
import { copyPlainText } from '@/lib/copyText';
import { useServerFn } from '@tanstack/react-start';
import { supabase } from '@/integrations/supabase/client';
import { diagnosticStore } from '@/lib/generationDiagnostics/store';
import { sendGenerationDiagnostics } from '@/lib/generationDiagnostics/relay.functions';
import { copyDiagnostics, MESSAGES } from '@/lib/generationDiagnostics/schema';
import { diagnosticVersionLabel } from '@/lib/generationDiagnostics/version';
import { activityDuration } from '@/lib/generationDiagnostics/duration';
import { preparationOutcome, providerCauseMessages } from '@/lib/generationDiagnostics/presentation';
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
  const [open, setOpen] = useState(false), [, refresh] = useState(0), [copy, setCopy] = useState<{ owner: string; status: string; manual: string | null } | null>(null), contentRef = useRef<HTMLDivElement>(null);
  const copySeq = useRef(0), accountRef = useRef(account); accountRef.current = account;
  useEffect(() => diagnosticStore().subscribe(() => refresh(n => n + 1)), []);
  const state = diagnosticStore().get();
  const rows = state.account === account ? state.rows : [];
  // Copy outcomes belong to the account that started them; render only while prop, store and owner all agree.
  const shown = copy && account && copy.owner === account && state.account === account ? copy : null;
  useEffect(() => { copySeq.current++; setCopy(null); }, [account, state.account]);
  return <>
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><History className="size-4" />Recent generation activity</Button>
    <Dialog open={open} onOpenChange={next => { setOpen(next); if (!next) { copySeq.current++; setCopy(null); } }}><DialogContent ref={contentRef} className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>Recent generation activity</DialogTitle><DialogDescription>Recent preparation results on this device.</DialogDescription></DialogHeader>
      {state.memoryOnly && <p role="status" className="text-sm text-destructive">Activity cannot be saved on this device right now. It will be lost when this page closes.</p>}
      {state.malformed && <p role="status" className="text-sm text-muted-foreground">Some older activity could not be read. It has been left unchanged.</p>}
      {!rows.length && <p className="text-sm text-muted-foreground">No recent generation activity.</p>}
      {rows.map(({ run, delivery }) => <details key={run.id} className="border-b border-border py-3">
        <summary className="cursor-pointer text-sm"><span className="font-medium">{statuses[run.status]}</span> · {new Date(run.startedAt).toLocaleString()}<span className="block text-muted-foreground">{delivery === 'sent' ? 'Sent' : delivery === 'not configured' ? 'Not configured' : delivery === 'retry later' ? 'Retry later' : 'Queued'}</span></summary>
        <div className="space-y-2 pt-3 text-sm">
          <p className="break-all text-muted-foreground">{diagnosticVersionLabel(run.version)} · Web build {run.build}</p>
          <p>{run.requested} requests · {activityDuration(run.elapsedMs / 1000)} elapsed</p>
          <p>{preparationOutcome(run)}</p>
          {run.coverage.filter(s => s.targetSeconds > 0).map(s => <p key={s.section}>{names[s.section]}: {activityDuration(s.achievedSeconds)} / {activityDuration(s.targetSeconds)}</p>)}
          {providerCauseMessages(run.causes).map((message, i) => <p key={`cause-${i}`}>{message}</p>)}
          {run.notices.map((n, i) => <p key={i}>{MESSAGES[n.code]} {n.count > 1 ? `(${n.count})` : ''}</p>)}
          <Button variant="outline" size="sm" onClick={async () => {
            const owner = account, seq = ++copySeq.current;
            setCopy(null);
            if (!owner || diagnosticStore().get().account !== owner) return;
            const text = copyDiagnostics(run);
            const copied = await copyPlainText(text, contentRef.current);
            if (seq !== copySeq.current || accountRef.current !== owner || diagnosticStore().get().account !== owner) return;
            setCopy({ owner, status: copied ? 'Diagnostics copied' : 'Copy unavailable. Select the text below and copy it.', manual: copied ? null : text });
          }}><Copy className="size-4" />Copy diagnostics</Button>
        </div>
      </details>)}
      <p role="status" className="text-sm text-muted-foreground">{shown?.status ?? ''}</p>
      {shown?.manual != null && <textarea aria-label="Diagnostics text" readOnly value={shown.manual} onFocus={e => e.currentTarget.select()} className="h-40 w-full rounded-md border border-border bg-muted p-2 font-mono text-xs text-foreground" />}
    </DialogContent></Dialog>
  </>;
}