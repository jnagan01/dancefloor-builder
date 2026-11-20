import { useEffect, useRef, useState, type HTMLAttributes } from 'react';
import * as Primitive from '@radix-ui/react-dialog';
import { AudioLines, Check, Clock3, Eye, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { meterMinutes, type MeterKey, type SectionMeterProgress } from '@/lib/sectionMeterProgress';

const keys: MeterKey[] = ['warmUp', 'transition', 'peak'];
const labels = { warmUp: 'Warm Up', transition: 'Transition', peak: 'Peak' };
const heights = Array.from({ length: 100 }, (_, i) => 7 + ((i * 13 + Math.floor(i / 7) * 11) % 23));
export function SectionMeterDialog({ progress, focusFallback }: { progress: SectionMeterProgress; focusFallback?: () => HTMLElement | null }) {
  const [run, setRun] = useState(progress.get);
  const [clock, setClock] = useState(Date.now);
  const returnFocus = useRef<{ id: number; target: HTMLElement | null } | null>(null);
  const show = useRef<HTMLButtonElement>(null);
  const showFocused = useRef(false);
  const mounted = useRef(false);
  const fallback = useRef(focusFallback); fallback.current = focusFallback;
  const usable = (target: HTMLElement | null | undefined): target is HTMLElement => !!target && target !== document.body && target.isConnected && target.getClientRects().length > 0 && !target.matches(':disabled,[aria-disabled="true"]');
  const restore = () => {
    const original = returnFocus.current?.target;
    const target = usable(original) ? original : fallback.current?.();
    if (usable(target)) target.focus();
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => progress.subscribe(() => setRun(progress.get())), [progress]);
  useEffect(() => {
    // A hidden run can finish without a Radix close event. Its focused Show control
    // disappears; return to the current route action, not the removed node/body.
    if ((!run || (run.finished && !run.open)) && showFocused.current && progress.get() === run) {
      showFocused.current = false;
      if (document.activeElement === document.body || document.activeElement === show.current) restore();
    }
  }, [run]);
  useEffect(() => {
    if (!run?.open || run.finished) return;
    setClock(Date.now()); const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run?.id, run?.open, run?.finished]);
  useEffect(() => {
    if (!run?.finished) return;
    setClock(Date.now());
    const id = run.id, timer = setTimeout(() => progress.release(id), 1800);
    return () => clearTimeout(timer);
  }, [run?.id, run?.finished, progress]);
  if (!run) return null;
  const elapsed = Math.max(0, Math.floor((clock - run.started) / 1000));
  return <>
    {!run.open && !run.finished && <Button ref={show} variant="ghost" size="sm" className="min-h-11 text-muted-foreground" onFocus={() => { showFocused.current = true; }} onBlur={() => { showFocused.current = false; }} onClick={() => progress.visible(run.id, true)}><Eye aria-hidden="true" className="size-4" />Show progress</Button>}
    <Primitive.Root open={run.open} onOpenChange={open => progress.visible(run.id, open)}>
      <Primitive.Portal>
        <Primitive.Overlay className="fixed inset-0 z-50 bg-media-overlay/60 backdrop-blur-[2px]" />
        <Primitive.Content className="section-meter-dialog fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-[680px] max-h-[calc(100dvh_-_2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-input bg-popover p-5 text-popover-foreground shadow-lg sm:p-8"
          onOpenAutoFocus={() => {
            if (returnFocus.current?.id === run.id) return;
            const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            returnFocus.current = { id: run.id, target: active !== show.current && usable(active) ? active : null };
          }}
          onCloseAutoFocus={e => {
            e.preventDefault();
            const current = progress.get();
            if (!mounted.current || (current && (current.id !== run.id || current.owner !== run.owner || current.event !== run.event || current.open))) return;
            if (usable(show.current)) show.current.focus(); else restore();
          }}>
          <Primitive.Close asChild><Button variant="ghost" size="icon" aria-label="Hide progress window" className="absolute right-2 top-2 min-h-11 min-w-11"><X aria-hidden="true" className="size-4" /></Button></Primitive.Close>
          <div className="mb-5 text-center">
            <div className="mb-4 flex items-center justify-center gap-3 text-xs font-semibold uppercase tracking-widest"><AudioLines aria-hidden="true" className="size-6 text-gold" />Set Architect</div>
            <Primitive.Title className="font-display text-2xl font-semibold sm:text-3xl">Building your lists</Primitive.Title>
            <Primitive.Description className="mt-2 text-sm text-muted-foreground sm:text-base">{run.expand ? 'Filling your preparation time' : 'Organizing your client tracks'}</Primitive.Description>
          </div>
          <div className="space-y-3">
            {keys.filter(k => run.targets[k] > 0).map(k => {
              const actual = Math.max(0, run.totals[k]), target = run.targets[k], ratio = Math.min(1, actual / target);
              // A shortage must never look complete, even when it rounds visually to the end.
              const fill = actual >= target ? 1 : Math.min(0.985, ratio);
              const label = k === 'warmUp' && run.type !== 'dance' ? run.type === 'dinner' ? 'Dinner' : 'Cocktail Hour' : labels[k];
              return <section key={`${run.id}:${k}`} className="rounded-xl border border-input bg-surface/40 px-4 py-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"><h2 className="min-w-0 font-display text-lg font-semibold">{label}</h2><div className="flex shrink-0 items-center gap-2 text-sm tabular-nums"><span>{meterMinutes(actual)} / {meterMinutes(target)} min</span>{actual >= target && <Check aria-label={`${label} target reached`} className="size-5 text-success" />}</div></div>
                <div role="progressbar" aria-label={`${label} usable preparation time`} aria-valuemin={0} aria-valuemax={Math.max(target, actual)} aria-valuenow={actual} aria-valuetext={`${meterMinutes(actual)} usable minutes of ${meterMinutes(target)} selected minutes`} className="relative mt-3 h-9">
                  <MeterBars bar="bg-muted-foreground opacity-35" />
                  {/* Gold copy revealed by a CSS transition between measured updates; nothing advances it on a timer. */}
                  <MeterBars data-meter-fill={fill} className="meter-fill" bar="bg-gold" style={{ clipPath: `inset(0 ${100 - fill * 100}% 0 0)` }} />
                  {!run.finished && <span aria-hidden="true" data-meter-leading style={{ left: `${fill * 100}%`, opacity: fill > 0 && fill < 1 ? undefined : 0 }} className="meter-leading absolute top-1 h-7 w-1 -translate-x-1/2 rounded-full bg-gold-soft" />}
                </div>
              </section>;
            })}
          </div>
          <p role="status" aria-live="polite" className="my-5 flex items-center justify-center gap-3 text-center text-sm"><AudioLines aria-hidden="true" className="size-5 shrink-0 text-gold" />{run.stage}</p>
          <footer className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border pt-3 text-xs sm:grid-cols-[auto_1fr_auto]">
            <span className="flex items-center gap-2 tabular-nums"><Clock3 aria-hidden="true" className="size-3.5" />Elapsed {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
            <span className="col-span-2 row-start-2 text-muted-foreground sm:col-span-1 sm:row-start-auto sm:text-center">Closes automatically when ready</span>
            <Primitive.Close asChild><Button variant="link" size="sm" className="min-h-11 p-0 text-gold">Hide window</Button></Primitive.Close>
          </footer>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  </>;
}
function MeterBars({ bar, className = '', ...props }: HTMLAttributes<HTMLDivElement> & { bar: string; 'data-meter-fill'?: number }) {
  return <div aria-hidden="true" {...props} className={`meter-bars absolute inset-0 flex items-center gap-px overflow-hidden sm:gap-[3px] ${className}`}>
    {heights.map((height, i) => <span key={i} style={{ height }} className={`min-w-0 flex-1 rounded-full ${bar}`} />)}
  </div>;
}
