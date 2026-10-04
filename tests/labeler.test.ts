import { describe, expect, it, vi } from 'vitest';

import type { AnthropicLike } from '../src/llm/anthropic.js';
import { labelMindMap } from '../src/llm/labeler.js';
import { SYSTEM_PROMPT } from '../src/llm/prompts.js';
import { buildGraph } from '../src/reader/graph.js';
import { buildMindMap } from '../src/tree/builder.js';
import type { RawEvent, TopicSegment } from '../src/types.js';
import { defaultRedactor } from '../src/utils/redact.js';

const JSONL_PATH = '/tmp/labeler-test.jsonl';

function fixture(size: number, text = 'Implement the requested feature') {
  const events = Array.from({ length: size }, (_, index): RawEvent => ({
    uuid: `event_${index}`,
    parentUuid: index === 0 ? null : `event_${index - 1}`,
    isSidechain: false,
    timestamp: `2026-04-21T00:00:${String(index).padStart(2, '0')}.000Z`,
    sessionId: 'labeler-test',
    cwd: '/tmp',
    gitBranch: 'main',
    version: 'test',
    entrypoint: 'cli',
    userType: 'external',
    type: 'user',
    message: { role: 'user', content: `${text} ${index}` },
  }));
  const segments = events.map((event, index): TopicSegment => ({
    id: `segment_${index}`,
    start_index: index,
    end_index: index,
    event_uuids: [event.uuid],
    dominant_files: [],
    dominant_tools: [],
    is_sidechain_only: false,
    time_range: [event.timestamp, event.timestamp],
    gap_before_ms: 0,
    boundary_reasons: [],
  }));
  const graph = buildGraph({ sessionId: 'labeler-test', permissionMode: 'default' }, events);
  const mindmap = buildMindMap(graph, segments, {
    jsonlPath: JSONL_PATH,
    specVersion: 'test',
    generatedAt: '2026-04-21T00:00:00.000Z',
  });
  return { graph, segments, mindmap };
}

interface Request {
  model: string;
  system: Array<{ type: string; text: string; cache_control?: { type: string } }>;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
}

function requestIndex(args: unknown): number {
  const request = args as Request;
  return Number(request.messages[0].content.match(/^# Segment segment_(\d+)/)?.[1]);
}

function response(inputTokens = 10) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          label: 'Labeled segment',
          summary: 'A useful summary.',
          type: 'topic',
          color: 'green',
          next_steps: ['Verify the change'],
        }),
      },
    ],
    usage: { input_tokens: inputTokens, output_tokens: 5 },
  };
}

function clientWithCounts(
  counts: number[],
  create: AnthropicLike['messages']['create'] = async () => response(),
) {
  return {
    messages: {
      countTokens: vi.fn(async (args: unknown) => ({ input_tokens: counts[requestIndex(args)] })),
      create: vi.fn(create),
    },
  };
}

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const options = { model: 'test-model', jsonlPath: JSONL_PATH };

describe('labelMindMap input reservations', () => {
  it('labels nested sub-actions as well as their phase header', async () => {
    const { mindmap, graph, segments } = fixture(2);
    const child = mindmap.root.children.pop()!;
    mindmap.root.children[0].children.push(child);
    const client = clientWithCounts([10, 10]);
    const { stats } = await labelMindMap(mindmap, graph, segments, {
      ...options,
      client,
      maxInputTokens: 20,
    });
    expect(stats.segments_labeled).toBe(2);
    expect(child.label).toBe('Labeled segment');
  });

  it('reserves before paid calls even when concurrent counts resolve together', async () => {
    const { mindmap, graph, segments } = fixture(6);
    const paidCallsStarted = barrier();
    const finishPaidCalls = barrier();
    let paidCalls = 0;
    const counts = [40, 40, 40, 40, 40, 40];
    const client = clientWithCounts(counts, async () => {
      paidCalls += 1;
      if (paidCalls === 2) paidCallsStarted.release();
      await finishPaidCalls.promise;
      return response(40);
    });
    const pending = labelMindMap(mindmap, graph, segments, {
      ...options,
      client,
      parallel: 3,
      maxInputTokens: 100,
    });
    await paidCallsStarted.promise;
    try {
      expect(client.messages.create).toHaveBeenCalledTimes(2);
      const reserved = client.messages.create.mock.calls.reduce(
        (sum, [args]) => sum + counts[requestIndex(args)],
        0,
      );
      expect(reserved).toBe(80);
      expect(reserved).toBeLessThanOrEqual(100);
    } finally {
      finishPaidCalls.release();
    }
    const { stats } = await pending;
    expect(stats.reserved_input_tokens).toBe(80);
    expect(stats.total_input_tokens).toBe(80);
    expect(stats.segments_labeled).toBe(2);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it('bounds both preflight and paid request concurrency', async () => {
    const { mindmap, graph, segments } = fixture(6);
    let active = 0;
    let peak = 0;
    const track = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
    };
    const client = {
      messages: {
        countTokens: vi.fn(async () => {
          await track();
          return { input_tokens: 10 };
        }),
        create: vi.fn(async () => {
          await track();
          return response();
        }),
      },
    };
    const { stats } = await labelMindMap(mindmap, graph, segments, {
      ...options,
      client,
      parallel: 2,
      maxInputTokens: 100,
    });
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect(stats.segments_labeled).toBe(6);
    expect(stats.reserved_input_tokens).toBe(60);
  });

  it.each([
    { budget: 0, paid: 0 },
    { budget: 24, paid: 0 },
    { budget: 25, paid: 1 },
    { budget: 49, paid: 1 },
    { budget: 50, paid: 2 },
  ])('admits only fitting requests at budget=$budget', async ({ budget, paid }) => {
    const { mindmap, graph, segments } = fixture(3);
    const client = clientWithCounts([25, 25, 25], async () => response(25));
    const { stats } = await labelMindMap(mindmap, graph, segments, {
      ...options,
      client,
      parallel: 1,
      maxInputTokens: budget,
    });
    expect(client.messages.create).toHaveBeenCalledTimes(paid);
    expect(stats.reserved_input_tokens).toBe(paid * 25);
    expect(stats.reserved_input_tokens).toBeLessThanOrEqual(budget);
    if (budget % 25 === 0) {
      // Equality means no remaining budget, not permission for one more call.
      expect(client.messages.countTokens).toHaveBeenCalledTimes(paid);
    }
  });

  it('skips oversized segments but still labels later segments that fit', async () => {
    const { mindmap, graph, segments } = fixture(4);
    const before = structuredClone(mindmap.root.children);
    const client = clientWithCounts([101, 70, 30, 1]);
    const { stats } = await labelMindMap(mindmap, graph, segments, {
      ...options,
      client,
      parallel: 1,
      maxInputTokens: 100,
    });
    expect(client.messages.create.mock.calls.map(([args]) => requestIndex(args))).toEqual([1, 2]);
    expect(client.messages.countTokens).toHaveBeenCalledTimes(3);
    expect(stats.reserved_input_tokens).toBe(100);
    expect(stats.segments_attempted).toBe(2);
    expect(mindmap.root.children[0]).toEqual(before[0]);
    expect(mindmap.root.children[3]).toEqual(before[3]);
  });

  it('uses preflight counts, not response usage, to decide the remaining budget', async () => {
    const { mindmap, graph, segments } = fixture(3);
    const client = clientWithCounts([40, 40, 40], async () => response(1));
    const { stats } = await labelMindMap(mindmap, graph, segments, {
      ...options,
      client,
      parallel: 1,
      maxInputTokens: 80,
    });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(stats.reserved_input_tokens).toBe(80);
    expect(stats.total_input_tokens).toBe(2);
  });

  it.each([-1, NaN, Infinity, 1.5])('fails closed for invalid budget %s', async (budget) => {
    const { mindmap, graph, segments } = fixture(1);
    const before = structuredClone(mindmap);
    const client = clientWithCounts([10]);
    const { stats } = await labelMindMap(mindmap, graph, segments, {
      ...options,
      client,
      maxInputTokens: budget,
    });
    expect(client.messages.countTokens).not.toHaveBeenCalled();
    expect(client.messages.create).not.toHaveBeenCalled();
    expect(stats.reserved_input_tokens).toBe(0);
    expect(mindmap).toEqual(before);
  });
});

describe('labelMindMap failures', () => {
  it('fails closed on a count error without stopping unrelated segments or logging secrets', async () => {
    const { mindmap, graph, segments } = fixture(3);
    const before = structuredClone(mindmap.root.children[0]);
    const warn = vi.fn();
    const client = clientWithCounts([20, 20, 20]);
    client.messages.countTokens.mockRejectedValueOnce(
      Object.assign(new Error('private token count response'), { status: 500 }),
    );
    const { stats } = await labelMindMap(mindmap, graph, segments, {
      ...options,
      client,
      parallel: 1,
      maxInputTokens: 40,
      logger: { warn },
    });
    expect(client.messages.countTokens).toHaveBeenCalledTimes(3);
    expect(client.messages.create.mock.calls.map(([args]) => requestIndex(args))).toEqual([1, 2]);
    expect(stats.segments_attempted).toBe(3);
    expect(stats.segments_failed).toBe(1);
    expect(stats.segments_labeled).toBe(2);
    expect(stats.reserved_input_tokens).toBe(40);
    expect(mindmap.root.children[0]).toEqual(before);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private token count response');
  });

  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid count %s without a paid request',
    async (count) => {
      const { mindmap, graph, segments } = fixture(1);
      const client = clientWithCounts([count]);
      const { stats } = await labelMindMap(mindmap, graph, segments, {
        ...options,
        client,
        maxInputTokens: 100,
      });
      expect(client.messages.create).not.toHaveBeenCalled();
      expect(stats.reserved_input_tokens).toBe(0);
      expect(stats.segments_failed).toBe(1);
    },
  );

  it.each([429, 500, undefined])(
    'does not retry or refund failed creates (status=%s)',
    async (status) => {
      const { mindmap, graph, segments } = fixture(2);
      const before = structuredClone(mindmap);
      const warn = vi.fn();
      const client = clientWithCounts([40, 40], async () => {
        throw Object.assign(new Error('private provider failure body'), { status });
      });
      const { stats } = await labelMindMap(mindmap, graph, segments, {
        ...options,
        client,
        parallel: 1,
        maxInputTokens: 60,
        logger: { warn },
      });
      expect(client.messages.create).toHaveBeenCalledTimes(1);
      expect(stats.reserved_input_tokens).toBe(40);
      expect(stats.total_input_tokens).toBe(0); // No provider usage available, not a billing claim.
      expect(stats.segments_failed).toBe(1);
      expect(mindmap).toEqual(before);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private provider failure body');
    },
  );

  it('accounts failed-response usage including cache reads/writes without logging model output', async () => {
    const { mindmap, graph, segments } = fixture(2);
    const before = structuredClone(mindmap);
    const warn = vi.fn();
    const client = clientWithCounts([70, 70], async () => ({
      content: [{ type: 'text', text: 'private invalid model output' }],
      usage: {
        input_tokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 20,
        output_tokens: 7,
      },
    }));
    const { stats } = await labelMindMap(mindmap, graph, segments, {
      ...options,
      client,
      parallel: 2,
      maxInputTokens: 70,
      logger: { warn },
    });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(stats.reserved_input_tokens).toBe(70);
    expect(stats.total_input_tokens).toBe(70);
    expect(stats.total_output_tokens).toBe(7);
    expect(stats.cache_read_tokens).toBe(30);
    expect(stats.cache_creation_tokens).toBe(20);
    expect(stats.segments_failed).toBe(1);
    expect(mindmap).toEqual(before);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private invalid model output');
  });
});

describe('labelMindMap prompt options', () => {
  it.each([
    { lang: 'en' as const, language: 'English', cache: true },
    { lang: 'ko' as const, language: 'Korean', cache: true },
    { lang: 'auto' as const, language: null, cache: true },
    { lang: 'en' as const, language: 'English', cache: false },
    { lang: 'ko' as const, language: 'Korean', cache: false },
    { lang: 'auto' as const, language: null, cache: false },
  ])(
    'forwards identical model/cache/language input for $lang with cache=$cache',
    async ({ lang, language, cache }) => {
      const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
      const { mindmap, graph, segments } = fixture(1, `Implement authentication with ${secret}`);
      const client = clientWithCounts([10]);
      await labelMindMap(mindmap, graph, segments, {
        ...options,
        client,
        lang,
        cache,
        maxOutputTokens: 321,
        redactor: defaultRedactor(),
      });
      const counted = client.messages.countTokens.mock.calls[0][0] as Request;
      const created = client.messages.create.mock.calls[0][0] as Request;
      const { max_tokens, ...prompt } = created;
      expect(max_tokens).toBe(321);
      expect(prompt).toEqual(counted);
      expect(prompt.model).toBe('test-model');
      expect(prompt.system[0].cache_control).toEqual(cache ? { type: 'ephemeral' } : undefined);
      expect(prompt.messages[0].content).not.toContain(secret);
      expect(prompt.messages[0].content).toContain('sk-ant-***REDACTED***');
      if (language) {
        expect(prompt.system[0].text).toContain(
          `Write label, summary, and next_steps in ${language}`,
        );
        expect(prompt.system[0].text).not.toContain('detect the dominant language');
      } else {
        expect(prompt.system[0].text).toBe(SYSTEM_PROMPT);
      }
    },
  );
});
