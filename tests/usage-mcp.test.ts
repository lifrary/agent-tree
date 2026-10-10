import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/mcp/server.js';

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
    readPicks: vi.fn((sessionId: string, options: Parameters<typeof actual.readPicks>[1] = {}) =>
      actual.readPicks(sessionId, { ...options, root: state.picksRoot }),
    ),
  };
});

let root: string;
let project: string;
let file: string;
let server: McpServer;
let client: Client;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'atree-usage-mcp-'));
  state.userConfigPath = join(root, 'user.yaml');
  state.picksRoot = join(root, 'picks');
  project = join(root, 'project');
  mkdirSync(project);
  file = join(project, 'session.jsonl');
  cpSync(resolve('tests/fixtures/usage-claude.jsonl'), file);
  cpSync(resolve('tests/fixtures/usage-claude'), join(project, 'session'), { recursive: true });
  vi.stubEnv('AGENT_TREE_NO_LLM', 'true');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  server = createServer();
  client = new Client({ name: 'usage-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});
afterEach(async () => {
  await client?.close();
  await server?.close();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const [first] = result.content as Array<{ type: string; text: string }>;
  return first.text;
}

describe('agent_tree_list usage', () => {
  it('renders usage columns only when asked, and JSON always carries usage', async () => {
    const plain = await client.callTool({
      name: 'agent_tree_list',
      arguments: { cwd: project, file },
    });
    const usage = await client.callTool({
      name: 'agent_tree_list',
      arguments: { cwd: project, file, usage: true, phasesOnly: true },
    });
    const json = await client.callTool({
      name: 'agent_tree_list',
      arguments: { cwd: project, file, format: 'json' },
    });
    for (const result of [plain, usage, json]) expect(result.isError).not.toBe(true);
    expect(textOf(plain)).not.toContain('prompt ');
    expect(textOf(usage)).toContain('prompt 6.7k · out 129 · ctx 3.1k');
    expect(textOf(usage)).toContain('compacted 968k → 21k');
    expect(json.structuredContent).toMatchObject({
      mindmap: {
        stats: {
          usage: {
            calls: 4,
            prompt_tokens: 6675,
            subagents: { count: 2, calls: 3, prompt_tokens: 717, output_tokens: 18 },
          },
        },
      },
    });
  });
});
