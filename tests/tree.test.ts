import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { detectSegments } from '../src/analyzer/segments.js';
import { buildGraph } from '../src/reader/graph.js';
import { readJsonl } from '../src/reader/jsonl.js';
import { buildMindMap } from '../src/tree/builder.js';
import type { MindMapNode, RawEvent } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/minimal-session.jsonl');

async function fixtureMindMap() {
  const { meta, events } = await readJsonl(FIXTURE);
  const graph = buildGraph(meta, events);
  const segments = detectSegments(graph.events);
  return buildMindMap(graph, segments, {
    jsonlPath: FIXTURE,
    specVersion: 'v0.3-test',
    generatedAt: '2026-04-21T00:00:00.000Z',
  });
}

function interleavedEvents(): RawEvent[] {
  const event = (
    index: number,
    minute: number,
    isSidechain: boolean,
    content: string | { name: string; file: string },
  ): RawEvent => {
    const envelope = {
      uuid: `event-${index}`,
      parentUuid: index === 0 ? null : `event-${index - 1}`,
      isSidechain,
      timestamp: new Date(Date.UTC(2026, 3, 21, 0, minute)).toISOString(),
      sessionId: 'interleaved-session',
      cwd: isSidechain ? '/sidechain' : '/project',
      gitBranch: 'main',
      version: 'test',
      entrypoint: 'test',
      userType: 'test',
    };
    if (typeof content === 'string') {
      return { ...envelope, type: 'user', message: { role: 'user', content } };
    }
    return {
      ...envelope,
      type: 'tool_use',
      tool_use: {
        id: `tool-${index}`,
        name: content.name,
        input: { file_path: content.file },
      },
    };
  };
  return [
    event(0, 0, true, 'Hidden preparation instruction'),
    event(1, 1, true, { name: 'Write', file: 'private/preparation.ts' }),
    event(2, 10, false, 'Now implement the main parser'),
    event(3, 11, false, { name: 'Edit', file: 'src/parser.ts' }),
    event(4, 12, true, 'Now run the hidden delegated work'),
    event(5, 13, true, { name: 'NotebookEdit', file: 'private/delegated.ipynb' }),
    event(6, 14, false, 'Next validate the public result'),
    event(7, 15, false, { name: 'Read', file: 'src/parser.ts' }),
    event(8, 59, true, 'Hidden trailing instruction'),
    event(9, 60, true, { name: 'Bash', file: 'private/trailing.ts' }),
  ];
}

function allNodes(node: MindMapNode): MindMapNode[] {
  return [node, ...node.children.flatMap(allNodes)];
}

describe('buildMindMap (§7.4)', () => {
  it('assigns root id n_001 and sequential pre-order ids', async () => {
    const mm = await fixtureMindMap();
    expect(mm.root.id).toBe('n_001');
    const ids: string[] = [];
    const walk = (n: { id: string; children: { id: string; children: unknown[] }[] }) => {
      ids.push(n.id);
      for (const c of n.children) walk(c as typeof n);
    };
    walk(mm.root);
    ids.forEach((id, i) => {
      expect(id).toBe(`n_${String(i + 1).padStart(3, '0')}`);
    });
  });

  it('root type is "root" and shape is rect', async () => {
    const mm = await fixtureMindMap();
    expect(mm.root.type).toBe('root');
    expect(mm.root.shape).toBe('rect');
  });

  it('produces a 🔀 Sidechains bucket when sidechain segments exist', async () => {
    const mm = await fixtureMindMap();
    const bucket = mm.root.children.find((c) => c.label.startsWith('🔀'));
    expect(bucket).toBeDefined();
    expect(bucket!.is_sidechain).toBe(true);
    expect(bucket!.children.length).toBeGreaterThan(0);
  });

  it('includes continue + fork snapshots on every node', async () => {
    const mm = await fixtureMindMap();
    const walk = (n: typeof mm.root) => {
      expect(n.context_snapshot_continue.mode).toBe('continue');
      expect(n.context_snapshot_fork.mode).toBe('fork');
      expect(n.context_snapshot_continue.clipboard_markdown).toContain('Continuing from');
      expect(n.context_snapshot_fork.clipboard_markdown).toContain('Forking at');
      for (const c of n.children) walk(c);
    };
    walk(mm.root);
  });

  it('derives root label from first user message text', async () => {
    const mm = await fixtureMindMap();
    // Fixture line 3 user text: "Please read src/foo.ts and explain"
    expect(mm.root.label).toContain('Please read');
  });

  it('stats reports 9 events / matches the fixture', async () => {
    const mm = await fixtureMindMap();
    expect(mm.stats.total_events).toBe(9);
    expect(mm.stats.total_turns).toBeGreaterThan(0);
    expect(mm.stats.total_tool_calls).toBeGreaterThan(0);
  });
});

describe('buildMindMap sidechain selection', () => {
  const options = {
    // A fixed path keeps the exclusion assertions below independent of the
    // checkout location (a clone under /private/tmp contains "private/").
    jsonlPath: '/fixtures/interleaved-session.jsonl',
    specVersion: 'v0.3-test',
    generatedAt: '2026-04-21T00:00:00.000Z',
  };
  const meta = { sessionId: 'interleaved-session', permissionMode: 'default' };

  it('drops sidechain text, tools and files from root and leaf snapshots without renumbering events', () => {
    const events = interleavedEvents();
    const graph = buildGraph(meta, events);
    const original = structuredClone(graph);
    const segments = detectSegments(graph.events, { sidechainHandling: 'drop' });
    const mm = buildMindMap(graph, segments, options);

    expect(mm.root.index_range).toEqual([2, 7]);
    expect(mm.root.event_uuids).toEqual(['event-2', 'event-3', 'event-6', 'event-7']);
    expect(mm.root.label).toBe('Now implement the main parser');
    expect(mm.root.summary).toContain('4 events, 2 segments');
    expect(mm.root.files_touched).toEqual(['src/parser.ts']);
    expect(mm.root.tools_used).toEqual(['Edit', 'Read']);
    expect(mm.project_path).toBe('/project');
    expect(mm.stats).toMatchObject({
      total_events: 4,
      total_turns: 2,
      total_tool_calls: 2,
      total_files_touched: 1,
      duration_minutes: 5,
      sidechain_count: 0,
    });
    expect(mm.root.children.map((n) => n.index_range)).toEqual([
      [2, 3],
      [6, 7],
    ]);
    expect(mm.root.children.map((n) => n.time_offset_ms)).toEqual([0, 240_000]);

    const instructions = ['Now implement the main parser', 'Next validate the public result'];
    for (const snapshot of [mm.root.context_snapshot_continue, mm.root.context_snapshot_fork]) {
      expect(snapshot.clipboard_markdown).toContain(instructions[0]);
    }
    mm.root.children.forEach((node, index) => {
      expect(node.event_uuids).toEqual(
        index === 0 ? ['event-2', 'event-3'] : ['event-6', 'event-7'],
      );
      for (const snapshot of [node.context_snapshot_continue, node.context_snapshot_fork]) {
        expect(snapshot.clipboard_markdown).toContain(instructions[index]);
        expect(snapshot.related_files.map((file) => file.path)).toEqual(['src/parser.ts']);
      }
    });
    const serialized = JSON.stringify(mm);
    for (const excluded of [
      'Hidden',
      'hidden',
      'private/',
      'Write',
      'NotebookEdit',
      'Bash',
      '/sidechain',
    ]) {
      expect(serialized).not.toContain(excluded);
    }
    expect(graph.events).toBe(events);
    expect(graph).toEqual(original);
  });

  it('uses exact membership for phase creation and snapshots even when ranges cover excluded events', () => {
    const graph = buildGraph(meta, interleavedEvents());
    const segments = detectSegments(graph.events, { sidechainHandling: 'drop' });
    const sparseSegments = [
      { ...segments[0], end_index: 5 },
      {
        ...segments[1],
        start_index: 4,
        event_uuids: ['event-7'],
        time_range: [graph.events[7].timestamp, graph.events[7].timestamp] as [string, string],
      },
    ];
    const mm = buildMindMap(graph, sparseSegments, options);

    expect(mm.root.event_uuids).toEqual(['event-2', 'event-3', 'event-7']);
    expect(mm.root.children).toHaveLength(1);
    const phase = mm.root.children[0];
    expect(phase.children).toHaveLength(1);
    const action = phase.children[0];
    expect(action.event_uuids).toEqual(['event-7']);
    expect(action.label).toBe('parser.ts (Read)');
    for (const snapshot of [phase.context_snapshot_continue, phase.context_snapshot_fork]) {
      expect(snapshot.clipboard_markdown).toContain('Now implement the main parser');
    }
    for (const snapshot of [action.context_snapshot_continue, action.context_snapshot_fork]) {
      expect(snapshot.related_files.map((file) => file.path)).toEqual(['src/parser.ts']);
      expect(snapshot.clipboard_markdown).not.toContain('user instruction');
    }
    expect(JSON.stringify(mm)).not.toContain('hidden delegated');
    expect(JSON.stringify(mm)).not.toContain('Next validate');
    expect(JSON.stringify(mm)).not.toContain('private/');
    expect(mm.stats.total_events).toBe(3);
  });

  it('does not restore dropped source occurrences with duplicate UUIDs in root metadata', () => {
    const events = interleavedEvents();
    events[0] = { ...events[0], uuid: events[2].uuid };
    events[8] = { ...events[8], uuid: events[6].uuid };
    const graph = buildGraph(meta, events);
    const segments = detectSegments(graph.events, { sidechainHandling: 'drop' });
    const mm = buildMindMap(graph, segments, options);

    expect(mm.root.event_uuids).toEqual(['event-2', 'event-3', 'event-6', 'event-7']);
    expect(mm.root.label).toBe('Now implement the main parser');
    expect(mm.stats.total_events).toBe(4);
    expect(mm.stats.sidechain_count).toBe(0);
    expect(JSON.stringify(mm)).not.toContain('Hidden');
  });

  it('flattens semantic grouping in chronological source order while retaining included resume context', () => {
    const events = interleavedEvents();
    const graph = buildGraph(meta, events);
    const original = structuredClone(graph);
    const segments = detectSegments(graph.events, { sidechainHandling: 'flatten' });
    const mm = buildMindMap(graph, segments, options);

    expect(mm.root.children.map((n) => n.index_range)).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
      [8, 9],
    ]);
    expect(allNodes(mm.root).every((n) => !n.is_sidechain)).toBe(true);
    expect(mm.root.children.flatMap((n) => n.event_uuids)).toEqual(events.map((e) => e.uuid));
    expect(mm.stats).toMatchObject({
      total_events: 10,
      total_turns: 5,
      total_tool_calls: 5,
      total_files_touched: 4,
      duration_minutes: 60,
      sidechain_count: 6,
    });
    const expectedInstructions = [
      'Hidden preparation instruction',
      'Now implement the main parser',
      'Now run the hidden delegated work',
      'Next validate the public result',
      'Hidden trailing instruction',
    ];
    const expectedFiles = [
      'private/preparation.ts',
      'src/parser.ts',
      'private/delegated.ipynb',
      'src/parser.ts',
      'private/trailing.ts',
    ];
    mm.root.children.forEach((node, index) => {
      for (const snapshot of [node.context_snapshot_continue, node.context_snapshot_fork]) {
        expect(snapshot.clipboard_markdown).toContain(expectedInstructions[index]);
        expect(snapshot.related_files.map((file) => file.path)).toEqual([expectedFiles[index]]);
      }
    });
    expect(graph.events).toBe(events);
    expect(graph).toEqual(original);
  });

  it('leaves an empty root when all source events are dropped', () => {
    const events = interleavedEvents().filter((event) => event.isSidechain);
    const graph = buildGraph(meta, events);
    const segments = detectSegments(graph.events, { sidechainHandling: 'drop' });
    const mm = buildMindMap(graph, segments, options);

    expect(mm.root.event_uuids).toEqual([]);
    expect(mm.root.children).toEqual([]);
    expect(mm.root.files_touched).toEqual([]);
    expect(mm.root.tools_used).toEqual([]);
    expect(mm.project_path).toBe('');
    expect(mm.stats).toEqual({
      total_events: 0,
      total_turns: 0,
      total_nodes: 1,
      total_tool_calls: 0,
      total_files_touched: 0,
      duration_minutes: 0,
      sidechain_count: 0,
    });
    expect(JSON.stringify(mm)).not.toContain('Hidden');
    expect(JSON.stringify(mm)).not.toContain('private/');
  });
});
