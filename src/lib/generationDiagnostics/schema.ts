import { z } from 'zod';

export const MESSAGES = {
  metadata_failed: 'Some online song details could not be checked. Finished details were kept.',
  metadata_timeout: 'Some song detail checks did not reply in time. Finished details were kept.',
  metadata_incomplete: 'Some online song details remain unknown. Finished details were kept.',
  lookup_budget: 'The song lookup limit was reached. Existing details were kept.',
  lookup_window: 'The remaining lookup time or service wait prevented further checks.',
  community_disabled: 'Community tags and listener counts were not available.',
  community_failed: 'Some community checks could not finish. Other details were kept.',
  community_budget: 'The community check limit was reached.',
  suggestions_failed: 'Some suggestions could not be obtained. Preparation continued with available tracks.',
  suggestions_timeout: 'Some suggestions did not arrive in time. Finished suggestions were kept.',
  suggestions_partial: 'Only the suggestions finished in time were kept.',
  strict_excluded: 'Some additions were withheld because their tempo or year could not meet your limits.',
  choices_excluded: 'Some additions were withheld to honour your preparation choices.',
  continuation: 'Preparation continued within its existing time and lookup limits.',
  short: 'One or more sections did not reach the selected preparation time.',
  failed: 'Preparation stopped unexpectedly. Your existing work was not replaced by diagnostics.',
  cancelled: 'Preparation stopped because the current work or signed-in account changed.',
  interrupted: 'Preparation was interrupted before a final result was recorded.',
} as const;
export const providers = ['metadata', 'reccobeats', 'musicbrainz', 'ai', 'lastfm', 'suggestions', 'cache'] as const;
export const causes = ['rate', 'server', 'denied', 'http', 'missing', 'malformed', 'network', 'deadline', 'paused', 'truncated', 'unavailable'] as const;
export const sections = ['warmUp', 'transition', 'peak'] as const;
const count = z.number().int().min(0).max(1_000_000);
export const NoticeSchema = z.object({ code: z.enum(Object.keys(MESSAGES) as [keyof typeof MESSAGES, ...Array<keyof typeof MESSAGES>]), count, provider: z.enum(providers).optional(), section: z.enum(sections).optional() });
export const CauseSchema = z.object({ provider: z.enum(providers), cause: z.enum(causes), count });
export const RunSchema = z.object({
  schema: z.literal(1), id: z.uuid(), revision: count,
  startedAt: z.number().int().min(0).max(8_640_000_000_000_000), endedAt: z.number().int().min(0).max(8_640_000_000_000_000).optional(),
  version: z.string().max(80).regex(/^[a-zA-Z0-9._:-]+$/), build: z.string().max(100).regex(/^[a-zA-Z0-9._:-]+$/),
  status: z.enum(['running', 'completed', 'warnings', 'short', 'failed', 'cancelled', 'interrupted']), elapsedMs: count,
  requested: count, notices: z.array(NoticeSchema).max(48), causes: z.array(CauseSchema).max(77),
  coverage: z.array(z.object({ section: z.enum(sections), targetSeconds: count, achievedSeconds: count })).max(3),
}).superRefine((r, ctx) => {
  if (r.status !== 'running' && r.endedAt === undefined) ctx.addIssue({ code: 'custom', message: 'Terminal time required' });
  if (r.endedAt !== undefined && r.endedAt < r.startedAt) ctx.addIssue({ code: 'custom', message: 'Invalid time order' });
  if (new Set(r.coverage.map(s => s.section)).size !== r.coverage.length) ctx.addIssue({ code: 'custom', message: 'Duplicate section' });
});
export type DiagnosticRun = z.infer<typeof RunSchema>;
export type NoticeCode = keyof typeof MESSAGES;
export type Delivery = 'queued' | 'sent' | 'not configured' | 'retry later';
export const BatchSchema = z.object({ runs: z.array(RunSchema).min(1).max(5) }).strict();
export type RelayReply = { accepted: Array<{ id: string; revision: number }>; state: Delivery; retryAfterMs?: number };
export function safeVersion(value: unknown): string { return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(value) ? value.slice(0, 80) : 'unknown'; }
export function safeCount(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? Math.min(1_000_000, Math.max(0, Math.round(value))) : 0; }
export function copyDiagnostics(value: unknown): string {
  const r = RunSchema.parse(value);
  return JSON.stringify({ ...r, notices: r.notices.map(n => ({ ...n, message: MESSAGES[n.code] })), scope: 'Synthetic-safe preparation summary; no songs, files, event details or account identity.' }, null, 2);
}