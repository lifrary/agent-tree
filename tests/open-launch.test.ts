import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSnapshotPrompt, type ModeContext } from '../src/cli/modes.js';
import { runOpenMode, type OpenDeps } from '../src/cli/open.js';
import { buildRedactor, runPipeline } from '../src/cli/pipeline.js';
import { DEFAULT_CONFIG, mergeConfig } from '../src/config/schema.js';
import { formatOpenCommand, MAX_PROMPT_BYTES, planLaunch } from '../src/launch/command.js';
import { resolveLaunchDir } from '../src/launch/directory.js';
import { findOnPath } from '../src/launch/path.js';
import { exitStatus, runAgent, type SpawnFn } from '../src/launch/run.js';
import type { SessionMatch } from '../src/sources/types.js';
import { createLoggerSync } from '../src/utils/logger.js';
import { recordPick } from '../src/utils/picks.js';

// Never touch the real ~/.cache: picks are observed through the mock only.
vi.mock('../src/utils/picks.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/picks.js')>()),
  recordPick: vi.fn(async () => {}),
}));
vi.mock('../src/utils/git.js', () => ({
  getGitContext: vi.fn(async () => ({ available: false, cwd: '' })),
  formatGitContextMarkdown: vi.fn(() => ''),
}));

const stubBin = resolve('tests/fixtures/bin');
const sessionId = 'aaaa1111-2222-3333-4444-555566667777';
let root: string;
let project: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'agent-tree-open-')));
  project = join(root, 'project');
  await mkdir(project);
});
afterEach(async () => {
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});

/** A child process double: emits what the test tells it to, records nothing else. */
function fakeChild(pid: number | undefined): ChildProcess {
  return Object.assign(new EventEmitter(), { pid }) as unknown as ChildProcess;
}

type SpawnCall = { command: string; args: string[]; options: SpawnOptions };

/** `spawned: false` mimics a binary that never started: Node leaves `pid` unset. */
function scriptedSpawn(
  script: (child: ChildProcess) => void,
  { spawned = true } = {},
): { spawn: SpawnFn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = fakeChild(spawned ? 4242 : undefined);
    setImmediate(() => script(child));
    return child;
  };
  return { spawn, calls };
}

const exitsWith =
  (code: number | null, signal: NodeJS.Signals | null = null) =>
  (child: ChildProcess) => {
    child.emit('spawn');
    child.emit('exit', code, signal);
  };

async function context(cwd: string | null, opts: ModeContext['opts']): Promise<ModeContext> {
  const lines = (await readFile(resolve('tests/fixtures/minimal-session.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => {
      const record = JSON.parse(line);
      if ('cwd' in record) {
        if (cwd === null) delete record.cwd;
        else record.cwd = cwd;
      }
      return JSON.stringify(record);
    });
  const file = join(root, 'session.jsonl');
  await writeFile(file, lines.join('\n') + '\n');
  const match: SessionMatch = { source: 'claude', sessionId, projectDir: '-p', jsonlPath: file };
  const config = mergeConfig(DEFAULT_CONFIG, { cache: { enabled: false } });
  const logger = createLoggerSync('error');
  const fullOpts = { llm: false, cwd: project, ...opts };
  const result = await runPipeline({ match, opts: fullOpts, config, logger, quiet: true });
  return {
    match,
    opts: fullOpts,
    config,
    logger,
    mindmap: result.mindmap,
    graph: result.graph,
    segments: result.segments,
    redactor: buildRedactor(fullOpts, config, logger),
    cacheHash: result.cacheHash,
  };
}

function deps(overrides: Partial<OpenDeps> = {}): OpenDeps {
  return { env: { PATH: stubBin }, interactive: () => true, ...overrides };
}

describe('planLaunch', () => {
  it('passes the prompt as the only argument to claude, with no shell', () => {
    const planned = planLaunch('claude', '/bin/claude', '/work', '# Continuing from: x');
    expect(planned).toEqual({
      ok: true,
      plan: {
        command: '/bin/claude',
        args: ['# Continuing from: x'],
        options: { cwd: '/work', stdio: 'inherit', shell: false },
      },
    });
  });

  it('gives codex its directory with -C and ends its options with --', () => {
    const planned = planLaunch('codex', '/bin/codex', '/work', '# Forking at: x');
    expect(planned.ok && planned.plan.args).toEqual(['-C', '/work', '--', '# Forking at: x']);
    expect(planned.ok && planned.plan.options).toEqual({
      cwd: '/work',
      stdio: 'inherit',
      shell: false,
    });
  });

  it('refuses a prompt that would read as an option', () => {
    for (const agent of ['claude', 'codex'] as const) {
      const planned = planLaunch(agent, '/bin/x', '/work', '--dangerously-skip-permissions');
      expect(planned.ok).toBe(false);
    }
  });

  it('caps the prompt at 100,000 bytes counted in UTF-8, not characters', () => {
    expect(MAX_PROMPT_BYTES).toBe(100_000);
    const atLimit = '# ' + 'a'.repeat(MAX_PROMPT_BYTES - 2);
    expect(planLaunch('claude', '/bin/x', '/w', atLimit).ok).toBe(true);
    const over = planLaunch('claude', '/bin/x', '/w', atLimit + 'a');
    expect(over).toMatchObject({
      ok: false,
      message: expect.stringMatching(/100,001 bytes.*--snapshot/),
    });
    // 34,000 Hangul syllables are 34,002 characters but 102,002 bytes.
    const hangul = planLaunch('claude', '/bin/x', '/w', '# ' + '가'.repeat(34_000));
    expect(hangul.ok).toBe(false);
  });

  it('refuses a NUL byte, which spawn cannot pass', () => {
    expect(planLaunch('claude', '/bin/x', '/w', '# a\0b').ok).toBe(false);
  });
});

describe('formatOpenCommand', () => {
  it('names the session by id prefix, or quotes an exported file', () => {
    expect(formatOpenCommand({ source: 'codex', sessionId, step: 12, mode: 'fork' })).toBe(
      'agent-tree --source codex aaaa1111 --open 12 --mode fork',
    );
    expect(
      formatOpenCommand({
        source: 'claude',
        sessionId,
        file: "/x/it's.jsonl",
        step: 3,
        mode: 'continue',
      }),
    ).toBe(`agent-tree --source claude --file '/x/it'\\''s.jsonl' --open 3 --mode continue`);
  });
});

describe('findOnPath', () => {
  it('returns the first executable regular file and skips relative entries', async () => {
    const [a, b, dir] = ['a', 'b', 'c'].map((name) => join(root, name));
    await Promise.all([mkdir(a), mkdir(b), mkdir(join(dir, 'claude'), { recursive: true })]);
    await writeFile(join(a, 'claude'), '#!/bin/sh\n'); // not executable
    await writeFile(join(b, 'claude'), '#!/bin/sh\n');
    await chmod(join(b, 'claude'), 0o755);
    expect(await findOnPath('claude', [dir, a, b].join(delimiter))).toBe(join(b, 'claude'));
    expect(await findOnPath('claude', [a, dir].join(delimiter))).toBeNull();
    expect(await findOnPath('claude', undefined)).toBeNull();
    // A relative or empty entry means "the current directory" to a shell; never here.
    const previous = process.cwd();
    process.chdir(b);
    try {
      expect(await findOnPath('claude', ['.', '', 'b'].join(delimiter))).toBeNull();
    } finally {
      process.chdir(previous);
    }
  });
});

describe('runAgent', () => {
  const plan = planLaunch('claude', '/bin/claude', '/work', '# p');
  if (!plan.ok) throw new Error('fixture plan refused');

  it('spawns the plan exactly, records the start, and reports the exit code', async () => {
    const { spawn, calls } = scriptedSpawn(exitsWith(7));
    const onStart = vi.fn();
    const outcome = await runAgent(plan.plan, { spawn, onStart });
    expect(calls).toEqual([{ command: '/bin/claude', args: ['# p'], options: plan.plan.options }]);
    expect(calls[0].options.shell).toBe(false);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ started: true, status: 7 });
  });

  it('maps a death by signal to 128 + the signal number', async () => {
    for (const [signal, status] of [
      ['SIGINT', 130],
      ['SIGTERM', 143],
    ] as const) {
      const { spawn } = scriptedSpawn(exitsWith(null, signal));
      expect(await runAgent(plan.plan, { spawn })).toEqual({ started: true, status });
    }
    expect(exitStatus(null, null)).toBe(1);
  });

  it('never records a start when the binary could not be spawned', async () => {
    const error = Object.assign(new Error('spawn /bin/claude ENOENT'), { code: 'ENOENT' });
    const { spawn } = scriptedSpawn((child) => child.emit('error', error), { spawned: false });
    const onStart = vi.fn();
    expect(await runAgent(plan.plan, { spawn, onStart })).toEqual({ started: false, error });
    expect(onStart).not.toHaveBeenCalled();
  });

  it('ignores SIGINT while the child runs and restores it afterwards', async () => {
    const signals = new EventEmitter();
    let listenersWhileRunning = -1;
    const { spawn } = scriptedSpawn((child) => {
      listenersWhileRunning = signals.listenerCount('SIGINT');
      signals.emit('SIGINT');
      exitsWith(0)(child);
    });
    const outcome = await runAgent(plan.plan, {
      spawn,
      signals: signals as unknown as Pick<NodeJS.Process, 'on' | 'removeListener'>,
    });
    expect(listenersWhileRunning).toBe(1);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(outcome).toEqual({ started: true, status: 0 });
  });
});

describe('resolveLaunchDir', () => {
  it("uses the step's recorded directory, and --open-dir overrides it", async () => {
    const ctx = await context(project, { open: '1' });
    const node = ctx.mindmap.root;
    expect(await resolveLaunchDir(ctx.graph, node, undefined)).toEqual({ ok: true, dir: project });
    const other = join(root, 'other');
    await mkdir(other);
    expect(await resolveLaunchDir(ctx.graph, node, other)).toEqual({ ok: true, dir: other });
  });

  it('refuses a directory that is gone instead of falling back to another', async () => {
    const gone = join(root, 'gone');
    const ctx = await context(gone, { open: '1' });
    const result = await resolveLaunchDir(ctx.graph, ctx.mindmap.root, undefined);
    expect(result).toEqual({ ok: false, message: expect.stringContaining(JSON.stringify(gone)) });
    expect(await resolveLaunchDir(ctx.graph, ctx.mindmap.root, join(root, 'nope'))).toMatchObject({
      ok: false,
      message: expect.stringContaining('--open-dir'),
    });
    const file = join(root, 'a-file');
    await writeFile(file, '');
    expect((await resolveLaunchDir(ctx.graph, ctx.mindmap.root, file)).ok).toBe(false);
  });

  it('refuses a session that records no directory', async () => {
    const ctx = await context(null, { open: '1' });
    expect((await resolveLaunchDir(ctx.graph, ctx.mindmap.root, undefined)).ok).toBe(false);
  });
});

describe('runOpenMode', () => {
  it('starts claude in the step directory with the --snapshot prompt and records the pick', async () => {
    const ctx = await context(project, { open: '1' });
    const expected = await buildSnapshotPrompt(ctx, '1', 'continue');
    const { spawn, calls } = scriptedSpawn(exitsWith(3));
    expect(await runOpenMode(ctx, deps({ spawn }))).toBe(3);
    expect(calls).toEqual([
      {
        command: join(stubBin, 'claude'),
        args: [expected!.markdown],
        options: { cwd: project, stdio: 'inherit', shell: false },
      },
    ]);
    expect(expected!.markdown.startsWith('# Continuing from: ')).toBe(true);
    expect(recordPick).toHaveBeenCalledWith(sessionId, 'n_001', 'continue', { source: 'claude' });
  });

  it('starts codex with -C and -- for --agent codex --mode fork', async () => {
    const ctx = await context(project, { open: '1', agent: 'codex', mode: 'fork' });
    const expected = await buildSnapshotPrompt(ctx, '1', 'fork');
    const { spawn, calls } = scriptedSpawn(exitsWith(0));
    expect(await runOpenMode(ctx, deps({ spawn }))).toBe(0);
    expect(calls[0].command).toBe(join(stubBin, 'codex'));
    expect(calls[0].args).toEqual(['-C', project, '--', expected!.markdown]);
    expect(expected!.markdown.startsWith('# Forking at: ')).toBe(true);
    expect(recordPick).toHaveBeenCalledWith(sessionId, 'n_001', 'fork', { source: 'claude' });
  });

  it('refuses before spawning and records no pick', async () => {
    const empty = join(root, 'empty-bin');
    await mkdir(empty);
    const ctx = await context(project, { open: '1' });
    const gone = await context(join(root, 'gone'), { open: '1' });
    const cases: Array<[ModeContext, Partial<OpenDeps>, number]> = [
      [ctx, { env: { PATH: empty } }, 127],
      [ctx, { env: { PATH: stubBin, CLAUDECODE: '1' } }, 2],
      [ctx, { interactive: () => false }, 2],
      [{ ...ctx, opts: { ...ctx.opts, open: '999' } }, {}, 2],
      [gone, {}, 2],
    ];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const [modeCtx, overrides, status] of cases) {
        const { spawn, calls } = scriptedSpawn(exitsWith(0));
        expect(await runOpenMode(modeCtx, deps({ spawn, ...overrides }))).toBe(status);
        expect(calls).toEqual([]);
      }
    } finally {
      errors.mockRestore();
    }
    expect(recordPick).not.toHaveBeenCalled();
  });
});
