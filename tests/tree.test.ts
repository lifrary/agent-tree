import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { detectSegments } from '../src/analyzer/segments.js';
import { buildGraph } from '../src/reader/graph.js';
import { readJsonl } from '../src/reader/jsonl.js';
import { buildMindMap } from '../src/tree/builder.js';

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
      expect(n.context_snapshot_continue.clipboard_markdown).toContain(
        'Continuing from',
      );
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
