import { PassThrough } from 'node:stream';
import { resolve } from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { runTui } from '../src/cli/tui.js';
import { readJsonl } from '../src/reader/jsonl.js';
import { buildGraph } from '../src/reader/graph.js';
import { detectSegments } from '../src/analyzer/segments.js';
import { buildMindMap } from '../src/tree/builder.js';
import { renderTextTree } from '../src/render/text.js';

async function fixture() {
  const path = resolve('tests/fixtures/minimal-session.jsonl');
  const { meta, events } = await readJsonl(path);
  const graph = buildGraph(meta, events);
  return buildMindMap(graph, detectSegments(events), { jsonlPath: path, specVersion: 'test' });
}
afterEach(() => vi.restoreAllMocks());

describe('interactive selection', () => {
  it('returns the canonical node and mode without emitting a separate snapshot', async () => {
    const mindmap = await fixture();
    const input = new PassThrough();
    const output = new PassThrough();
    let displayed = '';
    output.on('data', (chunk) => {
      displayed += chunk.toString();
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const pending = runTui(mindmap, { input, output, render: { maxDepth: 1 } });
    input.write('1 fork\n');
    expect(await pending).toEqual({ selected: true, nodeId: 'n_001', mode: 'fork' });
    expect(stdout).not.toHaveBeenCalled();
    expect(displayed).toContain('agent-tree');
    input.destroy();
    output.destroy();
  });

  it('retries invalid input and honors the filtered display', async () => {
    const mindmap = await fixture();
    const input = new PassThrough();
    const output = new PassThrough();
    let displayed = '';
    output.on('data', (chunk) => {
      displayed += chunk.toString();
    });
    const node = mindmap.root.children[0];
    const number = renderTextTree(mindmap).idToNumber.get(node.id)!;
    const pending = runTui(mindmap, { input, output, render: { filter: node.label } });
    input.write('not-a-node\n');
    await new Promise<void>((resolve) => setImmediate(resolve));
    input.write(`${number}\n`);
    expect(await pending).toEqual({ selected: true, nodeId: node.id, mode: 'continue' });
    expect(displayed).toContain(node.label);
    expect(displayed).toContain('!');
    input.destroy();
    output.destroy();
  });

  it.each(['quit', 'eof'])('cancels cleanly on %s', async (kind) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const pending = runTui(await fixture(), { input, output });
    if (kind === 'quit') input.write('q\n');
    else input.end();
    expect(await pending).toEqual({ selected: false, nodeId: null, mode: null });
    input.destroy();
    output.destroy();
  });
});
