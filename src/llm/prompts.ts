/**
 * LLM prompts — SPEC §7.3
 *
 * The system prompt is static (held in `SYSTEM_PROMPT`) so the Anthropic
 * prompt cache can amortize it across every segment in a single run.
 * The per-segment user message is dynamic: a compact markdown dump of the
 * segment's events, capped to protect token budget.
 */

import type { RawEvent, TopicSegment } from '../types.js';

export const SYSTEM_PROMPT = [
  'You label sections of Claude Code sessions for a mindmap. Produce strict JSON only. No prose.',
  '',
  'Required schema:',
  '{',
  '  "label": "<=60 chars title (user-visible)",',
  '  "summary": "1-2 sentence description",',
  '  "type": "topic|action|decision|error|dead_end",',
  '  "color": "green|yellow|red",',
  '  "next_steps": ["bullet", "bullet"]',
  '}',
  '',
  'Rules:',
  '- label: scannable, concrete (mention files or tools if present)',
  '- dead_end: emit only if ONE OR MORE of:',
  '    (a) three or more consecutive errors without resolution,',
  '    (b) user explicitly says "그만|포기|cancel|nevermind|let\'s stop",',
  '    (c) assistant emits "I cannot|unable to|I\'m stuck|giving up" AND next user msg switches topic.',
  '- red color: dead_end OR user expressed frustration ("왜|아니|not that|ugh").',
  '- yellow color: exploration, ambiguity, or sidechain-only segments.',
  '- green color: forward progress or clean completion.',
  '- Language: detect the dominant language of the user turns; emit label+summary+next_steps in that language.',
  '- next_steps: 1-3 concrete bullets, imperative mood.',
  '- Respond with ONLY the JSON object. No markdown fences, no explanation.',
].join('\n');

export interface SegmentPromptInput {
  segment: TopicSegment;
  events: RawEvent[]; // events sliced by segment.event_uuids
  maxChars?: number; // truncate each event body
}

export interface LabelResponse {
  label: string;
  summary: string;
  type: 'topic' | 'action' | 'decision' | 'error' | 'dead_end';
  color: 'green' | 'yellow' | 'red';
  next_steps: string[];
}

/**
 * Build the user-message text for a single segment. The output is markdown
 * formatted so the model has clean turn boundaries.
 */
export function buildSegmentUserMessage(inp: SegmentPromptInput): string {
  const perEventCap = inp.maxChars ?? 600;
  const lines: string[] = [];

  lines.push(`# Segment ${inp.segment.id}`);
  lines.push('');
  lines.push(
    `- events: ${inp.segment.start_index}–${inp.segment.end_index} ` +
      `(${inp.segment.event_uuids.length} total)`,
  );
  if (inp.segment.dominant_files.length > 0) {
    lines.push(`- dominant files: ${inp.segment.dominant_files.join(', ')}`);
  }
  if (inp.segment.dominant_tools.length > 0) {
    lines.push(`- dominant tools: ${inp.segment.dominant_tools.join(', ')}`);
  }
  if (inp.segment.boundary_reasons.length > 0) {
    lines.push(`- boundary signals: ${inp.segment.boundary_reasons.join(', ')}`);
  }
  if (inp.segment.is_sidechain_only) {
    lines.push('- sidechain only: true');
  }
  lines.push('');
  lines.push('## Events');
  lines.push('');

  for (const e of inp.events) {
    const header = `### ${e.type}${e.isSidechain ? ' (sidechain)' : ''}`;
    lines.push(header);
    const body = renderEventBody(e, perEventCap);
    if (body) lines.push(body);
    lines.push('');
  }

  lines.push('---');
  lines.push(
    'Respond with the JSON object described in the system prompt. No other text.',
  );
  return lines.join('\n');
}

function renderEventBody(e: RawEvent, cap: number): string {
  switch (e.type) {
    case 'user':
    case 'assistant': {
      const text = messageText(e).trim();
      return truncate(text, cap) || '_(empty turn)_';
    }
    case 'tool_use': {
      const name = e.tool_use?.name ?? 'unknown';
      const input = safeStringify(e.tool_use?.input);
      return `\`${name}\` input: ${truncate(input, cap)}`;
    }
    case 'tool_result': {
      const content = typeof e.tool_result?.content === 'string'
        ? e.tool_result.content
        : safeStringify(e.tool_result?.content);
      return `tool_result: ${truncate(content, cap)}`;
    }
    case 'attachment': {
      const a = e.attachment;
      const bits = [a.type ?? 'attachment'];
      if (a.hookName) bits.push(`hook=${a.hookName}`);
      if (typeof a.exitCode === 'number') bits.push(`exit=${a.exitCode}`);
      const snippet = a.content ?? a.stdout ?? '';
      const body = truncate(typeof snippet === 'string' ? snippet : '', cap);
      return `${bits.join(' · ')} ${body ? `— ${body}` : ''}`.trim();
    }
    case 'system':
      return truncate(safeStringify(e.payload), cap);
    case 'other':
      return `(${e.originalType}) ${truncate(safeStringify(e.payload), cap)}`;
    default:
      return '';
  }
}

function messageText(e: RawEvent): string {
  if (e.type !== 'user' && e.type !== 'assistant') return '';
  const content = (e.message as { content?: unknown } | undefined)?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: string; text?: string; name?: string; input?: unknown };
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'tool_use') parts.push(`[tool_use: ${b.name ?? '?'}]`);
  }
  return parts.join('\n');
}

function truncate(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return s.slice(0, Math.max(0, cap - 1)) + '…';
}

function safeStringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

