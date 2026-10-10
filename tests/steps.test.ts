import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { detectSegments } from '../src/analyzer/segments.js';
import { buildGraph } from '../src/reader/graph.js';
import { readJsonl } from '../src/reader/jsonl.js';
import { renderTextTree } from '../src/render/text.js';
import { buildMindMap } from '../src/tree/builder.js';
import { buildStepIndex } from '../src/tree/steps.js';
import type { MindMap, MindMapNode } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/minimal-session.jsonl');

function node(id: string, uuids: string[], children: MindMapNode[] = []): MindMapNode {
  const snapshot = {
    mode: 'continue' as const,
    session_id: 's',
    node_id: id,
    clipboard_markdown: '',
    related_files: [],
    next_steps: [],
  };
  return {
    id,
    type: children.length ? 'topic' : 'action',
    label: id,
    summary: '',
    index_range: [0, 0],
    event_uuids: uuids,
    files_touched: [],
    tools_used: [],
    is_sidechain: false,
    children,
    context_snapshot_continue: snapshot,
    context_snapshot_fork: { ...snapshot, mode: 'fork' },
  };
}

function mindmap(root: MindMapNode): MindMap {
  return {
    source: 'claude',
    session_id: 'aaaa1111-2222-3333-4444-555566667777',
    project_path: '/p',
    generated_at: '2026-10-10T00:00:00.000Z',
    spec_version: 'test',
    root,
    stats: {
      total_events: 0,
      total_turns: 0,
      total_nodes: 0,
      total_tool_calls: 0,
      total_files_touched: 0,
      duration_minutes: 0,
      sidechain_count: 0,
    },
  };
}

describe('buildStepIndex', () => {
  const tree = mindmap(
    node('n_001', ['u1', 'u2', 'u3', 'u4', 'u5'], [
      node('n_002', ['u1', 'u2', 'u3'], [node('n_003', ['u2']), node('n_004', ['u3'])]),
      node('n_005', ['u4']),
    ]),
  );

  it('maps an event to the deepest node holding it, not only leaves', () => {
    const steps = buildStepIndex(tree);
    expect(steps.stepOfEvent('u2')).toBe(3);
    expect(steps.stepOfEvent('u3')).toBe(4);
    expect(steps.stepOfEvent('u1')).toBe(2); // phase head
    expect(steps.stepOfEvent('u5')).toBe(1); // root only
    expect(steps.stepOfEvent('missing')).toBeUndefined();
  });

  it('uses the same numbers as the rendered tree', () => {
    const steps = buildStepIndex(tree);
    const rendered = renderTextTree(tree);
    for (const { number, id } of rendered.nodes) {
      expect(steps.stepOfNode(id)).toBe(number);
      expect(steps.nodeOfStep(number)?.id).toBe(id);
    }
    expect(steps.nodeOfStep(99)).toBeUndefined();
  });

  it('keeps the lower step when two nodes at one depth hold the same event', () => {
    const overlap = mindmap(node('n_001', ['x'], [node('n_002', ['x']), node('n_003', ['x'])]));
    expect(buildStepIndex(overlap).stepOfEvent('x')).toBe(2);
  });

  it('places every fixture event on a step whose node holds it', async () => {
    const { meta, events } = await readJsonl(FIXTURE);
    const graph = buildGraph(meta, events);
    const map = buildMindMap(graph, detectSegments(graph.events), {
      jsonlPath: FIXTURE,
      specVersion: 'test',
      generatedAt: '2026-10-10T00:00:00.000Z',
    });
    const steps = buildStepIndex(map);
    let placed = 0;
    for (const uuid of map.root.event_uuids) {
      const step = steps.stepOfEvent(uuid);
      expect(step).toBeDefined();
      expect(steps.nodeOfStep(step!)?.event_uuids).toContain(uuid);
      placed++;
    }
    expect(placed).toBe(map.root.event_uuids.length);
    expect(placed).toBeGreaterThan(0);
  });
});
