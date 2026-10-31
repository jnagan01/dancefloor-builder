import { validateBackup, type Backup } from './backups';
import { storeEventDraft, loadEventDraft, pendingRecoveryEvent } from './eventDrafts';
import { recoveryFromBackup } from './backups';
type Bridge = { save(raw: string, account: string): Promise<{ok:boolean;error?:string}>; latest(account: string): Promise<{ok:boolean;raw?:string;error?:string}> };
function bridge(): Bridge | undefined { return typeof window === 'undefined' ? undefined : (window as unknown as {electronBackups?:Bridge}).electronBackups; }
const key=(account:string)=>`setarchitect:backups:${encodeURIComponent(account)}`;
export async function saveBackup(backup: Backup) {
  const raw=JSON.stringify(backup); validateBackup(raw,backup.account);
  const native=bridge();
  if(native){const result=await native.save(raw,backup.account);if(!result.ok)throw Error(result.error??'Backup failed. Operation stopped.');return;}
  // One atomic localStorage record; failure leaves the last-good history intact.
  const previous=localStorage.getItem(key(backup.account));
  const history=previous===null?[]:JSON.parse(previous);
  if(!Array.isArray(history))throw Error('Backup history is unreadable; original preserved.');
  history.forEach(v=>validateBackup(v,backup.account));
  localStorage.setItem(key(backup.account),JSON.stringify([...history,raw].slice(-5)));
}
export async function latestBackup(account:string):Promise<Backup|null>{
  const native=bridge();if(native){const result=await native.latest(account);if(!result.ok)throw Error(result.error??'Backup unavailable.');return result.raw?validateBackup(result.raw,account):null;}
  const raw=localStorage.getItem(key(account));if(raw===null)return null;
  const history=JSON.parse(raw);if(!Array.isArray(history))throw Error('Backup history unreadable; original preserved.');
  return history.length?validateBackup(history.at(-1),account):null;
}
export function queueBackupEvent(backup:Backup,id:string){
  const draft=recoveryFromBackup(backup,id);
  // Read through the durable native journal too. Unreadable bytes throw without writes.
  if(loadEventDraft(backup.account,'new') || loadEventDraft(backup.account,pendingRecoveryEvent('new')))
    throw Error('An unsaved new event already has a recovery copy. Resolve it first.');
  storeEventDraft(draft);return draft;
}
export function backupBridgeAvailable(){return !!bridge();}
