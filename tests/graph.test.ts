import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buildGraph, graphToDump } from '../src/reader/graph.js';
import { readJsonl } from '../src/reader/jsonl.js';
import type { RawEvent, SessionMeta } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/minimal-session.jsonl');

describe('buildGraph (§7.1 pass 2)', () => {
  it('finds exactly one root at u-001', async () => {
    const { meta, events } = await readJsonl(FIXTURE);
    const graph = buildGraph(meta, events);
    expect(graph.roots).toEqual(['u-001']);
  });

  it('builds parent→children edges linearly for the fixture', async () => {
    const { meta, events } = await readJsonl(FIXTURE);
    const graph = buildGraph(meta, events);
    expect(graph.childrenOf.get('u-001')).toEqual(['u-002']);
    expect(graph.childrenOf.get('u-002')).toEqual(['u-003']);
    expect(graph.childrenOf.get('u-008')).toEqual(['u-009']);
  });

  it('indexes every event by uuid', async () => {
    const { meta, events } = await readJsonl(FIXTURE);
    const graph = buildGraph(meta, events);
    expect(graph.byUuid.size).toBe(events.length);
    for (const e of events) {
      expect(graph.byUuid.get(e.uuid)).toBe(e);
    }
  });

  it('graphToDump produces JSON-serializable plain object', async () => {
    const { meta, events } = await readJsonl(FIXTURE);
    const graph = buildGraph(meta, events);
    const dump = graphToDump(graph);
    expect(dump.roots).toEqual(['u-001']);
    expect(dump.childrenOf['u-001']).toEqual(['u-002']);
    expect(dump.stats.total_events).toBe(9);
    expect(dump.stats.sidechain_count).toBe(2); // u-007, u-008
    // Round-trip through JSON without loss
    const round = JSON.parse(JSON.stringify(dump));
    expect(round.stats.root_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Indirect cycle guard — v0.1.2
// ---------------------------------------------------------------------------

describe('buildGraph — indirect cycle guard', () => {
  function synthEvent(uuid: string, parentUuid: string | null): RawEvent {
    // Minimal shape that satisfies RawEvent without loading a fixture;
    // only uuid / parentUuid / (indirectly) duplicate-uuid matter for the
    // cycle guard. All other envelope fields get placeholders.
    return {
      uuid,
      parentUuid,
      isSidechain: false,
      timestamp: '2026-04-24T00:00:00.000Z',
      sessionId: 'test',
      cwd: '/tmp',
      gitBranch: 'main',
      version: 'test',
      entrypoint: 'test',
      userType: 'test',
      type: 'other',
      originalType: 'synthetic',
      payload: {},
    } as RawEvent;
  }

  const meta: SessionMeta = { sessionId: 'test', permissionMode: 'default' };

  it('breaks an indirect cycle (B↔C under root A) without infinite-looping downstream walkers', () => {
    // Build a graph where B and C point at each other. Trick: a duplicate
    // uuid in jsonl can synthesize this — second `B` overwrites byUuid but
    // both parentUuid values still feed childrenOf.
    //
    //   A (root)
    //   └─ B (parent=A)
    //       └─ C (parent=B)
    //           └─ B' (parent=C)  ← duplicate uuid, back-edge C→B
    const events: RawEvent[] = [
      synthEvent('A', null),
      synthEvent('B', 'A'),
      synthEvent('C', 'B'),
      synthEvent('B', 'C'), // duplicate uuid → closes B↔C loop
    ];
    const graph = buildGraph(meta, events);

    // Walk the DAG from root with a visit cap — if the cycle guard failed,
    // this loop would be unbounded.
    const seen = new Set<string>();
    const stack = [...graph.roots];
    let steps = 0;
    while (stack.length > 0 && steps < 100) {
      const uuid = stack.pop()!;
      if (seen.has(uuid)) continue;
      seen.add(uuid);
      for (const child of graph.childrenOf.get(uuid) ?? []) stack.push(child);
      steps += 1;
    }
    expect(steps).toBeLessThan(100); // terminated naturally
    expect(seen.has('A')).toBe(true);
    expect(seen.has('B')).toBe(true);
    expect(seen.has('C')).toBe(true);
    // The cycle guard dropped exactly the back-edge — C no longer lists B
    // as a child.
    expect(graph.childrenOf.get('C') ?? []).not.toContain('B');
  });

  it('preserves legitimate diamond shapes that don\'t actually cycle', () => {
    // Diamond: A → B, A → C. No back edges. Nothing should be removed.
    //   A
    //   ├─ B
    //   └─ C
    const events: RawEvent[] = [
      synthEvent('A', null),
      synthEvent('B', 'A'),
      synthEvent('C', 'A'),
    ];
    const graph = buildGraph(meta, events);
    expect(graph.childrenOf.get('A')).toEqual(['B', 'C']);
  });

  it('is safe on the empty-events case', () => {
    const graph = buildGraph(meta, []);
    expect(graph.roots).toEqual([]);
    expect(graph.childrenOf.size).toBe(0);
  });
});
