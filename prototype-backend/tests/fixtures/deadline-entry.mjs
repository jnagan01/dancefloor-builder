import { recommendSongsForSection } from 'UPSTREAM_RECOMMEND';
const start = Date.now();
let deadline = false;
try {
  await recommendSongsForSection({ data: { section: 'Peak', count: 2, prefs: {}, deadlineMs: 1000 }, context: { verifiedPrototype: true, userId: 'synthetic-test', supabase: {} } });
} catch (error) { if (error.code === 'SUGGESTION_DEADLINE') deadline = true; else throw error; }
if (!deadline || Date.now() - start > 1200) throw Error('Suggestion deadline did not return promptly.');
// Observe the SDK's delayed cleanup. An unhandled rejection fails this child
// process under Node's strict mode instead of being swallowed by the test runner.
await new Promise(resolve => setTimeout(resolve, 650));
console.log('late-provider-deadline-cleanup-passed');
