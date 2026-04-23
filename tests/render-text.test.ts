import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { detectSegments } from '../src/analyzer/segments.js';
import { buildGraph } from '../src/reader/graph.js';
import { readJsonl } from '../src/reader/jsonl.js';
import {
  lookupSnapshot,
  parseSelection,
  renderTextTree,
} from '../src/render/text.js';
import { buildMindMap } from '../src/tree/builder.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/minimal-session.jsonl');

async function fixtureMindmap() {
  const { meta, events } = await readJsonl(FIXTURE);
  const graph = buildGraph(meta, events);
  const segments = detectSegments(graph.events);
  return buildMindMap(graph, segments, {
    jsonlPath: FIXTURE,
    specVersion: 'v0.3-test',
    generatedAt: '2026-04-22T00:00:00.000Z',
  });
}

describe('renderTextTree', () => {
  it('numbers nodes in DFS pre-order starting at 1', async () => {
    const mindmap = await fixtureMindmap();
    const out = renderTextTree(mindmap);
    expect(out.nodes[0].number).toBe(1);
    expect(out.nodes[0].id).toBe('n_001');
    out.nodes.forEach((n, i) => {
      expect(n.number).toBe(i + 1);
    });
  });

  it('numberToId / idToNumber maps round-trip', async () => {
    const mindmap = await fixtureMindmap();
    const out = renderTextTree(mindmap);
    for (const n of out.nodes) {
      expect(out.numberToId.get(n.number)).toBe(n.id);
      expect(out.idToNumber.get(n.id)).toBe(n.number);
    }
  });

  it('header line announces session id + counts', async () => {
    const mindmap = await fixtureMindmap();
    const { text } = renderTextTree(mindmap);
    const firstLine = text.split('\n')[0];
    expect(firstLine).toContain('agent-tree');
    expect(firstLine).toContain(mindmap.session_id.slice(0, 8));
    expect(firstLine).toContain('events');
  });

  it('output is deterministic — same input, same string', async () => {
    const mindmap = await fixtureMindmap();
    const a = renderTextTree(mindmap).text;
    const b = renderTextTree(mindmap).text;
    expect(a).toBe(b);
  });
});

describe('parseSelection', () => {
  it.each([
    ['7', { ok: true, numberOrId: '7', mode: 'continue' }],
    ['12 fork', { ok: true, numberOrId: '12', mode: 'fork' }],
    ['n_005', { ok: true, numberOrId: 'n_005', mode: 'continue' }],
    ['3 continue', { ok: true, numberOrId: '3', mode: 'continue' }],
    ['8 c', { ok: true, numberOrId: '8', mode: 'continue' }],
    ['8 f', { ok: true, numberOrId: '8', mode: 'fork' }],
  ])('parses "%s" → %o', (input, expected) => {
    const got = parseSelection(input);
    expect(got.ok).toBe(expected.ok);
    if (expected.ok) {
      expect(got.numberOrId).toBe(expected.numberOrId);
      expect(got.mode).toBe(expected.mode);
    }
  });

  it('rejects unknown mode', () => {
    expect(parseSelection('5 zorp').ok).toBe(false);
  });

  it('quit returns ok=false with reason', () => {
    expect(parseSelection('q').reason).toBe('user quit');
    expect(parseSelection('quit').reason).toBe('user quit');
  });

  it('empty input → ok=false', () => {
    expect(parseSelection('').ok).toBe(false);
    expect(parseSelection('   ').ok).toBe(false);
  });
});

describe('lookupSnapshot', () => {
  it('finds a node by display number', async () => {
    const mindmap = await fixtureMindmap();
    const out = renderTextTree(mindmap);
    const node = lookupSnapshot(mindmap, '1', out);
    expect(node?.id).toBe('n_001');
    expect(node?.type).toBe('root');
  });

  it('finds a node by raw n_NNN id', async () => {
    const mindmap = await fixtureMindmap();
    const out = renderTextTree(mindmap);
    const node = lookupSnapshot(mindmap, 'n_002', out);
    expect(node?.id).toBe('n_002');
  });

  it('returns null for non-existent number', async () => {
    const mindmap = await fixtureMindmap();
    const out = renderTextTree(mindmap);
    expect(lookupSnapshot(mindmap, '9999', out)).toBeNull();
  });
});
