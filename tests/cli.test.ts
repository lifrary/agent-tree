import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeProjectPath } from '../src/sources/claude.js';

const exec = promisify(execFile);
const entry = resolve('src/cli.ts');
const fixture = resolve('tests/fixtures/minimal-session.jsonl');
const codexFixture = resolve('tests/fixtures/codex-session.jsonl');
const id = 'aaaa1111-2222-3333-4444-555566667777';
const otherId = 'bbbb1111-2222-3333-4444-555566667777';
let root: string;
let home: string;
let project: string;
let configDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-tree-cli-'));
  home = join(root, 'home');
  project = join(root, 'project_with spaces');
  configDir = join(root, 'claude');
  await Promise.all([mkdir(home), mkdir(project), mkdir(configDir)]);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function cli(...args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: configDir,
    CODEX_HOME: join(root, 'codex'),
    ANTHROPIC_API_KEY: '',
    AGENT_TREE_NO_LLM: 'true',
  };
  for (const key of [
    'AGENT_TREE_MODEL',
    'AGENT_TREE_MAX_TOK',
    'AGENT_TREE_REDACT_STRICT',
    'AGENT_TREE_LANG',
    'AGENT_TREE_VERBOSE',
  ]) {
    delete env[key];
  }
  return exec(process.execPath, ['--import', 'tsx', entry, ...args], {
    cwd: process.cwd(),
    env,
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function rollout(sessionId = id, cwd = project, modified = 1_700_000_000) {
  const dir = join(root, 'codex', 'sessions', '2026', '01', '02');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `rollout-2026-01-02T03-04-05-${sessionId}.jsonl`);
  const records = (await readFile(codexFixture, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => {
      const record = JSON.parse(line);
      if (record.type === 'session_meta') record.payload.id = sessionId;
      if (record.payload.cwd) record.payload.cwd = cwd;
      return JSON.stringify(record);
    });
  await writeFile(file, records.join('\n') + '\n');
  await utimes(file, modified, modified);
  return file;
}

describe('portable CLI workflows', () => {
  it('exports parseable redacted JSON without banners or progress on stdout', async () => {
    const { stdout } = await cli('--file', fixture, '--json', '--no-llm');
    const map = JSON.parse(stdout);
    expect(map.source).toBe('claude');
    expect(map.session_id).toBe(id);
    expect(map.stats.total_events).toBeGreaterThan(0);
    expect(map.root.children.length).toBeGreaterThan(0);
    expect(stdout).not.toContain('Pick a node');
  });

  it('lists sessions from the custom config root with a project filter', async () => {
    const dir = join(configDir, 'projects', encodeProjectPath(project));
    const other = join(configDir, 'projects', encodeProjectPath('/other'));
    await Promise.all([mkdir(dir, { recursive: true }), mkdir(other, { recursive: true })]);
    await writeFile(join(dir, `${id}.jsonl`), await readFile(fixture));
    await writeFile(join(other, 'bbbb1111-2222-3333-4444-555566667777.jsonl'), '{}');
    const { stdout } = await cli('--sessions', `--cwd=${project}`, '--limit', '1', '--json');
    const { sessions } = JSON.parse(stdout);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      source: 'claude',
      sessionId: id,
      projectDir: encodeProjectPath(project),
    });
    expect(sessions[0].sizeBytes).toBeGreaterThan(0);
    const all = await cli('--sessions', '--json');
    expect(JSON.parse(all.stdout).sessions).toHaveLength(2);
  });

  it('uses project configuration and redacts all JSON fields', async () => {
    await writeFile(
      join(project, '.agent-tree.yaml'),
      'redaction:\n  strict: true\n  extra_patterns: ["PRIVATE_WORD"]\n',
    );
    const file = join(project, 'export.jsonl');
    const raw = (await readFile(fixture, 'utf8')).replace(
      'Please read',
      'PRIVATE_WORD owner@example.com Please read',
    );
    await writeFile(file, raw);
    const { stdout } = await cli('--file', file, '--cwd', project, '--json');
    expect(stdout).not.toContain('owner@example.com');
    expect(stdout).not.toContain('PRIVATE_WORD');
    expect(stdout).toContain('[EMAIL]');
  });

  it('resumes an imported file and keeps stars under its embedded UUID', async () => {
    const snapshot = await cli('--file', fixture, '--snapshot', '1', '--mode', 'fork');
    expect(snapshot.stdout).toContain('Fork');
    const history = await readFile(
      join(home, '.cache', 'agent-tree', 'picks', 'claude', `${id}.jsonl`),
      'utf8',
    );
    expect(JSON.parse(history.trim())).toMatchObject({ node_id: 'n_001', mode: 'fork' });
    const list = await cli('--file', fixture, '--list');
    expect(list.stdout).toContain('--file');
    expect(list.stdout).toContain('--source claude');
    expect(list.stdout).toContain('starred');
  });

  it('supports empty exports and stable local identities without an envelope', async () => {
    const file = join(project, 'empty.jsonl');
    await writeFile(file, '');
    const first = JSON.parse((await cli('--file', file, '--json')).stdout);
    const second = JSON.parse((await cli('--file', file, '--json')).stdout);
    expect(first.stats.total_events).toBe(0);
    expect(first.session_id).toMatch(/^[a-f0-9]{32}$/);
    expect(first.session_id).toBe(second.session_id);
  });

  it('strict mode rejects malformed input without echoing its contents', async () => {
    const file = join(project, 'broken.jsonl');
    await writeFile(file, (await readFile(fixture, 'utf8')) + '\n{"private":"sensitive-value"');
    await expect(cli('--file', file, '--json', '--strict')).rejects.toMatchObject({ code: 1 });
    try {
      await cli('--file', file, '--json', '--strict');
    } catch (error) {
      expect((error as { stderr: string }).stderr).not.toContain('sensitive-value');
    }
    expect(
      JSON.parse((await cli('--file', file, '--json')).stdout).stats.total_events,
    ).toBeGreaterThan(0);
  });

  it('rejects bad options before touching session data', async () => {
    await expect(cli('--max-llm-tokens', '-1')).rejects.toMatchObject({ code: 2 });
    await expect(
      cli('--file', fixture, '--snapshot', '1', '--mode', 'broken'),
    ).rejects.toMatchObject({ code: 2 });
    await expect(cli('--tui')).rejects.toMatchObject({ code: 2 });
    await expect(cli('--pick')).rejects.toMatchObject({ code: 2 });
  });

  it('dry-run emits no JSON, dump artifacts or verbose caches', async () => {
    const dump = join(root, 'dump');
    const cache = join(root, 'cache');
    await writeFile(
      join(project, '.agent-tree.yaml'),
      `cache:\\n  dir: ${JSON.stringify(cache)}\\n`,
    );
    const result = await cli(
      '--file',
      fixture,
      '--cwd',
      project,
      '--json',
      '--dry-run',
      '--verbose',
      '--dump-json',
      dump,
    );
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Dry-run');
    await expect(readdir(dump)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readdir(cache)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports redaction counts on stderr without disclosing source values', async () => {
    const file = resolve('tests/fixtures/secret-laden.jsonl');
    const { stdout, stderr } = await cli('--file', file, '--json', '--redact-dryrun');
    expect(JSON.parse(stdout).stats.total_events).toBeGreaterThan(0);
    const line = stderr.split('\\n').find((line) => line.startsWith('Redaction preview'));
    expect(line).toBeDefined();
    expect(JSON.parse(line!.slice(line!.indexOf('{'))).anthropic_api_key).toBeGreaterThan(0);
    expect(stderr).not.toContain('sk-ant-dummy123');
  });
});

describe('Codex CLI workflows', () => {
  it('auto-detects imported JSON and preserves metadata identity, tools and deduplicated turns', async () => {
    const { stdout } = await cli('--file', codexFixture, '--json', '--strict', '--no-llm');
    const map = JSON.parse(stdout);
    expect(map).toMatchObject({
      source: 'codex',
      session_id: id,
      project_path: '/synthetic/project',
      stats: { total_events: 10, total_turns: 4, total_tool_calls: 2 },
    });
    expect(map.root.files_touched).toContain('src/app.ts');
    expect(map.root.tools_used).toEqual(expect.arrayContaining(['read_file', 'apply_patch']));
    expect(map.root.children.length).toBeGreaterThan(0);
    expect(stdout).not.toContain('Pick a node');
    expect(stdout).not.toContain('dddd1111-2222-3333-4444-555566667777');
    expect(stdout).not.toContain('SYNTHETIC_PRIVATE_INSTRUCTIONS');
    expect(stdout).not.toContain('SYNTHETIC_PRIVATE_REASONING');
    const explicit = JSON.parse(
      (await cli('--file', codexFixture, '--source', 'codex', '--json')).stdout,
    );
    expect(explicit).toMatchObject({ source: 'codex', session_id: id, stats: map.stats });
  });

  it('discovers date-layout rollouts through CODEX_HOME and filters by project', async () => {
    const path = await rollout();
    await rollout(otherId, join(root, 'other-project'), 1_700_000_100);
    const filtered = await cli(
      '--source',
      'codex',
      '--sessions',
      '--cwd',
      project,
      '--limit',
      '1',
      '--json',
    );
    expect(JSON.parse(filtered.stdout).sessions).toEqual([
      expect.objectContaining({
        source: 'codex',
        sessionId: id,
        projectDir: project,
        jsonlPath: path,
      }),
    ]);
    const all = JSON.parse((await cli('--source', 'codex', '--sessions', '--json')).stdout);
    expect(all.sessions.map((session: { sessionId: string }) => session.sessionId)).toEqual([
      otherId,
      id,
    ]);
    expect(all.sessions[0].sizeBytes).toBeGreaterThan(0);
    expect(Number.isFinite(all.sessions[0].mtimeMs)).toBe(true);
    expect(JSON.parse((await cli('--sessions', '--json')).stdout).sessions).toEqual([]);
  });

  it('selects Codex by UUID prefix, project default and global latest without crossing sources', async () => {
    await rollout();
    await rollout(otherId, join(root, 'other-project'), 1_700_000_100);
    const dir = join(configDir, 'projects', encodeProjectPath(project));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.jsonl`), await readFile(fixture));
    for (const selector of [id, id.slice(0, 8)]) {
      const map = JSON.parse((await cli('--source', 'codex', selector, '--json')).stdout);
      expect(map).toMatchObject({ source: 'codex', session_id: id });
    }
    const local = JSON.parse((await cli('--source', 'codex', '--cwd', project, '--json')).stdout);
    expect(local).toMatchObject({ source: 'codex', session_id: id });
    const latest = JSON.parse((await cli('--source', 'codex', '--latest', '--json')).stdout);
    expect(latest).toMatchObject({ source: 'codex', session_id: otherId });
    expect(JSON.parse((await cli(id, '--json')).stdout)).toMatchObject({
      source: 'claude',
      session_id: id,
    });
    const list = await cli('--source', 'codex', id, '--list');
    expect(list.stdout).toContain(`agent-tree --source codex ${id.slice(0, 8)} --snapshot`);
  }, 30_000);

  it.each([
    [codexFixture, 'claude'],
    [fixture, 'codex'],
  ])('rejects a mismatched source for %s', async (file, source) => {
    await expect(cli('--file', file, '--source', source, '--json')).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining('does not match the selected source'),
    });
  });

  it.each([
    '{"private":"SYNTHETIC_MALFORMED_SECRET"',
    JSON.stringify({
      timestamp: '2026-01-02T03:07:00Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'read_file',
        call_id: 'bad',
        arguments: 'SYNTHETIC_MALFORMED_SECRET',
      },
    }),
  ])(
    'strictly rejects malformed Codex records without echoing source contents: %s',
    async (broken) => {
      const file = join(project, 'broken-codex.jsonl');
      await writeFile(file, (await readFile(codexFixture, 'utf8')) + broken + '\n');
      await expect(cli('--file', file, '--json', '--strict')).rejects.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining('codex jsonl error at line'),
      });
      try {
        await cli('--file', file, '--json', '--strict');
      } catch (error) {
        expect((error as { stderr: string }).stderr).not.toContain('SYNTHETIC_MALFORMED_SECRET');
        expect((error as { stderr: string }).stderr).not.toContain('owner@example.com');
      }
      const recovered = await cli('--file', file, '--json');
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        source: 'codex',
        stats: { total_turns: 4 },
      });
      expect(recovered.stderr).not.toContain('SYNTHETIC_MALFORMED_SECRET');
    },
  );

  it('redacts Codex exports and emits metadata-only safe catalogs without reading malformed bodies', async () => {
    await writeFile(
      join(project, '.agent-tree.yaml'),
      'redaction:\n  strict: true\n  extra_patterns: ["SYNTHETIC_PRIVATE_WORD"]\n',
    );
    const exported = await cli('--file', codexFixture, '--cwd', project, '--json');
    expect(exported.stdout).not.toContain('SYNTHETIC_PRIVATE_WORD');
    expect(exported.stdout).not.toContain('owner@example.com');
    expect(exported.stdout).toContain('[EMAIL]');
    const file = await rollout(id, join(project, 'SYNTHETIC_PRIVATE_WORD-owner@example.com'));
    const header = (await readFile(file, 'utf8')).split('\n')[0];
    await writeFile(file, header + '\n{"private":"SYNTHETIC_BODY_SECRET"\n');
    const userConfig = join(home, '.config', 'agent-tree');
    await mkdir(userConfig, { recursive: true });
    await writeFile(
      join(userConfig, 'config.yaml'),
      'redaction:\n  strict: true\n  extra_patterns: ["SYNTHETIC_PRIVATE_WORD"]\n',
    );
    for (const format of [['--json'], []]) {
      const catalog = await cli('--source', 'codex', '--sessions', '--redact-strict', ...format);
      expect(catalog.stdout).toContain('aaaa1111-[PHONE]-555566667777');
      expect(catalog.stdout).toContain('codex');
      expect(catalog.stdout).not.toContain('owner@example.com');
      expect(catalog.stdout).not.toContain('SYNTHETIC_PRIVATE_WORD');
      expect(catalog.stdout).not.toContain('SYNTHETIC_BODY_SECRET');
      expect(catalog.stdout).not.toContain('SYNTHETIC_PRIVATE_INSTRUCTIONS');
      expect(catalog.stderr).not.toContain('SYNTHETIC_BODY_SECRET');
      if (format.length) {
        expect(Object.keys(JSON.parse(catalog.stdout).sessions[0]).sort()).toEqual(
          ['source', 'sessionId', 'projectDir', 'jsonlPath', 'mtimeMs', 'sizeBytes'].sort(),
        );
      }
    }
  });

  it('records detected and selected Codex snapshots without starring the same Claude UUID', async () => {
    for (const mode of ['continue', 'fork']) {
      const selection = mode === 'fork' ? ['--source', 'codex'] : [];
      const snapshot = await cli(
        '--file',
        codexFixture,
        ...selection,
        '--snapshot',
        '1',
        '--mode',
        mode,
      );
      expect(snapshot.stdout).toContain(mode === 'fork' ? 'Forking at:' : 'Continuing from:');
      expect(snapshot.stdout).toContain(id);
    }
    const history = await readFile(
      join(home, '.cache', 'agent-tree', 'picks', 'codex', `${id}.jsonl`),
      'utf8',
    );
    expect(
      history
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual([
      expect.objectContaining({ node_id: 'n_001', mode: 'continue' }),
      expect.objectContaining({ node_id: 'n_001', mode: 'fork' }),
    ]);
    const codexList = await cli('--file', codexFixture, '--list');
    expect(codexList.stdout).toContain('1 node starred, 2 total picks');
    expect(codexList.stdout).toContain('--source codex --file');
    expect((await cli('--file', fixture, '--list')).stdout).not.toContain('starred');
    await expect(
      readFile(join(home, '.cache', 'agent-tree', 'picks', 'claude', `${id}.jsonl`)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it('filters picks by source and unstars only the detected source', async () => {
    await cli('--file', fixture, '--snapshot', '1');
    await cli('--file', codexFixture, '--snapshot', '1');
    const all = (await cli('--picks')).stdout;
    expect(all).toContain(`claude session ${id.slice(0, 8)}`);
    expect(all).toContain(`codex session ${id.slice(0, 8)}`);
    for (const source of ['claude', 'codex']) {
      const picks = (await cli('--picks', '--source', source)).stdout;
      expect(picks).toContain(`${source} session ${id.slice(0, 8)}`);
      expect(picks).not.toContain(`${source === 'claude' ? 'codex' : 'claude'} session`);
    }
    expect((await cli('--file', codexFixture, '--unstar', '1')).stderr).toContain(
      'Unstarred n_001',
    );
    expect((await cli('--file', codexFixture, '--list')).stdout).not.toContain('starred');
    expect((await cli('--file', fixture, '--list')).stdout).toContain('starred');
    expect((await cli('--picks', '--source', 'codex')).stderr).toContain('No picks');
  }, 30_000);

  it.each(['invalid', 'CODEX', '../codex', ''])(
    'rejects invalid --source %j with exit 2',
    async (source) => {
      await expect(
        cli('--source', source, '--file', join(root, 'missing.jsonl'), '--json'),
      ).rejects.toMatchObject({ code: 2 });
    },
  );
});
