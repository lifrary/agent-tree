import { execFile, spawnSync } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { encodeProjectPath } from '../src/sources/claude.js';

const exec = promisify(execFile);
const entry = resolve('src/cli.ts');
const stubBin = resolve('tests/fixtures/bin');
const sessionId = 'aaaa1111-2222-3333-4444-555566667777';
// Everything a shell would act on; --open must hand it over as inert bytes.
const hostile = `Fix "double" and 'single' $(touch pwned) \`touch pwned2\` 한글 프롬프트\nsecond line; touch pwned3`;

// Drives the CLI as the session leader of a fresh pseudo-terminal, so stdin
// and stdout are TTYs and Ctrl-C reaches every process in the foreground group.
const PTY_RUNNER = String.raw`
import json, os, pty, select, signal, sys, time
spec = json.loads(sys.argv[1])
pid, fd = pty.fork()
if pid == 0:
    os.chdir(spec['cwd'])
    os.execve(spec['argv'][0], spec['argv'], spec['env'])
out, sent, replied, status = b'', False, False, None
deadline = time.monotonic() + spec['timeout']
while status is None and time.monotonic() < deadline:
    if select.select([fd], [], [], 0.1)[0]:
        try:
            out += os.read(fd, 65536)
        except OSError:
            pass
        marker = spec.get('interruptOn')
        if marker and not sent and marker.encode() in out:
            os.write(fd, b'\x03')
            sent = True
        reply_on = spec.get('replyOn')
        if reply_on and not replied and reply_on.encode() in out:
            os.write(fd, spec['reply'].encode())
            replied = True
    done, st = os.waitpid(pid, os.WNOHANG)
    if done:
        status = st
while select.select([fd], [], [], 0.1)[0]:
    try:
        data = os.read(fd, 65536)
    except OSError:
        break
    if not data:
        break
    out += data
if status is None:
    os.killpg(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
    result = {'timeout': True}
elif os.WIFSIGNALED(status):
    result = {'signal': os.WTERMSIG(status)}
else:
    result = {'code': os.WEXITSTATUS(status)}
result['output'] = out.decode('utf-8', 'replace')
print(json.dumps(result))
`;
const hasPty = spawnSync('python3', ['-c', 'import pty'], { stdio: 'ignore' }).status === 0;

let root: string;
let home: string;
let project: string;
let stubOut: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'agent-tree-open-cli-')));
  home = join(root, 'home');
  project = join(root, 'project');
  stubOut = join(root, 'stub');
  await Promise.all([mkdir(home), mkdir(project)]);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}): Record<string, string> {
  // Built from scratch, so CLAUDECODE from the session running these tests never leaks in.
  return {
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: join(root, 'claude'),
    CODEX_HOME: join(root, 'codex'),
    ANTHROPIC_API_KEY: '',
    AGENT_TREE_NO_LLM: 'true',
    TERM: 'xterm',
    PATH: [stubBin, '/usr/bin', '/bin'].join(delimiter),
    AGENT_TREE_STUB_OUT: stubOut,
    ...extra,
  };
}

/** A copy of a fixture whose events record `cwd` and whose first user prompt is `prompt`. */
async function session(
  fixture: 'minimal-session' | 'codex-session',
  cwd: string,
  prompt: string,
): Promise<string> {
  const original =
    fixture === 'codex-session'
      ? 'Please update src/app.ts for SYNTHETIC_PRIVATE_WORD owner@example.com.'
      : 'Please read src/foo.ts and explain';
  const raw = await readFile(resolve(`tests/fixtures/${fixture}.jsonl`), 'utf8');
  expect(raw).toContain(original);
  const records = raw
    .trim()
    .split('\n')
    .map((line) => {
      const record = JSON.parse(line.split(original).join(JSON.stringify(prompt).slice(1, -1)));
      if (typeof record.cwd === 'string') record.cwd = cwd;
      if (typeof record.payload?.cwd === 'string') record.payload.cwd = cwd;
      return JSON.stringify(record);
    });
  const file = join(root, `${fixture}.jsonl`);
  await writeFile(file, records.join('\n') + '\n');
  return file;
}

async function cli(args: string[], extra: Record<string, string> = {}) {
  return exec(process.execPath, ['--import', 'tsx', entry, ...args], {
    cwd: process.cwd(),
    env: env(extra),
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code: number; stdout: string; stderr: string }) => error,
  );
}

type PtyResult = { code?: number; signal?: number; timeout?: true; output: string };

async function underPty(
  args: string[],
  extra: Record<string, string> = {},
  interruptOn?: string,
  reply?: { on: string; text: string },
  stderrTo?: string,
): Promise<PtyResult> {
  const command = [process.execPath, '--import', 'tsx', entry, ...args];
  const spec = {
    cwd: process.cwd(),
    argv: stderrTo ? ['/bin/sh', '-c', 'exec "$@" 2>"$0"', stderrTo, ...command] : command,
    env: env(extra),
    timeout: 40,
    interruptOn,
    replyOn: reply?.on,
    reply: reply?.text,
  };
  const { stdout } = await exec('python3', ['-c', PTY_RUNNER, JSON.stringify(spec)], {
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout) as PtyResult;
}

/**
 * The prompt `--snapshot` prints; the Generated timestamp differs per run. It
 * records its own pick, so it gets a separate HOME.
 */
async function snapshotPrompt(file: string, mode: string, source = 'claude'): Promise<string> {
  const snapshotHome = join(root, 'snapshot-home');
  await mkdir(snapshotHome, { recursive: true });
  const result = await cli(
    ['--source', source, '--file', file, '--no-llm', '--snapshot', '1', '--mode', mode],
    { HOME: snapshotHome, USERPROFILE: snapshotHome },
  );
  expect(result.code).toBe(0);
  return result.stdout;
}

const withoutTimestamp = (text: string) =>
  text.replace(/^\*\*Generated\*\*: .*$/m, '**Generated**: -');

async function stubArgv(): Promise<string[]> {
  const bytes = await readFile(`${stubOut}.argv`);
  expect(bytes.at(-1)).toBe(0);
  return bytes.subarray(0, -1).toString('utf8').split('\0');
}

const picksFile = (source = 'claude') =>
  join(home, '.cache', 'agent-tree', 'picks', source, `${sessionId}.jsonl`);

async function expectNothingRan(): Promise<void> {
  expect(existsSync(`${stubOut}.argv`)).toBe(false);
  expect(existsSync(picksFile())).toBe(false);
}

async function expectNoPwnedFile(): Promise<void> {
  for (const dir of [project, root, process.cwd()]) {
    expect((await readdir(dir)).filter((name) => name.startsWith('pwned'))).toEqual([]);
  }
}

describe.skipIf(!hasPty)(
  hasPty
    ? '--open under a real terminal'
    : '--open under a real terminal (skipped: python3 with the pty module not found)',
  () => {
    it('hands claude the exact --snapshot prompt as inert bytes, in the step directory', async () => {
      const file = await session('minimal-session', project, hostile);
      const expected = await snapshotPrompt(file, 'continue');
      for (const part of [
        '$(touch pwned)',
        '`touch pwned2`',
        '"double"',
        "'single'",
        '한글 프롬프트',
        '\n',
      ]) {
        expect(expected).toContain(part);
      }

      const run = await underPty(['--file', file, '--no-llm', '--open', '1', '--yes']);
      expect(run).toMatchObject({ code: 0 });
      const argv = await stubArgv();
      expect(argv).toHaveLength(1);
      expect(withoutTimestamp(argv[0])).toBe(withoutTimestamp(expected));
      expect(argv[0].startsWith('# Continuing from: ')).toBe(true);
      expect((await readFile(`${stubOut}.cwd`, 'utf8')).trim()).toBe(project);
      expect((await readFile(`${stubOut}.name`, 'utf8')).trim()).toBe('claude');
      await expectNoPwnedFile();
      const picks = (await readFile(picksFile(), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(picks).toMatchObject([{ node_id: 'n_001', mode: 'continue' }]);
      expect(run.output).not.toContain('on GitHub helps others find it');
    }, 90_000);

    it("starts a codex session's own agent with -C and --, in --open-dir, and passes its exit status", async () => {
      const other = join(root, 'elsewhere');
      await mkdir(other);
      const file = await session('codex-session', project, hostile);
      const expected = await snapshotPrompt(file, 'fork', 'codex');

      const run = await underPty(
        [
          '--source',
          'codex',
          '--file',
          file,
          '--no-llm',
          '--open',
          '1',
          '--mode',
          'fork',
          '--open-dir',
          other,
          '--yes',
        ],
        { AGENT_TREE_STUB_EXIT: '7' },
      );
      expect(run).toMatchObject({ code: 7 });
      const argv = await stubArgv();
      expect(argv.slice(0, 3)).toEqual(['-C', other, '--']);
      expect(argv).toHaveLength(4);
      expect(withoutTimestamp(argv[3])).toBe(withoutTimestamp(expected));
      expect(argv[3].startsWith('# Forking at: ')).toBe(true);
      expect((await readFile(`${stubOut}.name`, 'utf8')).trim()).toBe('codex');
      expect((await readFile(`${stubOut}.cwd`, 'utf8')).trim()).toBe(other);
      await expectNoPwnedFile();
    }, 90_000);

    it('suggests the --open command after an interactive --snapshot, and starts nothing', async () => {
      const file = await session('minimal-session', project, 'plain prompt');
      // PATH holds only the stubs: no clipboard tool, so the real clipboard is never touched.
      const run = await underPty(
        ['--file', file, '--no-llm', '--snapshot', '1', '--mode', 'fork'],
        {
          PATH: stubBin,
        },
      );
      expect(run).toMatchObject({ code: 0 });
      expect(run.output).toContain(
        `start it directly: agent-tree --source claude --file '${file}' --open 1 --mode fork`,
      );
      expect(existsSync(`${stubOut}.argv`)).toBe(false);
    }, 90_000);

    it('asks before starting a session file: Enter starts it, Ctrl-C starts nothing', async () => {
      const file = await session('minimal-session', project, 'plain prompt');
      const question = 'Press Enter to start';

      const cancelled = await underPty(['--file', file, '--no-llm', '--open', '1'], {}, question);
      expect(cancelled).toMatchObject({ code: 130 });
      expect(cancelled.output).toContain(`About to start claude in ${project}`);
      expect(cancelled.output).toContain('# Continuing from: ');
      expect(cancelled.output).toContain('Cancelled; nothing was started.');
      await expectNothingRan();

      const started = await underPty(['--file', file, '--no-llm', '--open', '1'], {}, undefined, {
        on: question,
        text: '\r',
      });
      expect(started).toMatchObject({ code: 0 });
      expect((await stubArgv())[0].startsWith('# Continuing from: ')).toBe(true);
      expect(existsSync(picksFile())).toBe(true);
    }, 90_000);

    it('asks on the terminal even when stderr goes to a file', async () => {
      const file = await session('minimal-session', project, 'plain prompt');
      const errors = join(root, 'stderr.txt');
      const run = await underPty(
        ['--file', file, '--no-llm', '--open', '1'],
        {},
        undefined,
        { on: 'Press Enter to start', text: '\r' },
        errors,
      );
      expect(run).toMatchObject({ code: 0 });
      expect(run.output).toContain('About to start claude in');
      expect(existsSync(`${stubOut}.argv`)).toBe(true);
    }, 90_000);

    it('exits 2 and starts nothing when the session has no turns', async () => {
      const first = (await readFile(resolve('tests/fixtures/minimal-session.jsonl'), 'utf8')).split('\n')[0];
      expect(JSON.parse(first).type).toBe('permission-mode');
      const empty = join(root, 'empty.jsonl');
      await writeFile(empty, `${first}\n`);
      const run = await underPty(['--file', empty, '--no-llm', '--open', '1', '--yes']);
      expect(run).toMatchObject({ code: 2 });
      expect(run.output).toContain('No turns found');
      await expectNothingRan();
    }, 90_000);

    it('starts a discovered session without asking', async () => {
      const file = await session('minimal-session', project, 'plain prompt');
      const projects = join(root, 'claude', 'projects', encodeProjectPath(project));
      await mkdir(projects, { recursive: true });
      await writeFile(join(projects, `${sessionId}.jsonl`), await readFile(file));
      const run = await underPty([sessionId.slice(0, 8), '--cwd', project, '--no-llm', '--open', '1']);
      expect(run).toMatchObject({ code: 0 });
      expect(run.output).not.toContain('Press Enter to start');
      expect((await stubArgv())[0].startsWith('# Continuing from: ')).toBe(true);
    }, 90_000);

    it('survives Ctrl-C itself and exits 130 when it kills the agent', async () => {
      const file = await session('minimal-session', project, 'plain prompt');
      const run = await underPty(
        ['--file', file, '--no-llm', '--open', '1', '--yes'],
        { AGENT_TREE_STUB_WAIT: '1' },
        'STUB-READY',
      );
      expect(run).toMatchObject({ code: 130 });
    }, 90_000);

    it('refuses without starting anything: missing binary, nested session, directory gone', async () => {
      const file = await session('minimal-session', project, 'plain prompt');
      const empty = join(root, 'empty-bin');
      await mkdir(empty);

      const missing = await underPty(['--file', file, '--no-llm', '--open', '1'], { PATH: empty });
      expect(missing).toMatchObject({ code: 127 });
      expect(missing.output).toContain(
        'claude not found on PATH; install it or use --snapshot to copy the prompt',
      );
      await expectNothingRan();

      const nested = await underPty(['--file', file, '--no-llm', '--open', '1'], {
        CLAUDECODE: '1',
      });
      expect(nested).toMatchObject({ code: 2 });
      expect(nested.output).toContain('CLAUDECODE=1');
      await expectNothingRan();

      const gone = join(root, 'deleted-project');
      const orphan = await session('minimal-session', gone, 'plain prompt');
      const goneRun = await underPty(['--file', orphan, '--no-llm', '--open', '1']);
      expect(goneRun).toMatchObject({ code: 2 });
      expect(goneRun.output).toContain(gone);
      expect(goneRun.output).toContain('--open-dir');
      await expectNothingRan();

      const badDir = await underPty([
        '--file',
        file,
        '--no-llm',
        '--open',
        '1',
        '--open-dir',
        join(root, 'nope'),
      ]);
      expect(badDir).toMatchObject({ code: 2 });
      await expectNothingRan();
    }, 120_000);
  },
);

describe('--open outside a terminal', () => {
  it('refuses when stdin and stdout are not a TTY, and with --json', async () => {
    const file = await session('minimal-session', project, 'plain prompt');
    const piped = await cli(['--file', file, '--no-llm', '--open', '1']);
    expect(piped.code).toBe(2);
    expect(piped.stderr).toContain('interactive terminal');
    expect(piped.stdout).toBe('');
    await expectNothingRan();

    const json = await cli(['--file', file, '--no-llm', '--open', '1', '--json']);
    expect(json.code).toBe(2);
    await expectNothingRan();
  }, 60_000);

  it('refuses before the session is parsed, so a refusal never pays for analysis', async () => {
    const file = await session('minimal-session', project, 'plain prompt');
    await appendFile(file, 'not json\n');
    // Parsing first would fail this strict run with exit 1; the refusal must come first.
    const refused = await cli(['--file', file, '--strict', '--no-llm', '--open', '1']);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('interactive terminal');
    expect(refused.stderr).not.toContain('jsonl error');
    await expectNothingRan();
  }, 60_000);
});
