import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPipeline } from '../src/cli/pipeline.js';
import { DEFAULT_CONFIG } from '../src/config/schema.js';
import { readCodex } from '../src/reader/codex.js';
import { renderTextTree } from '../src/render/text.js';
import { createLoggerSync } from '../src/utils/logger.js';

const ID = 'dddddddd-0000-4000-8000-000000000004';
const T = (seconds: number) => new Date(Date.UTC(2026, 9, 1, 10, 0, seconds)).toISOString();
// Planted in rate_limits: account data that must never reach any output.
const SENTINEL_PLAN = 'plan_sentinel_q7z';
const SENTINEL_NUMBER = 987654321;
let temporary: string;

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'atree-usage-codex-'));
});
afterEach(() => {
  rmSync(temporary, { recursive: true, force: true });
});

function record(type: string, payload: unknown, at = 0) {
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

function usageRecord(responseId: string, usage: ReturnType<typeof tokens>, at: number) {
  return record(
    'token_usage_record',
    {
      thread_id: ID,
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
