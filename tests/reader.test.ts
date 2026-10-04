import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { extractSignals } from '../src/analyzer/signals.js';
import { readJsonl } from '../src/reader/jsonl.js';
import type { Logger } from '../src/utils/logger.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/minimal-session.jsonl');
const tempDirs: string[] = [];

async function jsonl(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-tree-reader-'));
  tempDirs.push(dir);
  const file = join(dir, 'session.jsonl');
  await writeFile(file, contents, 'utf8');
  return file;
}

function loggerSpy(): Logger {
  return {
    level: 'trace',
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('readJsonl (§7.1 pass 1)', () => {
  it('extracts session meta from line 1', async () => {
    const { meta } = await readJsonl(FIXTURE);
    expect(meta.sessionId).toBe('aaaa1111-2222-3333-4444-555566667777');
    expect(meta.permissionMode).toBe('default');
  });

  it('parses all 9 events (skips line 1 permission-mode)', async () => {
    const { events } = await readJsonl(FIXTURE);
    expect(events).toHaveLength(9);
  });

  it('preserves jsonl order', async () => {
    const { events } = await readJsonl(FIXTURE);
    const uuids = events.map((e) => e.uuid);
    expect(uuids).toEqual([
      'u-001',
      'u-002',
      'u-003',
      'u-004',
      'u-005',
      'u-006',
      'u-007',
      'u-008',
      'u-009',
    ]);
  });

  it('discriminates by type union', async () => {
    const { events } = await readJsonl(FIXTURE);
    const types = events.map((e) => e.type);
    expect(types).toContain('attachment');
    expect(types).toContain('user');
    expect(types).toContain('assistant');
    expect(types).toContain('tool_result');
  });

  it('reports 0 malformed lines on a clean fixture', async () => {
    const { malformedCount } = await readJsonl(FIXTURE);
    expect(malformedCount).toBe(0);
  });
});

describe('readJsonl — malformed input and diagnostics', () => {
  it.each([
    ['null', 'null', 'expected an object'],
    ['array', '[]', 'expected an object'],
    ['scalar', '"secret-value"', 'expected an object'],
    ['missing uuid', '{"type":"user"}', 'nonempty string uuid'],
    ['empty uuid', '{"type":"user","uuid":""}', 'nonempty string uuid'],
    [
      'uuidless attachment',
      '{"type":"attachment","attachment":{"type":"x"}}',
      'nonempty string uuid',
    ],
    ['uuidless system', '{"type":"system"}', 'nonempty string uuid'],
    ['missing type', '{"uuid":"u"}', 'nonempty string type'],
    ['numeric type', '{"uuid":"u","type":7}', 'nonempty string type'],
    ['missing message', '{"uuid":"u","type":"user"}', 'message must be an object'],
    ['array message', '{"uuid":"u","type":"user","message":[]}', 'message must be an object'],
    ['missing content', '{"uuid":"u","type":"user","message":{}}', 'message.content'],
    ['object content', '{"uuid":"u","type":"user","message":{"content":{}}}', 'message.content'],
    [
      'null block',
      '{"uuid":"u","type":"user","message":{"content":[null]}}',
      'message.content blocks',
    ],
    [
      'invalid text',
      '{"uuid":"u","type":"user","message":{"content":[{"type":"text","text":9}]}}',
      'text must be a string',
    ],
    [
      'invalid role',
      '{"uuid":"u","type":"user","message":{"role":false,"content":"ok"}}',
      'message.role',
    ],
    ['invalid sidechain', '{"uuid":"u","type":"system","isSidechain":"false"}', 'isSidechain'],
    ['invalid parent', '{"uuid":"u","type":"system","parentUuid":1}', 'parentUuid'],
    ['invalid timestamp', '{"uuid":"u","type":"system","timestamp":{}}', 'timestamp'],
    [
      'invalid tool',
      '{"uuid":"u","type":"tool_use","tool_use":{"id":"t","name":{}}}',
      'name must be a string',
    ],
    [
      'invalid result',
      '{"uuid":"u","type":"tool_result","tool_result":{"tool_use_id":4}}',
      'tool_use_id',
    ],
    [
      'invalid attachment',
      '{"uuid":"u","type":"attachment","attachment":{"type":7}}',
      'type must be a string',
    ],
    ['invalid meta', '{"type":"permission-mode","sessionId":{}}', 'sessionId'],
  ])('strict mode rejects %s with file and physical line number', async (_label, line, reason) => {
    const file = await jsonl(`\r\n${line}\r\n`);
    const error = await readJsonl(file, { strict: true }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(`${file}:2`);
    expect((error as Error).message).toContain(reason);
    expect((error as Error).message).not.toContain('secret-value');
  });

  it('does not expose source text from JSON.parse errors or tolerant warnings', async () => {
    const secret = 'sk-live-super-secret-token';
    const file = await jsonl(`{"type":"user","content":"${secret}" BROKEN}\n`);
    const error = await readJsonl(file, { strict: true }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`jsonl error at ${file}:1 — invalid JSON`);
    expect((error as Error).message).not.toContain(secret);
    const logger = loggerSpy();
    const result = await readJsonl(file, { logger });
    expect(result.malformedCount).toBe(1);
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(secret);
  });

  it('skips invalid records in tolerant mode and reports every physical line', async () => {
    const file = await jsonl(
      [
        '{"type":"permission-mode","sessionId":"s"}',
        'null',
        '[]',
        '{"type":"user","payload":"secret-value"}',
        '{"uuid":"secret-value"}',
        '{"uuid":"valid","type":"system"}',
      ].join('\n'),
    );
    const logger = loggerSpy();
    const result = await readJsonl(file, { logger });
    expect(result.events.map((event) => event.uuid)).toEqual(['valid']);
    expect(result.malformedCount).toBe(4);
    expect(vi.mocked(logger.warn).mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ path: file, lineNo: 2 }),
      expect.objectContaining({ path: file, lineNo: 3 }),
      expect.objectContaining({ path: file, lineNo: 4 }),
      expect.objectContaining({ path: file, lineNo: 5 }),
    ]);
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('secret-value');
  });

  it('keeps complete events before a truncated final record without a newline', async () => {
    const file = await jsonl('{"uuid":"ok","type":"system"}\n{"uuid":"unfinished"');
    const result = await readJsonl(file);
    expect(result.events.map((event) => event.uuid)).toEqual(['ok']);
    expect(result.malformedCount).toBe(1);
    await expect(readJsonl(file, { strict: true })).rejects.toThrow(`${file}:2`);
  });

  it('validates later permission metadata without replacing the original meta', async () => {
    const file = await jsonl(
      [
        { type: 'permission-mode', sessionId: 's', permissionMode: 'plan' },
        { type: 'permission-mode', permissionMode: {} },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n'),
    );
    await expect(readJsonl(file, { strict: true })).rejects.toThrow(`${file}:2`);
    const result = await readJsonl(file);
    expect(result.meta).toEqual({ sessionId: 's', permissionMode: 'plan' });
    expect(result.malformedCount).toBe(1);
    expect(result.skippedMetaCount).toBe(1);
  });

  it('rejects missing files with the original filesystem error', async () => {
    const file = await jsonl('');
    await rm(file);
    await expect(readJsonl(file)).rejects.toMatchObject({ code: 'ENOENT', path: file });
    await expect(readJsonl(file, { strict: true })).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts BOM, CRLF, blank lines and a complete final record without a newline', async () => {
    const file = await jsonl(
      '\uFEFF{"type":"permission-mode","sessionId":"s"}\r\n\r\n{"uuid":"a","type":"system"}\r\n{"uuid":"b","type":"system"}',
    );
    const result = await readJsonl(file, { strict: true });
    expect(result.meta.sessionId).toBe('s');
    expect(result.events.map((event) => event.uuid)).toEqual(['a', 'b']);
    expect(result.malformedCount).toBe(0);
  });
});

describe('readJsonl — safe typed payloads', () => {
  it('sanitizes malformed blocks and envelope fields without losing event indexes', async () => {
    const file = await jsonl(
      [
        { type: 'permission-mode', sessionId: 's' },
        {
          uuid: 'u',
          type: 'user',
          parentUuid: {},
          isSidechain: 'false',
          timestamp: [],
          message: {
            role: 5,
            content: [
              null,
              3,
              'text',
              [],
              {},
              { type: 4 },
              { type: 'text', text: null },
              { type: 'text', text: '/plan next task', citations: [{ id: 'c' }] },
              { type: 'thinking', thinking: {}, signature: 'retained' },
            ],
          },
        },
        {
          uuid: 'a',
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 3, name: {}, input: { file_path: 'src/a.ts' } },
              { type: 'tool_use', id: 't', name: 'Read', input: { file_path: 'src/b.ts' } },
              { type: 'tool_result', tool_use_id: 7, content: [{ type: 'image', source: {} }] },
            ],
          },
        },
        { uuid: 't', type: 'tool_use', tool_use: { id: null, name: [], input: null } },
        { uuid: 'm', type: 'user', message: false },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n'),
    );
    const logger = loggerSpy();
    const result = await readJsonl(file, { logger });
    expect(result.malformedCount).toBe(4);
    expect(logger.warn).toHaveBeenCalledTimes(4);
    expect(result.events.map((event) => event.uuid)).toEqual(['u', 'a', 't', 'm']);
    expect(result.events[0]).toMatchObject({
      parentUuid: null,
      isSidechain: false,
      timestamp: '',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: '' },
          { type: 'text', text: '/plan next task', citations: [{ id: 'c' }] },
          { type: 'thinking', signature: 'retained' },
        ],
      },
    });
    const signals = extractSignals(result.events);
    expect(signals.map(({ index, uuid }) => ({ index, uuid }))).toEqual([
      { index: 0, uuid: 'u' },
      { index: 1, uuid: 'a' },
      { index: 2, uuid: 't' },
      { index: 3, uuid: 'm' },
    ]);
    expect(signals[0].slashCommand).toBe('plan');
    expect(signals[1].tools).toEqual(['', 'Read']);
    expect(signals[1].files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(signals[2].tools).toEqual([]);
    expect(signals[3].text).toBe('');
  });

  it('sanitizes typed attachment and standalone tool-result fields', async () => {
    const file = await jsonl(
      [
        {
          uuid: 'a',
          type: 'attachment',
          attachment: {
            type: 'hook',
            stdout: {},
            exitCode: '0',
            durationMs: 2,
            extra: { keep: true },
          },
        },
        {
          uuid: 'r',
          type: 'tool_result',
          tool_result: { tool_use_id: [], content: { keep: true } },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n'),
    );
    const result = await readJsonl(file);
    expect(result.malformedCount).toBe(2);
    expect(result.events[0]).toMatchObject({
      attachment: { type: 'hook', durationMs: 2, extra: { keep: true } },
    });
    if (result.events[0].type !== 'attachment') throw new Error('expected attachment');
    expect(result.events[0].attachment).not.toHaveProperty('stdout');
    expect(result.events[0].attachment).not.toHaveProperty('exitCode');
    expect(result.events[1]).toMatchObject({
      tool_result: { tool_use_id: '', content: { keep: true } },
    });
  });

  it('preserves modern and unknown message blocks, payload fields and event types', async () => {
    const content = [
      { type: 'text', text: 'hello', citations: [{ source: 'x' }] },
      { type: 'image', source: { type: 'base64', data: 'payload' } },
      { type: 'document', source: { type: 'text', data: 'document' } },
      { type: 'redacted_thinking', data: 'opaque' },
      { type: 'server_tool_use', id: 's', name: 'web_search', input: { query: 'q' } },
      { type: 'future_block', nested: [null, { unknown: true }] },
      {
        type: 'tool_result',
        tool_use_id: 't',
        content: [{ type: 'image', source: {} }],
        is_error: true,
      },
      { type: 'tool_result', tool_use_id: 'empty', content: null },
    ];
    const unknown = { uuid: 'future', type: 'future_event', payload: { secret: 'opaque' } };
    const file = await jsonl(
      [
        {
          uuid: 'a',
          type: 'assistant',
          requestId: 'request-1',
          message: {
            role: 'assistant',
            content,
            model: 'future-model',
            usage: { input_tokens: 9 },
          },
        },
        unknown,
      ]
        .map((line) => JSON.stringify(line))
        .join('\n'),
    );
    const result = await readJsonl(file, { strict: true });
    expect(result.malformedCount).toBe(0);
    expect(result.events[0]).toMatchObject({
      requestId: 'request-1',
      message: { content, model: 'future-model', usage: { input_tokens: 9 } },
    });
    expect(result.events[1]).toMatchObject({
      type: 'other',
      originalType: 'future_event',
      payload: unknown,
    });
    expect(extractSignals(result.events)[0].text).toBe('hello');
  });

  it('skips known UUIDless metadata but retains UUID-carrying metadata events', async () => {
    const lines = [
      { type: 'permission-mode', sessionId: 's', permissionMode: 'plan' },
      { type: 'last-prompt', lastPrompt: 'x' },
      { type: 'file-history-snapshot', snapshot: {} },
      { type: 'queue-operation', operation: 'enqueue' },
      { type: 'permission-mode', permissionMode: 'default' },
      { uuid: 'a', type: 'last-prompt', lastPrompt: 'keep this event' },
      { uuid: 'b', type: 'permission-mode', parentUuid: 'a', permissionMode: 'default' },
    ];
    const file = await jsonl(lines.map((line) => JSON.stringify(line)).join('\n'));
    const result = await readJsonl(file, { strict: true });
    expect(result.meta).toEqual({ sessionId: 's', permissionMode: 'plan' });
    expect(result.skippedMetaCount).toBe(4);
    expect(result.malformedCount).toBe(0);
    expect(result.events.map((event) => event.uuid)).toEqual(['a', 'b']);
    expect(result.events[0]).toMatchObject({
      type: 'other',
      originalType: 'last-prompt',
      payload: lines[5],
    });
    expect(result.events[1]).toMatchObject({
      type: 'other',
      originalType: 'permission-mode',
      payload: lines[6],
    });
  });

  it('accepts current Claude Code UUIDless metadata and structured attachment content', async () => {
    const lines = [
      { type: 'permission-mode', sessionId: 's', permissionMode: 'default' },
      { type: 'custom-title', customTitle: 'title', sessionId: 's' },
      { type: 'agent-name', agentName: 'name', sessionId: 's' },
      { type: 'mode', mode: 'normal', sessionId: 's' },
      { type: 'atis-latch', atis: 'on', sessionId: 's' },
      { type: 'ai-title', aiTitle: 'title', sessionId: 's' },
      { type: 'file-history-delta', messageId: 'm', backup: {}, timestamp: 't' },
      { type: 'future-metadata', sessionId: 's' },
      {
        uuid: 'a',
        type: 'attachment',
        attachment: { type: 'hook_additional_context', hookName: 'h', content: ['context'] },
      },
      {
        uuid: 'b',
        parentUuid: 'a',
        type: 'attachment',
        attachment: { type: 'file', filename: 'f.ts', content: { type: 'text' } },
      },
    ];
    const file = await jsonl(lines.map((line) => JSON.stringify(line)).join('\n'));
    const logger = loggerSpy();
    const result = await readJsonl(file, { strict: true, logger });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(result.malformedCount).toBe(0);
    expect(result.skippedMetaCount).toBe(7);
    expect(result.events.map((event) => event.uuid)).toEqual(['a', 'b']);
    expect(
      result.events.map((event) => (event.type === 'attachment' ? event.attachment.content : '-')),
    ).toEqual([undefined, undefined]);
  });
});
