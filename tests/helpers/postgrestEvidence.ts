/** Synthetic HTTP-boundary parser for PostgREST's quoted IN-value grammar. */
export function evidenceFilterKeys(raw: string): string[] {
  const text = raw.startsWith('in.') ? raw.slice(3) : raw;
  if (!text.startsWith('(') || !text.endsWith(')')) throw Error('Invalid synthetic IN filter');
  const out: string[] = []; let i = 1;
  while (i < text.length - 1) {
    if (text[i++] !== '"') throw Error('Unquoted synthetic key');
    let key = '', closed = false;
    while (i < text.length - 1) {
      const c = text[i++];
      if (c === '\\') key += text[i++];
      else if (c === '"') { closed = true; break; }
      else key += c;
    }
    if (!closed) throw Error('Unclosed synthetic key'); out.push(key);
    if (i < text.length - 1 && text[i++] !== ',') throw Error('Invalid synthetic separator');
  }
  return out;
}