import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { z } from 'zod';
import { stripArtistFromTitle } from '@/lib/danceFloor';
import { targetsNote } from '@/lib/vibes';
import { eventTypeNote } from '@/lib/eventTypes';

/** Real validator/handler; only framework, authentication transport and AI are synthetic. */
export function recommendHandler(generate: (options: any) => Promise<any>, authenticated = true) {
  const require = createRequire(import.meta.url), ts = require('typescript');
  const module = { exports: {} as any };
  const code = ts.transpileModule(readFileSync('src/lib/recommend.functions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const imports: Record<string, any> = {
    './danceFloor': { stripArtistFromTitle }, './vibes': { targetsNote }, './eventTypes': { eventTypeNote }, zod: { z },
    './ai-gateway.server': { createLovableAiGatewayProvider: () => () => 'synthetic' },
    ai: { generateObject: generate, NoObjectGeneratedError: { isInstance: () => false } },
    '@/integrations/supabase/auth-middleware': { requireSupabaseAuth: async ({ next }: any) => { if (!authenticated) throw new Error('Unauthorized'); return next({ context: { userId: 'synthetic-owner' } }); } },
    '@tanstack/react-start': { createServerFn: () => {
      let validate: any, chain: any[] = [];
      const builder = { middleware: (m: any[]) => { chain = m; return builder; }, inputValidator: (v: any) => { validate = v; return builder; }, handler: (fn: any) => async ({ data }: any) => {
        const invoke = (i: number, context: any): any => i === chain.length ? fn({ data: validate(data), context }) : chain[i]({ next: ({ context: c }: any) => invoke(i + 1, c) });
        return invoke(0, {});
      } }; return builder;
    } },
  };
  vm.runInNewContext(code, { module, exports: module.exports, console, process: { env: { LOVABLE_API_KEY: 'synthetic-not-a-key' } }, require: (k: string) => { if (!(k in imports)) throw new Error('Unexpected test import'); return imports[k]; } });
  return { call: module.exports.recommendSongsForSection, schema: module.exports.RecommendInputSchema };
}