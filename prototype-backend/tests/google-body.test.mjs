import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directGoogleBody } from '../src/google-body.mjs';
test('direct Gemini applies a bounded thinking setting without changing the model, prompt or constraints', () => {
  const original = { model: 'gemini-3-flash-preview', messages: [{ role: 'user', content: 'Synthetic brief' }], response_format: { type: 'json_object' }, max_tokens: 8192, stream: true };
  const adapted = directGoogleBody(original);
  assert.deepEqual(adapted, { ...original, reasoning_effort: 'low' });
  assert.equal(original.reasoning_effort, undefined);
  const explicit = { ...original, reasoning_effort: 'high' };
  assert.equal(directGoogleBody(explicit), explicit);
  const other = { ...original, model: 'another-model' };
  assert.equal(directGoogleBody(other), other);
});
