import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buildGraph, graphToDump } from '../src/reader/graph.js';
import { readJsonl } from '../src/reader/jsonl.js';

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
