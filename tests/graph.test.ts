import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buildGraph, graphToDump } from '../src/reader/graph.js';
import { readJsonl } from '../src/reader/jsonl.js';
import type { RawEvent, SessionGraph, SessionMeta } from '../src/types.js';
import type { Logger } from '../src/utils/logger.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/minimal-session.jsonl');

function expectForest(graph: SessionGraph): void {
  expect(new Set(graph.roots).size).toBe(graph.roots.length);
  const incoming = new Map<string, number>();
  for (const [parent, children] of graph.childrenOf) {
    expect(graph.byUuid.has(parent)).toBe(true);
    expect(new Set(children).size).toBe(children.length);
    for (const child of children) {
      expect(graph.byUuid.has(child)).toBe(true);
      incoming.set(child, (incoming.get(child) ?? 0) + 1);
    }
  }
  for (const uuid of graph.byUuid.keys()) {
    expect(incoming.get(uuid) ?? 0).toBe(graph.roots.includes(uuid) ? 0 : 1);
  }
  const seen = new Set<string>();
  const stack = [...graph.roots];
  while (stack.length > 0) {
    const uuid = stack.pop()!;
    expect(seen.has(uuid)).toBe(false);
    seen.add(uuid);
    stack.push(...(graph.childrenOf.get(uuid) ?? []));
  }
  expect([...seen].sort()).toEqual([...graph.byUuid.keys()].sort());
}

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

  it('resolves duplicate parents before breaking a newly disconnected cycle', () => {
    const events: RawEvent[] = [
      synthEvent('A', null),
      synthEvent('B', 'A'),
      synthEvent('C', 'B'),
      synthEvent('B', 'C'), // duplicate uuid → closes B↔C loop
    ];
    const graph = buildGraph(meta, events);

    // Winning occurrences are A, C, B. The obsolete A→B edge is gone;
    // C starts cycle traversal and is promoted when B→C is cut.
    expect(graph.roots).toEqual(['A', 'C']);
    expect(graph.childrenOf.has('A')).toBe(false);
    expect(graph.childrenOf.get('C')).toEqual(['B']);
    expect(graph.childrenOf.has('B')).toBe(false);
    expect(graph.byUuid.get('B')).toBe(events[3]);
    expect(graph.events).toBe(events);
    expectForest(graph);
  });

  it("preserves legitimate diamond shapes that don't actually cycle", () => {
    // Diamond: A → B, A → C. No back edges. Nothing should be removed.
    //   A
    //   ├─ B
    //   └─ C
    const events: RawEvent[] = [synthEvent('A', null), synthEvent('B', 'A'), synthEvent('C', 'A')];
    const graph = buildGraph(meta, events);
    expect(graph.childrenOf.get('A')).toEqual(['B', 'C']);
    expectForest(graph);
  });

  it('breaks a pure rootless cycle and makes all its events reachable', () => {
    const events = [synthEvent('A', 'C'), synthEvent('B', 'A'), synthEvent('C', 'B')];
    const warn = vi.fn();
    const logger: Logger = {
      level: 'warn',
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    };
    const graph = buildGraph(meta, events, { logger });
    expect(graph.roots).toEqual(['A']);
    expect(graph.childrenOf.get('A')).toEqual(['B']);
    expect(graph.childrenOf.get('B')).toEqual(['C']);
    expect(graph.childrenOf.has('C')).toBe(false);
    expect(warn).toHaveBeenCalledWith('cycle detected in parentUuid chain, dropping back-edge', {
      from: 'C',
      to: 'A',
    });
    // Preserve source diagnostics and source-index associations.
    expect(events[0].parentUuid).toBe('C');
    expect(graph.events).toBe(events);
    expectForest(graph);
  });

  it('normalizes detached cycles even when a descendant appears first', () => {
    const graph = buildGraph(meta, [
      synthEvent('leaf', 'A'),
      synthEvent('root', null),
      synthEvent('C', 'B'),
      synthEvent('A', 'C'),
      synthEvent('B', 'A'),
      synthEvent('X', 'Y'),
      synthEvent('Y', 'X'),
    ]);
    expect(graph.roots).toEqual(['root', 'C', 'X']);
    expect(graph.childrenOf.get('A')).toEqual(['leaf', 'B']);
    expectForest(graph);
  });

  it('uses only final duplicate occurrences for roots, edges and child order', () => {
    const events = [
      synthEvent('root', null),
      synthEvent('duplicate', null),
      synthEvent('old-child', 'duplicate'),
      synthEvent('child', 'root'),
      synthEvent('duplicate', 'root'),
      synthEvent('child', null),
      synthEvent('sibling', 'root'),
    ];
    const warn = vi.fn();
    const logger: Logger = {
      level: 'warn',
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    };
    const graph = buildGraph(meta, events, { logger });
    expect(graph.roots).toEqual(['root', 'child']);
    expect(graph.childrenOf.get('root')).toEqual(['duplicate', 'sibling']);
    expect(graph.childrenOf.get('duplicate')).toEqual(['old-child']);
    expect(graph.byUuid.get('duplicate')).toBe(events[4]);
    expect(graph.byUuid.get('child')).toBe(events[5]);
    expect([...graph.byUuid.keys()]).toEqual([
      'root',
      'old-child',
      'duplicate',
      'child',
      'sibling',
    ]);
    expect(graph.events).toBe(events);
    expect(graph.events).toHaveLength(7);
    expect(graphToDump(graph).stats.total_events).toBe(7);
    expect(warn).toHaveBeenCalledTimes(2);
    expectForest(graph);
  });

  it('deduplicates roots and edges even when the identical object is repeated', () => {
    const root = synthEvent('root', null);
    const child = synthEvent('child', 'root');
    const graph = buildGraph(meta, [root, root, child, child]);
    expect(graph.roots).toEqual(['root']);
    expect(graph.childrenOf.get('root')).toEqual(['child']);
    expectForest(graph);
  });

  it('distinguishes forward references from orphans and self-references', () => {
    const events = [
      synthEvent('child', 'parent'),
      synthEvent('orphan', 'missing'),
      synthEvent('self', 'self'),
      synthEvent('parent', null),
    ];
    const warn = vi.fn();
    const logger: Logger = {
      level: 'warn',
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    };
    const graph = buildGraph(meta, events, { logger });
    expect(graph.roots).toEqual(['orphan', 'self', 'parent']);
    expect(graph.childrenOf.get('parent')).toEqual(['child']);
    expect(events.map((event) => event.parentUuid)).toEqual(['parent', 'missing', 'self', null]);
    expect(graphToDump(graph).stats.orphan_count).toBe(1);
    expect(warn).toHaveBeenCalledTimes(2);
    expectForest(graph);
  });

  it('handles deep cycles without recursive traversal', () => {
    const events = Array.from({ length: 15_000 }, (_, index) =>
      synthEvent(String(index), String(index === 0 ? 14_999 : index - 1)),
    );
    const graph = buildGraph(meta, events);
    expect(graph.roots).toEqual(['0']);
    expect(graph.childrenOf.size).toBe(14_999);
    expect(graph.childrenOf.has('14999')).toBe(false);
    let uuid: string | undefined = '0';
    let count = 0;
    while (uuid !== undefined && count <= events.length) {
      count += 1;
      uuid = graph.childrenOf.get(uuid)?.[0];
    }
    expect(count).toBe(events.length);
    expect(uuid).toBeUndefined();
  });

  it('serializes special UUID property names without prototype mutation', () => {
    const graph = buildGraph(meta, [
      synthEvent('__proto__', null),
      synthEvent('constructor', '__proto__'),
      synthEvent('toString', 'constructor'),
    ]);
    const dump = graphToDump(graph);
    expect(Object.getPrototypeOf(dump.childrenOf)).toBe(Object.prototype);
    expect(Object.hasOwn(dump.childrenOf, '__proto__')).toBe(true);
    expect(JSON.parse(JSON.stringify(dump)).childrenOf).toEqual({
      ['__proto__']: ['constructor'],
      constructor: ['toString'],
    });
    expectForest(graph);
  });

  it('is safe on the empty-events case', () => {
    const graph = buildGraph(meta, []);
    expect(graph.roots).toEqual([]);
    expect(graph.childrenOf.size).toBe(0);
  });
});
