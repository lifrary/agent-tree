import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { detectSegments } from '../src/analyzer/segments.js';
import { buildGraph } from '../src/reader/graph.js';
import { readJsonl } from '../src/reader/jsonl.js';
import { renderTextTree } from '../src/render/text.js';
import { buildMindMap } from '../src/tree/builder.js';
import type { MindMap, MindMapNode, StepUsage } from '../src/types.js';
import { attachSessionUsage, attachUsage } from '../src/usage/attach.js';

const exec = promisify(execFile);
const FIXTURE = resolve('tests/fixtures/usage-claude.jsonl');
const MINIMAL = resolve('tests/fixtures/minimal-session.jsonl');

async function mindmapOf(path: string, withUsage: boolean): Promise<MindMap> {
  const { meta, events } = await readJsonl(path);
  const graph = buildGraph(meta, events);
  const mindmap = buildMindMap(graph, detectSegments(graph.events), {
    jsonlPath: path,
    specVersion: 'v0.3-test',
    generatedAt: '2026-10-01T00:00:00.000Z',
  });
  if (withUsage) {
    await attachSessionUsage(mindmap, { source: 'claude', jsonlPath: path, events: graph.events });
  }
  return mindmap;
}

function withoutUsage(mindmap: MindMap): MindMap {
  const copy = structuredClone(mindmap);
  delete copy.stats.usage;
  const strip = (node: MindMapNode): void => {
    delete node.usage;
    node.children.forEach(strip);
  };
  strip(copy.root);
  return copy;
}

describe('usage in the text tree', () => {
  it('leaves the default tree byte-identical, in color too', async () => {
    const mindmap = await mindmapOf(FIXTURE, true);
    expect(mindmap.stats.usage).toBeDefined();
    for (const color of [false, true]) {
      expect(renderTextTree(mindmap, { color }).text).toBe(
        renderTextTree(withoutUsage(mindmap), { color }).text,
      );
    }
  });

  it('adds nothing under --usage when the session logged no usage', async () => {
    const mindmap = await mindmapOf(MINIMAL, true);
    expect(renderTextTree(mindmap, { usage: true, color: true }).text).toBe(
      renderTextTree(mindmap, { color: true }).text,
    );
  });

  it('never changes step numbers', async () => {
    const mindmap = await mindmapOf(FIXTURE, true);
    for (const maxDepth of [undefined, 1]) {
      const plain = renderTextTree(mindmap, { maxDepth });
      const usage = renderTextTree(mindmap, { maxDepth, usage: true });
      expect([...usage.numberToId]).toEqual([...plain.numberToId]);
    }
  });

  it('shows prompt, output, context peak, compactions and subagents per row', async () => {
    const lines = renderTextTree(await mindmapOf(FIXTURE, true), { usage: true, color: false })
      .text.split('\n')
      .filter((line) => /^\d+\./.test(line));
    expect(lines[0]).toMatch(/prompt 6\.7k · out 129 · ctx 3\.1k {2}2 agents prompt 717 · out 18$/);
    expect(lines[1]).toMatch(
      /prompt 3\.1k · out 80 · ctx 2\.0k {2}compacted 968k → 21k {2}2 agents prompt 717 · out 18$/,
    );
    expect(lines[2]).toMatch(/prompt 3\.6k · out 49 · ctx 3\.1k$/);
    // The root shows the session total but not the compaction its child holds.
    expect(lines[0]).not.toContain('compacted');
  });

  it('adds the Codex context window and sums the rows a collapsed run stands for', () => {
    const leaf = (id: string, uuid: string): MindMapNode => ({
      id,
      type: 'action',
      label: 'parser.ts (Edit)',
      summary: '',
      index_range: [0, 0],
      event_uuids: [uuid],
      files_touched: [],
      tools_used: [],
      is_sidechain: false,
      children: [],
      context_snapshot_continue: {
        mode: 'continue',
        session_id: 's',
        node_id: id,
        clipboard_markdown: '',
        related_files: [],
        next_steps: [],
      },
      context_snapshot_fork: {
        mode: 'fork',
        session_id: 's',
        node_id: id,
        clipboard_markdown: '',
        related_files: [],
        next_steps: [],
      },
    });
    const root = { ...leaf('n_001', 'r'), type: 'root' as const, label: 'session' };
    // The last sibling's └─ prefix ends the run, so a fourth row stays apart.
    root.children = [
      leaf('n_002', 'a'),
      leaf('n_003', 'b'),
      leaf('n_004', 'c'),
      leaf('n_005', 'd'),
    ];
    root.event_uuids = ['r', 'a', 'b', 'c', 'd'];
    const mindmap: MindMap = {
      source: 'codex',
      session_id: 's',
      project_path: '',
      generated_at: '',
      spec_version: 'test',
      root,
      stats: {
        total_events: 5,
        total_turns: 0,
        total_nodes: 5,
        total_tool_calls: 0,
        total_files_touched: 0,
        duration_minutes: 0,
        sidechain_count: 0,
      },
    };
    const call = (eventUuid: string, prompt: number) => ({
      eventUuid,
      timestamp: '',
      prompt_tokens: prompt,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      output_tokens: 100,
      reasoning_tokens: 0,
      context_window: 258400,
    });
    attachUsage(mindmap, {
      calls: [call('a', 150), call('b', 1500), call('c', 15000)],
      compactions: [{ eventUuid: 'b', pre_tokens: null, post_tokens: null, trigger: 'unknown' }],
    });
    const text = renderTextTree(mindmap, { usage: true, color: false, showRange: false }).text;
    const rows = text.split('\n').filter((line) => /^\d+\./.test(line));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/prompt 17k · out 300 · ctx 15k\/258k$/);
    expect(rows[1]).toMatch(/parser\.ts ×3 +prompt 17k · out 300 · ctx 15k\/258k {2}compacted$/);
    expect(rows[2]).toMatch(/parser\.ts \(Edit\) ?$/);
  });
});

describe('usage in JSON', () => {
  it('only adds usage fields to the mindmap', async () => {
    const plain = await mindmapOf(FIXTURE, false);
    const usage = await mindmapOf(FIXTURE, true);
    expect(withoutUsage(usage)).toEqual(plain);
    const fields: Array<keyof StepUsage> = [
      'calls',
      'prompt_tokens',
      'cache_read_tokens',
      'cache_write_tokens',
      'output_tokens',
      'reasoning_tokens',
      'context_peak',
      'context_window',
      'compactions',
      'subagents',
    ];
    expect(Object.keys(usage.stats.usage!)).toEqual(fields);
  });
});

describe('agent-tree --usage', () => {
  async function cli(...args: string[]) {
    return exec(process.execPath, ['--import', 'tsx', resolve('src/cli.ts'), ...args], {
      env: { ...process.env, ANTHROPIC_API_KEY: '', AGENT_TREE_NO_LLM: 'true' },
      timeout: 15_000,
    });
  }

  it('adds usage columns to --list only when asked, and JSON always carries usage', async () => {
    const plain = await cli('--file', FIXTURE, '--list', '--no-color');
    const usage = await cli('--file', FIXTURE, '--list', '--no-color', '--usage', '--phases-only');
    const json = await cli('--file', FIXTURE, '--json');
    expect(plain.stdout).not.toContain('prompt ');
    expect(usage.stdout).toContain('prompt 6.7k · out 129 · ctx 3.1k');
    expect(usage.stdout).toContain('compacted 968k → 21k');
    expect(JSON.parse(json.stdout).stats.usage).toMatchObject({ calls: 4, prompt_tokens: 6675 });
    for (const run of [plain, usage, json]) expect(run.stderr).toBe('');
  });
});
