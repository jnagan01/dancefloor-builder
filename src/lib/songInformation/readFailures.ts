import type { Entry } from './schema';

export type ReadFailures = { readDeadline:number; readDenied:number; readSchema:number; readOther:number };
export const emptyReadFailures = ():ReadFailures => ({readDeadline:0,readDenied:0,readSchema:0,readOther:0});
/** Only fixed numeric categories escape the adapter; never retain provider text or keys. */
export function readFailure(error:unknown):ReadFailures {
  const c=emptyReadFailures(), e=error as {name?:string;code?:string;status?:number};
  if(e?.name==='AbortError'||e?.name==='TimeoutError'||e?.code==='57014')c.readDeadline=1;
  else if(e?.status===401||e?.status===403||e?.code==='42501'||e?.code==='PGRST301')c.readDenied=1;
  else if(e?.code==='42P01'||e?.code==='42703'||e?.code==='PGRST205'||e?.code==='PGRST204')c.readSchema=1;
  else c.readOther=1;
  return c;
}
export class EvidenceReadError extends Error {
  constructor(readonly entries:Entry[],readonly failures:ReadFailures=emptyReadFailures()) {super('Evidence cache read unavailable');}
}