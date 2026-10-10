import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServer } from '../src/mcp/server.js';
import { encodeProjectPath } from '../src/sources/claude.js';

const testState = vi.hoisted(() => ({ userConfigPath: '', picksRoot: '' }));
vi.mock('../src/config/loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/loader.js')>();
  return {
    ...actual,
    loadConfig: (options: Parameters<typeof actual.loadConfig>[0] = {}) =>
      actual.loadConfig({ ...options, userConfigPath: testState.userConfigPath }),
  };
});
vi.mock('../src/utils/picks.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/picks.js')>();
  return {
    ...actual,
    recordPick: vi.fn(
      (
        sessionId: string,
        nodeId: string,
        mode: 'continue' | 'fork',
        options: Parameters<typeof actual.recordPick>[3] = {},
      ) => actual.recordPick(sessionId, nodeId, mode, { ...options, root: testState.picksRoot }),
    ),
  };
});
vi.mock('../src/utils/git.js', () => ({
  getGitContext: vi.fn(async () => ({ available: false, cwd: '' })),
  formatGitContextMarkdown: vi.fn(() => ''),
}));

const id = 'aaaa1111-2222-3333-4444-555566667777';
let root: string;
let project: string;
let server: McpServer;
let client: Client;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'agent-tree-open-mcp-')));
  testState.userConfigPath = join(root, 'user.yaml');
  testState.picksRoot = join(root, 'picks');
  project = join(root, 'project');
  await mkdir(project);
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
  await client?.close();
  await server?.close();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function snapshotText(args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name: 'agent_tree_snapshot', arguments: args });
  expect(result.isError).not.toBe(true);
  return (result.content as Array<{ type: string; text?: string }>)
    .map((block) => block.text ?? '')
    .join('\n');
}

describe('MCP and --open', () => {
  it('registers no tool that starts an agent', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'agent_tree_diff',
      'agent_tree_list',
      'agent_tree_picks',
      'agent_tree_search',
      'agent_tree_sessions',
      'agent_tree_snapshot',
      'agent_tree_unstar',
    ]);
  });

  it('ends a snapshot of an exported file with the --open command for that file', async () => {
    const file = join(project, "it's.jsonl");
    await writeFile(file, await readFile(resolve('tests/fixtures/minimal-session.jsonl')));
    const body = await snapshotText({ cwd: project, file, nodeId: '1' });
    expect(body.startsWith('# Continuing from: ')).toBe(true);
    const command = `agent-tree --source claude --file '${project}/it'\\''s.jsonl' --open 1 --mode continue`;
    expect(body.trimEnd().endsWith(`\n${command}`)).toBe(true);
  });

  it('names the file when the transcript id is not a UUID and no prefix would find it', async () => {
    const dir = join(root, 'claude', 'projects', encodeProjectPath(project));
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${id}.jsonl`);
    const raw = await readFile(resolve('tests/fixtures/minimal-session.jsonl'), 'utf8');
    await writeFile(path, raw.split(id).join('not-a-uuid'));
    const body = await snapshotText({ cwd: project, sessionId: id.slice(0, 8), nodeId: '1' });
    expect(
      body
        .trimEnd()
        .endsWith(`\nagent-tree --source claude --file '${path}' --open 1 --mode continue`),
    ).toBe(true);
  });

  it('names a discovered session by its id prefix, source and mode', async () => {
    const directory = join(root, 'codex', 'sessions', '2026', '01', '02');
    await mkdir(directory, { recursive: true });
    const lines = (await readFile(resolve('tests/fixtures/codex-session.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => {
        const record = JSON.parse(line);
        if (record.payload.cwd) record.payload.cwd = project;
        return JSON.stringify(record);
      });
    await writeFile(
      join(directory, `rollout-2026-01-02T03-04-05-${id}.jsonl`),
      lines.join('\n') + '\n',
    );
    const body = await snapshotText({
      cwd: project,
      source: 'codex',
      sessionId: id.slice(0, 8),
      nodeId: 'n_001',
      mode: 'fork',
    });
    expect(body.startsWith('# Forking at: ')).toBe(true);
    expect(
      body.trimEnd().endsWith('\nagent-tree --source codex aaaa1111 --open 1 --mode fork'),
    ).toBe(true);
  });
});
