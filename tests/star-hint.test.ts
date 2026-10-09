import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  REPOSITORY_URL,
  STAR_HINT_OPT_OUT_ENV,
  STAR_HINT_TEXT,
  maybeShowStarHint,
  type StarHintContext,
} from '../src/utils/star_hint.js';

const exec = promisify(execFile);
let root: string;
let marker: string;
let written: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-tree-star-'));
  marker = join(root, 'cache', 'agent-tree', 'star-hint-shown');
  written = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function terminal(overrides: Partial<StarHintContext> = {}): StarHintContext {
  return {
    env: {},
    stdoutIsTTY: true,
    stderrIsTTY: true,
    markerPath: marker,
    write: (text) => written.push(text),
    ...overrides,
  };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe('star hint', () => {
  it('shows exactly once per machine', async () => {
    expect(await maybeShowStarHint(terminal())).toBe('show');
    expect(await maybeShowStarHint(terminal())).toBe('already-shown');
    expect(await maybeShowStarHint(terminal())).toBe('already-shown');
    expect(written).toEqual([STAR_HINT_TEXT]);
    expect(STAR_HINT_TEXT).toContain(REPOSITORY_URL);
    expect(STAR_HINT_TEXT).toContain(`${STAR_HINT_OPT_OUT_ENV}=1`);
    expect(await exists(marker)).toBe(true);
  });

  it.each([
    ['opt-out env "1"', { env: { [STAR_HINT_OPT_OUT_ENV]: '1' } }, 'opted-out'],
    ['opt-out env "true"', { env: { [STAR_HINT_OPT_OUT_ENV]: 'true' } }, 'opted-out'],
    ['CI', { env: { CI: 'true' } }, 'ci'],
    ['a Claude Code agent', { env: { CLAUDECODE: '1' } }, 'agent'],
    ['stdout piped', { stdoutIsTTY: false }, 'not-a-terminal'],
    ['stderr piped', { stderrIsTTY: false }, 'not-a-terminal'],
    ['--json', { json: true }, 'machine-output'],
    ['--dump-json', { dumpJson: '/tmp/dump' }, 'machine-output'],
  ] as const)('stays silent and records nothing for %s', async (_label, overrides, reason) => {
    expect(await maybeShowStarHint(terminal(overrides))).toBe(reason);
    expect(written).toEqual([]);
    expect(await exists(marker)).toBe(false);
  });

  it('treats an opt-out value other than 1 or true as unset, like the other env flags', async () => {
    expect(await maybeShowStarHint(terminal({ env: { [STAR_HINT_OPT_OUT_ENV]: '0' } }))).toBe(
      'show',
    );
  });

  it('shows nothing when the marker cannot be written, so it never repeats', async () => {
    const blocker = join(root, 'not-a-dir');
    await writeFile(blocker, 'file');
    const ctx = terminal({ markerPath: join(blocker, 'star-hint-shown') });
    expect(await maybeShowStarHint(ctx)).toBe('marker-unwritable');
    expect(await maybeShowStarHint(ctx)).toBe('marker-unwritable');
    expect(written).toEqual([]);
  });

  it('is never wired into the MCP server or the agent skill', async () => {
    const server = await readFile(resolve('src/mcp/server.ts'), 'utf8');
    const skill = await readFile(resolve('skills/agent-tree/SKILL.md'), 'utf8');
    expect(server).not.toMatch(/star_hint|StarHint/);
    expect(skill).not.toMatch(/on GitHub helps|star (it )?on GitHub|⭐ on GitHub/i);
  });
});

describe('star hint through the real CLI', () => {
  async function cli(...args: string[]) {
    const home = join(root, 'home');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      ANTHROPIC_API_KEY: '',
      AGENT_TREE_NO_LLM: 'true',
    };
    delete env.CI;
    delete env.CLAUDECODE;
    delete env[STAR_HINT_OPT_OUT_ENV];
    const result = await exec(process.execPath, ['--import', 'tsx', resolve('src/cli.ts'), ...args], {
      env,
      timeout: 15_000,
    });
    return { ...result, marker: join(home, '.cache', 'agent-tree', 'star-hint-shown') };
  }

  it('prints the repository link in --help', async () => {
    const { stdout } = await cli('--help');
    expect(stdout).toContain(`Docs and issues: ${REPOSITORY_URL}`);
  });

  it('never hints or records a marker when output is piped', async () => {
    const run = await cli('--file', resolve('tests/fixtures/minimal-session.jsonl'), '--no-llm');
    expect(run.stdout).not.toBe('');
    expect(run.stderr).not.toContain('on GitHub');
    expect(await exists(run.marker)).toBe(false);
  });
});
