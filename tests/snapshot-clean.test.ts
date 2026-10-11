/**
 * Regression test for the snapshot UX bug fix.
 *
 * Catches any future drift back to the "M3 narrative placeholder" /
 * "M4 will paste..." style of internal-jargon leakage in the user-visible
 * clipboard markdown.
 */

import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { detectSegments } from '../src/analyzer/segments.js';
import { labelMindMap } from '../src/llm/labeler.js';
import { buildGraph } from '../src/reader/graph.js';
import { readJsonl } from '../src/reader/jsonl.js';
import { buildMindMap } from '../src/tree/builder.js';
import { buildContinueSnapshot, createSnapshotHistory } from '../src/tree/context_snapshot.js';
import type { MindMapNode, RawEvent, TopicSegment } from '../src/types.js';
import { defaultRedactor } from '../src/utils/redact.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/minimal-session.jsonl');

const FORBIDDEN_PHRASES = [
  '(M3 narrative placeholder)',
  '(M3 next-step bullet)',
  '(M4 will paste',
  '(M4 will extract',
  '(M3 LLM summary will populate',
  'M3 placeholder',
  'M4 placeholder',
];

async function buildFixtureMindmap() {
  const { meta, events } = await readJsonl(FIXTURE);
  const graph = buildGraph(meta, events);
  const segments = detectSegments(graph.events);
  const mindmap = buildMindMap(graph, segments, {
    jsonlPath: FIXTURE,
    specVersion: 'v0.3-test',
    generatedAt: '2026-04-22T00:00:00.000Z',
  });
  return { mindmap, graph, segments };
}

function walkMarkdown(
  node: import('../src/types.js').MindMapNode,
  fn: (md: string, mode: 'continue' | 'fork', nodeId: string) => void,
): void {
  fn(node.context_snapshot_continue.clipboard_markdown, 'continue', node.id);
  fn(node.context_snapshot_fork.clipboard_markdown, 'fork', node.id);
  for (const c of node.children) walkMarkdown(c, fn);
}

describe('heuristic snapshot UX (no LLM)', () => {
  it('no node leaks internal milestone jargon into the clipboard markdown', async () => {
    const { mindmap } = await buildFixtureMindmap();
    walkMarkdown(mindmap.root, (md, mode, nodeId) => {
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(md, `node ${nodeId} (${mode}) leaked "${phrase}"`).not.toContain(phrase);
      }
    });
  });

  it('root continue retains the original instruction and identifies the latest instruction', async () => {
    const { mindmap } = await buildFixtureMindmap();
    // Fixture's first user msg: "Please read src/foo.ts and explain"
    expect(mindmap.root.context_snapshot_continue.clipboard_markdown).toContain(
      '> Please read src/foo.ts and explain',
    );
    const snapshot = mindmap.root.context_snapshot_continue;
    expect(
      snapshot.evidence?.entries.find(
        (entry) => entry.event_index === snapshot.evidence?.instruction_index,
      )?.text,
    ).toBe('/wrap session');
  });

  it('a segment snapshot embeds its LAST user instruction verbatim', async () => {
    const { mindmap } = await buildFixtureMindmap();
    // Fixture seg containing the topic-shift event has user text "이제 다른 작업..."
    let foundQuoted = false;
    walkMarkdown(mindmap.root, (md) => {
      if (md.includes('> 이제 다른 작업. Edit src/bar.ts')) foundQuoted = true;
    });
    expect(foundQuoted).toBe(true);
  });

  it('section headings exist; sections without data are omitted, not stubbed', async () => {
    const { mindmap } = await buildFixtureMindmap();
    const md = mindmap.root.context_snapshot_continue.clipboard_markdown;
    // Heuristic root: no LLM → no "Decisions locked in" or "Suggested continuation"
    expect(md).not.toContain('## Decisions locked in before this point');
    expect(md).not.toContain('## Suggested continuation');
    // The last instruction remains a useful compatibility section.
    expect(md).toContain('## Last user instruction at this point');
    expect(md).toContain('## Full session reference');
  });
});

const syntheticOptions = {
  jsonlPath: '/fixtures/recovery.jsonl',
  specVersion: 'test',
  generatedAt: '2026-04-22T00:00:00.000Z',
};

function message(
  index: number,
  role: 'user' | 'assistant',
  text: string,
  parent: string | null = index === 0 ? null : `e-${index - 1}`,
  sidechain = false,
): RawEvent {
  const envelope = {
    uuid: `e-${index}`,
    parentUuid: parent,
    isSidechain: sidechain,
    timestamp: `2026-04-22T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
    sessionId: 'recovery-test',
    cwd: '/project',
    gitBranch: 'main',
    version: 'test',
    entrypoint: 'test',
    userType: 'external',
  };
  return role === 'user'
    ? { ...envelope, type: 'user', message: { role, content: text } }
    : { ...envelope, type: 'assistant', message: { role, content: text } };
}

function systemEvent(index: number, payload: Record<string, unknown>): RawEvent {
  return { ...message(index, 'assistant', ''), type: 'system', payload };
}

function segment(events: RawEvent[], start: number, end: number, id: string): TopicSegment {
  const members = events.slice(start, end + 1);
  return {
    id,
    start_index: start,
    end_index: end,
    event_uuids: members.map((event) => event.uuid),
    dominant_files: [],
    dominant_tools: [],
    is_sidechain_only: members.every((event) => event.isSidechain),
    time_range: [events[start].timestamp, events[end].timestamp],
    gap_before_ms: 0,
    boundary_reasons: [],
  };
}

function synthetic(events: RawEvent[], segments: TopicSegment[]) {
  const graph = buildGraph({ sessionId: 'recovery-test', permissionMode: 'default' }, events);
  const mindmap = buildMindMap(graph, segments, {
    ...syntheticOptions,
    redactor: defaultRedactor(),
  });
  return { graph, mindmap, segments };
}

function segmentNode(root: MindMapNode, id: string): MindMapNode {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.segment_id === id) return node;
    pending.push(...node.children);
  }
  throw new Error(`Missing segment ${id}`);
}

describe('deterministic recovery evidence', () => {
  it('retains prior instructions and assistant decisions verbatim, with occurrence references', () => {
    const events = [
      message(0, 'user', '  Keep the public API stable.\nDo not add dependencies.  '),
      message(1, 'assistant', 'Decision: reuse the existing parser, not a new package.'),
      message(2, 'user', 'Implement the validation stage now.'),
      message(3, 'assistant', 'Validation uses the existing parser.'),
      message(4, 'user', 'FUTURE QUESTION: remove the parser.'),
      message(5, 'assistant', 'FUTURE OUTCOME: parser removed.'),
    ];
    const segments = [
      segment(events, 0, 1, 'prior'),
      segment(events, 2, 3, 'selected'),
      segment(events, 4, 5, 'future'),
    ];
    const { mindmap } = synthetic(events, segments);
    const node = segmentNode(mindmap.root, 'selected');
    const continuation = node.context_snapshot_continue;
    expect(continuation.evidence?.entries.map((entry) => entry.event_index)).toEqual([0, 1, 2, 3]);
    expect(continuation.evidence?.entries[0].text).toBe(
      events[0].type === 'user' ? events[0].message.content : '',
    );
    expect(continuation.clipboard_markdown).toContain('Assistant statement');
    expect(continuation.clipboard_markdown).toContain('Source event 1 · uuid `e-1`');
    expect(continuation.clipboard_markdown).toContain(
      'Decision: reuse the existing parser, not a new package.',
    );
    expect(continuation.clipboard_markdown).toContain('Validation uses the existing parser.');
    expect(continuation.clipboard_markdown).not.toContain('FUTURE');
    expect(continuation.clipboard_markdown).not.toContain('Prior decisions stand');
    expect(continuation.clipboard_markdown).toContain('does not restore files');
    expect(continuation.clipboard_markdown).toContain('not a native session resume');
    expect(node.context_snapshot_fork.evidence?.entries.map((entry) => entry.event_index)).toEqual([
      0, 1, 2,
    ]);
    expect(node.context_snapshot_fork.clipboard_markdown).not.toContain('Validation uses');
    expect(node.context_snapshot_fork.clipboard_markdown).not.toContain('FUTURE');
    const rebuilt = segmentNode(synthetic(events, segments).mindmap.root, 'selected');
    expect(rebuilt.context_snapshot_continue).toEqual(continuation);
    expect(rebuilt.context_snapshot_fork).toEqual(node.context_snapshot_fork);
  });

  it('fork excludes later work, files, tools and summaries even within its selected segment', () => {
    const events = [
      message(0, 'user', 'Use the stable interfaces.'),
      message(1, 'assistant', 'Decision: keep the wire format.'),
      message(2, 'user', 'Now implement the requested feature.'),
      message(3, 'assistant', 'POST_QUESTION_DECISION: replace the wire format.'),
    ];
    const selected = segment(events, 2, 3, 'selected');
    selected.dominant_files = ['POST_QUESTION_FILE.ts'];
    selected.dominant_tools = ['POST_QUESTION_TOOL'];
    const { mindmap } = synthetic(events, [segment(events, 0, 1, 'prior'), selected]);
    const node = segmentNode(mindmap.root, 'selected');
    expect(node.context_snapshot_continue.clipboard_markdown).toContain('POST_QUESTION_DECISION');
    expect(node.context_snapshot_continue.clipboard_markdown).toContain('POST_QUESTION_FILE');
    expect(JSON.stringify(node.context_snapshot_fork)).not.toContain('POST_QUESTION');
    expect(node.context_snapshot_fork.evidence?.cutoff_index).toBe(2);
    expect(node.context_snapshot_fork.related_files).toEqual([]);
    expect(node.context_snapshot_fork.next_steps).toEqual([]);
  });

  it('forks at the question anchoring the displayed step, not later prompts or tool results', () => {
    const events = [
      message(0, 'user', 'First question in the segment.'),
      message(1, 'assistant', 'Decision before the later question.'),
      message(2, 'user', 'Second question in the segment.'),
      message(3, 'assistant', 'ANSWER_AFTER_SECOND_QUESTION'),
      message(4, 'user', ''),
    ];
    if (events[4].type === 'user') {
      events[4].message.content = [
        { type: 'tool_result', tool_use_id: 'tool', content: 'TOOL_RESULT_ONLY' },
      ];
    }
    const { mindmap } = synthetic(events, [segment(events, 0, 4, 'selected')]);
    const node = segmentNode(mindmap.root, 'selected');
    expect(node.label).toContain('First question');
    const snapshot = node.context_snapshot_fork;
    expect(snapshot.evidence?.cutoff_index).toBe(0);
    expect(snapshot.clipboard_markdown).toContain('First question in the segment.');
    expect(snapshot.clipboard_markdown).not.toContain('Decision before the later question.');
    expect(snapshot.clipboard_markdown).not.toContain('Second question in the segment.');
    expect(node.context_snapshot_continue.clipboard_markdown).toContain(
      'Second question in the segment.',
    );
    expect(snapshot.clipboard_markdown).not.toContain('ANSWER_AFTER');
    expect(snapshot.clipboard_markdown).not.toContain('TOOL_RESULT_ONLY');
  });

  it('action-only forks stop before their first occurrence and retain known prior instructions', () => {
    const events = [
      message(0, 'user', 'Preserve all existing interfaces.'),
      message(1, 'assistant', 'Decision: change only validation.'),
      message(2, 'assistant', 'LATER_ACTION_RESULT'),
    ];
    const selected = segment(events, 2, 2, 'action');
    selected.dominant_files = ['LATER_ACTION_FILE'];
    const { mindmap } = synthetic(events, [segment(events, 0, 1, 'prior'), selected]);
    const fork = segmentNode(mindmap.root, 'action').context_snapshot_fork;
    expect(fork.evidence?.cutoff_reason).toBe('before_segment');
    expect(fork.evidence?.cutoff_index).toBe(1);
    expect(fork.clipboard_markdown).toContain('Preserve all existing interfaces.');
    expect(fork.clipboard_markdown).toContain('stops immediately before the segment');
    expect(JSON.stringify(fork)).not.toContain('LATER_ACTION');
  });

  it('excludes sibling branches and dropped occurrences despite duplicated UUIDs', () => {
    const events = [
      message(0, 'user', 'Shared original instruction.'),
      message(1, 'assistant', 'Known shared decision.'),
      message(2, 'user', 'SIBLING_BRANCH_QUESTION', 'e-1', true),
      message(3, 'assistant', 'SIBLING_BRANCH_DECISION', 'e-2', true),
      message(4, 'user', 'Selected main question.', 'e-1'),
      message(5, 'assistant', 'Selected main outcome.'),
      { ...message(6, 'assistant', 'EXCLUDED_DUPLICATE_UUID', 'e-3', true), uuid: 'e-1' },
    ];
    const segments = [
      segment(events, 0, 1, 'prior'),
      segment(events, 2, 3, 'sibling'),
      segment(events, 4, 5, 'selected'),
    ];
    const { mindmap } = synthetic(events, segments);
    const node = segmentNode(mindmap.root, 'selected');
    expect(
      node.context_snapshot_continue.evidence?.entries.map((entry) => entry.event_index),
    ).toEqual([0, 1, 4, 5]);
    for (const snapshot of [node.context_snapshot_continue, node.context_snapshot_fork]) {
      expect(snapshot.clipboard_markdown).toContain('Known shared decision.');
      expect(JSON.stringify(snapshot)).not.toContain('SIBLING_BRANCH');
      expect(JSON.stringify(snapshot)).not.toContain('EXCLUDED_DUPLICATE');
    }
    expect(JSON.stringify(mindmap)).not.toContain('EXCLUDED_DUPLICATE');
    const dropped = synthetic(events, [segments[0], segments[2]]).mindmap;
    expect(JSON.stringify(dropped)).not.toContain('SIBLING_BRANCH');
  });

  it('does not substitute selected UUID matches for ambiguous excluded parents', () => {
    const events = [
      message(0, 'user', 'AMBIGUOUS_OLD_INSTRUCTION'),
      { ...message(1, 'assistant', 'EXCLUDED_DUPLICATE_PARENT', null, true), uuid: 'e-0' },
      message(2, 'user', 'Selected question without reliable ancestry.', 'e-0'),
      message(3, 'assistant', 'Selected outcome.'),
    ];
    const { mindmap } = synthetic(events, [
      segment(events, 0, 0, 'original'),
      segment(events, 2, 3, 'selected'),
    ]);
    const node = segmentNode(mindmap.root, 'selected');
    expect(node.context_snapshot_continue.evidence?.ancestry_gaps).toBe(1);
    expect(node.context_snapshot_continue.clipboard_markdown).toContain('Incomplete ancestry');
    expect(node.context_snapshot_continue.clipboard_markdown).not.toContain('AMBIGUOUS_OLD');
    expect(JSON.stringify(mindmap)).not.toContain('EXCLUDED_DUPLICATE_PARENT');
  });

  it('walks through dropped ancestors without quoting them and honors sparse membership', () => {
    const events = [
      message(0, 'user', 'Keep the original invariant.'),
      message(1, 'assistant', 'DROPPED_DELEGATED_WORK', 'e-0', true),
      message(2, 'user', 'Selected question after delegation.'),
      message(3, 'assistant', 'DROPPED_SPARSE_RESULT'),
      message(4, 'assistant', 'Selected answer.'),
    ];
    const selected = segment(events, 2, 4, 'selected');
    selected.event_uuids = ['e-2', 'e-4'];
    const { mindmap } = synthetic(events, [segment(events, 0, 0, 'prior'), selected]);
    const snapshot = segmentNode(mindmap.root, 'selected').context_snapshot_continue;
    expect(snapshot.evidence?.entries.map((entry) => entry.event_index)).toEqual([0, 2, 4]);
    expect(snapshot.evidence?.excluded_events).toBe(2);
    expect(JSON.stringify(mindmap)).not.toContain('DROPPED_');
  });

  it('makes root and sidechain container cutoffs explicit without changing numbering', () => {
    const events = [
      message(0, 'user', 'Original main instruction.'),
      message(1, 'assistant', 'Main decision.'),
      message(2, 'user', 'Delegated question.', 'e-1', true),
      message(3, 'assistant', 'DELEGATED_LATER_WORK', 'e-2', true),
      message(4, 'user', 'Latest main instruction.', 'e-1'),
      message(5, 'assistant', 'LATEST_MAIN_WORK'),
    ];
    const { mindmap } = synthetic(events, [
      segment(events, 0, 1, 'first'),
      segment(events, 2, 3, 'delegated'),
      segment(events, 4, 5, 'latest'),
    ]);
    expect(mindmap.root.id).toBe('n_001');
    expect(mindmap.root.children.map((node) => node.id)).toEqual(['n_002', 'n_003', 'n_004']);
    expect(mindmap.root.children[2].children[0].id).toBe('n_005');
    const rootContinue = mindmap.root.context_snapshot_continue;
    expect(rootContinue.clipboard_markdown).toContain('multiple branches');
    expect(rootContinue.clipboard_markdown).toContain('LATEST_MAIN_WORK');
    expect(
      mindmap.root.context_snapshot_fork.evidence?.entries.map((entry) => entry.event_index),
    ).toEqual([0]);
    const bucket = mindmap.root.children[2];
    expect(bucket.context_snapshot_continue.clipboard_markdown).toContain('DELEGATED_LATER_WORK');
    expect(bucket.context_snapshot_continue.clipboard_markdown).not.toContain('LATEST_MAIN_WORK');
    expect(bucket.context_snapshot_fork.evidence?.cutoff_index).toBe(2);
    expect(bucket.context_snapshot_fork.clipboard_markdown).toContain('Original main instruction.');
    expect(bucket.context_snapshot_fork.clipboard_markdown).not.toContain('DELEGATED_LATER_WORK');
  });

  it('reports missing questions and unavailable ancestry rather than inventing context', () => {
    const events = [message(0, 'assistant', 'Unanchored result.', 'missing-parent')];
    const { mindmap } = synthetic(events, [segment(events, 0, 0, 'selected')]);
    expect(mindmap.root.context_snapshot_fork.evidence?.cutoff_index).toBeNull();
    expect(mindmap.root.context_snapshot_fork.clipboard_markdown).toContain(
      'no selected textual user question',
    );
    const node = segmentNode(mindmap.root, 'selected');
    expect(node.context_snapshot_fork.evidence?.ancestry_gaps).toBe(1);
    expect(node.context_snapshot_fork.evidence?.entries).toEqual([]);
    expect(node.context_snapshot_fork.clipboard_markdown).not.toContain('Unanchored result.');
  });

  it('bounds evidence and UTF-8 prompt bytes with explicit omissions, retaining original and current asks', () => {
    const events: RawEvent[] = [message(0, 'user', 'ORIGINAL_REQUIRED_INVARIANT')];
    for (let index = 1; index < 100; index += 1) {
      events.push(
        message(index, 'assistant', `Recorded statement ${index}\n${'한글\n'.repeat(1_500)}`),
      );
    }
    events.push(message(100, 'user', 'CURRENT_REQUIRED_QUESTION'));
    events.push(message(101, 'assistant', 'LATEST_SELECTED_OUTCOME'));
    const { mindmap } = synthetic(events, [
      segment(events, 0, 99, 'prior'),
      segment(events, 100, 101, 'selected'),
    ]);
    const node = segmentNode(mindmap.root, 'selected');
    for (const snapshot of [node.context_snapshot_continue, node.context_snapshot_fork]) {
      expect(snapshot.evidence!.entries.length).toBeLessThanOrEqual(32);
      expect(snapshot.evidence!.omitted_entries).toBeGreaterThan(0);
      expect(snapshot.evidence!.truncated_entries).toBeGreaterThan(0);
      expect(snapshot.clipboard_markdown).toContain('Omitted by bounds:');
      expect(snapshot.clipboard_markdown).toContain('ORIGINAL_REQUIRED_INVARIANT');
      expect(snapshot.clipboard_markdown).toContain('CURRENT_REQUIRED_QUESTION');
      expect(snapshot.clipboard_markdown).not.toContain('�');
      expect(Buffer.byteLength(snapshot.clipboard_markdown)).toBeLessThanOrEqual(80_000);
    }
    expect(node.context_snapshot_continue.clipboard_markdown).toContain('LATEST_SELECTED_OUTCOME');
    expect(node.context_snapshot_fork.clipboard_markdown).not.toContain('LATEST_SELECTED_OUTCOME');
  });

  it('redacts complete secret values before excerpt truncation, including keys ending beyond the cap', () => {
    const privateKey = `-----BEGIN PRIVATE KEY-----\n${'PRIVATE_MATERIAL'.repeat(2_000)}\n-----END PRIVATE KEY-----`;
    const apiKey = `sk-proj-${'SECRET_VALUE'.repeat(600)}`;
    const events = [
      message(0, 'user', `Original constraints.\n${privateKey}\nKeep these constraints.`),
      message(1, 'assistant', `Decision: rotate ${apiKey} before continuing.`),
      message(2, 'user', 'Continue with redacted credentials.'),
    ];
    const { mindmap } = synthetic(events, [
      segment(events, 0, 1, 'prior'),
      segment(events, 2, 2, 'selected'),
    ]);
    const node = segmentNode(mindmap.root, 'selected');
    for (const snapshot of [node.context_snapshot_continue, node.context_snapshot_fork]) {
      const serialized = JSON.stringify(snapshot);
      expect(serialized).not.toContain('PRIVATE_MATERIAL');
      expect(serialized).not.toContain('SECRET_VALUE');
      expect(serialized).toContain('REDACTED PRIVATE KEY');
      expect(serialized).toContain('before continuing.');
      expect(snapshot.evidence?.truncated_entries).toBe(0);
    }
  });

  it('preserves assistant text blocks but never presents reasoning/tool outputs as decisions', () => {
    const events = [message(0, 'user', 'Choose the simpler design.'), message(1, 'assistant', '')];
    if (events[1].type === 'assistant') {
      events[1].message.content = [
        { type: 'thinking', thinking: 'INTERNAL_REASONING' },
        { type: 'text', text: 'Decision: reuse the current parser.' },
        { type: 'tool_use', id: 'tool', name: 'Read', input: { secret: 'TOOL_PAYLOAD' } },
        { type: 'text', text: 'Keep the existing interface.' },
      ];
    }
    const { mindmap } = synthetic(events, [segment(events, 0, 1, 'selected')]);
    const snapshot = segmentNode(mindmap.root, 'selected').context_snapshot_continue;
    expect(snapshot.evidence?.entries[1].text).toBe(
      'Decision: reuse the current parser.\nKeep the existing interface.',
    );
    expect(JSON.stringify(snapshot)).not.toContain('INTERNAL_REASONING');
    expect(JSON.stringify(snapshot)).not.toContain('TOOL_PAYLOAD');
  });

  it('attributes normalized compaction summaries and excludes those after the cutoff', () => {
    const events = [
      message(0, 'user', 'ORIGINAL_ASK: preserve the wire format.'),
      systemEvent(1, {
        type: 'compaction',
        message: '  PRE_QUESTION_SUMMARY\nThe recorded protocol remains stable.  ',
      }),
      systemEvent(2, { type: 'system', message: 'ARBITRARY_SYSTEM_MESSAGE' }),
      systemEvent(3, { type: 'developer', message: 'ARBITRARY_DEVELOPER_MESSAGE' }),
      systemEvent(4, { type: 'reasoning', message: 'INTERNAL_SYSTEM_REASONING' }),
      message(5, 'user', 'SELECTED_ASK: implement validation.'),
      systemEvent(6, { type: 'compaction', message: 'POST_QUESTION_SUMMARY' }),
      message(7, 'assistant', 'Validation complete.'),
      systemEvent(8, { type: 'compaction', message: 'POST_SEGMENT_SUMMARY' }),
    ];
    const { mindmap } = synthetic(events, [
      segment(events, 0, 4, 'prior'),
      segment(events, 5, 7, 'selected'),
      segment(events, 8, 8, 'future'),
    ]);
    const node = segmentNode(mindmap.root, 'selected');
    const continuation = node.context_snapshot_continue;
    const fork = node.context_snapshot_fork;
    expect(continuation.evidence?.entries.map((entry) => entry.event_index)).toEqual([
      0, 1, 5, 6, 7,
    ]);
    expect(fork.evidence?.entries.map((entry) => entry.event_index)).toEqual([0, 1, 5]);
    expect(fork.evidence?.entries[1]).toMatchObject({
      event_index: 1,
      event_uuid: 'e-1',
      role: 'compaction',
      text: '  PRE_QUESTION_SUMMARY\nThe recorded protocol remains stable.  ',
    });
    expect(continuation.clipboard_markdown).toContain('POST_QUESTION_SUMMARY');
    for (const snapshot of [continuation, fork]) {
      expect(snapshot.evidence?.instruction_index).toBe(5);
      expect(snapshot.clipboard_markdown).toContain(
        'Source event 1 · uuid `e-1` · Recorded compaction summary',
      );
      expect(snapshot.clipboard_markdown).toContain(
        'not original user instructions or verified decisions',
      );
      expect(snapshot.clipboard_markdown).not.toContain('ARBITRARY_SYSTEM_MESSAGE');
      expect(snapshot.clipboard_markdown).not.toContain('ARBITRARY_DEVELOPER_MESSAGE');
      expect(snapshot.clipboard_markdown).not.toContain('INTERNAL_SYSTEM_REASONING');
      expect(snapshot.clipboard_markdown).not.toContain('POST_SEGMENT_SUMMARY');
    }
    expect(fork.clipboard_markdown).not.toContain('POST_QUESTION_SUMMARY');
  });

  it('accepts only normalized string compaction payloads and never treats them as questions', () => {
    const events = [
      systemEvent(0, { type: 'compaction', message: 'RECORDED_CONTEXT_WITHOUT_QUESTION' }),
      systemEvent(1, { type: 'compacted', message: 'UNNORMALIZED_SUMMARY' }),
      systemEvent(2, { type: 'compaction', message: { text: 'NONSTRING_SUMMARY' } }),
      systemEvent(3, { type: 'compaction', summary: 'WRONG_FIELD_SUMMARY' }),
      systemEvent(4, { type: 'compaction', message: ' \n ' }),
    ];
    const { mindmap } = synthetic(events, [segment(events, 0, 4, 'selected')]);
    const node = segmentNode(mindmap.root, 'selected');
    expect(node.context_snapshot_continue.evidence?.entries.map((entry) => entry.role)).toEqual([
      'compaction',
    ]);
    expect(node.context_snapshot_continue.evidence?.instruction_index).toBeNull();
    expect(node.context_snapshot_continue.clipboard_markdown).not.toContain(
      '## Last user instruction',
    );
    expect(node.context_snapshot_fork.evidence?.cutoff_reason).toBe('before_segment');
    expect(node.context_snapshot_fork.evidence?.entries).toEqual([]);
    expect(mindmap.root.context_snapshot_fork.evidence?.cutoff_reason).toBe('no_question');
    for (const excluded of ['UNNORMALIZED_SUMMARY', 'NONSTRING_SUMMARY', 'WRONG_FIELD_SUMMARY']) {
      expect(JSON.stringify(mindmap)).not.toContain(excluded);
    }
  });

  it('redacts complete compaction values before excerpt bounds and respects selected membership', () => {
    const secret = `-----BEGIN PRIVATE KEY-----\n${'SUMMARY_SECRET'.repeat(1_000)}\n-----END PRIVATE KEY-----`;
    const events = [
      message(0, 'user', 'Preserve the original interface.'),
      systemEvent(1, {
        type: 'compaction',
        message: `RECORDED_SUMMARY\n${secret}\n${'summary-context '.repeat(1_000)}`,
      }),
      systemEvent(2, { type: 'compaction', message: 'EXCLUDED_COMPACTION_SUMMARY' }),
      message(3, 'user', 'Continue after compaction.'),
    ];
    const prior = segment(events, 0, 2, 'prior');
    prior.event_uuids = ['e-0', 'e-1'];
    const { mindmap } = synthetic(events, [prior, segment(events, 3, 3, 'selected')]);
    const snapshot = segmentNode(mindmap.root, 'selected').context_snapshot_fork;
    const summary = snapshot.evidence?.entries.find((entry) => entry.role === 'compaction');
    expect(summary?.event_index).toBe(1);
    expect(summary?.text).toContain('REDACTED PRIVATE KEY');
    expect(summary?.omitted_bytes).toBeGreaterThan(0);
    expect(Buffer.byteLength(summary!.text)).toBeLessThanOrEqual(4_096);
    expect(snapshot.clipboard_markdown).toContain('redacted UTF-8 bytes from this event');
    expect(snapshot.evidence?.excluded_events).toBe(1);
    expect(JSON.stringify(mindmap)).not.toContain('SUMMARY_SECRET');
    expect(JSON.stringify(mindmap)).not.toContain('EXCLUDED_COMPACTION_SUMMARY');
  });

  it('bounds long-history ancestry traversal while retaining provable asks and reporting unknown omissions', () => {
    const events: RawEvent[] = [message(0, 'user', 'ORIGINAL_PROVABLE_INSTRUCTION')];
    for (let index = 1; index < 20_000; index += 1) {
      events.push(
        message(
          index,
          index % 2 === 0 ? 'user' : 'assistant',
          `${index % 2 === 0 ? 'Question' : 'Outcome'} at source event ${index}.`,
        ),
      );
    }
    const history = createSnapshotHistory(events, new Set(events), defaultRedactor());
    const exactBoundary = history.forNode(segment(events, 510, 511, 'exact-boundary'), 'segment');
    expect(exactBoundary.continue.scanned_events).toBe(512);
    expect(exactBoundary.continue.traversal_truncated).toBe(false);
    expect(exactBoundary.continue.omitted_entries + exactBoundary.continue.entries.length).toBe(
      512,
    );
    let totalScanned = 0;
    for (let start = 19_920; start < events.length; start += 2) {
      const selected = segment(events, start, start + 1, `selected-${start}`);
      const snapshots = history.forNode(selected, 'segment');
      for (const evidence of [snapshots.continue, snapshots.fork]) {
        totalScanned += evidence.scanned_events;
        expect(evidence.scanned_events).toBe(512);
        expect(evidence.traversal_truncated).toBe(true);
        expect(evidence.instruction_index).toBe(start);
        expect(evidence.entries[0].text).toBe('ORIGINAL_PROVABLE_INSTRUCTION');
        expect(evidence.entries.some((entry) => entry.event_index === start)).toBe(true);
        expect(evidence.entries.length).toBeLessThanOrEqual(32);
        expect(evidence.omitted_entries).toBeGreaterThan(0);
        // The observed lower bound must NOT masquerade as the full prefix count.
        expect(evidence.omitted_entries + evidence.entries.length).toBeLessThan(start);
        expect(evidence.entries.every((entry) => entry.event_index <= evidence.cutoff_index!)).toBe(
          true,
        );
      }
      expect(snapshots.continue.entries.some((entry) => entry.event_index === start + 1)).toBe(
        true,
      );
      expect(snapshots.fork.entries.some((entry) => entry.event_index === start + 1)).toBe(false);
    }
    expect(totalScanned).toBe(40 * 2 * 512);
    const root = history.forNode(null, 'root');
    expect(root.continue.scanned_events).toBe(512);
    expect(root.continue.traversal_truncated).toBe(true);
    expect(root.continue.entries[0].text).toBe('ORIGINAL_PROVABLE_INSTRUCTION');
    expect(root.fork.entries.map((entry) => entry.event_index)).toEqual([0]);
    expect(root.fork.traversal_truncated).toBe(false);
    const selected = segment(events, 19_998, 19_999, 'latest');
    const evidence = history.forNode(selected, 'segment').continue;
    expect(history.forNode(selected, 'segment').continue).toEqual(evidence);
    const snapshot = buildContinueSnapshot({
      sessionId: 'recovery-test',
      nodeId: 'latest-node',
      jsonlPath: syntheticOptions.jsonlPath,
      label: 'Latest selection',
      generatedAt: syntheticOptions.generatedAt,
      segment: selected,
      evidence,
    });
    expect(snapshot.clipboard_markdown).toContain('Traversal limited to 512 source occurrences');
    expect(snapshot.clipboard_markdown).toContain('Additional context is uncounted');
    expect(snapshot.clipboard_markdown).toContain('lower bounds, not totals');
    expect(snapshot.clipboard_markdown).toContain('Omitted by bounds: at least');
    expect(Buffer.byteLength(snapshot.clipboard_markdown)).toBeLessThanOrEqual(80_000);
  });

  it('labels Git context as current rather than historical and bounds all enrichment', () => {
    const events = [message(0, 'user', 'Keep the public API stable.')];
    const selected = segment(events, 0, 0, 'selected');
    selected.dominant_files = Array.from(
      { length: 40 },
      (_, index) => `${index}-${'file'.repeat(3_000)}`,
    );
    const { mindmap } = synthetic(events, [selected]);
    const original = segmentNode(mindmap.root, 'selected').context_snapshot_continue;
    const snapshot = buildContinueSnapshot({
      sessionId: 'recovery-test',
      nodeId: original.node_id,
      jsonlPath: 'path'.repeat(10_000),
      label: 'label'.repeat(10_000),
      generatedAt: syntheticOptions.generatedAt,
      segment: selected,
      evidence: original.evidence!,
      redactor: defaultRedactor(),
      llm: {
        label: 'Enriched',
        summary: 'summary'.repeat(10_000),
        next_steps: Array.from({ length: 100 }, () => 'step'.repeat(10_000)),
      },
      gitContext: {
        cwd: '/project',
        available: true,
        branch: 'current-branch',
        shortHead: '1234567',
        status: ` M current-file.ts\n-----BEGIN PRIVATE KEY-----\n${'PRIVATE_GIT_MATERIAL\n'.repeat(30)}-----END PRIVATE KEY-----\n M after-key.ts`,
      },
    });
    expect(snapshot.clipboard_markdown).toContain('CURRENT at generation time, not historical');
    expect(snapshot.clipboard_markdown).toContain(
      'Current Git context only; NOT historical evidence',
    );
    expect(snapshot.clipboard_markdown).toContain('current-branch');
    expect(snapshot.clipboard_markdown).not.toContain('PRIVATE_GIT_MATERIAL');
    expect(snapshot.clipboard_markdown).toContain('after-key.ts');
    expect(snapshot.clipboard_markdown).toContain('Omitted:');
    expect(snapshot.related_files).toHaveLength(20);
    expect(snapshot.next_steps).toHaveLength(8);
    expect(Buffer.byteLength(snapshot.clipboard_markdown)).toBeLessThanOrEqual(80_000);
  });

  it('LLM refresh preserves bounded history and leaves fork prompts unchanged', async () => {
    const events = [
      message(0, 'user', 'ORIGINAL_INSTRUCTION: preserve the protocol.'),
      message(1, 'assistant', 'PRIOR_DECISION: reuse the existing protocol.'),
      systemEvent(2, { type: 'compaction', message: 'RECORDED_COMPACTION_CONTEXT' }),
      message(3, 'user', 'SELECTED_QUESTION: add validation.'),
      message(4, 'assistant', 'FUTURE_SELECTED_OUTCOME'),
    ];
    const { graph, segments, mindmap } = synthetic(events, [
      segment(events, 0, 2, 'prior'),
      segment(events, 3, 4, 'selected'),
    ]);
    const node = segmentNode(mindmap.root, 'selected');
    const originalEvidence = structuredClone(node.context_snapshot_continue.evidence);
    const originalFork = structuredClone(node.context_snapshot_fork);
    const client = {
      messages: {
        countTokens: vi.fn(async () => ({ input_tokens: 10 })),
        create: vi.fn(async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                label: 'FUTURE_LABEL',
                summary: 'FUTURE_SUMMARY',
                type: 'decision',
                color: 'green',
                next_steps: ['FUTURE_NEXT_STEP'],
              }),
            },
          ],
          usage: { input_tokens: 10, output_tokens: 10 },
        })),
      },
    };
    await labelMindMap(mindmap, graph, segments, {
      client,
      model: 'test-labeler',
      jsonlPath: syntheticOptions.jsonlPath,
      redactor: defaultRedactor(),
    });
    expect(node.context_snapshot_continue.evidence).toEqual(originalEvidence);
    expect(node.context_snapshot_continue.clipboard_markdown).toContain('PRIOR_DECISION');
    expect(node.context_snapshot_continue.clipboard_markdown).toContain(
      'RECORDED_COMPACTION_CONTEXT',
    );
    expect(node.context_snapshot_continue.clipboard_markdown).toContain('FUTURE_SUMMARY');
    expect(node.context_snapshot_fork).toEqual(originalFork);
    expect(JSON.stringify(node.context_snapshot_fork)).not.toContain('FUTURE');
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });
});

describe('LLM-enriched snapshot', () => {
  it('adds Decisions / Suggested continuation when label is supplied', async () => {
    const { mindmap, graph, segments } = await buildFixtureMindmap();

    const client = {
      messages: {
        countTokens: vi.fn(async () => ({ input_tokens: 100 })),
        create: vi.fn(async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                label: 'Mocked label',
                summary: 'Mocked summary of segment work.',
                type: 'topic',
                color: 'green',
                next_steps: ['Refactor X', 'Add tests for Y'],
              }),
            },
          ],
          usage: { input_tokens: 100, output_tokens: 20 },
        })),
      },
    };

    await labelMindMap(mindmap, graph, segments, {
      client,
      model: 'claude-sonnet-4-6',
      jsonlPath: FIXTURE,
    });

    let foundEnriched = false;
    walkMarkdown(mindmap.root, (md) => {
      // The LLM enrichment must surface in the snapshot:
      //   - the model's `summary` lands in the "Context up to this point" block
      //   - each `next_steps` entry lands in the "Suggested continuation" block
      // ("Decisions locked in" was dropped in the audit pass — its body was
      // identical to "Context up to this point" so it added no info; the test
      // used to assert both for redundancy.)
      if (
        md.includes('## Context up to this point') &&
        md.includes('## Suggested continuation') &&
        md.includes('- Refactor X') &&
        md.includes('Mocked summary of segment work.')
      ) {
        foundEnriched = true;
      }
      // And still no jargon leaks through the rebuild
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(md).not.toContain(phrase);
      }
    });
    expect(foundEnriched).toBe(true);
  });
});
