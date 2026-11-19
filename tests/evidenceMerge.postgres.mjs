// Isolated PostgreSQL execution of the actual migration trigger, never a hosted database.
import { mkdtempSync, readFileSync, rmSync, chownSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'evidence-merge-'));
const root=process.getuid?.()===0;
if(root)chownSync(dir,1000,1000);
const run=(cmd,args)=>execFileSync(root?'setpriv':cmd,root?['--reuid=1000','--regid=1000','--clear-groups',cmd,...args]:args,{encoding:'utf8',env:{...process.env,PGUSER:root?'lovable':process.env.USER}});
const sql=query=>run('psql',['-h',dir,'-p','55439','-d','postgres','-v','ON_ERROR_STOP=1','-At','-c',query]);
try {
 run('initdb',['-D',join(dir,'data'),'-A','trust','--no-locale']);
 run('pg_ctl',['-D',join(dir,'data'),'-l',join(dir,'server.log'),'-o',`-k ${dir} -p 55439 -h ''`,'-w','start']);
 sql('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.track_evidence_cache(cache_key text PRIMARY KEY,kind text,value jsonb,fetched_at timestamptz);');
 sql(readFileSync('drizzle/migrations/0004_align_evidence_provenance_order.sql','utf8'));
 sql('CREATE TRIGGER preserve_track_evidence BEFORE UPDATE ON public.track_evidence_cache FOR EACH ROW EXECUTE FUNCTION public.merge_track_evidence_update();');
 const ranks={user:12,measured:10,tags:8,virtualdj:8,provider:6,catalogue:4,ai:3,estimate:2,filename:1,unknown:0};
 let checks=0;
 for(const [old,rank] of Object.entries(ranks))for(const [next,nrank] of Object.entries(ranks)){
  const value=(source,n,date)=>JSON.stringify({energy:n,prov:{energy:source},updated:{energy:date},checked:{energy:date+50}});
  sql(`TRUNCATE public.track_evidence_cache; INSERT INTO public.track_evidence_cache VALUES('synthetic','metadata','${value(old,7,100)}',now()); UPDATE public.track_evidence_cache SET value='${value(next,8,200)}';`);
  const out=JSON.parse(sql("SELECT value FROM public.track_evidence_cache WHERE cache_key='synthetic'"));
  assert.equal(out.energy,nrank>=rank?8:7);assert.equal(out.updated.energy,nrank>=rank?200:100);assert.equal(out.checked.energy,nrank>=rank?250:150);checks++;
 }
 sql(`UPDATE public.track_evidence_cache SET value='{"energy":8,"prov":{"energy":"user"},"updated":{"energy":300},"checked":{"energy":400}}'; UPDATE public.track_evidence_cache SET value='{"energy":8,"prov":{"energy":"user"},"updated":{"energy":500},"checked":{"energy":600}}';`);
 const same=JSON.parse(sql('SELECT value FROM public.track_evidence_cache'));assert.equal(same.updated.energy,300);assert.equal(same.checked.energy,600);
 const asyncSql=async query=>{
  const args=['-h',dir,'-p','55439','-d','postgres','-v','ON_ERROR_STOP=1','-At','-c',query];
  await promisify(execFile)(root?'setpriv':'psql',root?['--reuid=1000','--regid=1000','--clear-groups','psql',...args]:args,{env:{...process.env,PGUSER:root?'lovable':process.env.USER}});
 };
 sql('TRUNCATE public.track_evidence_cache; INSERT INTO public.track_evidence_cache VALUES(\'synthetic\',\'metadata\',\'{"energy":1,"prov":{"energy":"unknown"}}\',now());');
 await Promise.all([
  asyncSql('BEGIN; UPDATE public.track_evidence_cache SET value=\'{"energy":9,"prov":{"energy":"measured"},"updated":{"energy":100},"checked":{"energy":200}}\'; SELECT pg_sleep(.1); COMMIT;'),
  asyncSql('BEGIN; UPDATE public.track_evidence_cache SET value=\'{"energy":4,"prov":{"energy":"catalogue"},"updated":{"energy":300},"checked":{"energy":400}}\'; COMMIT;'),
 ]);
 const concurrent=JSON.parse(sql('SELECT value FROM public.track_evidence_cache'));assert.equal(concurrent.energy,9);assert.equal(concurrent.updated.energy,100);assert.equal(concurrent.checked.energy,200);
 console.log(`${checks+2} actual SQL merge cases passed, including concurrent writers; isolated temporary database only.`);
} finally {
 try{run('pg_ctl',['-D',join(dir,'data'),'-m','immediate','-w','stop']);}catch{}
 rmSync(dir,{recursive:true,force:true});
}