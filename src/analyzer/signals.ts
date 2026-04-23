/**
 * Per-event signal extraction — SPEC §7.2 raw signal layer
 *
 * Converts a RawEvent into structured signals that segments.ts groups into
 * TopicSegment boundaries. Kept file-scoped (no graph-level reasoning) so this
 * module stays trivially unit-testable.
 */

import type { RawEvent } from '../types.js';

export interface EventSignals {
  index: number;
  uuid: string;
  timestamp: number; // epoch ms; NaN when malformed
  isSidechain: boolean;
  /** User/assistant text (joined). Empty string for tool_use / attachment. */
  text: string;
  /** Inferred tool call names for this event ("Edit", "Bash", ...). */
  tools: string[];
  /** File paths inferred from tool inputs / message content. */
  files: string[];
  /** If the user turn starts with "/...", the command token (without leading /). */
  slashCommand: string | null;
  /** True when user text matches a known topic-shift phrase. */
  hasTopicShiftPhrase: boolean;
  /** True if this event is a turn-level user/assistant message (for counting). */
  isTurn: boolean;
}

const TOPIC_SHIFT_PATTERNS = [
  // Korean
  /\b이제\b/,
  /\b다음은\b/,
  /\b그럼\b/,
  /\b참고로\b/,
  /\b이번엔\b/,
  /\b이번에는\b/,
  // English — word-boundary, lowercase matched after .toLowerCase()
  /\bnow\b/,
  /\bnext\b/,
  /\bswitching to\b/,
  /let['’]s move\b/,
  /\bokay so\b/,
];

export function extractSignals(events: RawEvent[]): EventSignals[] {
  const out: EventSignals[] = new Array(events.length);
  for (let i = 0; i < events.length; i += 1) {
    out[i] = extractOne(events[i], i);
  }
  return out;
}

function extractOne(e: RawEvent, index: number): EventSignals {
  const timestamp = parseTs(e.timestamp);
  const text = extractText(e);
  const tools = extractTools(e);
  const files = extractFiles(e, tools);
  const slashCommand = extractSlashCommand(e, text);
  const hasTopicShiftPhrase = detectTopicShift(text);
  const isTurn = e.type === 'user' || e.type === 'assistant';

  return {
    index,
    uuid: e.uuid,
    timestamp,
    isSidechain: e.isSidechain,
    text,
    tools,
    files,
    slashCommand,
    hasTopicShiftPhrase,
    isTurn,
  };
}

function parseTs(iso: string): number {
  if (!iso) return NaN;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : NaN;
}

function extractText(e: RawEvent): string {
  if (e.type !== 'user' && e.type !== 'assistant') return '';
  const msg = e.message;
  if (!msg) return '';
  const content = (msg as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: string; text?: string };
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.join('\n');
}

function extractTools(e: RawEvent): string[] {
  const tools: string[] = [];
  if (e.type === 'tool_use' && e.tool_use?.name) {
    tools.push(e.tool_use.name);
    return tools;
  }
  if (e.type === 'assistant') {
    const content = (e.message as { content?: unknown })?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as { type?: string; name?: string };
        if (b.type === 'tool_use' && typeof b.name === 'string') tools.push(b.name);
      }
    }
  }
  return tools;
}

function extractFiles(e: RawEvent, tools: string[]): string[] {
  const files = new Set<string>();

  const harvest = (input: unknown) => {
    if (!input || typeof input !== 'object') return;
    const obj = input as Record<string, unknown>;
    // Common path-shaped fields across Edit/Write/Read/NotebookEdit/Grep/Glob
    const fp = obj.file_path ?? obj.path ?? obj.notebook_path;
    if (typeof fp === 'string' && fp.length > 0) files.add(fp);
    // Grep may carry include paths
    const ps = obj.paths;
    if (Array.isArray(ps)) {
      for (const p of ps) if (typeof p === 'string') files.add(p);
    }
  };

  if (e.type === 'tool_use') {
    harvest(e.tool_use?.input);
  } else if (e.type === 'assistant') {
    const content = (e.message as { content?: unknown })?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as { type?: string; input?: unknown };
        if (b.type === 'tool_use') harvest(b.input);
      }
    }
  }

  // Suppress — just to use the tools param without a lint warning; if a tool
  // name matches a file-touching op we could tighten, but harvest() is already
  // permissive so no-op here is fine.
  void tools;

  return Array.from(files);
}

function extractSlashCommand(e: RawEvent, text: string): string | null {
  if (e.type !== 'user') return null;
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const match = trimmed.slice(1).match(/^([A-Za-z0-9_:-]+)/);
  return match ? match[1] : null;
}

function detectTopicShift(text: string): boolean {
  if (!text) return false;
  const lowered = text.toLowerCase();
  for (const re of TOPIC_SHIFT_PATTERNS) {
    if (re.test(text) || re.test(lowered)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Set utilities used by segments.ts
// ---------------------------------------------------------------------------

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}
