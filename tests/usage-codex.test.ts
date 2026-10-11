import {
  appendFileSync,
  closeSync,
  copyFileSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPipeline } from '../src/cli/pipeline.js';
import { DEFAULT_CONFIG } from '../src/config/schema.js';
import { readCodex } from '../src/reader/codex.js';
import { renderTextTree } from '../src/render/text.js';
import { codexSource } from '../src/sources/codex.js';
import { findSpawnEvent } from '../src/sources/relations.js';
import type { SessionEntry } from '../src/sources/types.js';
import { buildStepIndex } from '../src/tree/steps.js';
import type { RawEvent } from '../src/types.js';
import { collectSessionUsage } from '../src/usage/attach.js';
import { codexSubagentSignature, readCodexSubagents } from '../src/usage/codex_subagents.js';
import { createLoggerSync } from '../src/utils/logger.js';

const ID = 'dddddddd-0000-4000-8000-000000000004';
const T = (seconds: number) => new Date(Date.UTC(2026, 9, 1, 10, 0, seconds)).toISOString();
// Planted in rate_limits: account data that must never reach any output.
const SENTINEL_PLAN = 'plan_sentinel_q7z';
const SENTINEL_NUMBER = 987654321;
let temporary: string;

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'atree-usage-codex-'));
  vi.stubEnv('CODEX_HOME', join(temporary, 'codex'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(temporary, { recursive: true, force: true });
});

function record<T>(type: string, payload: T, at = 0) {
  return { timestamp: T(at), type, payload };
}
const meta = () =>
  record('session_meta', { id: ID, cwd: '/work/project', cli_version: '0.162.0', source: 'cli' });
const message = (role: 'user' | 'assistant', text: string, at: number) =>
  record(
    'response_item',
    {
      type: 'message',
      role,
      content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
    },
    at,
  );
const agentMessage = (text: string, at: number) =>
  record('event_msg', { type: 'agent_message', message: text }, at);

function tokens(input: number, cached: number, output: number, reasoning = 0) {
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    cache_write_input_tokens: 0,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: input + output,
  };
}

function tokenCount(
  total: ReturnType<typeof tokens>,
  last: ReturnType<typeof tokens>,
  at: number,
  window = 258400,
) {
  return record(
    'event_msg',
    {
      type: 'token_count',
      info: { total_token_usage: total, last_token_usage: last, model_context_window: window },
      rate_limits: {
        plan_type: SENTINEL_PLAN,
        primary: { used_percent: SENTINEL_NUMBER, window_minutes: SENTINEL_NUMBER },
      },
    },
    at,
  );
}

function usageRecord(
  responseId: string,
  usage: ReturnType<typeof tokens>,
  at: number,
  threadId = ID,
) {
  return record(
    'token_usage_record',
    {
      thread_id: threadId,
      turn_id: 't1',
      session_id: ID,
      root_turn_id: 't1',
      response_id: responseId,
      usage,
      turn_token_usage: usage,
      thread_token_usage: usage,
    },
    at,
  );
}

function write(lines: unknown[]): string {
  const path = join(temporary, 'rollout.jsonl');
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  return path;
}

async function pipeline(path: string) {
  return runPipeline({
    match: { source: 'codex', sessionId: ID, projectDir: '/work/project', jsonlPath: path },
    opts: { llm: false },
    config: DEFAULT_CONFIG,
    logger: createLoggerSync('error'),
    quiet: true,
  });
}

// token_count only, as every Codex CLI writes it.
function countsOnly(): unknown[] {
  return [
    meta(),
    message('user', 'Fix the parser bug in the config loader', 1),
    record(
      'event_msg',
      { type: 'token_count', info: null, rate_limits: { plan_type: SENTINEL_PLAN } },
      2,
    ),
    message('assistant', 'Looking at the loader now.', 3),
    tokenCount(tokens(100, 40, 10, 2), tokens(100, 40, 10, 2), 4),
    // The same response reported again: its cumulative total did not move.
    tokenCount(tokens(100, 40, 10, 2), tokens(100, 40, 10, 2), 5),
    message('assistant', 'Patched it.', 6),
    tokenCount(tokens(250, 100, 25, 2), tokens(150, 60, 15), 7),
  ];
}

describe('Codex token_count samples', () => {
  it('retains explicit response/thread identities and counts distinct zero-token responses', async () => {
    const count = tokenCount(tokens(0, 0, 0), tokens(0, 0, 0), 1);
    const identified = (id: string) => ({
      ...count,
      payload: { ...count.payload, response_id: id, thread_id: ID },
    });
    const result = await readCodex(
      write([meta(), identified('r1'), identified('r1'), identified('r2')]),
    );
    expect(result.usage?.map((sample) => [sample.response_id, sample.thread_id])).toEqual([
      ['r1', ID],
      ['r2', ID],
    ]);
  });

  it('skips null info and repeated totals, and never adds cached tokens twice', async () => {
    const { usage } = await readCodex(write(countsOnly()));
    expect(usage).toHaveLength(2);
    const { mindmap } = await pipeline(write(countsOnly()));
    expect(mindmap.stats.usage).toMatchObject({
      calls: 2,
      prompt_tokens: 250,
      cache_read_tokens: 100,
      output_tokens: 25,
      reasoning_tokens: 2,
      context_peak: 150,
      context_window: 258400,
    });
    expect(mindmap.stats.usage).not.toHaveProperty('subagents');
  });

  it('attributes a sample to the last event before it that survives fallback suppression', async () => {
    const lines = [
      meta(),
      record('event_msg', { type: 'token_count', info: { last_token_usage: tokens(1, 0, 1) } }, 1),
      message('user', 'Fix the parser bug in the config loader', 2),
      message('assistant', 'Patched it.', 3),
      // The fallback copy of the message above is suppressed by the reader.
      agentMessage('Patched it.', 4),
      tokenCount(tokens(30, 0, 3), tokens(30, 0, 3), 5),
    ];
    const result = await readCodex(write(lines));
    const assistant = result.events.find((event) => event.type === 'assistant')!;
    expect(result.events.filter((event) => event.type === 'assistant')).toHaveLength(1);
    expect(result.usage!.map((sample) => sample.eventUuid)).toEqual([null, assistant.uuid]);
  });

  it('turns compacted records into compactions without token counts', async () => {
    const lines = [
      ...countsOnly(),
      record('compacted', { message: 'summary of the earlier turns' }, 8),
    ];
    const { mindmap } = await pipeline(write(lines));
    expect(mindmap.stats.usage!.compactions).toEqual([
      { pre_tokens: null, post_tokens: null, trigger: 'unknown' },
    ]);
  });
});

describe('Codex token_usage_record samples', () => {
  function withRecords(): unknown[] {
    return [
      meta(),
      message('user', 'Fix the parser bug in the config loader', 1),
      message('assistant', 'Looking at the loader now.', 2),
      usageRecord('resp_1', tokens(100, 40, 10, 2), 3),
      tokenCount(tokens(100, 40, 10, 2), tokens(100, 40, 10, 2), 4, 200000),
      message('assistant', 'Patched it.', 5),
      usageRecord('resp_2', tokens(150, 60, 15), 6),
      // The same response written twice.
      usageRecord('resp_2', tokens(150, 60, 15), 7),
      tokenCount(tokens(250, 100, 25, 2), tokens(150, 60, 15), 8, 200000),
    ];
  }

  it('uses the records alone when a file has any, with the window from token_count', async () => {
    const { usage } = await readCodex(write(withRecords()));
    expect(usage!.map((sample) => [sample.prompt_tokens, sample.context_window])).toEqual([
      [100, 200000],
      [150, 200000],
    ]);
    const { mindmap } = await pipeline(write(withRecords()));
    expect(mindmap.stats.usage).toMatchObject({
      calls: 2,
      prompt_tokens: 250,
      cache_read_tokens: 100,
      output_tokens: 25,
      context_window: 200000,
    });
  });

  it('keeps a usage record a metadata line, so event counts and strict mode do not change', async () => {
    const result = await readCodex(write(withRecords()), { strict: true });
    expect(result.malformedCount).toBe(0);
    expect(result.events).toHaveLength(3);
    expect(result.usage!.map((sample) => [sample.response_id, sample.thread_id])).toEqual([
      ['resp_1', ID],
      ['resp_2', ID],
    ]);
  });

  it('degrades an unrecognized usage shape to no data instead of a strict-mode error', async () => {
    const lines = [
      meta(),
      message('user', 'Fix the parser bug in the config loader', 1),
      record('token_usage_record', { response_id: 'r', usage: { input_tokens: 'many' } }, 2),
      record('event_msg', { type: 'token_count', info: { last_token_usage: [] } }, 3),
    ];
    const result = await readCodex(write(lines), { strict: true });
    expect(result.usage).toBeUndefined();
  });
});

describe('Codex rate_limits', () => {
  it('never reaches the JSON or the text tree', async () => {
    for (const lines of [countsOnly(), [...countsOnly(), usageRecord('r9', tokens(9, 0, 9), 9)]]) {
      const result = await pipeline(write(lines));
      const json = JSON.stringify(result.mindmap) + JSON.stringify(result.graph.events);
      const text = renderTextTree(result.mindmap, { usage: true, color: false }).text;
      for (const output of [json, text]) {
        expect(output).not.toContain(SENTINEL_PLAN);
        expect(output).not.toContain(String(SENTINEL_NUMBER));
      }
      expect(result.mindmap.stats.usage!.calls).toBeGreaterThan(0);
    }
  });
});

const CHILD = 'aaaaaaaa-0000-4000-8000-000000000001';
const NESTED = 'bbbbbbbb-0000-4000-8000-000000000002';
const UNLINKED = 'cccccccc-0000-4000-8000-000000000003';
const UNRELATED = 'eeeeeeee-0000-4000-8000-000000000005';

function native(
  id: string,
  lines: unknown[],
  options: { parentId?: string | null; at?: number; archived?: boolean } = {},
): string {
  const directory = options.archived
    ? join(process.env.CODEX_HOME!, 'archived_sessions')
    : join(process.env.CODEX_HOME!, 'sessions', '2026', '10', '01');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `rollout-2026-10-01T10-00-00-${id}.jsonl`);
  const header = record(
    'session_meta',
    {
      id,
      cwd: '/work/project',
      source:
        options.parentId === undefined
          ? 'cli'
          : options.parentId === null
            ? 'subagent'
            : { subagent: { thread_spawn: { parent_thread_id: options.parentId } } },
    },
    options.at ?? 0,
  );
  writeFileSync(path, [header, ...lines].map((line) => JSON.stringify(line)).join('\n') + '\n');
  return path;
}

function spawn(child: string, at: number, name = 'spawn_agent', callId = `spawn-${child}`) {
  return [
    record(
      'response_item',
      {
        type: 'function_call',
        name,
        call_id: callId,
        arguments: '{}',
      },
      at,
    ),
    record(
      'response_item',
      {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify({ agent_id: child }),
      },
      at + 1,
    ),
  ];
}

async function collect(path: string) {
  const result = await readCodex(path);
  return collectSessionUsage({
    source: 'codex',
    jsonlPath: path,
    events: result.events,
    samples: result.usage,
  });
}

describe('Codex descendant usage', () => {
  it('reads an already verified descriptor without reopening its path or closing the caller handle', async () => {
    const path = write([meta(), usageRecord('fd-response', tokens(10, 0, 1), 1)]);
    const fd = openSync(path, 'r');
    try {
      const result = await readCodex(join(temporary, 'missing.jsonl'), { fd });
      expect(result.usage?.[0].prompt_tokens).toBe(10);
      expect(fstatSync(fd).isFile()).toBe(true);
    } finally {
      closeSync(fd);
    }
  });

  it('keeps main totals separate and resolves nested calls through every parent spawn', async () => {
    const path = native(ID, [
      message('user', 'Fix the parser bug in the config loader', 1),
      usageRecord('main', tokens(50, 0, 5), 2),
      ...spawn(CHILD, 10),
    ]);
    native(
      CHILD,
      [
        usageRecord('child', tokens(100, 0, 10), 13, CHILD),
        ...spawn(NESTED, 20, 'functions.spawn_agent'),
      ],
      { parentId: ID, at: 12 },
    );
    native(NESTED, [usageRecord('nested', tokens(200, 0, 20), 23, NESTED)], {
      parentId: CHILD,
      at: 22,
    });
    native(UNLINKED, [usageRecord('unlinked', tokens(300, 0, 30), 25, UNLINKED)], {
      parentId: ID,
      at: 24,
    });
    const result = await readCodex(path);
    const origin = result.events.find((event) => event.type === 'tool_use')!.uuid;
    const usage = await collect(path);
    expect(usage.calls.map((sample) => sample.prompt_tokens)).toEqual([50]);
    expect(usage.subagents).toEqual(
      expect.arrayContaining([
        { agentId: CHILD, eventUuid: origin, calls: 1, prompt_tokens: 100, output_tokens: 10 },
        { agentId: NESTED, eventUuid: origin, calls: 1, prompt_tokens: 200, output_tokens: 20 },
        { agentId: UNLINKED, eventUuid: null, calls: 1, prompt_tokens: 300, output_tokens: 30 },
      ]),
    );
    expect(usage.subagents).toHaveLength(3);
    const { mindmap } = await pipeline(path);
    expect(mindmap.stats.usage).toMatchObject({
      calls: 1,
      prompt_tokens: 50,
      output_tokens: 5,
      subagents: {
        count: 3,
        unattributed_count: 1,
        calls: 3,
        prompt_tokens: 600,
        output_tokens: 60,
      },
    });
    const index = buildStepIndex(mindmap);
    const owner = index.nodeOfStep(index.stepOfEvent(origin)!);
    expect(owner?.usage?.subagents).toMatchObject({
      count: 2,
      calls: 2,
      prompt_tokens: 300,
      output_tokens: 30,
    });
    expect(owner?.usage?.subagents).not.toHaveProperty('unattributed_count');
  });

  it('leaves nested usage unlinked when either spawn in the chain is missing', async () => {
    const path = native(ID, spawn(CHILD, 1));
    native(CHILD, [usageRecord('child', tokens(10, 0, 1), 5, CHILD)], { parentId: ID, at: 3 });
    native(NESTED, [usageRecord('nested', tokens(20, 0, 2), 8, NESTED)], {
      parentId: CHILD,
      at: 6,
    });
    expect(
      (await collect(path)).subagents?.find((agent) => agent.agentId === NESTED)?.eventUuid,
    ).toBeNull();
    native(ID, []);
    native(CHILD, [...spawn(NESTED, 6)], { parentId: ID, at: 3 });
    const usage = await collect(path);
    expect(usage.subagents).toEqual([
      { agentId: NESTED, eventUuid: null, calls: 1, prompt_tokens: 20, output_tokens: 2 },
    ]);
  });

  it('does not attach unknown parents, missing ancestry, or disconnected cycles', async () => {
    const path = native(ID, [...spawn(UNRELATED, 1), ...spawn(UNLINKED, 3)]);
    native(UNRELATED, [usageRecord('unknown', tokens(99, 0, 9), 10, UNRELATED)], {
      parentId: null,
    });
    native(UNLINKED, [usageRecord('missing', tokens(99, 0, 9), 10, UNLINKED)], {
      parentId: 'ffffffff-0000-4000-8000-000000000006',
    });
    native(CHILD, [usageRecord('cycle-a', tokens(99, 0, 9), 10, CHILD)], { parentId: NESTED });
    native(NESTED, [usageRecord('cycle-b', tokens(99, 0, 9), 10, NESTED)], { parentId: CHILD });
    expect((await collect(path)).subagents).toBeUndefined();
    expect(await codexSubagentSignature(path)).toBe('');
  });

  it('terminates a cycle that includes the queried native thread', async () => {
    const path = native(ID, spawn(CHILD, 1), { parentId: CHILD });
    native(CHILD, [usageRecord('child', tokens(10, 0, 1), 5, CHILD), ...spawn(ID, 6)], {
      parentId: ID,
      at: 3,
    });
    expect((await collect(path)).subagents).toHaveLength(1);
    expect(await codexSubagentSignature(path)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reads archived children and counts an active/archived duplicate only once', async () => {
    const path = native(ID, spawn(CHILD, 1));
    native(CHILD, [usageRecord('archived', tokens(20, 0, 2), 5, CHILD)], {
      parentId: ID,
      archived: true,
      at: 3,
    });
    expect((await collect(path)).subagents?.[0].prompt_tokens).toBe(20);
    native(CHILD, [usageRecord('active', tokens(10, 0, 1), 5, CHILD)], {
      parentId: ID,
      at: 3,
    });
    const usage = await collect(path);
    expect(usage.subagents).toHaveLength(1);
    expect(usage.subagents?.[0].prompt_tokens).toBe(10);
  });

  it('deduplicates inherited responses by identity and rejects foreign-thread provenance', async () => {
    const path = native(ID, [usageRecord('shared-main', tokens(50, 0, 5), 1), ...spawn(CHILD, 2)]);
    native(
      CHILD,
      [
        usageRecord('shared-main', tokens(50, 0, 5), 1),
        usageRecord('foreign', tokens(900, 0, 90), 5, UNRELATED),
        usageRecord('shared-child', tokens(100, 0, 10), 5, CHILD),
        usageRecord('shared-child', tokens(100, 0, 10), 6, CHILD),
        ...spawn(NESTED, 7),
      ],
      { parentId: ID, at: 4 },
    );
    native(
      NESTED,
      [
        usageRecord('shared-child', tokens(100, 0, 10), 5, CHILD),
        // Even a copied record with rewritten thread metadata retains response identity.
        usageRecord('shared-main', tokens(50, 0, 5), 10, NESTED),
        usageRecord('nested', tokens(200, 0, 20), 11, NESTED),
      ],
      { parentId: CHILD, at: 9 },
    );
    const usage = await collect(path);
    expect(usage.calls).toHaveLength(1);
    expect(usage.subagents?.map((agent) => [agent.calls, agent.prompt_tokens])).toEqual([
      [1, 100],
      [1, 200],
    ]);
  });

  it('drops token_count history before child creation without subtracting cumulative totals', async () => {
    const path = native(ID, [
      tokenCount(tokens(50, 0, 5), tokens(50, 0, 5), 1),
      ...spawn(CHILD, 8),
    ]);
    native(
      CHILD,
      [
        tokenCount(tokens(50, 0, 5), tokens(50, 0, 5), 1),
        // This old response was not available in the parent's supplied samples.
        tokenCount(tokens(900, 0, 90), tokens(850, 0, 85), 2),
        tokenCount(tokens(1100, 0, 110), tokens(200, 0, 20), 11),
        tokenCount(tokens(1100, 0, 110), tokens(200, 0, 20), 12),
      ],
      { parentId: ID, at: 10 },
    );
    expect((await collect(path)).subagents?.[0]).toMatchObject({
      calls: 1,
      prompt_tokens: 200,
      output_tokens: 20,
    });
  });

  it('uses timestamp and ancestor evidence, not counts alone, without a creation cutoff', async () => {
    const path = native(ID, [tokenCount(tokens(50, 0, 5), tokens(50, 0, 5), 1)]);
    const ownThread = tokenCount(tokens(150, 0, 15), tokens(50, 0, 5), 1);
    const childPath = native(
      CHILD,
      [
        tokenCount(tokens(50, 0, 5), tokens(50, 0, 5), 1),
        tokenCount(tokens(100, 0, 10), tokens(50, 0, 5), 2),
        { ...ownThread, payload: { ...ownThread.payload, thread_id: CHILD } },
      ],
      { parentId: ID },
    );
    const discover = codexSource.discover.bind(codexSource);
    vi.spyOn(codexSource, 'discover').mockImplementation(async (options) =>
      (await discover(options)).map((entry) =>
        entry.jsonlPath !== childPath
          ? entry
          : {
              ...entry,
              subagent: { ...entry.subagent!, createdAt: undefined },
            },
      ),
    );
    expect((await collect(path)).subagents?.[0]).toMatchObject({
      calls: 2,
      prompt_tokens: 100,
      output_tokens: 10,
    });
    expect((await readCodex(childPath)).usage?.at(-1)?.thread_id).toBe(CHILD);
  });

  it('keeps no usage distinct from an explicitly logged zero-token call', async () => {
    const path = native(ID, [message('user', 'Fix the parser bug in the config loader', 1)]);
    expect((await collect(path)).subagents).toBeUndefined();
    native(CHILD, [], { parentId: ID });
    expect((await collect(path)).subagents).toBeUndefined();
    expect((await pipeline(path)).mindmap.stats.usage).toBeUndefined();
    native(CHILD, [usageRecord('zero', tokens(0, 0, 0), 2, CHILD)], { parentId: ID });
    expect((await pipeline(path)).mindmap.stats.usage).toMatchObject({
      calls: 0,
      prompt_tokens: 0,
      subagents: { count: 1, calls: 1, prompt_tokens: 0, output_tokens: 0 },
    });
  });

  it('never scans host children for a portable export, even with the same thread ID', async () => {
    const path = native(ID, [...countsOnly().slice(1), ...spawn(CHILD, 8)]);
    native(CHILD, [usageRecord('child', tokens(100, 0, 10), 11, CHILD)], { parentId: ID });
    const portable = join(temporary, 'export.jsonl');
    copyFileSync(path, portable);
    const discover = vi.spyOn(codexSource, 'discover');
    expect((await collect(portable)).subagents).toBeUndefined();
    expect(await codexSubagentSignature(portable)).toBe('');
    expect(discover).not.toHaveBeenCalled();
    // A file under CODEX_HOME still must be in the native discovered layout.
    const misplaced = join(process.env.CODEX_HOME!, 'sessions', 'export.jsonl');
    copyFileSync(path, misplaced);
    expect((await collect(misplaced)).subagents).toBeUndefined();
  });

  it('recovers valid child usage from malformed lines and skips missing/nonregular logs', async () => {
    const path = native(ID, spawn(CHILD, 1));
    const childPath = native(CHILD, [usageRecord('child', tokens(10, 0, 1), 5, CHILD)], {
      parentId: ID,
    });
    appendFileSync(childPath, '{broken private text\n');
    native(NESTED, [record('token_usage_record', { usage: [] }, 5)], { parentId: ID });
    const missing = native(UNLINKED, [], { parentId: ID });
    rmSync(missing);
    const link = native(UNRELATED, [], { parentId: ID });
    rmSync(link);
    symlinkSync(childPath, link);
    mkdirSync(missing);
    expect((await collect(path)).subagents).toEqual([
      expect.objectContaining({ agentId: CHILD, calls: 1, prompt_tokens: 10 }),
    ]);
  });

  it('skips a child that disappears after discovery and logs no exception text or paths', async () => {
    const path = native(ID, spawn(CHILD, 1));
    const childPath = native(CHILD, [usageRecord('child', tokens(10, 0, 1), 5, CHILD)], {
      parentId: ID,
    });
    const entries = await codexSource.discover({ includeSubagents: true });
    rmSync(childPath);
    vi.spyOn(codexSource, 'discover').mockResolvedValue(entries);
    const result = await readCodex(path);
    expect(await readCodexSubagents(path, result.events, result.usage ?? [])).toBeUndefined();
    const logger = { ...createLoggerSync('error'), debug: vi.fn() };
    vi.mocked(codexSource.discover).mockRejectedValue(new Error(`private text ${childPath}`));
    expect(await readCodexSubagents(path, result.events, [], logger)).toBeUndefined();
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('private text');
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain(childPath);
    expect(await codexSubagentSignature(path)).toBe('unreadable');
  });

  it('does not follow a child path replaced by a symlink after discovery', async () => {
    const path = native(ID, spawn(CHILD, 1));
    const childPath = native(CHILD, [usageRecord('child', tokens(10, 0, 1), 5, CHILD)], {
      parentId: ID,
    });
    const entries = await codexSource.discover({ includeSubagents: true });
    const outside = join(temporary, 'outside.jsonl');
    copyFileSync(childPath, outside);
    rmSync(childPath);
    symlinkSync(outside, childPath);
    vi.spyOn(codexSource, 'discover').mockResolvedValue(entries);
    expect((await collect(path)).subagents).toBeUndefined();
  });

  it('invalidates signatures for active/archive descendants growing, appearing, or disappearing', async () => {
    const path = native(ID, []);
    const absent = await codexSubagentSignature(path);
    const childPath = native(CHILD, [], { parentId: ID });
    const present = await codexSubagentSignature(path);
    expect(present).not.toBe(absent);
    appendFileSync(
      childPath,
      JSON.stringify(usageRecord('child', tokens(10, 0, 1), 5, CHILD)) + '\n',
    );
    const appended = await codexSubagentSignature(path);
    expect(appended).not.toBe(present);
    const nestedPath = native(NESTED, [], { parentId: CHILD, archived: true });
    const archived = await codexSubagentSignature(path);
    expect(archived).not.toBe(appended);
    appendFileSync(
      nestedPath,
      JSON.stringify(usageRecord('nested', tokens(20, 0, 2), 6, NESTED)) + '\n',
    );
    expect(await codexSubagentSignature(path)).not.toBe(archived);
    rmSync(nestedPath);
    expect(await codexSubagentSignature(path)).toBe(appended);
    native(UNRELATED, [], { parentId: null });
    expect(await codexSubagentSignature(path)).toBe(appended);
    rmSync(childPath);
    expect(await codexSubagentSignature(path)).toBe(absent);
  });
});

describe('structured spawn relations', () => {
  function entry(source: 'claude' | 'codex', toolUseId?: string): SessionEntry {
    return {
      source,
      sessionId: CHILD,
      projectDir: '/work/project',
      jsonlPath: 'unused.jsonl',
      mtimeMs: 0,
      sizeBytes: 0,
      subagent: { id: CHILD, parentSessionId: ID, toolUseId },
    };
  }

  it('requires the spawn call and its matching JSON result, not wait/resume or incidental text', async () => {
    for (const name of ['wait', 'resume_agent', 'functions.wait', 'other.spawn_agent']) {
      const result = await readCodex(write([meta(), ...spawn(CHILD, 1, name)]));
      expect(findSpawnEvent(result.events, entry('codex'))).toBeNull();
    }
    const call = spawn(CHILD, 1)[0];
    for (const output of [
      `agent_id: ${CHILD}`,
      `prefix {"agent_id":"${CHILD}"}`,
      JSON.stringify({ text: CHILD }),
    ]) {
      const result = await readCodex(
        write([
          meta(),
          call,
          record(
            'response_item',
            {
              type: 'function_call_output',
              call_id: `spawn-${CHILD}`,
              output,
            },
            2,
          ),
        ]),
      );
      expect(findSpawnEvent(result.events, entry('codex'))).toBeNull();
    }
    const mismatched = await readCodex(
      write([
        meta(),
        call,
        record(
          'response_item',
          {
            type: 'function_call_output',
            call_id: 'other-call',
            output: JSON.stringify({ agent_id: CHILD }),
          },
          2,
        ),
      ]),
    );
    expect(findSpawnEvent(mismatched.events, entry('codex'))).toBeNull();
  });

  it('links a namespaced spawn to a structured thread_id result projected from output blocks', async () => {
    const result = await readCodex(
      write([
        meta(),
        spawn(CHILD, 1, 'functions.spawn_agent')[0],
        record(
          'response_item',
          {
            type: 'function_call_output',
            call_id: `spawn-${CHILD}`,
            output: [
              { type: 'output_text', text: JSON.stringify({ thread_id: CHILD.toUpperCase() }) },
            ],
          },
          2,
        ),
      ]),
    );
    expect(findSpawnEvent(result.events, entry('codex'))).toBe(result.events[0].uuid);
  });

  it('uses Claude toolUseId first, falls back to toolUseResult.agentId, and does not resolve parents', () => {
    const envelope = {
      uuid: 'call-event',
      parentUuid: null,
      isSidechain: false,
      timestamp: T(1),
      sessionId: ID,
      cwd: '/work/project',
      gitBranch: '',
      version: '',
      entrypoint: '',
      userType: '',
    };
    const call: RawEvent = {
      ...envelope,
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Agent', input: {} }],
      },
    };
    const result = {
      ...envelope,
      uuid: 'result-event',
      type: 'user' as const,
      message: { role: 'user' as const, content: [] },
      toolUseResult: { agentId: CHILD },
    };
    expect(findSpawnEvent([result, call], entry('claude', 'tool-1'))).toBe('call-event');
    expect(findSpawnEvent([result, call], entry('claude', 'missing'))).toBe('result-event');
    const nested = entry('claude');
    nested.subagent!.id = NESTED;
    nested.subagent!.parentAgentId = CHILD;
    expect(findSpawnEvent([result, call], nested)).toBeNull();
    expect(findSpawnEvent([call], entry('claude'))).toBeNull();
  });
});
