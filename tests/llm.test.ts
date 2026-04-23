import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { detectSegments } from '../src/analyzer/segments.js';
import { callSegmentLabel } from '../src/llm/anthropic.js';
import { labelMindMap } from '../src/llm/labeler.js';
import { buildSegmentUserMessage, SYSTEM_PROMPT } from '../src/llm/prompts.js';
import { buildGraph } from '../src/reader/graph.js';
import { readJsonl } from '../src/reader/jsonl.js';
import { buildMindMap } from '../src/tree/builder.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/minimal-session.jsonl');

function mockClient(
  handler: (args: unknown) => Promise<{
    content?: Array<{ type: string; text?: string }>;
    usage?: Record<string, number>;
  }>,
) {
  return {
    messages: {
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
    }
    const sys = captured?.system as Array<{ cache_control?: { type: string } }>;
    expect(Array.isArray(sys)).toBe(true);
    expect(sys[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('returns {ok:false} on non-JSON content (no throw)', async () => {
    const client = mockClient(async () => ({
      content: [{ type: 'text', text: 'I am prose not json' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
    const res = await callSegmentLabel({
      client,
      systemPrompt: 'SYS',
      userMessage: 'USR',
      model: 'x',
    });
    expect(res.ok).toBe(false);
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
    });
    expect(stats.segments_labeled).toBeGreaterThan(0);

    // At least one topic leaf should now have the mocked label
    const walk = (n: { type: string; label: string; context_snapshot_continue: { clipboard_markdown: string }; children: { type: string; label: string; context_snapshot_continue: { clipboard_markdown: string }; children: unknown[] }[] }): boolean => {
      if (n.type === 'topic' && n.label === 'Mock-Labeled Segment') {
        expect(n.context_snapshot_continue.clipboard_markdown).toContain(
          'Do X next',
        );
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
    });
    expect(stats.segments_failed).toBeGreaterThanOrEqual(1);
    expect(stats.segments_labeled + stats.segments_failed).toBe(
      stats.segments_attempted,
    );
  });
});
