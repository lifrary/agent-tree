/**
 * ContextSnapshot builder — SPEC §7.5
 *
 * Produces the markdown that ends up on the user's clipboard when they pick a
 * node. Two enrichment levels:
 *
 * 1. **Heuristic** (default, no LLM):
 *    - Fills "Last user instruction" by extracting the verbatim user turn from
 *      the segment's events — no LLM required.
 *    - Lists segment metadata (boundary signals, dominant files / tools).
 *    - Skips LLM-only sections cleanly so the user never sees internal jargon
 *      like "(M3 narrative placeholder)" in their pasted markdown.
 *
 * 2. **LLM-enriched** (when `label` is supplied):
 *    - Adds an LLM summary, locked-in decisions, and suggested-next-steps
 *      bullets on top of the heuristic data.
 */

import type { ContextSnapshot, RawEvent, TopicSegment } from '../types.js';
import { formatGitContextMarkdown, type GitContext } from '../utils/git.js';
import type { Redactor } from '../utils/redact.js';

export interface LabelData {
  label: string;
  summary: string;
  next_steps: string[];
}

export interface SnapshotInputs {
  sessionId: string;
  jsonlPath: string;
  nodeId: string;
  label: string;
  segment: TopicSegment | null; // null for root / container nodes
  generatedAt: string; // ISO-8601
  /**
   * Events covered by this segment — used to extract the verbatim last user
   * turn for the heuristic snapshot. Empty array is fine; the section just
   * gets omitted.
   */
  events?: RawEvent[];
  /**
   * LLM-derived enrichment. When omitted, the snapshot stays heuristic-only.
   */
  llm?: LabelData;
  /**
   * Applied to verbatim user text + LLM bullets BEFORE they're quoted into
   * the snapshot markdown. Without this, secrets in user turns leak straight
   * into the clipboard payload.
   */
  redactor?: Redactor;
  /**
   * Git state at snapshot generation time — branch / HEAD / recent commits /
   * working-tree status. When present, the snapshot adds a "Git context"
   * section so the new claude session knows what code state to work against.
   */
  gitContext?: GitContext;
}

export function buildContinueSnapshot(inp: SnapshotInputs): ContextSnapshot {
  return {
    mode: 'continue',
    session_id: inp.sessionId,
    node_id: inp.nodeId,
    clipboard_markdown: renderContinueMarkdown(inp),
    related_files: (inp.segment?.dominant_files ?? []).map((path) => ({
      path,
      summary: '(file touched in this segment)',
    })),
    next_steps: inp.llm?.next_steps ?? [],
  };
}

export function buildForkSnapshot(inp: SnapshotInputs): ContextSnapshot {
  return {
    mode: 'fork',
    session_id: inp.sessionId,
    node_id: inp.nodeId,
    clipboard_markdown: renderForkMarkdown(inp),
    related_files: (inp.segment?.dominant_files ?? []).map((path) => ({
      path,
      summary: '(file state at fork point — disk may differ)',
    })),
    next_steps: inp.llm?.next_steps ?? [],
  };
}

// ---------------------------------------------------------------------------
// Markdown renderers
// ---------------------------------------------------------------------------

function renderContinueMarkdown(inp: SnapshotInputs): string {
  const sections: string[] = [];
  sections.push(`# Continuing from: ${inp.label}`);
  sections.push('');
  sections.push(headerLines(inp, 'continue'));
  sections.push('');

  const summarySection = sectionContext(inp);
  if (summarySection) {
    sections.push(summarySection);
    sections.push('');
  }

  const files = sectionFiles(inp, 'this branch');
  if (files) {
    sections.push(files);
    sections.push('');
  }

  const lastUser = sectionLastUserInstruction(inp);
  if (lastUser) {
    sections.push(lastUser);
    sections.push('');
  }

  const next = sectionNextSteps(inp);
  if (next) {
    sections.push(next);
    sections.push('');
  }

  const git = inp.gitContext ? formatGitContextMarkdown(inp.gitContext) : null;
  if (git) {
    sections.push(git);
    sections.push('');
  }

  sections.push(sectionFullReference(inp));
  sections.push('');
  sections.push('---');
  sections.push('');
  sections.push(
    'Please continue from this point. Prior decisions stand; only the direction forward is open.',
  );
  sections.push('');
  return sections.join('\n');
}

function renderForkMarkdown(inp: SnapshotInputs): string {
  const sections: string[] = [];
  sections.push(`# Forking at: ${inp.label} (discarding future)`);
  sections.push('');
  sections.push(headerLines(inp, 'fork'));
  sections.push('');

  const summarySection = sectionContext(inp, /*forkHeading*/ true);
  if (summarySection) {
    sections.push(summarySection);
    sections.push('');
  }

  const files = sectionFiles(inp, 'as of this fork point');
  if (files) {
    sections.push(files);
    sections.push('');
  }

  const openQuestion = sectionOpenQuestion(inp);
  if (openQuestion) {
    sections.push(openQuestion);
    sections.push('');
  }

  sections.push('## What I want you to DO');
  sections.push('- Ignore whatever path the original session took after this.');
  sections.push('- Re-approach the open question fresh.');
  sections.push('- You may suggest different architecture / file layout / tools.');
  sections.push('');

  const git = inp.gitContext ? formatGitContextMarkdown(inp.gitContext) : null;
  if (git) {
    sections.push(git);
    sections.push('');
  }

  sections.push(sectionFullReference(inp));
  sections.push('');
  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Section helpers — return null when the section has no data so we omit it
// (no internal-jargon placeholders ever leak to the user-facing markdown).
// ---------------------------------------------------------------------------

function headerLines(inp: SnapshotInputs, mode: 'continue' | 'fork'): string {
  const range = inp.segment
    ? `${inp.segment.start_index}–${inp.segment.end_index}`
    : 'whole session';
  const modeLine =
    mode === 'continue'
      ? '**Mode**: continue (preserving decisions so far)'
      : '**Mode**: fork (discarding subsequent turns from original session)';
  return [
    `**Source session**: \`${inp.sessionId}\` (events ${range})`,
    modeLine,
    `**Generated**: ${inp.generatedAt}`,
  ].join('\n');
}

function sectionContext(inp: SnapshotInputs, fork = false): string | null {
  const heading = fork ? '## State at fork point' : '## Context up to this point';
  if (inp.llm?.summary) {
    const safe = inp.redactor ? inp.redactor.apply(inp.llm.summary) : inp.llm.summary;
    return `${heading}\n${safe}`;
  }
  // Heuristic: derive a one-liner from segment metadata.
  if (inp.segment) {
    const bits: string[] = [];
    if (inp.segment.dominant_tools.length > 0) {
      bits.push(`tools used: ${inp.segment.dominant_tools.slice(0, 3).join(', ')}`);
    }
    if (inp.segment.boundary_reasons.length > 0) {
      bits.push(`segment opened by: ${inp.segment.boundary_reasons.join(' + ')}`);
    }
    bits.push(`${inp.segment.event_uuids.length} events in this segment`);
    return `${heading}\n${bits.join('. ')}.`;
  }
  return null;
}

function sectionFiles(inp: SnapshotInputs, qualifier: string): string | null {
  const files = inp.segment?.dominant_files ?? [];
  if (files.length === 0) return null;
  const heading =
    qualifier === 'this branch'
      ? '## Files touched in this branch'
      : `## Files ${qualifier}`;
  return `${heading}\n${files.map((f) => `- \`${f}\``).join('\n')}`;
}

function sectionLastUserInstruction(inp: SnapshotInputs): string | null {
  const raw = lastUserText(inp.events);
  if (!raw) return null;
  const safe = inp.redactor ? inp.redactor.apply(raw) : raw;
  const quoted = safe
    .split('\n')
    .map((ln) => `> ${ln}`)
    .join('\n');
  return `## Last user instruction at this point\n${quoted}`;
}

function sectionOpenQuestion(inp: SnapshotInputs): string | null {
  const raw = lastUserText(inp.events);
  if (!raw) return null;
  const safe = inp.redactor ? inp.redactor.apply(raw) : raw;
  const quoted = safe
    .split('\n')
    .map((ln) => `> ${ln}`)
    .join('\n');
  return `## Open question(s) at this moment\n${quoted}`;
}

function sectionNextSteps(inp: SnapshotInputs): string | null {
  if (!inp.llm || inp.llm.next_steps.length === 0) return null;
  const steps = inp.redactor
    ? inp.llm.next_steps.map((s) => inp.redactor!.apply(s))
    : inp.llm.next_steps;
  return `## Suggested continuation\n${steps.map((s) => `- ${s}`).join('\n')}`;
}

function sectionFullReference(inp: SnapshotInputs): string {
  const range = inp.segment
    ? `${inp.segment.start_index}–${inp.segment.end_index}`
    : 'whole session';
  return [
    '## Full session reference',
    `- jsonl: \`${inp.jsonlPath}\``,
    `- event range: ${range}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Verbatim last-user-turn extraction (heuristic — no LLM needed).
// ---------------------------------------------------------------------------

function lastUserText(events: RawEvent[] | undefined): string | null {
  if (!events || events.length === 0) return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type !== 'user') continue;
    const content = (e.message as { content?: unknown } | undefined)?.content;
    if (typeof content === 'string' && content.trim().length > 0) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as { type?: string; text?: string };
        if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
      }
      const joined = parts.join('\n').trim();
      if (joined.length > 0) return joined;
    }
  }
  return null;
}
