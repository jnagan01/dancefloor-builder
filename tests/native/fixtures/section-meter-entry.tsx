// Isolated rendered model fixture; no account, network, event persistence or audio.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SectionMeterDialog } from '../../../src/components/builder/SectionMeterDialog';
import { AppearanceProvider, useAppearance } from '../../../src/components/AppearanceProvider';
import { createSectionMeterProgress } from '../../../src/lib/sectionMeterProgress';
import { Button } from '../../../src/components/ui/button';
const progress = createSectionMeterProgress();
const w = window as any; w.__meter = progress;
let id=0;
function Fixture() {
 const {setAppearance}=useAppearance();
 return <main className="min-h-dvh bg-background p-8 text-foreground"><h1 className="font-display text-3xl">Synthetic event builder</h1><div className="mt-6 flex flex-wrap gap-3">
 <Button onClick={()=>progress.begin({id:++id,owner:'synthetic',event:'A',type:'dance',expand:true,targets:{warmUp:5400,transition:14400,peak:7200}})}>Start generation</Button>
 {(['light','dark','system'] as const).map(t=><Button key={t} variant="outline" onClick={()=>setAppearance(t)}>{t}</Button>)}</div>
 <div className="mt-8 grid grid-cols-3 gap-4">{['Warm Up','Transition','Peak'].map(t=><section key={t} className="border-t border-border py-4"><h2 className="font-display text-xl">{t}</h2>{Array.from({length:9},(_,i)=><p key={i} className="border-b border-border py-4 text-muted-foreground">Synthetic track {i+1}</p>)}</section>)}</div>
 <SectionMeterDialog progress={progress}/></main>;
}
createRoot(document.getElementById('root') as HTMLElement).render(<AppearanceProvider><Fixture/></AppearanceProvider>);