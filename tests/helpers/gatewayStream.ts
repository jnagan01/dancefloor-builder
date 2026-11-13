/**
 * Synthetic Lovable AI Gateway chat-completions endpoint for the REAL AI SDK + openai-compatible provider.
 * Streams OpenAI-style SSE chunks after a model-specific start-up delay, honours the caller's abort signal and records
 * only the request contract (model/options), never credentials. Timings come from live measurements (see callers).
 */
export type GatewayRequest = { model: string; stream?: boolean; max_tokens?: number; temperature?: number; reasoning_effort?: string; prompt: string; authorized: boolean };

export function gatewayStream(o: {
  startupMs: (model: string, prompt: string) => number;
  /** Delay between streamed content chunks. */
  chunkMs: number;
  chunkChars?: number;
  content: (req: GatewayRequest) => string;
  requests?: GatewayRequest[];
  status?: (req: GatewayRequest) => number | undefined;
}) {
  return async (init: RequestInit | undefined): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const headers = new Headers(init?.headers);
    const prompt = (body.messages ?? []).map((m: any) => typeof m.content === 'string' ? m.content : (m.content ?? []).map((c: any) => c.text ?? '').join('')).join('\n');
    const req: GatewayRequest = { model: body.model, stream: body.stream, max_tokens: body.max_tokens, temperature: body.temperature, reasoning_effort: body.reasoning_effort, prompt, authorized: !!headers.get('Lovable-API-Key') };
    o.requests?.push(req);
    const signal = init?.signal ?? undefined;
    const status = o.status?.(req);
    if (status) return new Response(JSON.stringify({ error: { message: 'synthetic gateway status' } }), { status, headers: { 'content-type': 'application/json' } });
    const text = o.content(req);
    const size = o.chunkChars ?? 40;
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
    const enc = new TextEncoder();
    const frame = (delta: object, finish: string | null = null) => enc.encode(`data: ${JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 0, model: req.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    const sleep = (ms: number) => new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
      const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
      const onAbort = () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    let step = -1;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (step === -1) { await sleep(o.startupMs(req.model, prompt)); controller.enqueue(frame({ role: 'assistant', content: '' })); step = 0; return; }
          if (step < parts.length) { await sleep(o.chunkMs); controller.enqueue(frame({ content: parts[step++] })); return; }
          controller.enqueue(frame({}, 'stop'));
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (e) { controller.error(e); }
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

/** Estimate content for every numbered prompt line `i. Artist — Song`. */
export function estimateItems(prompt: string, value: (artist: string, song: string) => Record<string, unknown> | null): string {
  const items = [...prompt.matchAll(/^(\d+)\. (.+?) — (.+?)(?: \|.*)?$/gm)].flatMap(m => { const v = value(m[2], m[3]); return v ? [{ i: Number(m[1]), ...v }] : []; });
  return JSON.stringify({ items });
}
