import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import * as fs from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { encodeProjectPath, getProjectsRoot } from '../src/sources/claude.js';
import {
  findLatestSession,
  findLatestSessionInProject,
  listSessions,
  locateSession,
  sessionFromFile,
} from '../src/utils/session_path.js';

// Keep real filesystem behavior, with replaceable exports for deterministic
// permission failures and races on every platform (including privileged CI).
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
}));

const ID_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID_B = 'BBBBBBBB-0000-4000-8000-000000000002';
const ID_C = 'aaaaaaaa-0000-4000-8000-000000000003';
const TIME = 1_700_000_000_000;
let tmpRoot: string;
let projectsRoot: string;

beforeEach(() => {
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), 'atree-sessions-')));
  projectsRoot = join(tmpRoot, 'projects');
  mkdirSync(projectsRoot);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeSession(projectDir: string, sessionId = ID_A, mtimeMs = TIME, body = '{}\n'): string {
  const directory = join(projectsRoot, projectDir);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${sessionId}.jsonl`);
  writeFileSync(file, body, 'utf8');
  utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
  return file;
}

function ioError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`filesystem failure: ${code}`), { code });
}

describe('project paths', () => {
  it.each([
    ['/Users/alice/Code/my_project', '-Users-alice-Code-my-project'],
    ['/tmp/a-Z0_9.foo bar@x', '-tmp-a-Z0-9-foo-bar-x'],
    ['C:\\Users\\Example User\\my_project', 'C--Users-Example-User-my-project'],
    ['\\\\server\\share\\my_project', '--server-share-my-project'],
    ['/a.b_c d/é', '-a-b-c-d--'],
  ])('encodes %s using Claude Code path rules', (input, expected) => {
    expect(encodeProjectPath(input)).toBe(expected);
  });

  it('looks up CLAUDE_CONFIG_DIR dynamically', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(tmpRoot, 'first'));
    expect(getProjectsRoot()).toBe(join(tmpRoot, 'first', 'projects'));
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(tmpRoot, 'second'));
    expect(getProjectsRoot()).toBe(join(tmpRoot, 'second', 'projects'));
    vi.stubEnv('CLAUDE_CONFIG_DIR', undefined);
    expect(getProjectsRoot()).toBe(join(homedir(), '.claude', 'projects'));
    vi.stubEnv('CLAUDE_CONFIG_DIR', '');
    expect(getProjectsRoot()).toBe(join(homedir(), '.claude', 'projects'));
  });

  it('uses the custom configuration root for every discovery entry point', async () => {
    const cwd = '/work/project_with spaces';
    const projectDir = encodeProjectPath(cwd);
    const jsonlPath = makeSession(projectDir);
    const expected = { source: 'claude', sessionId: ID_A, projectDir, jsonlPath };
    vi.stubEnv('CLAUDE_CONFIG_DIR', tmpRoot);

    expect(await listSessions()).toEqual([{ ...expected, mtimeMs: TIME, sizeBytes: 3 }]);
    expect(await locateSession('AAAA')).toEqual([expected]);
    expect(await findLatestSession()).toEqual(expected);
    expect(await findLatestSessionInProject(cwd)).toEqual(expected);
  });
});

describe('listSessions', () => {
  it('includes only full UUID JSONL regular files directly under project directories', async () => {
    const a = makeSession('-project', ID_A);
    const b = makeSession('-project', ID_B);
    const projectPath = join(projectsRoot, '-project');
    for (const name of [
      'notes.jsonl',
      'aaaa.jsonl',
      `agent-${ID_A}.jsonl`,
      'gggggggg-0000-4000-8000-000000000001.jsonl',
      `${ID_A}.json`,
      // A distinct UUID avoids overwriting the accepted lowercase file on
      // case-insensitive filesystems while still testing extension filtering.
      'cccccccc-0000-4000-8000-000000000004.JSONL',
      `${ID_A}.jsonl.bak`,
    ]) {
      writeFileSync(join(projectPath, name), '{}\n');
    }
    mkdirSync(join(projectPath, `${ID_C}.jsonl`));
    mkdirSync(join(projectPath, 'subagents'));
    writeFileSync(join(projectPath, 'subagents', `${ID_C}.jsonl`), '{}\n');
    writeFileSync(join(projectsRoot, `${ID_C}.jsonl`), '{}\n');
    writeFileSync(join(projectsRoot, 'not-a-project'), '{}\n');

    const sessions = await listSessions({ root: projectsRoot });
    expect(sessions.map((entry) => entry.jsonlPath)).toEqual([b, a]);
    expect(sessions.map((entry) => entry.sessionId)).toEqual([ID_B, ID_A]);
  });

  it('sorts by descending mtime then ascending full path and reports byte sizes', async () => {
    const z = makeSession('-z', ID_A, TIME, '한글\n');
    const c = makeSession('-a', ID_C, TIME);
    const a = makeSession('-a', ID_A, TIME);
    const newest = makeSession('-z', ID_B, TIME + 1000);

    const sessions = await listSessions({ root: projectsRoot });
    expect(sessions.map((entry) => entry.jsonlPath)).toEqual([newest, a, c, z]);
    expect(sessions.map((entry) => entry.mtimeMs)).toEqual([TIME + 1000, TIME, TIME, TIME]);
    expect(sessions[3].sizeBytes).toBe(Buffer.byteLength('한글\n'));
    expect(sessions[3].sizeBytes).toBe(statSync(z).size);
  });

  it.each([0, 1, 2, 10])('limits sorted results to %i', async (limit) => {
    makeSession('-project', ID_A, TIME);
    makeSession('-project', ID_C, TIME + 1000);
    makeSession('-project', ID_B, TIME + 2000);
    const all = await listSessions({ root: projectsRoot });
    expect(await listSessions({ root: projectsRoot, limit })).toEqual(all.slice(0, limit));
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid limit %s',
    async (limit) => {
      await expect(listSessions({ root: projectsRoot, limit })).rejects.toThrow(
        'session limit must be a nonnegative safe integer',
      );
    },
  );

  it('scans only the encoded project directory when projectCwd is provided', async () => {
    const cwd = '/work/project_with spaces';
    const projectDir = encodeProjectPath(cwd);
    const matching = makeSession(projectDir);
    makeSession('-other', ID_B, TIME + 1000);
    const spy = vi.spyOn(fs, 'readdir');

    const sessions = await listSessions({ root: projectsRoot, projectCwd: cwd });
    expect(sessions.map((entry) => entry.jsonlPath)).toEqual([matching]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(join(projectsRoot, projectDir), {
      withFileTypes: true,
    });
    expect(await findLatestSessionInProject(cwd, { root: projectsRoot })).toEqual({
      source: 'claude',
      sessionId: ID_A,
      projectDir,
      jsonlPath: matching,
    });
    expect(await findLatestSessionInProject('/missing/project', { root: projectsRoot })).toBeNull();
  });

  it('returns no sessions for missing roots and roots that are not directories', async () => {
    const file = join(tmpRoot, 'file');
    writeFileSync(file, 'not a directory');
    for (const root of [join(tmpRoot, 'missing'), file, join(file, 'projects')]) {
      expect(await listSessions({ root })).toEqual([]);
      expect(await findLatestSession({ root })).toBeNull();
      expect(await findLatestSessionInProject('/work', { root })).toBeNull();
      expect(await locateSession('aaaa', { root })).toEqual([]);
    }
  });

  it('skips symlink roots, project directories and session files', async () => {
    const legitimate = makeSession('-project');
    const outside = join(tmpRoot, 'outside');
    mkdirSync(outside);
    const externalSession = join(outside, `${ID_B}.jsonl`);
    writeFileSync(externalSession, '{}\n');
    symlinkSync(outside, join(projectsRoot, '-linked-project'), 'dir');
    symlinkSync(externalSession, join(projectsRoot, '-project', `${ID_B}.jsonl`));
    symlinkSync(join(outside, 'missing.jsonl'), join(projectsRoot, '-project', `${ID_C}.jsonl`));
    const rootAlias = join(tmpRoot, 'root-alias');
    symlinkSync(projectsRoot, rootAlias, 'dir');

    expect((await listSessions({ root: projectsRoot })).map((entry) => entry.jsonlPath)).toEqual([
      legitimate,
    ]);
    expect(await listSessions({ root: rootAlias })).toEqual([]);
    expect(await listSessions({ root: projectsRoot, projectCwd: '/linked/project' })).toEqual([]);
  });

  it.each(['ENOENT', 'ENOTDIR'])(
    'skips a file that disappears during discovery (%s)',
    async (code) => {
      makeSession('-project');
      const original = fs.lstat;
      vi.spyOn(fs, 'lstat')
        .mockImplementationOnce(original)
        .mockImplementationOnce(original)
        .mockRejectedValueOnce(ioError(code));
      expect(await listSessions({ root: projectsRoot })).toEqual([]);
    },
  );

  it.each(['ENOENT', 'ENOTDIR'])(
    'skips a project that disappears before readdir (%s)',
    async (code) => {
      makeSession('-project');
      const original = fs.readdir;
      vi.spyOn(fs, 'readdir').mockImplementationOnce(original).mockRejectedValueOnce(ioError(code));
      expect(await listSessions({ root: projectsRoot })).toEqual([]);
    },
  );

  it('skips a regular directory entry replaced by a symlink before lstat', async () => {
    const file = makeSession('-project');
    const outside = join(tmpRoot, 'outside.jsonl');
    writeFileSync(outside, 'outside data\n');
    const original = fs.lstat;
    vi.spyOn(fs, 'lstat')
      .mockImplementationOnce(original)
      .mockImplementationOnce(original)
      .mockImplementationOnce(async () => {
        renameSync(file, join(tmpRoot, 'moved.jsonl'));
        symlinkSync(outside, file);
        return original(file);
      });

    expect(await listSessions({ root: projectsRoot })).toEqual([]);
  });

  it('discards a project replaced by a symlink while its files are scanned', async () => {
    makeSession('-project');
    const projectPath = join(projectsRoot, '-project');
    const outside = join(tmpRoot, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, `${ID_A}.jsonl`), 'outside data\n');
    const original = fs.readdir;
    vi.spyOn(fs, 'readdir')
      .mockImplementationOnce(original)
      .mockImplementationOnce(async (...args) => {
        const entries = await original(...args);
        renameSync(projectPath, join(tmpRoot, 'moved-project'));
        symlinkSync(outside, projectPath, 'dir');
        return entries;
      });

    expect(await listSessions({ root: projectsRoot })).toEqual([]);
  });

  it('discards a root replaced by a symlink while projects are scanned', async () => {
    makeSession('-project');
    const outside = join(tmpRoot, 'outside');
    mkdirSync(join(outside, '-project'), { recursive: true });
    writeFileSync(join(outside, '-project', `${ID_A}.jsonl`), 'outside data\n');
    const original = fs.lstat;
    vi.spyOn(fs, 'lstat')
      .mockImplementationOnce(original)
      .mockImplementationOnce(async () => {
        renameSync(projectsRoot, join(tmpRoot, 'moved-root'));
        symlinkSync(outside, projectsRoot, 'dir');
        return original(join(projectsRoot, '-project'));
      });

    expect(await listSessions({ root: projectsRoot })).toEqual([]);
  });

  it.each(['EACCES', 'EPERM', 'EIO', 'ELOOP'])(
    'surfaces root metadata failures (%s)',
    async (code) => {
      const error = ioError(code);
      vi.spyOn(fs, 'lstat').mockRejectedValueOnce(error);
      await expect(listSessions({ root: projectsRoot })).rejects.toBe(error);
    },
  );

  it.each(['EACCES', 'EIO'])('surfaces root directory listing failures (%s)', async (code) => {
    const error = ioError(code);
    vi.spyOn(fs, 'readdir').mockRejectedValueOnce(error);
    await expect(listSessions({ root: projectsRoot })).rejects.toBe(error);
  });

  it.each(['EACCES', 'EIO'])('surfaces project directory listing failures (%s)', async (code) => {
    makeSession('-project');
    const error = ioError(code);
    const original = fs.readdir;
    vi.spyOn(fs, 'readdir').mockImplementationOnce(original).mockRejectedValueOnce(error);
    await expect(listSessions({ root: projectsRoot })).rejects.toBe(error);
  });

  it.each(['EACCES', 'EIO'])('surfaces individual session metadata failures (%s)', async (code) => {
    makeSession('-project');
    const error = ioError(code);
    const original = fs.lstat;
    vi.spyOn(fs, 'lstat')
      .mockImplementationOnce(original)
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(error);
    await expect(listSessions({ root: projectsRoot })).rejects.toBe(error);
  });
});

describe('lookup entry points', () => {
  it('prefers the hinted project, then mtime and deterministic path order', async () => {
    const preferred = makeSession('-preferred', ID_A, TIME);
    const newest = makeSession('-other', ID_C, TIME + 1000);
    const tied = makeSession('-other', ID_A, TIME + 1000);
    expect(
      await locateSession('AAAA', {
        root: projectsRoot,
        projectHint: '-preferred',
      }),
    ).toEqual([
      { source: 'claude', sessionId: ID_A, projectDir: '-preferred', jsonlPath: preferred },
      { source: 'claude', sessionId: ID_A, projectDir: '-other', jsonlPath: tied },
      { source: 'claude', sessionId: ID_C, projectDir: '-other', jsonlPath: newest },
    ]);
    expect(await findLatestSession({ root: projectsRoot })).toEqual({
      source: 'claude',
      sessionId: ID_A,
      projectDir: '-other',
      jsonlPath: tied,
    });
    expect(await locateSession(ID_C.toUpperCase(), { root: projectsRoot })).toEqual([
      { source: 'claude', sessionId: ID_C, projectDir: '-other', jsonlPath: newest },
    ]);
  });

  it('rejects invalid ids before touching the filesystem', async () => {
    const spy = vi.spyOn(fs, 'lstat');
    for (const id of ['../escape', 'abc', 'not-a-uuid', '']) {
      await expect(locateSession(id, { root: projectsRoot })).rejects.toThrow(
        'is not a valid UUID or prefix',
      );
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('sessionFromFile', () => {
  it('imports a portable export with a provisional filename-based id', async () => {
    const directory = join(tmpRoot, 'portable exports');
    mkdirSync(directory);
    const file = join(directory, 'my saved conversation.jsonl');
    writeFileSync(
      file,
      '{"type":"permission-mode","sessionId":"envelope-id","permissionMode":"default"}\n',
    );

    expect(await sessionFromFile(relative(process.cwd(), file))).toEqual({
      source: 'claude',
      sessionId: 'my saved conversation',
      projectDir: 'portable exports',
      jsonlPath: file,
    });
  });

  it.each(['{}\n', '{"sessionId":"envelope-id"}\n', 'not valid JSON\n', 'null\n[]\n42\n'])(
    'rejects unrecognized nonempty formats: %j',
    async (body) => {
      const file = makeSession('-project', ID_A, TIME, body);
      await expect(sessionFromFile(file)).rejects.toThrow(
        'Cannot identify session format; select --source explicitly.',
      );
    },
  );

  it.each(['{}\n', '{"sessionId":"envelope-id"}\n', '{"type":\nnot valid JSON\n'])(
    'accepts headerless or malformed files with an explicit source: %j',
    async (body) => {
      const file = makeSession('-project', ID_A, TIME, body);
      expect(await sessionFromFile(file, 'claude')).toEqual({
        source: 'claude',
        sessionId: ID_A,
        projectDir: '-project',
        jsonlPath: file,
      });
    },
  );

  it.each(['', ' \n\t\r\n'])('imports empty exports as Claude sessions: %j', async (body) => {
    const file = makeSession('-project', ID_A, TIME, body);
    expect(await sessionFromFile(file)).toEqual({
      source: 'claude',
      sessionId: ID_A,
      projectDir: '-project',
      jsonlPath: file,
    });
  });

  it.each(['user', 'assistant'])(
    'detects Claude from a %s event after blank, invalid and unrecognized lines',
    async (role) => {
      const record = {
        type: role,
        uuid: 'message-001',
        parentUuid: null,
        sessionId: ID_A,
        timestamp: '2026-04-20T10:00:00.000Z',
        cwd: '/work/project',
        message: { role, content: [{ type: 'text', text: 'Hello' }] },
      };
      const file = makeSession(
        '-project',
        ID_A,
        TIME,
        `\n \t\nnot valid JSON\nnull\n[]\n{}\n${JSON.stringify(record)}\n`,
      );
      expect(await sessionFromFile(file)).toEqual({
        source: 'claude',
        sessionId: ID_A,
        projectDir: '-project',
        jsonlPath: file,
      });
    },
  );

  it('resolves an explicitly selected symlink to the real JSONL file', async () => {
    const file = makeSession(
      '-project',
      ID_A,
      TIME,
      '{"type":"permission-mode","permissionMode":"default"}\n',
    );
    const alias = join(tmpRoot, 'export-alias.jsonl');
    symlinkSync(file, alias);
    expect(await sessionFromFile(alias)).toEqual({
      source: 'claude',
      sessionId: ID_A,
      projectDir: '-project',
      jsonlPath: file,
    });
  });

  it('rejects non-JSONL files, including aliases to non-JSONL targets', async () => {
    const file = join(tmpRoot, 'export.json');
    writeFileSync(file, '{}');
    const alias = join(tmpRoot, 'alias.jsonl');
    symlinkSync(file, alias);
    for (const candidate of [file, alias]) {
      await expect(sessionFromFile(candidate)).rejects.toThrow(
        'session file must have a .jsonl extension',
      );
    }
  });

  it('rejects directories with JSONL names', async () => {
    const directory = join(tmpRoot, 'directory.jsonl');
    mkdirSync(directory);
    await expect(sessionFromFile(directory)).rejects.toThrow('session file must be a regular file');
  });

  it('surfaces missing explicit files rather than silently returning nothing', async () => {
    await expect(sessionFromFile(join(tmpRoot, 'missing.jsonl'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('surfaces import realpath and metadata failures', async () => {
    const file = makeSession('-project');
    const realpathError = ioError('EACCES');
    vi.spyOn(fs, 'realpath').mockRejectedValueOnce(realpathError);
    await expect(sessionFromFile(file)).rejects.toBe(realpathError);
    const metadataError = ioError('EIO');
    vi.spyOn(fs, 'lstat').mockRejectedValueOnce(metadataError);
    await expect(sessionFromFile(file)).rejects.toBe(metadataError);
  });
});
