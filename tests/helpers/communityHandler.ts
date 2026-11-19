import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { z } from 'zod';
import * as evidence from '@/lib/prep/communityEvidence';
import * as reuse from '@/lib/songInformation/reuse';
import * as schema from '@/lib/songInformation/schema';
import * as lastfm from '@/lib/songInformation/lastfm.server';
import type { EvidenceStorage } from '@/lib/songInformation/cache.server';

/** Real community validator/handler and workers; only auth and storage/provider transports are synthetic. */
export function communityHandler(storage: EvidenceStorage, fetcher: typeof fetch, authenticated = true) {
  const ts = createRequire(import.meta.url)('typescript'), module = { exports: {} as any };
  const auth = ({ next }: any) => { if (!authenticated) throw Error('Unauthorized'); return next({ context: { userId: 'synthetic-owner' } }); };
  const imports: Record<string, unknown> = {
    zod: { z }, './communityEvidence': evidence,
    '../songInformation/schema': schema, '../songInformation/reuse': reuse,
    '../songInformation/lastfm.server': lastfm,
    '../songInformation/cache.server': { createEvidenceStorage: () => storage },
    '@/integrations/supabase/auth-middleware': { requireSupabaseAuth: auth },
    '@tanstack/react-start': { createServerFn: () => {
      let validate: any, chain: any[] = [];
      const b = { middleware: (m: any[]) => { chain = m; return b; }, inputValidator: (v: any) => { validate = v; return b; }, handler: (fn: any) => async (data: unknown) => {
        const invoke = (i: number, context: any): any => i === chain.length ? fn({ data: validate(data), context }) : chain[i]({ next: ({ context: c }: any) => invoke(i + 1, c) });
        return invoke(0, {});
      } }; return b;
    } },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/prep/community.functions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, require: (k: string) => { if (!(k in imports)) throw Error(`Unexpected synthetic import ${k}`); return imports[k]; },
    URL, AbortController, AbortSignal, get Date() { return Date; }, get setTimeout() { return setTimeout; }, get clearTimeout() { return clearTimeout; },
    process: { env: { LASTFM_API_KEY: 'synthetic-only' } }, fetch: fetcher,
  });
  return module.exports.lookupCommunityBatch as (data: unknown) => Promise<import('@/lib/prep/community.functions').CommunityRow[]>;
}