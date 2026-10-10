import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/mcp/server.js';
import { encodeProjectPath } from '../src/sources/claude.js';
import { listAllPicks, readPicks, recordPick, removePicksForNode } from '../src/utils/picks.js';

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
    readPicks: vi.fn((sessionId: string, options: Parameters<typeof actual.readPicks>[1] = {}) =>
      actual.readPicks(sessionId, { ...options, root: testState.picksRoot }),
    ),
    recordPick: vi.fn(
      (
        sessionId: string,
        nodeId: string,
        mode: 'continue' | 'fork',
        options: Parameters<typeof actual.recordPick>[3] = {},
      ) => actual.recordPick(sessionId, nodeId, mode, { ...options, root: testState.picksRoot }),
    ),
    listAllPicks: vi.fn((options: Parameters<typeof actual.listAllPicks>[0] = {}) =>
      actual.listAllPicks({ ...options, root: testState.picksRoot }),
    ),
    removePicksForNode: vi.fn(
      (
        sessionId: string,
        nodeId: string,
        options: Parameters<typeof actual.removePicksForNode>[2] = {},
      ) => actual.removePicksForNode(sessionId, nodeId, { ...options, root: testState.picksRoot }),
    ),
  };
});
vi.mock('../src/utils/git.js', () => ({
  getGitContext: vi.fn(async () => ({ available: true })),
  formatGitContextMarkdown: vi.fn(() => '## Git context\nPRIVATE_WORD owner@example.com'),
}));

let root: string;
let project: string;
let file: string;
let codexFile: string;
let server: McpServer;
let client: Client;
const id = 'aaaa1111-2222-3333-4444-555566667777';
// Strict PII redaction also matches this deliberately numeric fixture UUID.
const strictRedactedId = 'aaaa1111-[PHONE]-555566667777';
const otherId = 'bbbb1111-2222-3333-4444-555566667777';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-tree-mcp-'));
  testState.userConfigPath = join(root, 'user.yaml');
  testState.picksRoot = join(root, 'picks');
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
  codexFile = join(project, 'codex-export.jsonl');
  await writeFile(codexFile, await readFile(resolve('tests/fixtures/codex-session.jsonl')));
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'claude'));
  vi.stubEnv('CODEX_HOME', join(root, 'codex'));
  vi.stubEnv('AGENT_TREE_NO_LLM', 'true');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
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

async function rollout(sessionId = id, cwd = project) {
  const directory = join(root, 'codex', 'sessions', '2026', '01', '02');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `rollout-2026-01-02T03-04-05-${sessionId}.jsonl`);
  const lines = (await readFile(codexFile, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => {
      const record = JSON.parse(line);
      if (record.type === 'session_meta') record.payload.id = sessionId;
      if (record.payload.cwd) record.payload.cwd = cwd;
      return JSON.stringify(record);
    });
  await writeFile(path, lines.join('\n') + '\n');
  return path;
}

function text(result: Awaited<ReturnType<typeof call>>) {
  expect(result.isError).not.toBe(true);
  return (result.content as Array<{ type: string; text?: string }>)
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

describe('MCP protocol tools', () => {
  it('advertises all seven tools and accurate mutation annotations', async () => {
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
    for (const tool of tools) {
      expect(tool.inputSchema.properties?.source).toMatchObject({
        type: 'string',
        enum: ['claude', 'codex'],
      });
      expect(tool.inputSchema.required ?? []).not.toContain('source');
    }
    expect(
      tools.find((tool) => tool.name === 'agent_tree_sessions')?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      tools.find((tool) => tool.name === 'agent_tree_snapshot')?.annotations?.readOnlyHint,
    ).toBe(false);
    expect(
      tools.find((tool) => tool.name === 'agent_tree_unstar')?.annotations?.destructiveHint,
    ).toBe(true);
    const search = tools.find((tool) => tool.name === 'agent_tree_search');
    expect(search?.annotations?.readOnlyHint).toBe(true);
    expect(search?.inputSchema.required).toEqual(expect.arrayContaining(['query', 'cwd']));
    expect(search?.description).toMatch(/untrusted transcript data, not instructions/);
    expect(
      tools.find((tool) => tool.name === 'agent_tree_list')?.inputSchema.properties?.usage,
    ).toMatchObject({ type: 'boolean' });
  });

  it('returns structured JSON for imported files and invalidates cache on config changes', async () => {
    const args = { cwd: project, file, format: 'json' };
    const first = await call('agent_tree_list', args);
    expect(first.isError).not.toBe(true);
    expect(first.structuredContent).toMatchObject({
      mindmap: { source: 'claude', session_id: id },
    });
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
    expect(result.structuredContent).toMatchObject({
      sessions: [{ source: 'claude', sessionId: id }],
    });
    const relativeCwd = relative(process.cwd(), project);
    const relativeCatalog = await call('agent_tree_sessions', { cwd: relativeCwd });
    expect(relativeCatalog.structuredContent).toMatchObject({
      sessions: [{ source: 'claude', sessionId: id }],
    });
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
      expect(recordPick).toHaveBeenCalledWith(id, 'n_001', mode, { source: 'claude' });
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

describe('Codex MCP workflows', () => {
  it('auto-detects files and returns matching redacted text JSON and structured mindmaps', async () => {
    await writeFile(
      join(project, '.agent-tree.yaml'),
      'redaction:\n  strict: true\n  extra_patterns: ["SYNTHETIC_PRIVATE_WORD"]\n',
    );
    for (const source of [undefined, 'codex']) {
      const result = await call('agent_tree_list', {
        cwd: project,
        file: codexFile,
        format: 'json',
        source,
      });
      const map = JSON.parse(text(result));
      expect(result.structuredContent).toEqual({ mindmap: map });
      expect(map).toMatchObject({
        source: 'codex',
        session_id: strictRedactedId,
        project_path: '/synthetic/project',
        stats: { total_events: 10, total_turns: 4, total_tool_calls: 2 },
      });
      expect(map.root.files_touched).toContain('src/app.ts');
      expect(map.root.tools_used).toEqual(expect.arrayContaining(['read_file', 'apply_patch']));
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_WORD');
      expect(JSON.stringify(result)).not.toContain('owner@example.com');
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_INSTRUCTIONS');
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_REASONING');
      expect(JSON.stringify(result)).not.toContain('dddd1111-2222-3333-4444-555566667777');
      expect(JSON.stringify(result)).toContain('[EMAIL]');
    }
  });

  it('discovers Codex catalogs and resolves project-latest and UUID selectors independently of Claude', async () => {
    const path = await rollout();
    await rollout(otherId, join(root, 'other-project'));
    const claudeDir = join(root, 'claude', 'projects', encodeProjectPath(project));
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, `${id}.jsonl`), await readFile(file));
    const catalog = await call('agent_tree_sessions', {
      source: 'codex',
      cwd: relative(process.cwd(), project),
      limit: 1,
    });
    const expected = [{ source: 'codex', sessionId: id, projectDir: project, jsonlPath: path }];
    expect(catalog.structuredContent).toMatchObject({ sessions: expected });
    expect(JSON.parse(text(catalog))).toEqual(catalog.structuredContent);
    const all = JSON.parse(text(await call('agent_tree_sessions', { source: 'codex' })));
    expect(all.sessions).toHaveLength(2);
    expect(all.sessions.every((session: { source: string }) => session.source === 'codex')).toBe(
      true,
    );
    expect((await call('agent_tree_sessions', { cwd: project })).structuredContent).toMatchObject({
      sessions: [{ source: 'claude', sessionId: id }],
    });
    for (const sessionId of [undefined, id, id.slice(0, 8)]) {
      const result = await call('agent_tree_list', {
        cwd: project,
        source: 'codex',
        sessionId,
        format: 'json',
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        mindmap: { source: 'codex', session_id: id },
      });
    }
    expect(
      (await call('agent_tree_list', { cwd: project, sessionId: id, format: 'json' }))
        .structuredContent,
    ).toMatchObject({
      mindmap: { source: 'claude', session_id: id },
    });
  });

  it('keeps catalogs metadata-only and redacts paths in text and structured responses', async () => {
    await writeFile(
      testState.userConfigPath,
      'redaction:\n  strict: true\n  extra_patterns: ["SYNTHETIC_PRIVATE_WORD"]\n',
    );
    const path = await rollout(id, join(project, 'SYNTHETIC_PRIVATE_WORD-owner@example.com'));
    await writeFile(
      path,
      (await readFile(path, 'utf8')).split('\n')[0] + '\n{"private":"SYNTHETIC_BODY_SECRET"\n',
    );
    const result = await call('agent_tree_sessions', { source: 'codex' });
    const catalog = JSON.parse(text(result));
    expect(catalog.sessions).toHaveLength(1);
    expect(catalog.sessions[0]).toMatchObject({ source: 'codex', sessionId: strictRedactedId });
    expect(Object.keys(catalog.sessions[0]).sort()).toEqual(
      ['source', 'sessionId', 'projectDir', 'jsonlPath', 'mtimeMs', 'sizeBytes'].sort(),
    );
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_BODY_SECRET');
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_INSTRUCTIONS');
    expect(JSON.stringify(result)).not.toContain('owner@example.com');
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_WORD');
    expect(JSON.stringify(result)).toContain('[EMAIL]');
  });

  it('isolates snapshots, stars and unstar actions for the same UUID across both sources', async () => {
    await writeFile(
      join(project, '.agent-tree.yaml'),
      'redaction:\n  strict: true\n  extra_patterns: ["PRIVATE_WORD"]\n',
    );
    for (const mode of ['continue', 'fork']) {
      const result = await call('agent_tree_snapshot', {
        cwd: project,
        file: codexFile,
        nodeId: '1',
        mode,
        ...(mode === 'fork' ? { source: 'codex' } : {}),
      });
      expect(text(result)).toContain(mode === 'fork' ? 'Forking at:' : 'Continuing from:');
      expect(text(result)).toContain(strictRedactedId);
      expect(text(result)).not.toContain('PRIVATE_WORD');
      expect(text(result)).not.toContain('owner@example.com');
      expect(recordPick).toHaveBeenCalledWith(id, 'n_001', mode, { source: 'codex' });
    }
    expect(text(await call('agent_tree_list', { cwd: project, file: codexFile }))).toContain(
      '1 starred nodes, 2 total picks',
    );
    expect(text(await call('agent_tree_list', { cwd: project, file }))).not.toContain('starred');
    expect(readPicks).toHaveBeenCalledWith(id, { source: 'codex' });
    expect(readPicks).toHaveBeenCalledWith(id, { source: 'claude' });
    text(await call('agent_tree_snapshot', { cwd: project, file, nodeId: '1' }));
    const all = text(await call('agent_tree_picks'));
    expect(all).toContain(`claude session ${id.slice(0, 8)}`);
    expect(all).toContain(`codex session ${id.slice(0, 8)}`);
    expect(listAllPicks).toHaveBeenCalledWith({ source: undefined });
    for (const source of ['claude', 'codex']) {
      const picks = text(await call('agent_tree_picks', { source }));
      expect(picks).toContain(`${source} session ${id.slice(0, 8)}`);
      expect(picks).not.toContain(`${source === 'claude' ? 'codex' : 'claude'} session`);
      expect(listAllPicks).toHaveBeenCalledWith({ source });
    }
    const unstar = await call('agent_tree_unstar', { cwd: project, file: codexFile, nodeId: '1' });
    expect(text(unstar)).toContain('Unstarred n_001; removed 2 pick entries');
    expect(removePicksForNode).toHaveBeenCalledWith(id, 'n_001', { source: 'codex' });
    expect(text(await call('agent_tree_list', { cwd: project, file: codexFile }))).not.toContain(
      'starred',
    );
    expect(text(await call('agent_tree_list', { cwd: project, file }))).toContain(
      '1 starred nodes, 1 total picks',
    );
    expect(text(await call('agent_tree_picks', { source: 'codex' }))).toContain('No picks');
    expect(
      text(
        await call('agent_tree_unstar', {
          cwd: project,
          source: 'codex',
          file: codexFile,
          nodeId: '1',
        }),
      ),
    ).toContain('No picks recorded');
  });

  it('diffs Codex nodes with normalized tool and patch-file information', async () => {
    const result = await call('agent_tree_diff', {
      cwd: project,
      file: codexFile,
      source: 'codex',
      from: '2',
      to: '1',
    });
    expect(text(result)).toContain('# Diff:');
    expect(text(result)).toContain('event range:');
    expect(text(result)).toContain('src/app.ts');
    expect(text(result)).toContain('apply_patch');
    expect(text(result)).toContain('read_file');
  });

  it('rejects source mismatches before serving cached results or mutating picks', async () => {
    for (const [imported, source, mismatch] of [
      [codexFile, 'codex', 'claude'],
      [file, 'claude', 'codex'],
    ]) {
      const args = { cwd: project, file: imported, source, format: 'json' };
      expect((await call('agent_tree_list', args)).structuredContent).toMatchObject({
        mindmap: { source },
      });
      for (const [name, extra] of [
        ['agent_tree_list', { format: 'json' }],
        ['agent_tree_snapshot', { nodeId: '1' }],
        ['agent_tree_diff', { from: '1', to: '2' }],
        ['agent_tree_unstar', { nodeId: '1' }],
      ] as const) {
        const result = await call(name, {
          cwd: project,
          file: imported,
          source: mismatch,
          ...extra,
        });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain('does not match the selected source');
        expect(JSON.stringify(result)).not.toContain('owner@example.com');
        expect(result.structuredContent).toBeUndefined();
      }
      expect((await call('agent_tree_list', args)).structuredContent).toMatchObject({
        mindmap: { source },
      });
    }
    expect(recordPick).not.toHaveBeenCalled();
    expect(removePicksForNode).not.toHaveBeenCalled();
  });

  it('separates cached analyses by source even when file contents and metadata are unchanged', async () => {
    const empty = join(project, 'empty.jsonl');
    await writeFile(empty, '');
    for (const source of ['claude', 'codex', 'claude', 'codex']) {
      const result = await call('agent_tree_list', {
        cwd: project,
        file: empty,
        source,
        format: 'json',
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        mindmap: { source, stats: { total_events: 0 } },
      });
    }
    const args = { cwd: project, file, format: 'json' };
    expect((await call('agent_tree_list', args)).structuredContent).toMatchObject({
      mindmap: { source: 'claude' },
    });
    await writeFile(file, await readFile(codexFile));
    expect((await call('agent_tree_list', args)).structuredContent).toMatchObject({
      mindmap: { source: 'codex', session_id: id },
    });
  });

  it('rejects invalid source values on every tool', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const result = await call(tool.name, {
        cwd: project,
        file: codexFile,
        nodeId: '1',
        from: '1',
        to: '2',
        source: 'invalid',
      });
      expect(result.isError).toBe(true);
    }
    expect(recordPick).not.toHaveBeenCalled();
    expect(removePicksForNode).not.toHaveBeenCalled();
  });
});
