import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMatcher } from '../src/search/matcher.js';
import {
  claudeRecordItems,
  codexRecordItems,
  fieldsOf,
  type FieldText,
} from '../src/search/project.js';
import { boundReport } from '../src/search/bound.js';
import { formatSessionBlocks } from '../src/search/format.js';
import { scanFile } from '../src/search/scan.js';
import type { SearchReport, SessionResult } from '../src/search/types.js';
import { matchField, snippetAround } from '../src/search/snippet.js';
import { defaultRedactor } from '../src/utils/redact.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-tree-search-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function candidates(lines: string[], query: string, chunkBytes?: number): Promise<string[]> {
  const file = join(root, 'session.jsonl');
  await writeFile(file, lines.join('\n') + '\n');
  const found: string[] = [];
  await scanFile(file, createMatcher(query), (line) => found.push(line) > 0, { chunkBytes });
  return found;
}

const json = (value: unknown) => JSON.stringify(value);
const fields = (items: ReturnType<typeof claudeRecordItems>, includeToolOutput = false) =>
  fieldsOf(items, { includeToolOutput, searchCalls: new Set() });

describe('search matcher', () => {
  it('folds case only for an all-lowercase query (smart case)', () => {
    expect(createMatcher('redactor').indexIn('the Redactor ran')).toBe(4);
    expect(createMatcher('Redactor').indexIn('the redactor ran')).toBe(-1);
    expect(createMatcher('Redactor').indexIn('the Redactor ran')).toBe(4);
    expect(createMatcher('Redactor').caseSensitive).toBe(true);
  });

  it('folds ASCII only, so accented capitals keep their case', () => {
    expect(createMatcher('é').indexIn('CAFÉ')).toBe(-1);
    expect(createMatcher('é').indexIn('café')).toBe(3);
  });

  it('treats the query literally, never as a pattern', () => {
    expect(createMatcher('a.c').indexIn('abc')).toBe(-1);
    expect(createMatcher('(a|b)*').indexIn('x (a|b)* y')).toBe(2);
  });
});

describe('search prefilter (stage 1)', () => {
  it('finds quotes and backslashes in their JSON-escaped form', async () => {
    const lines = [json({ text: 'say "hi" to C:\\temp' }), json({ text: 'say hi' })];
    expect(await candidates(lines, 'say "hi"')).toEqual([lines[0]]);
    expect(await candidates(lines, 'c:\\temp')).toEqual([lines[0]]);
  });

  it('finds text inside a JSON string that is itself JSON (Codex function arguments)', async () => {
    const line = json({ arguments: json({ cmd: 'grep "needle" src' }) });
    expect(await candidates([line], 'grep "needle"')).toEqual([line]);
  });

  it('finds Hangul that an ASCII-only writer escaped inside Codex function arguments', async () => {
    const asciiArguments = '{"cmd":"grep \\uac80\\uc0c9 src"}';
    expect(JSON.parse(asciiArguments).cmd).toBe('grep 검색 src');
    const line = json({ payload: { type: 'function_call', arguments: asciiArguments } });
    expect(line).toContain('\\\\uac80\\\\uc0c9');
    expect(await candidates([line], '검색')).toEqual([line]);
  });

  it('finds a Hangul query stored as raw UTF-8 and as \\uXXXX escapes', async () => {
    const raw = json({ text: '검색 기능' });
    const escaped = raw.replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
    const upper = raw.replace(
      /[\u0080-\uffff]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    expect(escaped).not.toContain('검색');
    expect(await candidates([raw, escaped, upper, json({ text: 'other' })], '검색')).toEqual([
      raw,
      escaped,
      upper,
    ]);
  });

  it('reports a match split across a chunk boundary, at every boundary position', async () => {
    const lines = [
      json({ n: 1, text: 'nothing here' }),
      json({ n: 2, text: `padding ${'x'.repeat(37)} the needle sits here` }),
      json({ n: 3, text: 'no' }),
      json({ n: 4, text: 'needle again, twice: needle' }),
    ];
    for (let chunkBytes = 1; chunkBytes <= 90; chunkBytes++) {
      expect(await candidates(lines, 'needle', chunkBytes), `chunk ${chunkBytes}`).toEqual([
        lines[1],
        lines[3],
      ]);
    }
  });

  it('reports a final line without a trailing newline', async () => {
    const file = join(root, 'tail.jsonl');
    await writeFile(file, `${json({ a: 1 })}\n${json({ text: 'needle' })}`);
    for (const chunkBytes of [3, 7, 1024]) {
      const found: string[] = [];
      await scanFile(file, createMatcher('needle'), (line) => found.push(line) > 0, { chunkBytes });
      expect(found).toEqual([json({ text: 'needle' })]);
    }
  });

  it('stops when the callback says so', async () => {
    const lines = [json({ t: 'needle 1' }), json({ t: 'needle 2' })];
    const file = join(root, 'stop.jsonl');
    await writeFile(file, lines.join('\n'));
    const found: string[] = [];
    await scanFile(file, createMatcher('needle'), (line) => found.push(line) < 0);
    expect(found).toEqual([lines[0]]);
  });
});

describe('searchable fields', () => {
  const claude = (message: unknown, extra: Record<string, unknown> = {}) => ({
    uuid: 'u1',
    type: (message as { role: string }).role,
    message,
    ...extra,
  });

  it('projects prompts, replies, tool names and inputs, never thinking', () => {
    const items = claudeRecordItems(
      claude({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'secret plan' },
          { type: 'text', text: 'Reply text' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls src', nested: ['a'] } },
        ],
      }),
    );
    expect(fields(items)).toEqual<FieldText[]>([
      { field: 'assistant', text: 'Reply text' },
      { field: 'tool_name', text: 'Bash' },
      { field: 'tool_input', text: 'ls src' },
      { field: 'tool_input', text: 'a' },
    ]);
  });

  it('includes tool results only on request, and never their images', () => {
    const items = claudeRecordItems(
      claude({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: [
              { type: 'text', text: 'output line' },
              { type: 'image', source: { data: 'aW1hZ2U=' } },
            ],
          },
        ],
      }),
    );
    expect(fields(items)).toEqual([]);
    expect(fields(items, true)).toEqual([{ field: 'tool_output', text: 'output line' }]);
  });

  it('skips injected and noise prompts, and records without a uuid', () => {
    const prompt = { role: 'user', content: 'A real prompt' };
    expect(fields(claudeRecordItems(claude(prompt)))).toEqual([
      { field: 'user', text: 'A real prompt' },
    ]);
    expect(fields(claudeRecordItems(claude(prompt, { isMeta: true })))).toEqual([]);
    expect(fields(claudeRecordItems(claude(prompt, { isCompactSummary: true })))).toEqual([]);
    expect(fields(claudeRecordItems({ ...claude(prompt), uuid: undefined }))).toEqual([]);
    for (const noise of ['<command-name>/x</command-name>', 'Stop hook feedback: x', '$ ls']) {
      expect(fields(claudeRecordItems(claude({ role: 'user', content: noise })))).toEqual([]);
    }
  });

  it('agrees with the readers on calls they keep or drop', () => {
    const shell = (action: Record<string, unknown>) =>
      codexRecordItems({
        type: 'response_item',
        payload: { type: 'local_shell_call', call_id: 'c1', action: { type: 'exec', ...action } },
      });
    expect(shell({ command: [] })).toEqual([]);
    expect(shell({ command: ['ls', 1] })).toEqual([]);
    expect(fields(shell({ command: ['ls', 'src'] })).map((field) => field.text)).toEqual([
      'local_shell',
      'exec',
      'ls',
      'src',
    ]);
    const unnamed = claudeRecordItems(
      claude({
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', input: { command: 'make needle' } }],
      }),
    );
    expect(fields(unnamed)).toContainEqual({ field: 'tool_input', text: 'make needle' });
  });

  it('never projects Codex developer instructions, reasoning or session metadata', () => {
    const records = [
      { type: 'session_meta', payload: { id: 'x', base_instructions: 'needle' } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'needle' }],
        },
      },
      {
        type: 'response_item',
        payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'needle' }] },
      },
      { type: 'event_msg', payload: { type: 'token_count', rate_limits: { plan_type: 'needle' } } },
    ];
    for (const record of records) expect(fields(codexRecordItems(record), true)).toEqual([]);
  });

  it('projects Codex prompts, replies, calls and outputs like the reader does', () => {
    const items = [
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Fix it' }],
        },
      },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'Fixed' } },
      {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell',
          call_id: 'c1',
          arguments: json({ cmd: 'ls' }),
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'apply_patch',
          call_id: 'c2',
          input: '*** Begin Patch',
        },
      },
      {
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'c1', output: 'file.ts' },
      },
      {
        type: 'response_item',
        payload: { type: 'function_call', name: 'shell', call_id: '', arguments: '{}' },
      },
    ].flatMap((record) => codexRecordItems(record));
    expect(fields(items, true)).toEqual<FieldText[]>([
      { field: 'user', text: 'Fix it' },
      { field: 'assistant', text: 'Fixed' },
      { field: 'tool_name', text: 'shell' },
      { field: 'tool_input', text: 'ls' },
      { field: 'tool_name', text: 'apply_patch' },
      { field: 'tool_input', text: '*** Begin Patch' },
      { field: 'tool_output', text: 'file.ts' },
    ]);
  });

  it("skips the search's own calls and their results", () => {
    const state = { includeToolOutput: true, searchCalls: new Set<string>() };
    const mcpCall = claudeRecordItems(
      claude({
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'm1',
            name: 'mcp__agent-tree__agent_tree_search',
            input: { query: 'needle' },
          },
          {
            type: 'tool_use',
            id: 's1',
            name: 'Bash',
            input: { command: 'npx agent-tree --json --search needle' },
          },
          { type: 'tool_use', id: 's2', name: 'Bash', input: { command: 'grep needle src' } },
          {
            type: 'tool_use',
            id: 's3',
            name: 'Bash',
            input: { command: 'cd ~/Code/agent-tree-work && grep --search needle' },
          },
        ],
      }),
    );
    expect(fieldsOf(mcpCall, state).map((field) => field.text)).toEqual([
      'Bash',
      'grep needle src',
      'Bash',
      'cd ~/Code/agent-tree-work && grep --search needle',
    ]);
    const results = claudeRecordItems(
      claude({
        role: 'user',
        content: ['m1', 's1', 's2'].map((id) => ({
          type: 'tool_result',
          tool_use_id: id,
          content: `needle via ${id}`,
        })),
      }),
    );
    expect(fieldsOf(results, state).map((field) => field.text)).toEqual(['needle via s2']);
  });

  it('skips search calls written as argv arrays', () => {
    const call = (command: string[]) =>
      codexRecordItems({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell',
          call_id: 'c1',
          arguments: json({ command }),
        },
      });
    const state = () => ({ includeToolOutput: false, searchCalls: new Set<string>() });
    for (const command of [
      ['agent-tree', '--search', 'heron'],
      ['npx', 'agent-tree', '--json', '--search', 'heron'],
      ['atree', '--search', 'heron'],
    ]) {
      expect(fieldsOf(call(command), state()), command.join(' ')).toEqual([]);
    }
    expect(fieldsOf(call(['grep', '--search', 'heron']), state())).not.toEqual([]);
  });
});

describe('confirming on redacted text', () => {
  const redactor = defaultRedactor();

  it('cannot find or confirm a secret', () => {
    const secret = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
    const field: FieldText = { field: 'user', text: `token ${secret} here` };
    expect(createMatcher(secret).indexIn(field.text)).toBeGreaterThan(0);
    expect(matchField(field, createMatcher(secret), redactor)).toBeNull();
    expect(matchField(field, createMatcher(secret.slice(4, 20)), redactor)).toBeNull();
    const around = matchField(field, createMatcher('here'), redactor);
    expect(around?.snippet).not.toContain(secret.slice(4));
    expect(around?.snippet).toContain('REDACTED');
  });

  it('cuts 60 characters either side, on one line, with ellipses', () => {
    const text = `${'a'.repeat(100)}\nNEEDLE\n${'b'.repeat(100)}`;
    const snippet = snippetAround(text, 101, 6);
    expect(snippet).toBe(`…${'a'.repeat(59)} NEEDLE ${'b'.repeat(59)}…`);
    expect(snippetAround('short NEEDLE', 6, 6)).toBe('short NEEDLE');
  });

  it('strips terminal escapes and bidirectional overrides from snippets', () => {
    expect(snippetAround('x\x1b[2Jneedle\u202ey', 6, 6)).toBe('x [2Jneedle y');
  });
});

describe('search text output', () => {
  const report = (project: string | null): SearchReport => ({
    query: 'needle',
    case_sensitive: false,
    scope: { sources: ['claude'], project, since_days: null, include_tool_output: false },
    scanned: { sessions: 1, bytes: 10, seconds: 0.1, stopped_early: false },
    total_sessions: 1,
    results: [
      {
        source: 'claude',
        session_id: 'aaaa1111-2222-4333-8444-555566667777',
        project_dir: '/tmp/odd\x1b]0;title\x07dir',
        mtime: '2026-10-01T10:00:00.000Z',
        hits: [
          {
            step: 3,
            node_id: 'n_003',
            field: 'user',
            timestamp: '2026-10-01T10:00:00.000Z',
            snippet: 'a needle',
            matches_in_step: 1,
          },
        ],
        more_hits: 0,
      },
    ],
  });
  const commandId = () => 'aaaa1111';

  it('keeps control characters from session paths out of the terminal', () => {
    const [block] = formatSessionBlocks(report(null), { commandId });
    expect(block.split('\n').some((line) => /\p{Cc}/u.test(line))).toBe(false);
    expect(block.split('\n')[0]).toContain('/tmp/odd ]0;title dir');
  });

  it('repeats --cwd in the snapshot command when the search was scoped to a project', () => {
    const [unscoped] = formatSessionBlocks(report(null), { commandId });
    expect(unscoped.split('\n').at(-1)).toBe(
      '  snapshot: agent-tree --source claude aaaa1111 --snapshot 3 --mode continue',
    );
    const [scoped] = formatSessionBlocks(report("/tmp/it's here"), { commandId });
    expect(scoped.split('\n').at(-1)).toBe(
      "  snapshot: agent-tree --source claude --cwd '/tmp/it'\\''s here' aaaa1111 --snapshot 3 --mode continue",
    );
  });
});

describe('bounding the MCP report', () => {
  const session = (id: string, hits: number): SessionResult => ({
    source: 'claude',
    session_id: id,
    project_dir: '/p',
    mtime: '2026-10-01T10:00:00.000Z',
    hits: Array.from({ length: hits }, (_, index) => ({
      step: index + 1,
      node_id: `n_00${index + 1}`,
      field: 'user',
      timestamp: '2026-10-01T10:00:00.000Z',
      snippet: 'x'.repeat(100),
      matches_in_step: 1,
    })),
    more_hits: 0,
  });
  const report = (results: SessionResult[], total = results.length): SearchReport => ({
    query: 'x',
    case_sensitive: false,
    scope: { sources: ['claude'], project: null, since_days: null, include_tool_output: false },
    scanned: { sessions: total, bytes: 1, seconds: 0.1, stopped_early: false },
    total_sessions: total,
    results,
  });
  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

  it('leaves a report within the budget unchanged', () => {
    const input = report([session('a', 3)]);
    expect(boundReport(input, bytes(input))).toEqual(input);
  });

  it('drops hits from the fullest sessions first, the older on a tie, and counts them', () => {
    const input = report([session('a', 2), session('b', 6), session('c', 6)]);
    const before = JSON.stringify(input);
    const one = boundReport(input, bytes(input) - 100);
    expect(JSON.stringify(input)).toBe(before);
    expect(bytes(one)).toBeLessThanOrEqual(bytes(input) - 100);
    expect(one.results.map((result) => [result.hits.length, result.more_hits])).toEqual([
      [2, 0],
      [6, 0],
      [5, 1],
    ]);
    const two = boundReport(input, bytes(input) - 300);
    expect(two.results.map((result) => [result.hits.length, result.more_hits])).toEqual([
      [2, 0],
      [5, 1],
      [5, 1],
    ]);
  });

  it('keeps one hit per session, then drops the oldest sessions', () => {
    const expected = report([{ ...session('a', 1), more_hits: 2 }], 2);
    const bounded = boundReport(report([session('a', 3), session('b', 3)]), bytes(expected));
    expect(bounded).toEqual(expected);
  });
});
