import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/mcp/server.js';
import { encodeProjectPath } from '../src/utils/session_path.js';
import { recordPick } from '../src/utils/picks.js';

const testState = vi.hoisted(() => ({ userConfigPath: '' }));
vi.mock('../src/config/loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/loader.js')>();
  return {
    ...actual,
    loadConfig: (options: Parameters<typeof actual.loadConfig>[0] = {}) =>
      actual.loadConfig({ ...options, userConfigPath: testState.userConfigPath }),
  };
});

vi.mock('../src/utils/picks.js', () => ({
  readPicks: vi.fn(async () => ({ modesByNode: new Map(), total: 0 })),
  recordPick: vi.fn(async () => undefined),
  listAllPicks: vi.fn(async () => []),
  removePicksForNode: vi.fn(async () => 1),
}));
vi.mock('../src/utils/git.js', () => ({
  getGitContext: vi.fn(async () => ({ available: true })),
  formatGitContextMarkdown: vi.fn(() => '## Git context\nPRIVATE_WORD owner@example.com'),
}));

let root: string;
let project: string;
let file: string;
let server: McpServer;
let client: Client;
const id = 'aaaa1111-2222-3333-4444-555566667777';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-tree-mcp-'));
  testState.userConfigPath = join(root, 'user.yaml');
  project = join(root, 'project');
  await mkdir(project);
  file = join(project, 'portable.jsonl');
  await writeFile(
    file,
    (await readFile(resolve('tests/fixtures/minimal-session.jsonl'), 'utf8')).replace(
      'Please read',
      'PRIVATE_WORD owner@example.com Please read',
    ),
  );
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'claude'));
  vi.stubEnv('AGENT_TREE_MODEL', undefined);
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

async function call(name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}

describe('MCP protocol tools', () => {
  it('advertises all six tools and accurate mutation annotations', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'agent_tree_diff',
      'agent_tree_list',
      'agent_tree_picks',
      'agent_tree_sessions',
      'agent_tree_snapshot',
      'agent_tree_unstar',
    ]);
    expect(
      tools.find((tool) => tool.name === 'agent_tree_sessions')?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      tools.find((tool) => tool.name === 'agent_tree_snapshot')?.annotations?.readOnlyHint,
    ).toBe(false);
    expect(
      tools.find((tool) => tool.name === 'agent_tree_unstar')?.annotations?.destructiveHint,
    ).toBe(true);
  });

  it('returns structured JSON for imported files and invalidates cache on config changes', async () => {
    const args = { cwd: project, file, format: 'json' };
    const first = await call('agent_tree_list', args);
    expect(first.isError).not.toBe(true);
    expect(first.structuredContent).toMatchObject({ mindmap: { session_id: id } });
    expect(JSON.stringify(first)).toContain('owner@example.com');
    await writeFile(
      join(project, '.agent-tree.yaml'),
      'redaction:\n  strict: true\n  extra_patterns: ["PRIVATE_WORD"]\n',
    );
    const second = await call('agent_tree_list', args);
    expect(second.isError).not.toBe(true);
    expect(JSON.stringify(second)).not.toContain('owner@example.com');
    expect(JSON.stringify(second)).not.toContain('PRIVATE_WORD');
    expect(JSON.stringify(second)).toContain('[EMAIL]');
  });

  it('invalidates cached analysis when the source changes', async () => {
    const args = { cwd: project, file, format: 'json' };
    await call('agent_tree_list', args);
    await writeFile(file, '');
    const empty = await call('agent_tree_list', args);
    expect(empty.structuredContent).toMatchObject({ mindmap: { stats: { total_events: 0 } } });
  });

  it('discovers sessions through the custom root with a bounded result', async () => {
    const dir = join(root, 'claude', 'projects', encodeProjectPath(project));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.jsonl`), await readFile(file));
    const result = await call('agent_tree_sessions', { cwd: project, limit: 1 });
    expect(result.structuredContent).toMatchObject({ sessions: [{ sessionId: id }] });
    const relativeCwd = relative(process.cwd(), project);
    const relativeCatalog = await call('agent_tree_sessions', { cwd: relativeCwd });
    expect(relativeCatalog.structuredContent).toMatchObject({ sessions: [{ sessionId: id }] });
    const relativeTree = await call('agent_tree_list', { cwd: relativeCwd, format: 'json' });
    expect(relativeTree.structuredContent).toMatchObject({ mindmap: { session_id: id } });
    expect((await call('agent_tree_sessions', { limit: 0 })).isError).toBe(true);
  });

  it('redacts appended git context and records imported identity for both snapshot modes', async () => {
    await writeFile(
      join(project, '.agent-tree.yaml'),
      'redaction:\n  strict: true\n  extra_patterns: ["PRIVATE_WORD"]\n',
    );
    for (const mode of ['continue', 'fork']) {
      const result = await call('agent_tree_snapshot', { cwd: project, file, nodeId: '1', mode });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result)).toContain('Git context');
      expect(JSON.stringify(result)).not.toContain('PRIVATE_WORD');
      expect(JSON.stringify(result)).not.toContain('owner@example.com');
      expect(recordPick).toHaveBeenCalledWith(id, 'n_001', mode);
    }
  });

  it('keeps tool errors structured for conflicting selectors, missing files and bad nodes', async () => {
    expect((await call('agent_tree_list', { cwd: file, file })).isError).toBe(true);
    expect((await call('agent_tree_sessions', { cwd: file })).isError).toBe(true);
    for (const [name, args] of [
      ['agent_tree_list', { file, sessionId: id }],
      ['agent_tree_list', { file: join(project, 'missing.jsonl') }],
      ['agent_tree_list', { file, format: 'json', phasesOnly: true }],
      ['agent_tree_snapshot', { file, nodeId: 'does-not-exist' }],
      ['agent_tree_diff', { file, from: '1', to: 'does-not-exist' }],
    ] as const) {
      expect((await call(name, { cwd: project, ...args })).isError).toBe(true);
    }
  });
});
