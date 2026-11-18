import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BatchSchema } from '@/lib/generationDiagnostics/schema';

it('actual handler requires authentication, strips private fields and reads secrets only inside the server handler', async () => {
  const require = createRequire(import.meta.url), ts = require('typescript'), module = { exports: {} as any };
  let signedIn = false, sends = 0;
  const imports: Record<string, unknown> = {
    './schema': { BatchSchema },
    './relay.server': { relayDiagnostics: async (data: any, config: any) => {
      sends++; expect(JSON.stringify(data)).not.toContain('PRIVATE');
      expect(config).toEqual({ token: 'synthetic-only-token', host: 'in.logs.betterstack.com' });
      return { accepted: [{ id: data.runs[0].id, revision: 0 }], state: 'sent' };
    } },
    '@/integrations/supabase/auth-middleware': { requireSupabaseAuth: ({ next }: any) => { if (!signedIn) throw Error('Unauthorized'); return next(); } },
    '@tanstack/react-start': { createServerFn: () => {
      let validate: any, middleware: any[] = [];
      const b = { middleware: (m: any[]) => { middleware = m; return b; }, inputValidator: (v: any) => { validate = v; return b; }, handler: (fn: any) => async (input: unknown) => {
        const invoke = (i: number): any => i < middleware.length ? middleware[i]({ next: () => invoke(i + 1) }) : fn({ data: validate(input) }); return invoke(0);
      } }; return b;
    } },
  };
  const code = ts.transpileModule(readFileSync('src/lib/generationDiagnostics/relay.functions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let reads = 0;
  const env = new Proxy({}, { get: (_target, key) => { reads++; return key === 'BETTER_STACK_SOURCE_TOKEN' ? 'synthetic-only-token' : 'in.logs.betterstack.com'; } });
  vm.runInNewContext(code, { module, exports: module.exports, process: { env }, require: (k: string) => { if (!(k in imports)) throw Error('Unexpected import'); return imports[k]; } });
  expect(reads).toBe(0);
  const time = Date.now(), run = { schema: 1, kind: 'synthetic_connection_check', id: '10000000-0000-4000-8000-000000000099', revision: 0, startedAt: time, endedAt: time, version: 'test', build: 'test', status: 'completed', elapsedMs: 0, requested: 0, coverage: [], causes: [], notices: [], accountId: 'PRIVATE', eventName: 'PRIVATE' };
  await expect(module.exports.sendGenerationDiagnostics({ runs: [run] })).rejects.toThrow('Unauthorized'); expect(sends).toBe(0); expect(reads).toBe(0);
  signedIn = true;
  await expect(module.exports.sendGenerationDiagnostics({ runs: Array(6).fill(run) })).rejects.toThrow(); expect(sends).toBe(0);
  expect((await module.exports.sendGenerationDiagnostics({ runs: [run] })).state).toBe('sent'); expect(sends).toBe(1); expect(reads).toBe(2);
});