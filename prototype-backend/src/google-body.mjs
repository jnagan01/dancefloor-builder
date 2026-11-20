// Google's direct API otherwise uses its model-default thinking budget, which
// can consume the whole 30-second suggestion window before emitting an item.
// Keep the requested model, prompt, schema and output limits unchanged.
export function directGoogleBody(body) {
  return /^gemini-3(?:[.-]|$)/.test(body.model) && body.reasoning_effort === undefined
    ? { ...body, reasoning_effort: 'low' }
    : body;
}
