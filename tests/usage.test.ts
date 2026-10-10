import { execFileSync, spawn } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  cpSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPipeline } from '../src/cli/pipeline.js';
import { DEFAULT_CONFIG } from '../src/config/schema.js';
import type { SessionMatch } from '../src/sources/types.js';
import { buildStepIndex } from '../src/tree/steps.js';
import type { MindMap, MindMapNode } from '../src/types.js';
import { attachUsage } from '../src/usage/attach.js';
import { formatTokens } from '../src/usage/format.js';
import { createLoggerSync } from '../src/utils/logger.js';

const FIXTURE = resolve('tests/fixtures/usage-claude.jsonl');
const MINIMAL = resolve('tests/fixtures/minimal-session.jsonl');
const logger = createLoggerSync('error');
let temporary: string;

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'atree-usage-'));
});
afterEach(() => {
  rmSync(temporary, { recursive: true, force: true });
});

function match(jsonlPath: string): SessionMatch {
  return { source: 'claude', sessionId: 'fixture', projectDir: '-fixture', jsonlPath };
}

async function mindmapOf(jsonlPath: string): Promise<MindMap> {
  const result = await runPipeline({
    match: match(jsonlPath),
    opts: { llm: false },
    config: DEFAULT_CONFIG,
    logger,
    quiet: true,
  });
  return result.mindmap;
}

function nodeHolding(mindmap: MindMap, uuid: string): MindMapNode {
  const index = buildStepIndex(mindmap);
  return index.nodeOfStep(index.stepOfEvent(uuid)!)!;
}

/** The fixture without its subagent folder: a portable export. */
function exportedCopy(): string {
  const path = join(temporary, 'exported.jsonl');
  cpSync(FIXTURE, path);
  return path;
}

describe('Claude Code usage', () => {
  it('counts each message.id once, falls back to requestId, and skips <synthetic>', async () => {
    const usage = (await mindmapOf(exportedCopy())).stats.usage!;
    // msg_A (two records), msg_B, msg_C and req_D (two records without an id).
    expect(usage.calls).toBe(4);
    expect(usage.prompt_tokens).toBe(1110 + 2005 + 3057 + 503);
    expect(usage.cache_read_tokens).toBe(1000 + 2000 + 3000 + 500);
    expect(usage.cache_write_tokens).toBe(100 + 50);
    expect(usage.output_tokens).toBe(50 + 30 + 40 + 9);
    expect(usage.reasoning_tokens).toBe(20);
    expect(usage.context_peak).toBe(3057);
    expect(usage.context_window).toBeNull();
  });

  it('attributes each call to the step of its first record and sums subtrees', async () => {
    const mindmap = await mindmapOf(exportedCopy());
    const first = nodeHolding(mindmap, 'e-a1');
    const second = nodeHolding(mindmap, 'e-a4');
    expect(first.usage).toMatchObject({ calls: 2, prompt_tokens: 3115, output_tokens: 80 });
    expect(second.usage).toMatchObject({ calls: 2, prompt_tokens: 3560, output_tokens: 49 });
    expect(mindmap.root.usage).toEqual(mindmap.stats.usage);
    expect(mindmap.root.usage!.calls).toBe(first.usage!.calls + second.usage!.calls);
  });

  it('shows a compact_boundary on its own step with its token counts', async () => {
    const mindmap = await mindmapOf(exportedCopy());
    const compaction = { pre_tokens: 967517, post_tokens: 21137, trigger: 'auto' };
    expect(nodeHolding(mindmap, 'e-s1').usage!.compactions).toEqual([compaction]);
    expect(nodeHolding(mindmap, 'e-a4').usage!.compactions).toEqual([]);
    expect(mindmap.stats.usage!.compactions).toEqual([compaction]);
  });

  it('leaves usage absent when the transcript logged none', async () => {
    const mindmap = await mindmapOf(MINIMAL);
    expect(mindmap.stats.usage).toBeUndefined();
    const visit = (node: MindMapNode): void => {
      expect(node.usage).toBeUndefined();
      node.children.forEach(visit);
    };
    visit(mindmap.root);
  });

  it('treats a record without usage as no data, never as a zero call', async () => {
    const path = join(temporary, 'no-usage.jsonl');
    writeFileSync(
      path,
      [
        '{"type":"permission-mode","permissionMode":"default","sessionId":"s"}',
        '{"parentUuid":null,"uuid":"x1","timestamp":"2026-10-01T10:00:00.000Z","sessionId":"s","type":"user","message":{"role":"user","content":"Explain the parser module please"}}',
        '{"parentUuid":"x1","uuid":"x2","timestamp":"2026-10-01T10:00:01.000Z","sessionId":"s","type":"assistant","message":{"role":"assistant","id":"m1","model":"claude-opus-5-5","content":[{"type":"text","text":"Sure."}]}}',
      ].join('\n') + '\n',
    );
    const mindmap = await mindmapOf(path);
    expect(mindmap.stats.usage).toBeUndefined();
    expect(mindmap.root.usage).toBeUndefined();
  });
});

describe('Claude Code subagent usage', () => {
  it('links each subagent to the step holding its Agent tool_use, beside the main numbers', async () => {
    const mindmap = await mindmapOf(FIXTURE);
    // a1 by toolUseId, a2 (nested) through its parentAgentId; <synthetic> and
    // the repeated msg_S1 are not calls.
    const agents = { count: 2, calls: 3, prompt_tokens: 111 + 202 + 404, output_tokens: 18 };
    expect(nodeHolding(mindmap, 'e-a2').usage!.subagents).toEqual(agents);
    expect(nodeHolding(mindmap, 'e-a4').usage!.subagents).toEqual({
      count: 0,
      calls: 0,
      prompt_tokens: 0,
      output_tokens: 0,
    });
    expect(mindmap.stats.usage!.subagents).toEqual(agents);
    // Never added into the main numbers.
    expect(mindmap.stats.usage).toMatchObject({
      calls: 4,
      prompt_tokens: 6675,
      output_tokens: 129,
    });
  });

  it('reports no subagents field when the session has no subagent folder', async () => {
    const usage = (await mindmapOf(exportedCopy())).stats.usage!;
    expect(usage).not.toHaveProperty('subagents');
  });

  it('keeps inline sidechain calls (older Claude Code) beside the main numbers', async () => {
    const path = exportedCopy();
    const sidechain = (uuid: string, id: string, input: number) =>
      JSON.stringify({
        parentUuid: 'e-a8',
        uuid,
        isSidechain: true,
        agentId: 'inline-1',
        timestamp: '2026-10-01T10:20:20.000Z',
        sessionId: 's',
        type: 'assistant',
        message: {
          role: 'assistant',
          id,
          model: 'claude-haiku-5-5',
          content: [],
          usage: { input_tokens: input, output_tokens: 2 },
        },
      });
    appendFileSync(
      path,
      sidechain('e-x1', 'msg_X1', 40) + '\n' + sidechain('e-x2', 'msg_X2', 60) + '\n',
    );
    const usage = (await mindmapOf(path)).stats.usage!;
    expect(usage).toMatchObject({ calls: 4, prompt_tokens: 6675, output_tokens: 129 });
    expect(usage.subagents).toEqual({ count: 1, calls: 2, prompt_tokens: 100, output_tokens: 4 });
  });

  it('falls back to toolUseResult.agentId and keeps an unlinked agent at the root', async () => {
    const path = join(temporary, 'session.jsonl');
    cpSync(FIXTURE, path);
    const folder = join(temporary, 'session', 'subagents');
    cpSync(resolve('tests/fixtures/usage-claude/subagents'), folder, { recursive: true });
    // a1 loses its sidecar: the main transcript's toolUseResult.agentId still links it.
    rmSync(join(folder, 'agent-a1.meta.json'));
    // a2 loses its parent link and names a tool_use nobody holds: session-level.
    writeFileSync(join(folder, 'agent-a2.meta.json'), '{"toolUseId":"toolu_missing"}');
    const mindmap = await mindmapOf(path);
    expect(nodeHolding(mindmap, 'e-r1').usage!.subagents).toMatchObject({ count: 1, calls: 2 });
    expect(mindmap.root.usage!.subagents).toMatchObject({ count: 2, calls: 3 });
    const childAgents = mindmap.root.children.reduce(
      (sum, child) => sum + (child.usage?.subagents?.count ?? 0),
      0,
    );
    expect(childAgents).toBe(1);
  });

  it('reads usage lines that straddle a read chunk, after lines longer than a chunk', async () => {
    const path = join(temporary, 'session.jsonl');
    cpSync(FIXTURE, path);
    const folder = join(temporary, 'session', 'subagents');
    cpSync(resolve('tests/fixtures/usage-claude/subagents'), folder, { recursive: true });
    const filler = (bytes: number) =>
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'x'.repeat(bytes) } });
    const call = (id: string, input: number) =>
      JSON.stringify({
        type: 'assistant',
        uuid: id,
        message: {
          id,
          model: 'claude-haiku-5-5',
          usage: { input_tokens: input, output_tokens: 1 },
        },
      });
    const MiB = 1024 * 1024;
    writeFileSync(
      join(folder, 'agent-a2.jsonl'),
      // The first call crosses the 1 MiB read boundary; the last line has no
      // newline and a CRLF line ending precedes it.
      [
        filler(MiB - 120),
        call('m1', 10),
        filler(2.5 * MiB),
        call('m2', 20) + '\r',
        call('m3', 30),
      ].join('\n'),
    );
    const usage = (await mindmapOf(path)).stats.usage!;
    expect(usage.subagents).toEqual({
      count: 2,
      calls: 5,
      prompt_tokens: 313 + 60,
      output_tokens: 14,
    });
  });

  it('never follows a symlinked subagent transcript', async () => {
    const path = join(temporary, 'session.jsonl');
    cpSync(FIXTURE, path);
    const folder = join(temporary, 'session', 'subagents');
    cpSync(resolve('tests/fixtures/usage-claude/subagents'), folder, { recursive: true });
    rmSync(join(folder, 'agent-a2.jsonl'));
    symlinkSync(
      resolve('tests/fixtures/usage-claude/subagents/agent-a2.jsonl'),
      join(folder, 'agent-a2.jsonl'),
    );
    const usage = (await mindmapOf(path)).stats.usage!;
    expect(usage.subagents).toEqual({ count: 1, calls: 2, prompt_tokens: 313, output_tokens: 11 });
  });

  it('never follows a symlinked or FIFO sidecar', async () => {
    const outside = join(temporary, 'outside.meta.json');
    // Followed, this would move a1 to the step holding toolu_write1.
    writeFileSync(outside, '{"toolUseId":"toolu_write1"}');
    for (const plant of ['symlink', 'fifo'] as const) {
      const path = join(temporary, `${plant}.jsonl`);
      cpSync(FIXTURE, path);
      const folder = join(temporary, plant, 'subagents');
      cpSync(resolve('tests/fixtures/usage-claude/subagents'), folder, { recursive: true });
      const meta = join(folder, 'agent-a1.meta.json');
      rmSync(meta);
      if (plant === 'symlink') symlinkSync(outside, meta);
      else execFileSync('mkfifo', [meta]);
      // A reader that opened the FIFO blocking waits for a writer forever; this
      // late writer releases it, so a regression fails on time instead of hanging.
      const writer =
        plant === 'fifo'
          ? setTimeout(() => spawn('sh', ['-c', 'exec 3>"$1"', 'sh', meta]).unref(), 3000)
          : undefined;
      const started = Date.now();
      let mindmap: MindMap;
      try {
        mindmap = await mindmapOf(path);
      } finally {
        clearTimeout(writer);
      }
      expect(Date.now() - started).toBeLessThan(1500);
      // Without its sidecar, a1 still links through toolUseResult.agentId.
      expect(nodeHolding(mindmap, 'e-r1').usage!.subagents!.count).toBe(2);
      expect(nodeHolding(mindmap, 'e-a4').usage!.subagents!.count).toBe(0);
    }
  }, 15_000);

  it('does not count a forked subagent repeating the main call that started it', async () => {
    const path = join(temporary, 'session.jsonl');
    cpSync(FIXTURE, path);
    const folder = join(temporary, 'session', 'subagents');
    cpSync(resolve('tests/fixtures/usage-claude/subagents'), folder, { recursive: true });
    const record = (id: string, usage: Record<string, number>) =>
      JSON.stringify({
        type: 'assistant',
        uuid: `f-${id}`,
        isSidechain: true,
        message: { id, model: 'claude-opus-5-5', usage },
      });
    writeFileSync(
      join(folder, 'agent-f1.jsonl'),
      [
        // The fork's transcript opens with the parent's own msg_A.
        record('msg_A', {
          input_tokens: 10,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 1000,
          output_tokens: 50,
        }),
        record('msg_F1', { input_tokens: 8, output_tokens: 2 }),
      ].join('\n') + '\n',
    );
    writeFileSync(join(folder, 'agent-f1.meta.json'), '{"toolUseId":"toolu_agent1","isFork":true}');
    const usage = (await mindmapOf(path)).stats.usage!;
    expect(usage).toMatchObject({ calls: 4, prompt_tokens: 6675 });
    expect(usage.subagents).toEqual({
      count: 3,
      calls: 4,
      prompt_tokens: 717 + 8,
      output_tokens: 18 + 2,
    });
  });

  it.skipIf(process.getuid?.() === 0)(
    'keeps the tree and main usage when the subagent folder is unreadable',
    async () => {
      const path = join(temporary, 'session.jsonl');
      cpSync(FIXTURE, path);
      const sessionFolder = join(temporary, 'session');
      cpSync(resolve('tests/fixtures/usage-claude/subagents'), join(sessionFolder, 'subagents'), {
        recursive: true,
      });
      chmodSync(sessionFolder, 0o000);
      try {
        const usage = (await mindmapOf(path)).stats.usage!;
        expect(usage).toMatchObject({ calls: 4, prompt_tokens: 6675 });
        expect(usage).not.toHaveProperty('subagents');
      } finally {
        chmodSync(sessionFolder, 0o755);
      }
    },
  );
});

describe('attachUsage', () => {
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
      type: children.length > 0 ? 'topic' : 'action',
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
  function tree(): MindMap {
    const leafA = node('n_003', ['a']);
    const leafB = node('n_004', ['b']);
    const phase = node('n_002', ['p', 'a', 'b'], [leafA, leafB]);
    const root = node('n_001', ['p', 'a', 'b', 'c'], [phase]);
    root.type = 'root';
    return {
      source: 'codex',
      session_id: 's',
      project_path: '',
      generated_at: '',
      spec_version: 'test',
      root,
      stats: {
        total_events: 4,
        total_turns: 0,
        total_nodes: 4,
        total_tool_calls: 0,
        total_files_touched: 0,
        duration_minutes: 0,
        sidechain_count: 0,
      },
    };
  }
  const sample = (eventUuid: string | null, prompt: number, window: number | null = null) => ({
    eventUuid,
    timestamp: '',
    prompt_tokens: prompt,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    output_tokens: 1,
    reasoning_tokens: 0,
    context_window: window,
  });

  it('sums each subtree inclusively and attributes every call exactly once', () => {
    const mindmap = tree();
    attachUsage(mindmap, {
      calls: [
        sample('p', 10),
        sample('a', 20),
        sample('b', 30, 1000),
        sample('c', 40),
        sample('unknown', 50),
        sample(null, 60),
      ],
      compactions: [],
    });
    const [phase] = mindmap.root.children;
    expect(phase.children.map((leaf) => leaf.usage!.prompt_tokens)).toEqual([20, 30]);
    expect(phase.usage).toMatchObject({ calls: 3, prompt_tokens: 60, context_peak: 30 });
    expect(phase.usage!.context_window).toBe(1000);
    // Calls whose event no node holds belong to the root, so it is the session total.
    expect(mindmap.root.usage).toMatchObject({ calls: 6, prompt_tokens: 210, output_tokens: 6 });
    expect(mindmap.stats.usage).toEqual(mindmap.root.usage);
    expect(mindmap.stats.usage).not.toBe(mindmap.root.usage);
  });

  it('gives every node usage, zeros included, once the session logged any call', () => {
    const mindmap = tree();
    attachUsage(mindmap, { calls: [sample('a', 5)], compactions: [] });
    expect(mindmap.root.children[0].children[1].usage).toMatchObject({
      calls: 0,
      prompt_tokens: 0,
    });
  });

  it('attaches nothing when no call was logged', () => {
    const mindmap = tree();
    attachUsage(mindmap, {
      calls: [],
      compactions: [{ eventUuid: 'a', pre_tokens: null, post_tokens: null, trigger: 'unknown' }],
    });
    expect(mindmap.root.usage).toBeUndefined();
    expect(mindmap.stats.usage).toBeUndefined();
  });
});

describe('formatTokens', () => {
  it('keeps three significant figures at most', () => {
    expect(
      [950, 9100, 9949, 9950, 21137, 182000, 967517, 999499, 999500, 2412000, 24_400_000].map(
        formatTokens,
      ),
    ).toEqual(['950', '9.1k', '9.9k', '10k', '21k', '182k', '968k', '999k', '1.0M', '2.4M', '24M']);
    expect(formatTokens(8_182_831_061)).toBe('8.2B');
  });
});
