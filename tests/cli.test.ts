import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeProjectPath } from '../src/utils/session_path.js';

const exec = promisify(execFile);
const entry = resolve('src/cli.ts');
const fixture = resolve('tests/fixtures/minimal-session.jsonl');
const id = 'aaaa1111-2222-3333-4444-555566667777';
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

describe('portable CLI workflows', () => {
  it('exports parseable redacted JSON without banners or progress on stdout', async () => {
    const { stdout } = await cli('--file', fixture, '--json', '--no-llm');
    const map = JSON.parse(stdout);
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
    expect(sessions[0]).toMatchObject({ sessionId: id, projectDir: encodeProjectPath(project) });
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
      join(home, '.cache', 'agent-tree', 'picks', `${id}.jsonl`),
      'utf8',
    );
    expect(JSON.parse(history.trim())).toMatchObject({ node_id: 'n_001', mode: 'fork' });
    const list = await cli('--file', fixture, '--list');
    expect(list.stdout).toContain('--file');
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
