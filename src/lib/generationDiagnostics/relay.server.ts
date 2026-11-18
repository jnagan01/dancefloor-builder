import { BatchSchema, MESSAGES, type RelayReply } from './schema';

/** Config is supplied only by the authenticated handler, never by the caller. */
export async function relayDiagnostics(input: unknown, config: { token?: string; host?: string }, transport: typeof fetch = fetch): Promise<RelayReply> {
  const { runs } = BatchSchema.parse(input); // rebuild nested objects; unknown fields never travel
  if (!config.token || !config.host) return { accepted: [], state: 'not configured' };
  // Better Stack source hosts only. No credentials, port, path, query or arbitrary client URL.
  const host = config.host.replace(/^https:\/\//, '').replace(/\/$/, '');
  if (!/^(?:(?:[a-z0-9-]+\.)*in\.logs\.betterstack\.com|s[0-9]+\.[a-z0-9-]+\.betterstackdata\.com)$/.test(host)) return { accepted: [], state: 'not configured' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const payload = runs.map(r => ({ ...r, dt: new Date(r.endedAt ?? r.startedAt).toISOString(), application: 'Set Architect', level: 'info', synthetic: r.kind === 'synthetic_connection_check', message: r.kind === 'synthetic_connection_check' ? 'SYNTHETIC CONNECTION CHECK — no user data' : `Preparation ${r.status}`, notices: r.notices.map(n => ({ ...n, message: MESSAGES[n.code] })) }));
    const response = await Promise.race([
      transport(`https://${host}/`, { method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
      new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, 5000); }),
    ]);
    if (response?.status === 202) { void response.body?.cancel().catch(() => {}); return { accepted: runs.map(({ id, revision }) => ({ id, revision })), state: 'sent' }; }
    const raw = response?.headers.get('retry-after');
    const seconds = raw && /^\d{1,6}$/.test(raw) ? Number(raw) : 0;
    void response?.body?.cancel().catch(() => {});
    return { accepted: [], state: 'retry later', retryAfterMs: Math.max(60_000, Math.min(3_600_000, seconds * 1000)) };
  } catch { return { accepted: [], state: 'retry later', retryAfterMs: 60_000 }; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}