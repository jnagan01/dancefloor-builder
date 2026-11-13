import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { z } from 'zod';
import { stripArtistFromTitle } from '@/lib/danceFloor';
import { targetsNote } from '@/lib/vibes';
import { eventTypeNote } from '@/lib/eventTypes';
import * as lanes from '@/lib/prep/suggestionLanes';

/**
 * Synthetic AI SDK `streamObject` backed by `generate(options)`. `generate` may return
 * `{ object }` (all items at once when it resolves) or `{ stream, stepMs }` (one complete item every stepMs,
 * honouring the server's abort signal) so deadline-bounded partial retention is exercised for real.
 */
function syntheticStreamObject(generate: (options: any) => Promise<any>, finishReason: Promise<string>) {
  return (options: any) => {
    let resolveObject!: (v: any) => void, rejectObject!: (e: unknown) => void;
    const object = new Promise((res, rej) => { resolveObject = res; rejectObject = rej; }); object.catch(() => {});
    const run = Promise.resolve().then(() => generate(options));
    async function* partials() {
      let out: any;
      try { out = await run; } catch (error) { options.onError?.({ error }); rejectObject(error); return; }
      if (Array.isArray(out?.stream)) {
        const acc: any[] = [];
        for (const item of out.stream) {
          await new Promise(r => setTimeout(r, out.stepMs ?? 0));
          if (options.abortSignal?.aborted) { rejectObject(new Error('aborted')); return; }
          acc.push(item); yield { suggestions: acc.slice() };
        }
        resolveObject({ suggestions: acc }); return;
      }
      yield out.object; resolveObject(out.object);
    }
    return { partialObjectStream: partials(), object, finishReason };
  };
}

/** Real validator/handler; only framework, authentication transport and AI are synthetic. */
export function recommendHandler(generate: (options: any) => Promise<any>, authenticated = true, finishReason = Promise.resolve('stop')) {
  const require = createRequire(import.meta.url), ts = require('typescript');
  const module = { exports: {} as any };
  const code = ts.transpileModule(readFileSync('src/lib/recommend.functions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const imports: Record<string, any> = {
    './danceFloor': { stripArtistFromTitle }, './vibes': { targetsNote }, './eventTypes': { eventTypeNote }, zod: { z }, './prep/suggestionLanes': lanes,
    './ai-gateway.server': { createLovableAiGatewayProvider: () => () => 'synthetic' },
    ai: { streamObject: syntheticStreamObject(generate, finishReason), NoObjectGeneratedError: { isInstance: () => false } },
    '@/integrations/supabase/auth-middleware': { requireSupabaseAuth: async ({ next }: any) => { if (!authenticated) throw new Error('Unauthorized'); return next({ context: { userId: 'synthetic-owner' } }); } },
    '@tanstack/react-start': { createServerFn: () => {
      let validate: any, chain: any[] = [];
      const builder = { middleware: (m: any[]) => { chain = m; return builder; }, inputValidator: (v: any) => { validate = v; return builder; }, handler: (fn: any) => async ({ data }: any) => {
        const invoke = (i: number, context: any): any => i === chain.length ? fn({ data: validate(data), context }) : chain[i]({ next: ({ context: c }: any) => invoke(i + 1, c) });
        return invoke(0, {});
      } }; return builder;
    } },
  };
  vm.runInNewContext(code, { module, exports: module.exports, console, get setTimeout() { return setTimeout; }, get clearTimeout() { return clearTimeout; }, AbortController, process: { env: { LOVABLE_API_KEY: 'synthetic-not-a-key' } }, require: (k: string) => { if (!(k in imports)) throw new Error('Unexpected test import'); return imports[k]; } });
  return { call: module.exports.recommendSongsForSection, schema: module.exports.RecommendInputSchema };
}