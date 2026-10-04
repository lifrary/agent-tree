import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { detectSegments } from '../src/analyzer/segments.js';
import {
  callSegmentLabel,
  countSegmentInputTokens,
  createAnthropicClient,
} from '../src/llm/anthropic.js';
import { labelMindMap } from '../src/llm/labeler.js';
import { buildSegmentUserMessage, SYSTEM_PROMPT } from '../src/llm/prompts.js';
import { buildGraph } from '../src/reader/graph.js';
import { readJsonl } from '../src/reader/jsonl.js';
import { buildMindMap } from '../src/tree/builder.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/minimal-session.jsonl');

const sdkConstructor = vi.hoisted(() =>
  vi.fn(function () {
    return { messages: { create: vi.fn(), countTokens: vi.fn() } };
  }),
);
vi.mock('@anthropic-ai/sdk', () => ({ default: sdkConstructor }));

function mockClient(
  handler: (args: unknown) => Promise<{
    content?: Array<{ type: string; text?: string }>;
    usage?: Record<string, number>;
  }>,
) {
  return {
    messages: {
      countTokens: vi.fn(async (_args: unknown) => ({ input_tokens: 150 })),
      create: vi.fn(handler),
    },
  };
}

describe('prompts.ts', () => {
  it('SYSTEM_PROMPT describes the required JSON schema', () => {
    expect(SYSTEM_PROMPT).toContain('"label"');
    expect(SYSTEM_PROMPT).toContain('"type"');
    expect(SYSTEM_PROMPT).toContain('dead_end');
    expect(SYSTEM_PROMPT).toContain('strict JSON');
  });

  it('buildSegmentUserMessage embeds event bodies + boundary signals', async () => {
    const { events } = await readJsonl(FIXTURE);
    const segs = detectSegments(events);
    const seg = segs[0];
    const msg = buildSegmentUserMessage({
      segment: seg,
      events: events.slice(seg.start_index, seg.end_index + 1),
    });
    expect(msg).toContain(`# Segment ${seg.id}`);
    expect(msg).toContain('## Events');
    expect(msg).toContain('Respond with the JSON object');
  });
});

describe('createAnthropicClient', () => {
  it('does not construct a client or change the environment without a key', async () => {
    sdkConstructor.mockClear();
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    try {
      expect(await createAnthropicClient()).toBeNull();
      expect(sdkConstructor).not.toHaveBeenCalled();
      expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('disables SDK retries so custom retries cannot multiply attempts', async () => {
    sdkConstructor.mockClear();
    expect(
      await createAnthropicClient({
        apiKey: 'test-api-key',
        timeoutMs: 1234,
      }),
    ).not.toBeNull();
    expect(sdkConstructor).toHaveBeenCalledExactlyOnceWith({
      apiKey: 'test-api-key',
      timeout: 1234,
      maxRetries: 0,
    });
  });
});

describe('callSegmentLabel', () => {
  it('sends system prompt with cache_control and parses JSON', async () => {
    let captured: Record<string, unknown> | undefined;
    const client = mockClient(async (args) => {
      captured = args as Record<string, unknown>;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              label: 'Seg1',
              summary: 'did a thing',
              type: 'topic',
              color: 'green',
              next_steps: ['a', 'b'],
            }),
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 30,
        },
      };
    });
    const res = await callSegmentLabel({
      client,
      systemPrompt: 'SYS',
      userMessage: 'USR',
      model: 'claude-sonnet-4-6',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.label.label).toBe('Seg1');
      expect(res.usage.cacheReadTokens).toBe(30);
      expect(res.usage.inputTokens).toBe(180);
    }
    const sys = captured?.system as Array<{ cache_control?: { type: string } }>;
    expect(Array.isArray(sys)).toBe(true);
    expect(sys[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('returns {ok:false} on non-JSON content (no throw)', async () => {
    const client = mockClient(async () => ({
      content: [{ type: 'text', text: 'private model response that must not be logged' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
    const res = await callSegmentLabel({
      client,
      systemPrompt: 'SYS',
      userMessage: 'USR',
      model: 'x',
    });
    expect(res).toEqual({
      ok: false,
      reason: 'invalid label JSON',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    });
  });

  it('retains usage for empty content, including cached input', async () => {
    const client = mockClient(async () => ({
      content: [],
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 30,
        output_tokens: 5,
      },
    }));
    const result = await callSegmentLabel({
      client,
      systemPrompt: 'SYS',
      userMessage: 'USR',
      model: 'x',
    });
    expect(result).toEqual({
      ok: false,
      reason: 'empty response content',
      usage: {
        inputTokens: 60,
        cacheReadTokens: 20,
        cacheCreationTokens: 30,
        outputTokens: 5,
      },
    });
  });

  it.each([true, false])('counts exactly the create input with cache=%s', async (cache) => {
    const client = mockClient(async () => ({ content: [] }));
    const input = {
      client,
      systemPrompt: 'SYS',
      userMessage: 'USR',
      model: 'custom-model',
      cache,
      maxOutputTokens: 987,
    };
    expect(await countSegmentInputTokens(input)).toEqual({
      ok: true,
      inputTokens: 150,
    });
    await callSegmentLabel(input);
    const counted = client.messages.countTokens.mock.calls[0][0];
    const created = client.messages.create.mock.calls[0][0] as Record<string, unknown>;
    const { max_tokens, ...prompt } = created;
    expect(max_tokens).toBe(987);
    expect(counted).toEqual(prompt);
    expect(prompt).toEqual({
      model: 'custom-model',
      system: [
        {
          type: 'text',
          text: 'SYS',
          ...(cache ? { cache_control: { type: 'ephemeral' } } : {}),
        },
      ],
      messages: [{ role: 'user', content: 'USR' }],
    });
  });

  it('retries on 429 with backoff, then succeeds', async () => {
    let calls = 0;
    const client = mockClient(async () => {
      calls += 1;
      if (calls < 2) {
        const err = new Error('rate limited') as Error & { status: number };
        err.status = 429;
        throw err;
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              label: 'R',
              summary: 's',
              type: 'topic',
              color: 'green',
              next_steps: [],
            }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    });
    const res = await callSegmentLabel({
      client,
      systemPrompt: 'SYS',
      userMessage: 'USR',
      model: 'x',
      sleeper: async () => undefined, // skip real sleep
    });
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('makes only the initial attempt when maxRetries is zero and hides error bodies', async () => {
    const sleeper = vi.fn(async () => undefined);
    const client = mockClient(async () => {
      throw Object.assign(new Error('private response or credential'), { status: 500 });
    });
    const result = await callSegmentLabel({
      client,
      model: 'x',
      systemPrompt: 'SYS',
      userMessage: 'USR',
      maxRetries: 0,
      sleeper,
    });
    expect(result).toEqual({ ok: false, reason: 'label request failed (HTTP 500)' });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(sleeper).not.toHaveBeenCalled();
  });

  it('returns {ok:false} with auth reason on 401', async () => {
    const client = mockClient(async () => {
      const err = new Error('unauth') as Error & { status: number };
      err.status = 401;
      throw err;
    });
    const res = await callSegmentLabel({
      client,
      systemPrompt: 'SYS',
      userMessage: 'USR',
      model: 'x',
      sleeper: async () => undefined,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('auth');
  });

  it('strips ```json fences', async () => {
    const client = mockClient(async () => ({
      content: [
        {
          type: 'text',
          text:
            '```json\n' +
            JSON.stringify({
              label: 'F',
              summary: 's',
              type: 'topic',
              color: 'green',
              next_steps: [],
            }) +
            '\n```',
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const res = await callSegmentLabel({
      client,
      systemPrompt: 'SYS',
      userMessage: 'USR',
      model: 'x',
    });
    expect(res.ok).toBe(true);
  });
});

describe('labelMindMap', () => {
  it('mutates topic nodes with LLM label and upgrades snapshot narrative', async () => {
    const { meta, events } = await readJsonl(FIXTURE);
    const graph = buildGraph(meta, events);
    const segments = detectSegments(graph.events);
    const mindmap = buildMindMap(graph, segments, {
      jsonlPath: FIXTURE,
      specVersion: 'v0.3-test',
      generatedAt: '2026-04-21T00:00:00.000Z',
    });

    const client = mockClient(async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            label: 'Mock-Labeled Segment',
            summary: 'Mock summary of what happened.',
            type: 'topic',
            color: 'green',
            next_steps: ['Do X next', 'Verify Y'],
          }),
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 0,
      },
    }));

    const { stats } = await labelMindMap(mindmap, graph, segments, {
      client,
      model: 'claude-sonnet-4-6',
      jsonlPath: FIXTURE,
    });
    expect(stats.segments_labeled).toBeGreaterThan(0);

    // At least one topic leaf should now have the mocked label
    const walk = (n: {
      type: string;
      label: string;
      context_snapshot_continue: { clipboard_markdown: string };
      children: {
        type: string;
        label: string;
        context_snapshot_continue: { clipboard_markdown: string };
        children: unknown[];
      }[];
    }): boolean => {
      if (n.type === 'topic' && n.label === 'Mock-Labeled Segment') {
        expect(n.context_snapshot_continue.clipboard_markdown).toContain('Do X next');
        return true;
      }
      for (const c of n.children) if (walk(c as typeof n)) return true;
      return false;
    };
    expect(walk(mindmap.root as unknown as Parameters<typeof walk>[0])).toBe(true);
  });

  it('respects parallel throttle + per-segment independence on failure', async () => {
    const { meta, events } = await readJsonl(FIXTURE);
    const graph = buildGraph(meta, events);
    const segments = detectSegments(graph.events);
    const mindmap = buildMindMap(graph, segments, {
      jsonlPath: FIXTURE,
      specVersion: 'v0.3-test',
      generatedAt: '2026-04-21T00:00:00.000Z',
    });

    let calls = 0;
    const client = mockClient(async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('unauth') as Error & { status: number };
        err.status = 401; // non-retryable → labeler records as failed
        throw err;
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              label: 'Survivor',
              summary: 's',
              type: 'topic',
              color: 'green',
              next_steps: [],
            }),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    });

    const { stats } = await labelMindMap(mindmap, graph, segments, {
      client,
      model: 'x',
      parallel: 1,
      jsonlPath: FIXTURE,
    });
    expect(stats.segments_failed).toBeGreaterThanOrEqual(1);
    expect(stats.segments_labeled + stats.segments_failed).toBe(stats.segments_attempted);
  });
});
