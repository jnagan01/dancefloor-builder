import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
// Compatibility export preserves the shared generation code; the actual transport
// is Google's direct API. Neither code nor credentials contact Lovable.
export function createLovableAiGatewayProvider(key: string) {
  const provider = createOpenAICompatible({ name: 'direct-gemini-test', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', headers: { Authorization: `Bearer ${key}` } });
  return (requested: string) => provider(process.env.GEMINI_MODEL || requested.replace(/^google\//, ''));
}
