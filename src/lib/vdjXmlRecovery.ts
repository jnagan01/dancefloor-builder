// Safe recovery for malformed VirtualDJ database.xml files.
//
// A single bad byte (control character, raw "<" or bare "&" in a tag) makes the
// whole document fail strict XML parsing. Recovery splits the document into
// independent <Song>/<Track> blocks so one damaged entry cannot discard the
// metadata of every other track. Each block is first parsed strictly (DOMParser,
// identical semantics to a valid file); only blocks that still fail use the
// tolerant attribute reader below. No DTD, external or custom entity is ever
// interpreted: only the five predefined XML entities and valid numeric
// character references are decoded; anything else is kept as literal text.

/** Minimal element shape shared by DOM elements and tolerant-parsed blocks. */
export interface XmlNodeLike {
  tagName: string;
  getAttribute(name: string): string | null;
  attributes: ArrayLike<{ name: string; value: string }>;
  children: ArrayLike<XmlNodeLike>;
}

export interface SkippedVdjEntry { line: number; reason: string }

export interface VdjBlock { node: XmlNodeLike; line: number; tolerant: boolean }

export interface VdjRecoveryResult {
  blocks: VdjBlock[];
  skipped: SkippedVdjEntry[];
  skippedCount: number;
}

const MAX_SKIPPED_REPORTED = 50;
const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function validXmlChar(cp: number): boolean {
  return cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
}

/**
 * Decode an attribute value the way a conforming XML parser would for the
 * predefined/numeric references, keeping bare "&" and unknown named entities
 * literal. Returns null when a numeric reference names an invalid character.
 */
export function decodeXmlAttribute(raw: string): string | null {
  // XML end-of-line handling, then attribute-value normalization of literal whitespace.
  const normalized = raw.replace(/\r\n?/g, "\n").replace(/[\t\n]/g, " ");
  let invalid = false;
  const out = normalized.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|([A-Za-z]+));/g, (whole, hex, dec, name) => {
    if (name !== undefined) return Object.prototype.hasOwnProperty.call(PREDEFINED, name) ? PREDEFINED[name] : whole;
    const cp = hex !== undefined ? parseInt(hex, 16) : parseInt(dec, 10);
    if (!Number.isSafeInteger(cp) || !validXmlChar(cp)) { invalid = true; return whole; }
    return String.fromCodePoint(cp);
  });
  return invalid ? null : out;
}

class TolerantNode implements XmlNodeLike {
  attributes: Array<{ name: string; value: string }> = [];
  children: TolerantNode[] = [];
  constructor(public tagName: string) {}
  getAttribute(name: string): string | null {
    return this.attributes.find((a) => a.name === name)?.value ?? null;
  }
}

interface ParsedTag { node: TolerantNode; end: number; selfClosing: boolean; problem?: string; rawPath?: string }

/** Parse one start tag beginning at `text[start] === "<"`; quote-aware, bounded by text. */
function parseStartTag(text: string, start: number): ParsedTag | { error: string } {
  const nameMatch = /^<([A-Za-z_][\w.:-]*)/.exec(text.slice(start, start + 256));
  if (!nameMatch) return { error: "unreadable tag" };
  const node = new TolerantNode(nameMatch[1]);
  let i = start + nameMatch[0].length;
  let problem: string | undefined;
  let rawPath: string | undefined;
  const seen = new Map<string, string | null>();
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text.startsWith("/>", i)) return { node, end: i + 2, selfClosing: true, problem, rawPath };
    if (text[i] === ">") return { node, end: i + 1, selfClosing: false, problem, rawPath };
    const nm = /^[^\s=/>"'<]+/.exec(text.slice(i, i + 256));
    if (!nm) { problem = "unexpected character in tag"; i++; continue; }
    const name = nm[0];
    i += name.length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== "=") { problem = "attribute without value"; continue; }
    i++;
    while (i < text.length && /\s/.test(text[i])) i++;
    const quote = text[i];
    if (quote !== '"' && quote !== "'") { problem = "unquoted attribute"; continue; }
    const close = text.indexOf(quote, i + 1);
    if (close < 0) return { error: `unterminated ${name} value` };
    const raw = text.slice(i + 1, close);
    if (rawPath === undefined && /^(filepath|path|filepathname)$/i.test(name)) rawPath = raw;
    const value = decodeXmlAttribute(raw);
    i = close + 1;
    if (seen.has(name)) {
      if (seen.get(name) !== value) return { error: `conflicting duplicate ${name}` };
      continue;
    }
    seen.set(name, value);
    if (value === null) { problem = `invalid character reference in ${name}`; continue; }
    node.attributes.push({ name, value });
  }
  return { error: "unterminated tag" };
}

/** Tolerantly read one Song block: the Song attributes plus every descendant start tag (flattened). */
export function parseBlockTolerant(block: string): { node: TolerantNode } | { error: string } {
  const head = parseStartTag(block, 0);
  if ("error" in head) return head;
  const song = head.node;
  const pathValue = song.attributes.find((a) => /^(filepath|path|filepathname)$/i.test(a.name))?.value;
  if (!pathValue) {
    return { error: head.problem?.startsWith("invalid character reference") ? head.problem : "missing file path" };
  }
  // A raw "<", line break or `="` inside a path means a quote ran past its tag;
  // using it would invent a different file identity.
  if (/[<\n\r]|="/.test(head.rawPath ?? "")) return { error: "unsafe file path" };
  if (head.selfClosing) return { node: song };
  let i = head.end;
  while (i < block.length) {
    const lt = block.indexOf("<", i);
    if (lt < 0) break;
    if (block.startsWith("<!--", lt)) { const e = block.indexOf("-->", lt + 4); if (e < 0) break; i = e + 3; continue; }
    if (block.startsWith("<![CDATA[", lt)) { const e = block.indexOf("]]>", lt + 9); if (e < 0) break; i = e + 3; continue; }
    if (block[lt + 1] === "/") {
      if (/^<\/\s*(song|track)\s*>/i.test(block.slice(lt, lt + 16))) break;
      const e = block.indexOf(">", lt); if (e < 0) break; i = e + 1; continue;
    }
    if (!/[A-Za-z_]/.test(block[lt + 1] ?? "")) { i = lt + 1; continue; }
    const child = parseStartTag(block, lt);
    // A damaged child stops child reading; the Song and earlier children stay.
    if ("error" in child) break;
    song.children.push(child.node);
    i = child.end;
  }
  return { node: song };
}

// Stray C0 controls (e.g. a lone NUL at a line start) between entries must not hide the next Song.
const BLOCK_START = /(^|[\n>])[ \t\x00-\x08\x0B\x0C\x0E-\x1F]*<(Song|Track)(?=[\s>/])/gi;

function blockEnd(chunk: string): number {
  const closeRe = /<\/\s*(?:song|track)\s*>/gi;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = closeRe.exec(chunk)) !== null) last = m.index + m[0].length;
  return last;
}

type StrictParse = (xml: string) => XmlNodeLike | null;

/** Build a strict single-block parser from DOMParser when available. */
export function domBlockParser(): StrictParse | null {
  if (typeof DOMParser === "undefined") return null;
  const parser = new DOMParser();
  return (xml) => {
    const doc = parser.parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return null;
    const root = doc.documentElement;
    return root && /^(song|track)$/i.test(root.tagName) ? (root as unknown as XmlNodeLike) : null;
  };
}

/** Split a (malformed) database into Song blocks and parse each independently. */
export function recoverVdjBlocks(text: string, strict: StrictParse | null = domBlockParser()): VdjRecoveryResult {
  const starts: number[] = [];
  BLOCK_START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_START.exec(text)) !== null) {
    starts.push(m.index + m[0].length - m[2].length - 1);
  }
  const blocks: VdjBlock[] = [];
  const skipped: SkippedVdjEntry[] = [];
  let skippedCount = 0;
  let line = 1;
  let lineAt = 0;
  for (let n = 0; n < starts.length; n++) {
    const start = starts[n];
    for (let k = lineAt; k < start; k++) if (text.charCodeAt(k) === 10) line++;
    lineAt = start;
    const chunk = text.slice(start, n + 1 < starts.length ? starts[n + 1] : text.length);
    const end = blockEnd(chunk);
    let node: XmlNodeLike | null = null;
    if (strict) {
      const candidate = end > 0 ? chunk.slice(0, end) : selfClosed(chunk);
      if (candidate) node = strict(candidate);
    }
    if (node) { blocks.push({ node, line, tolerant: false }); continue; }
    const tolerant = parseBlockTolerant(end > 0 ? chunk.slice(0, end) : chunk);
    if ("error" in tolerant) {
      skippedCount++;
      if (skipped.length < MAX_SKIPPED_REPORTED) skipped.push({ line, reason: tolerant.error });
      continue;
    }
    blocks.push({ node: tolerant.node, line, tolerant: true });
  }
  return { blocks, skipped, skippedCount };
}

function selfClosed(chunk: string): string | null {
  const head = parseStartTag(chunk, 0);
  return "error" in head || !head.selfClosing ? null : chunk.slice(0, head.end);
}
