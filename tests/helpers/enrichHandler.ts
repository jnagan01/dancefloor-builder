import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { z } from 'zod';
import { runEnrichment, type EnrichDeps } from '@/lib/enrichPipeline.server';

/** Actual authenticated RPC validator/handler, real pipeline, isolated storage/provider transport only. */
export function enrichHandler(storage: EnrichDeps, pipeline = runEnrichment) {
  const require = createRequire(import.meta.url), ts = require('typescript'), module = { exports: {} as any };
  const code = ts.transpileModule(readFileSync('src/lib/enrich.functions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const imports: Record<string, unknown> = {
    zod: { z }, './enrichPipeline.server': { runEnrichment: pipeline }, './enrichCache.server': { createEnrichCache: () => storage },
    '@/integrations/supabase/auth-middleware': { requireSupabaseAuth: ({ next }: any) => next({ context: { userId: 'synthetic-owner' } }) },
    '@tanstack/react-start': { createServerFn: () => {
      let validate: any, chain: any[] = [];
      const b = { middleware: (m: any[]) => { chain = m; return b; }, inputValidator: (v: any) => { validate = v; return b; }, handler: (fn: any) => async (data: unknown) => {
        const invoke = (i: number, context: any): any => i === chain.length ? fn({ data: validate(data), context }) : chain[i]({ next: ({ context: c }: any) => invoke(i + 1, c) });
        return invoke(0, {});
      } }; return b;
    } },
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: (k: string) => { if (!(k in imports)) throw Error(`Unexpected synthetic import ${k}`); return imports[k]; } });
  return module.exports.enrichSongs as (data: unknown) => ReturnType<typeof runEnrichment>;
}