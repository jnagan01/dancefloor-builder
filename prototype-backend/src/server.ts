import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { adminClient, userClient, PROJECT, PROJECT_URL } from './db';
import { secretMatches, validTestUser, assertSyntheticSave, assertTestLookup, TEST_EMAILS } from './guards.mjs';
import { handlers } from './handlers';
import { runSyncRequest } from './sync';
const configurationReady = () => process.env.APP_ENV === 'prototype-test' && process.env.SUPABASE_URL === PROJECT_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.SUPABASE_PUBLISHABLE_KEY && (process.env.PROTOTYPE_PAIRING_TOKEN?.length ?? 0) >= 40 && (process.env.TEST_LOGIN_PASSWORD?.length ?? 0) >= 40;
// Avoid upstream SDK error objects, prompts, query strings, and credentials in logs.
console.error = () => console.info(JSON.stringify({ level: 'error', code: 'upstream-service-error' }));
console.warn = () => console.info(JSON.stringify({ level: 'warning', code: 'upstream-service-warning' }));
let initialization: Promise<void> | undefined;
async function initialize() {
  if (!configurationReady()) throw Error('Test service setup is incomplete.');
  return initialization ??= (async () => {
    const admin = adminClient();
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 50 });
    if (error) throw Error('Test account setup failed.');
    for (const email of TEST_EMAILS) {
      const existing = data.users.find(u => u.email === email);
      if (existing) { if (!validTestUser(existing)) throw Error('Test identity mismatch.'); continue; }
      const created = await admin.auth.admin.createUser({ email, password: process.env.TEST_LOGIN_PASSWORD!, email_confirm: true, app_metadata: { setarchitect_environment: 'prototype-test' } });
      if (created.error) throw Error('Test identity creation failed.');
    }
  })().catch(error => { initialization = undefined; throw error; });
}
const inflight = new Map<string, number>(), calls = new Map<string, { at: number; count: number }>();
function json(res: http.ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value));
}
async function readBody(req: http.IncomingMessage) {
  let length = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { length += chunk.length; if (length > 1024 * 1024) throw Error('Payload exceeds test limit.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
const server = http.createServer(async (req, res) => {
  const id = randomUUID(), started = Date.now(), url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { service: 'setarchitect-prototype-backend', environment: 'prototype-test', schema: 1, sync: 1, project: PROJECT, configured: configurationReady(), providers: { gemini: !!process.env.GEMINI_API_KEY, lastfm: !!process.env.LASTFM_API_KEY, musicbrainz: true, reccobeats: true } });
  if (!configurationReady()) return json(res, 503, { error: 'Test backend is awaiting secure configuration.', requestId: id });
  let owner: string | undefined;
  let counted = false;
  try {
    if (req.method === 'POST' && url.pathname === '/v1/session') {
      if (!secretMatches(req.headers['x-prototype-pairing'], process.env.PROTOTYPE_PAIRING_TOKEN)) return json(res, 401, { error: 'Test pairing required.' });
      const body = await readBody(req); if (!['a', 'b'].includes(body.actor ?? 'a')) return json(res, 400, { error: 'Unknown test actor.' });
      await initialize();
      const auth = userClient('');
      const { data, error } = await auth.auth.signInWithPassword({ email: TEST_EMAILS[body.actor === 'b' ? 1 : 0], password: process.env.TEST_LOGIN_PASSWORD! });
      if (error || !data.session || !validTestUser(data.user)) throw Error('Synthetic sign-in failed.');
      return json(res, 200, { accessToken: data.session.access_token, expiresAt: data.session.expires_at, userId: data.user.id, ...(body.purpose === 'native-account-sync-v1' ? { refreshToken:data.session.refresh_token, user:{id:data.user.id,email:data.user.email,app_metadata:data.user.app_metadata}, publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY } : {}) });
    }
    const name = url.pathname.startsWith('/v1/rpc/') ? url.pathname.slice(8) : '';
    const syncOperation = /^\/v1\/sync\/(pull|push)$/.exec(url.pathname)?.[1];
    if (req.method !== 'POST' || (!Object.hasOwn(handlers, name) && !syncOperation)) return json(res, 404, { error: 'Unknown test endpoint.' });
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return json(res, 401, { error: 'A signed-in test session is required.' });
    const db = userClient(token), { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !validTestUser(auth.user)) return json(res, 401, { error: 'Test session is not valid.' });
    owner = auth.user!.id;
    const rate = calls.get(owner); const bucket = !rate || Date.now() - rate.at > 60_000 ? { at: Date.now(), count: 0 } : rate;
    calls.set(owner, bucket); if (++bucket.count > 180 || (inflight.get(owner) ?? 0) >= 8) return json(res, 429, { error: 'Test request limit reached.' });
    const body = await readBody(req);
    if(syncOperation){inflight.set(owner,(inflight.get(owner)??0)+1);counted=true;const reply=await runSyncRequest(db,owner,syncOperation,body);return json(res,reply.status,reply.body);}
    if (name === 'saveWorkflowSafely') assertSyntheticSave(body.data);
    if (['enrichSongs', 'lookupCommunityBatch', 'lookupMusicBrainz', 'lookupLastfmTrack'].includes(name)) assertTestLookup(body.data);
    if (['recommendSongsForSection', 'getArtistNeighbors'].includes(name) && !process.env.GEMINI_API_KEY) return json(res, 503, { error: 'Direct Gemini test key is not configured.', code: 'provider_not_configured' });
    inflight.set(owner, (inflight.get(owner) ?? 0) + 1);
    counted = true;
    const result = await (handlers as any)[name]({ data: body.data, context: { verifiedPrototype: true, userId: owner, supabase: db } });
    return json(res, 200, { result });
  } catch (error) {
    const invalid = error instanceof SyntaxError || (error as any)?.name === 'ZodError';
    const timeout = (error as any)?.code === 'SUGGESTION_DEADLINE';
    const unavailable = (error as any)?.code === 'sync_unavailable' || (error as any)?.code === 'sync_limit';
    json(res, invalid ? 400 : timeout ? 504 : unavailable ? (error as any).status : 422, { error: invalid ? 'Test request validation failed.' : timeout ? 'Suggestion request reached its deadline (SUGGESTION_DEADLINE).' : unavailable ? (error as Error).message : 'Test operation could not complete. Local work is preserved.', ...(timeout ? { code: 'SUGGESTION_DEADLINE' } : unavailable ? {code:(error as any).code} : {}), requestId: id });
  } finally {
    if (owner && counted) inflight.set(owner, Math.max(0, (inflight.get(owner) ?? 0) - 1));
    console.info(JSON.stringify({ requestId: id, status: res.statusCode, elapsedMs: Date.now() - started }));
  }
});
server.requestTimeout = 300_000; server.headersTimeout = 15_000;
server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.info('Set Architect test API listening.'));
process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 25_000).unref(); });
