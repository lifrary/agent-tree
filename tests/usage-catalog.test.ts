import { appendFile, mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { format } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import * as pipeline from '../src/cli/pipeline.js';
import { DEFAULT_CONFIG } from '../src/config/schema.js';
import { createServer } from '../src/mcp/server.js';
import { claudeSource, encodeProjectPath } from '../src/sources/claude.js';
import { codexSource } from '../src/sources/codex.js';
import { addCatalogUsage, type CatalogUsageEntry } from '../src/usage/catalog.js';
import * as subagents from '../src/usage/subagents.js';
import * as codexSubagents from '../src/usage/codex_subagents.js';
import { createLoggerSync } from '../src/utils/logger.js';
import { defaultRedactor } from '../src/utils/redact.js';
import { listSessions } from '../src/utils/session_path.js';

const state = vi.hoisted(() => ({ userConfigPath: '', picksRoot: '' }));
vi.mock('../src/config/loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/loader.js')>();
  return {
    ...actual,
    loadConfig: (options: Parameters<typeof actual.loadConfig>[0] = {}) =>
      actual.loadConfig({ ...options, userConfigPath: state.userConfigPath }),
  };
});
vi.mock('../src/utils/picks.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/picks.js')>();
  return {
    ...actual,
    readPicks: (sessionId: string, options: Parameters<typeof actual.readPicks>[1] = {}) =>
      actual.readPicks(sessionId, { ...options, root: state.picksRoot }),
  };
});

const ids = {
  main: 'aaaaaaaa-abcd-4abc-8abc-aaaaaaaaaaaa',
  missing: 'bbbbbbbb-abcd-4abc-8abc-bbbbbbbbbbbb',
  zero: 'cccccccc-abcd-4abc-8abc-cccccccccccc',
  child: 'dddddddd-abcd-4abc-8abc-dddddddddddd',
};
const at = (second: number) => new Date(Date.UTC(2026, 9, 1, 10, 0, second)).toISOString();
let root: string;
let project: string;
let server: McpServer;
let client: Client;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atree-catalog-usage-'));
  project = join(root, 'PRIVATEPROJECT');
  await mkdir(project);
  state.userConfigPath = join(root, 'user.yaml');
  state.picksRoot = join(root, 'picks');
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'claude'));
  vi.stubEnv('CODEX_HOME', join(root, 'codex'));
  vi.stubEnv('AGENT_TREE_NO_LLM', '');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('AGENT_TREE_MODEL', undefined);
  vi.stubEnv('AGENT_TREE_REDACT_STRICT', '');
  vi.stubEnv('AGENT_TREE_VERBOSE', '');
  server = createServer();
  client = new Client({ name: 'catalog-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});
afterEach(async () => {
  await client?.close();
  await server?.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function writeLines(file: string, records: unknown[]) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  return file;
}

type Tokens = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};
const mainTokens: Tokens = {
  input_tokens: 100,
  cache_read_input_tokens: 20,
  cache_creation_input_tokens: 10,
  output_tokens: 7,
};

async function claude(id: string, usage?: Tokens, child = false, trigger?: string) {
  const file = join(root, 'claude', 'projects', encodeProjectPath(project), `${id}.jsonl`);
  const base = { sessionId: id, cwd: project, isSidechain: false, gitBranch: 'main' };
  const records: unknown[] = [
    {
      ...base,
      uuid: 'user-1',
      parentUuid: null,
      timestamp: at(0),
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'Check the parser behavior' }] },
    },
    {
      ...base,
      uuid: 'assistant-1',
      parentUuid: 'user-1',
      timestamp: at(1),
      type: 'assistant',
      message: {
        role: 'assistant',
        id: `call-${id}`,
        usage,
        content: [
          { type: 'text', text: 'Checking the parser.' },
          ...(child
            ? [{ type: 'tool_use', id: 'spawn-1', name: 'Agent', input: { prompt: 'Review' } }]
            : []),
        ],
      },
    },
  ];
  if (child) {
    records.push({
      ...base,
      uuid: 'result-1',
      parentUuid: 'assistant-1',
      timestamp: at(5),
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'spawn-1', content: 'Reviewed.' }],
      },
      toolUseResult: { agentId: 'catalog-child', status: 'completed' },
    });
    await writeLines(join(file.slice(0, -6), 'subagents', 'agent-catalog-child.jsonl'), [
      {
        ...base,
        uuid: 'child-1',
        parentUuid: null,
        timestamp: at(3),
        type: 'assistant',
        isSidechain: true,
        message: {
          role: 'assistant',
          id: 'child-call',
          content: [{ type: 'text', text: 'Reviewed the parser.' }],
          usage: { input_tokens: 40, cache_read_input_tokens: 5, output_tokens: 3 },
        },
      },
    ]);
  }
  if (trigger)
    records.push({
      ...base,
      uuid: 'compact-1',
      parentUuid: child ? 'result-1' : 'assistant-1',
      timestamp: at(6),
      type: 'system',
      subtype: 'compact_boundary',
      content: 'Compacted',
      compactMetadata: { trigger, preTokens: 1000, postTokens: 100 },
    });
  return writeLines(file, records);
}

function codexCount(
  input: number,
  output: number,
  second: number,
  lastInput = input,
  lastOutput = output,
) {
  const tokens = (prompt: number, out: number) => ({
    input_tokens: prompt,
    cached_input_tokens: 0,
    output_tokens: out,
    reasoning_output_tokens: 0,
    total_tokens: prompt + out,
  });
  return {
    timestamp: at(second),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: tokens(input, output),
        last_token_usage: tokens(lastInput, lastOutput),
      },
    },
  };
}

async function codex(id: string, parent?: string) {
  const record = (type: string, payload: unknown, second: number) => ({
    timestamp: at(second),
    type,
    payload,
  });
  const records: unknown[] = [
    record(
      'session_meta',
      {
        id,
        cwd: project,
        source: parent ? { subagent: { thread_spawn: { parent_thread_id: parent } } } : 'cli',
      },
      parent ? 3 : 0,
    ),
    record(
      'response_item',
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Review the parser' }],
      },
      parent ? 4 : 1,
    ),
  ];
  if (!parent)
    records.push(
      record(
        'response_item',
        {
          type: 'function_call',
          name: 'spawn_agent',
          call_id: 'spawn-1',
          arguments: JSON.stringify({ message: 'Review the parser' }),
        },
        2,
      ),
      record(
        'response_item',
        {
          type: 'function_call_output',
          call_id: 'spawn-1',
          output: JSON.stringify({ agent_id: ids.child }),
        },
        3,
      ),
    );
  records.push(codexCount(parent ? 40 : 100, parent ? 4 : 10, 5));
  return writeLines(
    join(root, 'codex', 'sessions', '2026', '10', '01', `rollout-2026-10-01T10-00-00-${id}.jsonl`),
    records,
  );
}

async function cli(...args: string[]) {
  let stdout = '';
  let stderr = '';
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  const log = vi.spyOn(console, 'error').mockImplementation((...values) => {
    stderr += format(...values) + '\n';
  });
  try {
    const code = await main(['node', 'agent-tree', '--cwd', project, ...args]);
    return { code, stdout, stderr };
  } finally {
    out.mockRestore();
    err.mockRestore();
    log.mockRestore();
  }
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>) {
  return (result.content as Array<{ type: string; text?: string }>)
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

async function catalog(args: Record<string, unknown> = {}) {
  const result = await client.callTool({
    name: 'agent_tree_sessions',
    arguments: { cwd: project, ...args },
  });
  expect(result.isError, textOf(result)).not.toBe(true);
  expect(JSON.parse(textOf(result))).toEqual(result.structuredContent);
  return (result.structuredContent as { sessions: CatalogUsageEntry[] }).sessions;
}

const aggregateOptions = () => ({
  opts: { cwd: project },
  config: DEFAULT_CONFIG,
  logger: createLoggerSync('error'),
  redactor: defaultRedactor(),
});

describe('opt-in catalog usage', () => {
  it('leaves both default catalogs metadata-only, without pipeline or child usage reads', async () => {
    await claude(ids.main, mainTokens, true);
    await codex(ids.main);
    await codex(ids.child, ids.main);
    const analyze = vi.spyOn(pipeline, 'runPipeline');
    const claudeRead = vi.spyOn(claudeSource, 'read');
    const codexRead = vi.spyOn(codexSource, 'read');
    const children = vi.spyOn(subagents, 'readClaudeSubagents');
    const claudeSignature = vi.spyOn(subagents, 'subagentSignature');
    const codexSignature = vi.spyOn(codexSubagents, 'codexSubagentSignature');
    for (const source of ['claude', 'codex']) {
      const run = await cli('--sessions', '--json', '--source', source);
      expect(run.code, run.stderr).toBe(0);
      const rows = await catalog({ source });
      expect(JSON.parse(run.stdout).sessions).toEqual(rows);
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]).sort()).toEqual([
        'jsonlPath',
        'mtimeMs',
        'projectDir',
        'sessionId',
        'sizeBytes',
        'source',
      ]);
      expect(await catalog({ source, usage: false })).toEqual(rows);
    }
    for (const spy of [analyze, claudeRead, codexRead, children, claudeSignature, codexSignature])
      expect(spy).not.toHaveBeenCalled();
  });

  it('shares main/child fields and combined totals across CLI and MCP', async () => {
    await claude(ids.main, mainTokens, true);
    const run = await cli('--sessions', '--usage', '--json');
    expect(run.code, run.stderr).toBe(0);
    const rows = await catalog({ usage: true });
    expect(JSON.parse(run.stdout).sessions).toEqual(rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      usage_status: 'available',
      total_prompt_tokens: 175,
      total_output_tokens: 10,
      usage: {
        calls: 1,
        prompt_tokens: 130,
        cache_read_tokens: 20,
        cache_write_tokens: 10,
        output_tokens: 7,
        context_peak: 130,
        subagents: { count: 1, calls: 1, prompt_tokens: 45, output_tokens: 3 },
      },
    });
    const plain = await cli('--sessions', '--usage');
    expect(plain.stdout).toContain('total prompt 175 · total out 10 (main + subagents)');
    expect(plain.stdout).not.toMatch(/\$|USD|price/i);
  });

  it('keeps absent usage distinct from genuinely logged zero counts', async () => {
    await claude(ids.missing);
    await claude(ids.zero, { input_tokens: 0, output_tokens: 0 });
    const run = await cli('--sessions', '--usage', '--json');
    expect(run.code, run.stderr).toBe(0);
    const rows = await catalog({ usage: true });
    expect(JSON.parse(run.stdout).sessions).toEqual(rows);
    expect(rows.find((row) => row.sessionId === ids.missing)).toMatchObject({
      usage_status: 'not_logged',
      usage: null,
      total_prompt_tokens: null,
      total_output_tokens: null,
    });
    expect(rows.find((row) => row.sessionId === ids.zero)).toMatchObject({
      usage_status: 'available',
      usage: { calls: 1, prompt_tokens: 0, output_tokens: 0 },
      total_prompt_tokens: 0,
      total_output_tokens: 0,
    });
    const plain = await cli('--sessions', '--usage');
    expect(plain.stdout).toContain('usage not logged; totals unknown');
    expect(plain.stdout).toContain('total prompt 0 · total out 0');
  });

  it('limits before parsing and analyzes selected rows sequentially with no LLM or writes', async () => {
    const newest = await claude(ids.main, mainTokens);
    const older = await claude(ids.missing, mainTokens);
    await utimes(older, new Date(at(0)), new Date(at(0)));
    await utimes(newest, new Date(at(1)), new Date(at(1)));
    const original = pipeline.runPipeline;
    let active = 0;
    let peak = 0;
    const analyze = vi.spyOn(pipeline, 'runPipeline').mockImplementation(async (input) => {
      active++;
      peak = Math.max(peak, active);
      try {
        return await original(input);
      } finally {
        active--;
      }
    });
    const run = await cli('--sessions', '--usage', '--limit', '1', '--json');
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout).sessions.map((row: CatalogUsageEntry) => row.sessionId)).toEqual([
      ids.main,
    ]);
    expect((await catalog({ usage: true, limit: 1 })).map((row) => row.sessionId)).toEqual([
      ids.main,
    ]);
    expect(analyze.mock.calls.map(([input]) => input.match.jsonlPath)).toEqual([newest, newest]);
    await catalog({ usage: true, limit: 2 });
    expect(analyze).toHaveBeenCalledTimes(4);
    expect(peak).toBe(1);
    for (const [input] of analyze.mock.calls)
      expect(input).toMatchObject({
        opts: { llm: false, dryRun: true },
        quiet: true,
      });
  });

  it('redacts paths, nested usage strings, text, JSON and diagnostics with project policy', async () => {
    const file = await claude(ids.main, mainTokens, false, 'PRIVATEUSAGE');
    await appendFile(file, 'malformed line\n');
    await writeFile(
      join(project, '.agent-tree.yaml'),
      'redaction:\n  extra_patterns: [PRIVATEPROJECT, PRIVATEUSAGE]\n',
    );
    const run = await cli('--sessions', '--usage', '--json');
    expect(run.code).toBe(0);
    expect(run.stdout + run.stderr).not.toMatch(/PRIVATEPROJECT|PRIVATEUSAGE/);
    expect(run.stderr).toContain('skipped malformed jsonl line');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rows = await catalog({ usage: true });
    expect(JSON.parse(run.stdout).sessions).toEqual(rows);
    expect(rows[0].usage?.compactions[0].trigger).toBe('[REDACTED]');
    expect(format(logged.mock.calls)).not.toMatch(/PRIVATEPROJECT|PRIVATEUSAGE/);
    logged.mockRestore();
    for (const flags of [[], ['--usage']]) {
      const plain = await cli('--sessions', ...flags);
      expect(plain.stdout + plain.stderr).not.toMatch(/PRIVATEPROJECT|PRIVATEUSAGE/);
      expect(plain.stdout).toContain('[REDACTED]');
    }
  });

  it('isolates unreadable entries on both surfaces and labels unavailable totals', async () => {
    const unavailable = await claude(ids.missing, mainTokens);
    await claude(ids.main, mainTokens);
    const original = pipeline.runPipeline;
    vi.spyOn(pipeline, 'runPipeline').mockImplementation((input) => {
      if (input.match.jsonlPath === unavailable)
        return Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }));
      return original(input);
    });
    const run = await cli('--sessions', '--usage', '--json');
    expect(run.code, run.stderr).toBe(0);
    const rows = await catalog({ usage: true });
    expect(JSON.parse(run.stdout).sessions).toEqual(rows);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.sessionId === ids.missing)).toMatchObject({
      usage_status: 'unavailable',
      usage: null,
      total_prompt_tokens: null,
      total_output_tokens: null,
    });
    expect(rows.find((row) => row.sessionId === ids.main)?.total_prompt_tokens).toBe(130);
    expect((await cli('--sessions', '--usage')).stdout).toContain(
      'usage unavailable; totals unknown',
    );
  });

  it('handles rotation after discovery but propagates programming errors', async () => {
    const removed = await claude(ids.missing, mainTokens);
    await claude(ids.main, mainTokens);
    const entries = await listSessions({ projectCwd: project });
    await rm(removed);
    const rows = await addCatalogUsage(entries, aggregateOptions());
    expect(rows.find((row) => row.sessionId === ids.missing)?.usage_status).toBe('unavailable');
    expect(rows.find((row) => row.sessionId === ids.main)?.total_prompt_tokens).toBe(130);
    const bug = new TypeError('programming error');
    vi.spyOn(pipeline, 'runPipeline').mockRejectedValueOnce(bug);
    await expect(addCatalogUsage(entries, aggregateOptions())).rejects.toBe(bug);
  });

  it.each(['token_count', 'token_usage_record'])(
    'preserves token-only Codex %s usage, including logged zeros versus absent logs',
    async (kind) => {
      for (const [id, counts] of [
        [ids.main, [100, 10]],
        [ids.zero, [0, 0]],
        [ids.missing, null],
      ] as const) {
        const records: unknown[] = [
          {
            timestamp: at(0),
            type: 'session_meta',
            payload: { id, cwd: project, source: 'cli' },
          },
        ];
        if (counts) {
          const [input, output] = counts;
          records.push(
            kind === 'token_count'
              ? codexCount(input, output, 1)
              : {
                  timestamp: at(1),
                  type: 'token_usage_record',
                  payload: {
                    thread_id: id,
                    response_id: `token-only-${id}`,
                    usage: {
                      input_tokens: input,
                      cached_input_tokens: 0,
                      output_tokens: output,
                      reasoning_output_tokens: 0,
                      total_tokens: input + output,
                    },
                  },
                },
          );
        }
        await writeLines(
          join(
            root,
            'codex',
            'sessions',
            '2026',
            '10',
            '01',
            `rollout-2026-10-01T10-00-00-${id}.jsonl`,
          ),
          records,
        );
      }
      const run = await cli('--sessions', '--source', 'codex', '--usage', '--json');
      expect(run.code, run.stderr).toBe(0);
      const rows = await catalog({ source: 'codex', usage: true });
      expect(JSON.parse(run.stdout).sessions).toEqual(rows);
      expect(rows).toHaveLength(3);
      expect(rows.find((row) => row.sessionId === ids.main)).toMatchObject({
        usage_status: 'available',
        total_prompt_tokens: 100,
        total_output_tokens: 10,
        usage: { calls: 1, prompt_tokens: 100, output_tokens: 10 },
      });
      expect(rows.find((row) => row.sessionId === ids.zero)).toMatchObject({
        usage_status: 'available',
        total_prompt_tokens: 0,
        total_output_tokens: 0,
        usage: { calls: 1, prompt_tokens: 0, output_tokens: 0 },
      });
      expect(rows.find((row) => row.sessionId === ids.missing)).toMatchObject({
        usage_status: 'not_logged',
        usage: null,
        total_prompt_tokens: null,
        total_output_tokens: null,
      });
    },
  );

  it('supports optional Codex totals and refreshes a cached tree when only its child grows', async () => {
    const file = await codex(ids.main);
    const child = await codex(ids.child, ids.main);
    const originalStat = await stat(file);
    const run = await cli('--sessions', '--source', 'codex', '--usage', '--json');
    expect(run.code, run.stderr).toBe(0);
    const rows = await catalog({ source: 'codex', usage: true });
    expect(JSON.parse(run.stdout).sessions).toEqual(rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      usage_status: 'available',
      total_prompt_tokens: 140,
      total_output_tokens: 14,
      usage: {
        prompt_tokens: 100,
        output_tokens: 10,
        subagents: { count: 1, calls: 1, prompt_tokens: 40, output_tokens: 4 },
      },
    });
    const args = { cwd: project, file, format: 'json' };
    const readTree = async () => {
      const result = await client.callTool({ name: 'agent_tree_list', arguments: args });
      expect(result.isError, textOf(result)).not.toBe(true);
      return (result.structuredContent as { mindmap: { stats: { usage: { subagents: unknown } } } })
        .mindmap.stats.usage.subagents;
    };
    expect(await readTree()).toMatchObject({ calls: 1, prompt_tokens: 40, output_tokens: 4 });
    await appendFile(child, JSON.stringify(codexCount(70, 7, 10, 30, 3)) + '\n');
    expect(await readTree()).toMatchObject({ calls: 2, prompt_tokens: 70, output_tokens: 7 });
    const currentStat = await stat(file);
    expect([currentStat.mtimeMs, currentStat.size]).toEqual([
      originalStat.mtimeMs,
      originalStat.size,
    ]);
    expect((await catalog({ source: 'codex', usage: true }))[0]).toMatchObject({
      total_prompt_tokens: 170,
      total_output_tokens: 17,
    });
  });

  it('retains mode validation and the seven-tool MCP surface', async () => {
    for (const args of [['--search', 'parser'], ['--open', '1'], ['--snapshot', '1'], ['--picks']])
      expect((await cli('--usage', ...args)).code).toBe(2);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(7);
    const sessions = tools.find((tool) => tool.name === 'agent_tree_sessions')!;
    expect(sessions.inputSchema.properties?.usage).toMatchObject({ type: 'boolean' });
    expect(sessions.annotations?.readOnlyHint).toBe(true);
    expect(sessions.description).toContain('extra log reads');
    expect(sessions.description).toContain('never LLM calls');
  });
});
