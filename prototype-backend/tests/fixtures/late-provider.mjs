import { MockLanguageModelV3 } from 'ai/test';
export function createLovableAiGatewayProvider() {
  return () => new MockLanguageModelV3({ doStream: async () => {
    await new Promise(resolve => setTimeout(resolve, 1250));
    throw new DOMException('Synthetic late provider abort', 'AbortError');
  } });
}
