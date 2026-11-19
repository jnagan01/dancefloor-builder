// Isolated PostgreSQL execution of the actual migration trigger, never a hosted database.
import { mkdtempSync, readFileSync, rmSync, chownSync, readdirSync } from 'node:fs';
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
 // Every migration from the provenance alignment onward, in journal order (later ones replace the trigger function).
 for(const f of readdirSync('drizzle/migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&Number(f.slice(0,4))>=4).sort())sql(readFileSync(join('drizzle/migrations',f),'utf8'));
 sql('CREATE TRIGGER preserve_track_evidence BEFORE UPDATE ON public.track_evidence_cache FOR EACH ROW EXECUTE FUNCTION public.merge_track_evidence_update();');
 const rankSource=readFileSync('src/lib/prep/provenance.ts','utf8').match(/const RANK: Record<string, number> = \{([^}]+)\}/);
 assert.ok(rankSource,'Authoritative source ranks must be readable');
 const ranks=Object.fromEntries(rankSource[1].split(',').map(pair=>{const [source,rank]=pair.trim().split(':');return [source.trim(),Number(rank)*2];}));
 assert.equal(ranks.filename,2);assert.equal(ranks.filename,ranks.estimate);
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
 // Definitive-miss cooldowns: max(old,new) per field, independent of value/checked dates and arrival order.
 const H=3600000, now=Date.now();
 sql(`TRUNCATE public.track_evidence_cache; INSERT INTO public.track_evidence_cache VALUES('synthetic','metadata','{"energy":5,"prov":{"energy":"ai"},"checked":{"energy":100},"updated":{"energy":100}}',now());`);
 // Newer write records a valid 24-hour cooldown for year (and energy) ...
 sql(`UPDATE public.track_evidence_cache SET value='{"energy":5,"prov":{"energy":"ai"},"checked":{"energy":100},"updated":{"energy":100},"missed":{"year":${now},"energy":${now}}}'`);
 // ... then an older, out-of-order partial write (no missed / older missed) must not remove or lower it.
 await Promise.all([
  asyncSql(`BEGIN; UPDATE public.track_evidence_cache SET value='{"energy":6,"prov":{"energy":"ai"},"checked":{"energy":50},"updated":{"energy":50}}'; SELECT pg_sleep(.1); COMMIT;`),
  asyncSql(`BEGIN; UPDATE public.track_evidence_cache SET value='{"danceability":7,"prov":{"danceability":"provider"},"checked":{"danceability":200},"updated":{"danceability":200},"missed":{"year":${now-20*H},"bpm":${now-H}}}'; COMMIT;`),
 ]);
 const cool=JSON.parse(sql('SELECT value FROM public.track_evidence_cache'));
 assert.equal(cool.missed.year,now);assert.equal(cool.missed.energy,now);assert.equal(cool.missed.bpm,now-H);
 assert.equal(cool.energy,5);assert.equal(cool.checked.energy,100);assert.equal(cool.updated.energy,100);assert.equal(cool.danceability,7);
 // A transient failure writes no missed date: it never acquires a cooldown, and a row with none keeps none.
 sql(`TRUNCATE public.track_evidence_cache; INSERT INTO public.track_evidence_cache VALUES('synthetic','metadata','{"energy":5,"prov":{"energy":"ai"},"checked":{"energy":100}}',now()); UPDATE public.track_evidence_cache SET value='{"energy":5,"prov":{"energy":"ai"},"checked":{"energy":300}}';`);
 const transient=JSON.parse(sql('SELECT value FROM public.track_evidence_cache'));assert.equal(transient.missed,undefined);assert.equal(transient.checked.energy,300);
 // Malformed incoming miss dates are ignored rather than replacing a valid one.
 sql(`UPDATE public.track_evidence_cache SET value='{"energy":5,"missed":{"year":${now}}}'; UPDATE public.track_evidence_cache SET value='{"energy":5,"missed":{"year":"soon"}}';`);
 assert.equal(JSON.parse(sql('SELECT value FROM public.track_evidence_cache')).missed.year,now);
 checks+=3;
 console.log(`${checks+2} actual SQL merge cases passed, including concurrent writers; isolated temporary database only.`);
} finally {
 try{run('pg_ctl',['-D',join(dir,'data'),'-m','immediate','-w','stop']);}catch{}
 rmSync(dir,{recursive:true,force:true});
}