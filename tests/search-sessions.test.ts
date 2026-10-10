import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServer } from '../src/mcp/server.js';
import { searchText } from '../src/mcp/search.js';
import { encodeProjectPath } from '../src/sources/claude.js';

const testState = vi.hoisted(() => ({ userConfigPath: '' }));
vi.mock('../src/config/loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/loader.js')>();
  return {
    ...actual,
    loadConfig: (options: Parameters<typeof actual.loadConfig>[0] = {}) =>
      actual.loadConfig({ ...options, userConfigPath: testState.userConfigPath }),
  };
});

const exec = promisify(execFile);
const entry = resolve('src/cli.ts');
const ids = {
  old: 'a1a1a1a1-2222-4333-8444-555566667777',
  mid: 'b2b2b2b2-2222-4333-8444-555566667777',
  new: 'c3c3c3c3-2222-4333-8444-555566667777',
  codex: 'd4d4d4d4-2222-4333-8444-555566667777',
};
const DAY = 24 * 60 * 60;
const now = Math.floor(Date.now() / 1000);
let root: string;
let home: string;
let project: string;
let other: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-tree-search-cli-'));
  home = join(root, 'home');
  project = join(root, 'project');
  other = join(root, 'other');
  await Promise.all([home, project, other].map((dir) => mkdir(dir)));
  testState.userConfigPath = join(root, 'user.yaml');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

function env(): NodeJS.ProcessEnv {
  const vars: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: join(root, 'claude'),
    CODEX_HOME: join(root, 'codex'),
    ANTHROPIC_API_KEY: '',
    AGENT_TREE_NO_LLM: 'true',
  };
  for (const key of ['AGENT_TREE_REDACT_STRICT', 'AGENT_TREE_VERBOSE', 'NO_COLOR'])
    delete vars[key];
  return vars;
}

async function cli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, ['--import', 'tsx', entry, ...args], {
      cwd: process.cwd(),
      env: env(),
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

interface Turn {
  prompt: string;
  reply?: string;
  tool?: { name: string; input: Record<string, unknown>; output: string };
}

/** A Claude Code session whose phases are the given prompts, a minute apart. */
async function claudeSession(id: string, cwd: string, turns: Turn[], ageDays = 0) {
  const dir = join(root, 'claude', 'projects', encodeProjectPath(cwd));
  await mkdir(dir, { recursive: true });
  const base = {
    isSidechain: false,
    sessionId: id,
    cwd,
    gitBranch: 'main',
    version: '2.1.296',
    userType: 'external',
  };
  const records: unknown[] = [
    { type: 'permission-mode', permissionMode: 'default', sessionId: id },
  ];
  let parent: string | null = null;
  const push = (offset: number, record: Record<string, unknown>) => {
    const uuid = `${id.slice(0, 8)}-${records.length}`;
    const timestamp = new Date(Date.UTC(2026, 9, 1, 10) + offset * 1000).toISOString();
    records.push({ ...base, parentUuid: parent, uuid, timestamp, ...record });
    parent = uuid;
  };
  turns.forEach((turn, index) => {
    const at = index * 3600;
    push(at, {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: turn.prompt }] },
    });
    const content: unknown[] = [{ type: 'text', text: turn.reply ?? `Working on step ${index}.` }];
    if (turn.tool) {
      content.push({
        type: 'tool_use',
        id: `tool-${index}`,
        name: turn.tool.name,
        input: turn.tool.input,
      });
    }
    push(at + 5, { type: 'assistant', message: { role: 'assistant', content } });
    if (turn.tool) {
      push(at + 10, {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: `tool-${index}`, content: turn.tool.output },
          ],
        },
      });
    }
  });
  const file = join(dir, `${id}.jsonl`);
  await writeFile(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  const mtime = now - ageDays * DAY;
  await utimes(file, mtime, mtime);
  return file;
}

/** A Codex rollout with one user prompt and one tool call per turn. */
async function codexSession(id: string, cwd: string, prompts: string[], ageDays = 0) {
  const dir = join(root, 'codex', 'sessions', '2026', '10', '01');
  await mkdir(dir, { recursive: true });
  const at = (seconds: number) => new Date(Date.UTC(2026, 9, 1, 9) + seconds * 1000).toISOString();
  const records: unknown[] = [
    {
      timestamp: at(0),
      type: 'session_meta',
      payload: {
        id,
        cwd,
        cli_version: '0.160.0',
        source: 'cli',
        base_instructions: 'INSTRUCTIONS_ONLY',
      },
    },
    {
      timestamp: at(1),
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: 'DEVELOPER_ONLY' }],
      },
    },
  ];
  prompts.forEach((prompt, index) => {
    const t = (index + 1) * 3600;
    records.push(
      { timestamp: at(t), type: 'turn_context', payload: { turn_id: `turn-${index}`, cwd } },
      {
        timestamp: at(t + 1),
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] },
      },
      {
        timestamp: at(t + 1),
        type: 'event_msg',
        payload: { type: 'user_message', message: prompt },
      },
      {
        timestamp: at(t + 2),
        type: 'response_item',
        payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'REASONING_ONLY' }] },
      },
      {
        timestamp: at(t + 3),
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell',
          call_id: `call-${index}`,
          arguments: JSON.stringify({ cmd: `ls dir${index}` }),
        },
      },
      {
        timestamp: at(t + 4),
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: `call-${index}`,
          output: `listing ${index}`,
        },
      },
      {
        timestamp: at(t + 5),
        type: 'event_msg',
        payload: { type: 'token_count', info: null, rate_limits: { plan_type: 'RATE_LIMIT_ONLY' } },
      },
    );
  });
  const file = join(dir, `rollout-2026-10-01T09-00-00-${id}.jsonl`);
  await writeFile(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  const mtime = now - ageDays * DAY;
  await utimes(file, mtime, mtime);
  return file;
}

const prompts = [
  'Please set up the project skeleton',
  'Add the ZEBRAFISH feature to the app module',
  'Finally write tests for the parser module',
];

async function search(...args: string[]) {
  const run = await cli('--search', ...args, '--json');
  expect(run.code, run.stderr).toBe(0);
  return JSON.parse(run.stdout);
}

describe('agent-tree --search', () => {
  it('reports a planted marker at its step, and --snapshot of that step shows it', async () => {
    await claudeSession(
      ids.new,
      project,
      prompts.map((prompt) => ({ prompt })),
    );
    const report = await search('zebrafish');
    expect(report.results).toHaveLength(1);
    const [result] = report.results;
    expect(result).toMatchObject({
      source: 'claude',
      session_id: ids.new,
      project_dir: project,
      more_hits: 0,
    });
    expect(result.hits).toHaveLength(1);
    const [hit] = result.hits;
    expect(hit).toMatchObject({ field: 'user', matches_in_step: 1 });
    expect(hit.snippet).toContain('ZEBRAFISH');

    const snapshot = await cli(ids.new.slice(0, 8), '--snapshot', String(hit.step));
    expect(snapshot.code, snapshot.stderr).toBe(0);
    expect(snapshot.stdout.split('\n')[0]).toContain('ZEBRAFISH');
    const neighbour = await cli(ids.new.slice(0, 8), '--snapshot', String(hit.step + 1));
    expect(neighbour.stdout.split('\n')[0]).not.toContain('ZEBRAFISH');
  }, 30_000);

  it('maps Codex prompts and tool inputs to steps and never matches reasoning or instructions', async () => {
    await codexSession(ids.codex, other, ['Investigate the KESTREL outage', 'Then clean up']);
    const report = await search('dir1');
    expect(report.results.map((result: { session_id: string }) => result.session_id)).toEqual([
      ids.codex,
    ]);
    expect(report.results[0].hits[0].field).toBe('tool_input');

    const kestrel = await search('kestrel', '--source', 'codex');
    const [hit] = kestrel.results[0].hits;
    expect(hit.field).toBe('user');
    const snapshot = await cli(
      '--source',
      'codex',
      ids.codex.slice(0, 8),
      '--snapshot',
      String(hit.step),
    );
    expect(snapshot.stdout.split('\n')[0]).toContain('KESTREL');

    const output = await search('listing 1', '--include-tool-output');
    expect(output.results[0].hits.map((hit: { field: string }) => hit.field)).toEqual([
      'tool_output',
    ]);
    expect((await search('listing 1')).results).toEqual([]);

    for (const hidden of [
      'INSTRUCTIONS_ONLY',
      'DEVELOPER_ONLY',
      'REASONING_ONLY',
      'RATE_LIMIT_ONLY',
    ]) {
      expect((await search(hidden, '--include-tool-output')).results, hidden).toEqual([]);
    }
  }, 60_000);

  it('matches tool output only with --include-tool-output', async () => {
    await claudeSession(ids.new, project, [
      {
        prompt: prompts[0],
        tool: { name: 'Bash', input: { command: 'cat notes' }, output: 'the PELICAN line' },
      },
    ]);
    expect((await search('pelican')).results).toEqual([]);
    const report = await search('pelican', '--include-tool-output');
    expect(report.results[0].hits[0].field).toBe('tool_output');
    expect(report.scope.include_tool_output).toBe(true);
  }, 30_000);

  it('never reports its own search calls', async () => {
    await claudeSession(ids.new, project, [
      {
        prompt: prompts[0],
        tool: {
          name: 'Bash',
          input: { command: 'agent-tree --search heron' },
          output: 'heron hits',
        },
      },
    ]);
    expect((await search('heron', '--include-tool-output')).results).toEqual([]);
  }, 30_000);

  it('exits 0 with "No matches." and an empty result for an absent term', async () => {
    await claudeSession(
      ids.new,
      project,
      prompts.map((prompt) => ({ prompt })),
    );
    const text = await cli('--search', 'absent_term_xq');
    expect(text).toMatchObject({ code: 0, stdout: '' });
    expect(text.stderr).toBe('No matches.\n');
    const report = await search('absent_term_xq');
    expect(report).toMatchObject({ total_sessions: 0, results: [] });
    expect(report.scanned).toMatchObject({ sessions: 1, stopped_early: false });
  }, 30_000);

  it('orders sessions newest first, stops at --limit, and scopes by --since, --cwd and --source', async () => {
    const turns = prompts.map((prompt) => ({ prompt }));
    await claudeSession(ids.old, project, turns, 20);
    await claudeSession(ids.mid, other, turns, 2);
    await claudeSession(ids.new, project, turns, 1);
    await codexSession(ids.codex, project, ['Add the ZEBRAFISH feature to the app module'], 3);
    const sessionIds = (report: { results: Array<{ session_id: string }> }) =>
      report.results.map((result) => result.session_id);

    const all = await search('zebrafish');
    expect(sessionIds(all)).toEqual([ids.new, ids.mid, ids.codex, ids.old]);
    expect(all.scope).toEqual({
      sources: ['claude', 'codex'],
      project: null,
      since_days: null,
      include_tool_output: false,
    });

    const limited = await search('zebrafish', '--limit', '2');
    expect(sessionIds(limited)).toEqual([ids.new, ids.mid]);
    expect(limited.scanned).toMatchObject({ sessions: 2, stopped_early: true });
    expect(limited.total_sessions).toBe(2);

    expect(sessionIds(await search('zebrafish', '--since', '10'))).toEqual([
      ids.new,
      ids.mid,
      ids.codex,
    ]);
    expect(sessionIds(await search('zebrafish', '--cwd', project))).toEqual([
      ids.new,
      ids.codex,
      ids.old,
    ]);
    expect(sessionIds(await search('zebrafish', '--source', 'codex'))).toEqual([ids.codex]);
  }, 90_000);

  it('prints session blocks with steps, "+N more" and a ready --snapshot command', async () => {
    const turns = Array.from({ length: 7 }, (_, index) => ({
      prompt: `Turn ${index}: tune the OSPREY parser`,
    }));
    await claudeSession(ids.new, project, turns);
    const { code, stdout } = await cli('--search', 'osprey');
    expect(code).toBe(0);
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toMatch(
      new RegExp(
        `^claude  ${ids.new.slice(0, 8)}  ${project}  \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$`,
      ),
    );
    expect(
      lines
        .slice(1, 6)
        .every((line) => /^ {2}step \d+ +user {8}Turn \d: tune the OSPREY parser$/.test(line)),
    ).toBe(true);
    expect(lines[6]).toBe('  +2 more steps');
    const firstStep = /step (\d+)/.exec(lines[1])![1];
    expect(lines[7]).toBe(
      `  open: agent-tree --source claude ${ids.new.slice(0, 8)} --snapshot ${firstStep} --mode continue`,
    );
    expect(stdout).not.toContain('\x1b[');
  }, 30_000);

  it('rejects an empty or multi-line query with exit 2', async () => {
    expect((await cli('--search', ' ')).code).toBe(2);
    expect((await cli('--search', 'a\nb')).code).toBe(2);
  }, 30_000);
});

describe('agent_tree_search (MCP)', () => {
  let server: McpServer;
  let client: Client;

  beforeEach(async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'claude'));
    vi.stubEnv('CODEX_HOME', join(root, 'codex'));
    vi.stubEnv('AGENT_TREE_NO_LLM', 'true');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('AGENT_TREE_REDACT_STRICT', '');
    server = createServer();
    client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });
  afterEach(async () => {
    await client.close();
    await server.close();
  });

  const call = (args: Record<string, unknown>) =>
    client.callTool({ name: 'agent_tree_search', arguments: { cwd: project, ...args } });
  const textOf = (result: Awaited<ReturnType<typeof call>>) =>
    (result.content as Array<{ text?: string }>).map((block) => block.text ?? '').join('\n');

  it('returns the same report as the CLI JSON, plus a text block', async () => {
    await claudeSession(
      ids.new,
      project,
      prompts.map((prompt) => ({ prompt })),
    );
    await codexSession(ids.codex, other, ['Add the ZEBRAFISH feature to the app module'], 1);
    const result = await call({ query: 'zebrafish' });
    expect(result.isError).not.toBe(true);
    const cliReport = await search('zebrafish');
    const normalize = (report: { scanned: { seconds: number } }) => ({
      ...report,
      scanned: { ...report.scanned, seconds: 0 },
    });
    expect(normalize(result.structuredContent as never)).toEqual(normalize(cliReport));
    const text = textOf(result);
    expect(text).toContain(`claude  ${ids.new.slice(0, 8)}`);
    expect(text).toContain('--snapshot');
    expect(text).toMatch(/2 sessions with matches; 2 sessions \(.+\) scanned in [\d.]+ s\.$/);
  }, 30_000);

  it('limits the project scope to cwd and the source on request', async () => {
    await claudeSession(
      ids.new,
      project,
      prompts.map((prompt) => ({ prompt })),
    );
    await claudeSession(
      ids.mid,
      other,
      prompts.map((prompt) => ({ prompt })),
    );
    await codexSession(ids.codex, project, ['Add the ZEBRAFISH feature to the app module']);
    const scoped = await call({ query: 'zebrafish', scope: 'project', source: 'claude' });
    const report = scoped.structuredContent as {
      results: Array<{ session_id: string }>;
      scope: unknown;
    };
    expect(report.results.map((result) => result.session_id)).toEqual([ids.new]);
    expect(report.scope).toEqual({
      sources: ['claude'],
      project,
      since_days: null,
      include_tool_output: false,
    });
  }, 30_000);

  it('rejects queries the schema lets through but the search cannot run', async () => {
    for (const query of ['   ', 'a\nb']) {
      const result = await call({ query });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/^Search /);
    }
    const tooLong = await call({ query: 'x'.repeat(201) });
    expect(tooLong.isError).toBe(true);
    const badLimit = await call({ query: 'x', limit: 51 });
    expect(badLimit.isError).toBe(true);
  });

  it('caps the text block at 20 KB and points to structuredContent', () => {
    const blocks = Array.from({ length: 100 }, (_, index) => `block ${index} ${'x'.repeat(400)}`);
    const text = searchText(blocks, 'summary.');
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(20 * 1024);
    expect(text).toMatch(
      /\(\d+ more sessions in structuredContent; text is capped at 20 KB\)\n\nsummary\.$/,
    );
  });
});
