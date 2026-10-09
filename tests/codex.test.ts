import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendFileSync,
  constants,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import * as fs from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { extractSignals } from '../src/analyzer/signals.js';
import { readCodex } from '../src/reader/codex.js';
import { buildGraph } from '../src/reader/graph.js';
import { codexSource } from '../src/sources/codex.js';
import type { Logger } from '../src/utils/logger.js';

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
}));

const ID_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID_B = 'BBBBBBBB-0000-4000-8000-000000000002';
const ID_C = 'cccccccc-0000-4000-8000-000000000003';
const TIMESTAMP = '2025-01-02T03:04:05.000Z';
let temporary: string;
let root: string;

beforeEach(() => {
  temporary = realpathSync(mkdtempSync(join(tmpdir(), 'atree-codex-')));
  root = join(temporary, 'sessions');
  mkdirSync(root);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(temporary, { recursive: true, force: true });
});

function record(type: string, payload: unknown, extra: Record<string, unknown> = {}) {
  return { timestamp: TIMESTAMP, type, payload, ...extra };
}

function metadata(payload: Record<string, unknown> = {}) {
  return record('session_meta', {
    id: ID_A,
    cwd: '/work/project',
    cli_version: '0.160.0',
    source: 'cli',
    ...payload,
  });
}

function message(role: 'user' | 'assistant', text: string) {
  return record('response_item', {
    type: 'message',
    role,
    content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
  });
}

function fallback(role: 'user' | 'assistant', text: string) {
  return record('event_msg', {
    type: role === 'user' ? 'user_message' : 'agent_message',
    message: text,
  });
}

function transcript(lines: unknown[]): string {
  const path = join(temporary, 'import.jsonl');
  writeFileSync(
    path,
    lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n',
  );
  return path;
}

function rollout(
  id = ID_A,
  payload: Record<string, unknown> = {},
  parts = ['2025', '01', '02'],
  body?: string,
): string {
  const directory = join(root, ...parts);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `rollout-2025-01-02T03-04-05-${id}.jsonl`);
  writeFileSync(path, body ?? JSON.stringify(metadata({ id, ...payload })) + '\n');
  return path;
}

function ioError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error('synthetic filesystem failure'), { code });
}

function loggerSpy(): Logger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    level: 'warn',
  };
}

describe('Codex discovery', () => {
  it('reads bounded metadata and returns source, cwd, identity and file stats without sorting', async () => {
    const path = rollout(ID_A, { cwd: '/work/project/../project' });
    appendFileSync(path, 'a malformed later record is irrelevant to discovery\n');
    const open = vi.spyOn(fs, 'open');
    expect(await codexSource.discover({ root })).toEqual([
      {
        source: 'codex',
        sessionId: ID_A,
        projectDir: '/work/project/../project',
        jsonlPath: path,
        mtimeMs: statSync(path).mtimeMs,
        sizeBytes: statSync(path).size,
      },
    ]);
    expect(open).toHaveBeenCalledWith(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  });

  it('uses CODEX_HOME dynamically and gives an explicit root priority', async () => {
    const path = rollout();
    vi.stubEnv('CODEX_HOME', temporary);
    expect((await codexSource.discover({})).map((entry) => entry.jsonlPath)).toEqual([path]);
    vi.stubEnv('CODEX_HOME', join(temporary, 'other-home'));
    expect(await codexSource.discover({})).toEqual([]);
    expect((await codexSource.discover({ root })).map((entry) => entry.jsonlPath)).toEqual([path]);
  });

  it.each([undefined, ''])(
    'uses the home sessions directory when CODEX_HOME is %s without reading private logs',
    async (value) => {
      vi.stubEnv('CODEX_HOME', value);
      const lstat = vi.spyOn(fs, 'lstat').mockRejectedValue(ioError('ENOENT'));
      expect(await codexSource.discover({})).toEqual([]);
      expect(lstat).toHaveBeenCalledWith(join(homedir(), '.codex', 'sessions'));
    },
  );

  it('filters by resolved cwd rather than directory encoding', async () => {
    const cwd = join(temporary, 'project');
    const path = rollout(ID_A, { cwd: join(cwd, 'nested', '..') });
    rollout(ID_B, { cwd: `${cwd}-other` });
    expect(
      (await codexSource.discover({ root, projectCwd: relative(process.cwd(), cwd) })).map(
        (entry) => entry.jsonlPath,
      ),
    ).toEqual([path]);
    expect(await codexSource.discover({ root, projectCwd: '/missing/project' })).toEqual([]);
  });

  it('traverses exactly regular YYYY/MM/DD directories and rollout timestamp/UUID filenames', async () => {
    const accepted = rollout();
    for (const parts of [
      [],
      ['2025'],
      ['2025', '01'],
      ['2025', '01', '02', 'nested'],
      ['notes', '01', '02'],
      ['2025', '1', '02'],
      ['2025', '13', '02'],
      ['2025', '01', '00'],
    ]) {
      rollout(ID_B, {}, parts);
    }
    const directory = join(root, '2025', '01', '02');
    for (const name of [
      'notes.jsonl',
      `${ID_B}.jsonl`,
      `rollout-invalid-${ID_B}.jsonl`,
      'rollout-2025-01-02T03-04-05-not-a-uuid.jsonl',
      `rollout-2025-01-02T03-04-05-${ID_C}.JSONL`,
    ]) {
      writeFileSync(join(directory, name), JSON.stringify(metadata({ id: ID_B })));
    }
    mkdirSync(join(directory, `rollout-2025-01-02T03-04-05-${ID_B}.jsonl`));
    expect((await codexSource.discover({ root })).map((entry) => entry.jsonlPath)).toEqual([
      accepted,
    ]);
  });

  it.each([
    '',
    '{"type":"session_meta","payload":',
    '{}',
    '[]',
    JSON.stringify(record('response_item', { type: 'message', role: 'user', content: [] })),
    JSON.stringify(record('session_meta', { cwd: '/work' })),
    JSON.stringify(record('session_meta', { session_id: ID_A, cwd: '/work' })),
    JSON.stringify(metadata({ id: ID_B })),
    JSON.stringify(metadata({ session_id: 'not-a-uuid' })),
    JSON.stringify(metadata({ session_id: null })),
    JSON.stringify(metadata({ cwd: 9 })),
    JSON.stringify(metadata({ cwd: '' })),
    JSON.stringify(metadata({ base_instructions: 'x'.repeat(1024 * 1024) })),
  ])('skips malformed, mismatched or oversized first metadata (case %#)', async (body) => {
    rollout(ID_A, {}, undefined, body);
    expect(await codexSource.discover({ root })).toEqual([]);
  });

  it('uses the thread id independently of the root session_id and matches filenames case-insensitively', async () => {
    const path = rollout(
      ID_A,
      {},
      undefined,
      JSON.stringify(
        record('session_meta', {
          id: ID_A.toUpperCase(),
          session_id: ID_B,
          cwd: '/work/project',
        }),
      ),
    );
    expect(await codexSource.discover({ root })).toMatchObject([
      { sessionId: ID_A.toUpperCase(), jsonlPath: path },
    ]);
  });

  it('excludes subagents from discovery but allows explicit reading', async () => {
    const path = rollout(ID_A, {
      source: { subagent: { thread_spawn: { parent_thread_id: ID_B } } },
    });
    appendFileSync(path, JSON.stringify(message('user', 'Synthetic child task')) + '\n');
    rollout(ID_C, { source: 'subagent' });
    expect(await codexSource.discover({ root })).toEqual([]);
    expect((await codexSource.read(path)).events).toMatchObject([
      { type: 'user', isSidechain: true },
    ]);
  });

  it('skips symlink roots, date directories and rollout files', async () => {
    const accepted = rollout();
    const outside = join(temporary, 'outside');
    mkdirSync(outside);
    const external = join(outside, `rollout-2025-01-02T03-04-05-${ID_B}.jsonl`);
    writeFileSync(external, JSON.stringify(metadata({ id: ID_B })));
    symlinkSync(outside, join(root, '2024'), 'dir');
    symlinkSync(outside, join(root, '2025', '02'), 'dir');
    symlinkSync(outside, join(root, '2025', '01', '03'), 'dir');
    symlinkSync(external, join(root, '2025', '01', '02', basename(external)));
    symlinkSync(root, join(temporary, 'root-link'), 'dir');
    expect((await codexSource.discover({ root })).map((entry) => entry.jsonlPath)).toEqual([
      accepted,
    ]);
    expect(await codexSource.discover({ root: join(temporary, 'root-link') })).toEqual([]);
  });

  it('does not follow a file replaced by a symlink between lstat and open', async () => {
    const path = rollout();
    const moved = join(temporary, 'moved.jsonl');
    const original = fs.open;
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      renameSync(path, moved);
      symlinkSync(moved, path);
      return original(...args);
    });
    expect(await codexSource.discover({ root })).toEqual([]);
  });

  it.each([0, 1, 2, 3])(
    'discards directory replacement at depth %i even if the file inode survives',
    async (depth) => {
      const path = rollout();
      const components = ['2025', '01', '02', basename(path)];
      const replaced = join(root, ...components.slice(0, depth));
      const moved = join(temporary, 'moved-directory');
      const original = fs.open;
      vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
        const handle = await original(...args);
        renameSync(replaced, moved);
        mkdirSync(replaced);
        renameSync(join(moved, components[depth]), join(replaced, components[depth]));
        return handle;
      });
      expect(await codexSource.discover({ root })).toEqual([]);
    },
  );

  it.each(['ENOENT', 'ENOTDIR', 'ELOOP'])(
    'skips files lost during safe open (%s)',
    async (code) => {
      rollout();
      vi.spyOn(fs, 'open').mockRejectedValue(ioError(code));
      expect(await codexSource.discover({ root })).toEqual([]);
    },
  );

  it('surfaces unexpected directory and file IO errors', async () => {
    rollout();
    const directoryError = vi.spyOn(fs, 'readdir').mockRejectedValue(ioError('EACCES'));
    await expect(codexSource.discover({ root })).rejects.toMatchObject({ code: 'EACCES' });
    directoryError.mockRestore();
    vi.spyOn(fs, 'open').mockRejectedValue(ioError('EIO'));
    await expect(codexSource.discover({ root })).rejects.toMatchObject({ code: 'EIO' });
  });

  it('returns no entries for absent and nondirectory roots', async () => {
    const file = join(temporary, 'file');
    writeFileSync(file, 'not a directory');
    for (const path of [file, join(file, 'sessions'), join(temporary, 'missing')]) {
      expect(await codexSource.discover({ root: path })).toEqual([]);
    }
  });

  it('identifies Codex envelopes positively without claiming Claude or unknown JSON', () => {
    for (const type of [
      'session_meta',
      'turn_context',
      'response_item',
      'event_msg',
      'compacted',
    ]) {
      expect(codexSource.accepts(record(type, {}))).toBe(true);
    }
    for (const value of [
      {},
      { type: 'user', uuid: 'u' },
      { type: 'response_item', payload: [] },
      { type: { toString: null }, payload: {} },
    ]) {
      expect(codexSource.accepts(value)).toBe(false);
    }
  });
});

describe('Codex normalization', () => {
  it('preserves metadata and cwd changes, skips instructions, and does not invent source defaults', async () => {
    const path = transcript([
      metadata({
        permissionMode: 'plan',
        git: { branch: 'feature' },
        base_instructions: { text: 'PRIVATE_BASE_INSTRUCTIONS' },
      }),
      record('response_item', {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: 'PRIVATE_DEVELOPER_INSTRUCTIONS' }],
      }),
      record('response_item', {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: 'PRIVATE_SYSTEM_INSTRUCTIONS' }],
      }),
      message('user', 'Read the source'),
      record('turn_context', {
        cwd: '/work/second',
        approval_policy: 'on-request',
        turn_id: 'synthetic-turn',
      }),
      message('assistant', 'Read complete'),
    ]);
    const result = await readCodex(path, { strict: true });
    expect(result.meta).toEqual({ sessionId: ID_A, permissionMode: 'on-request' });
    expect(result.events).toMatchObject([
      {
        type: 'user',
        cwd: '/work/project',
        gitBranch: 'feature',
        version: '0.160.0',
        entrypoint: 'cli',
        userType: '',
      },
      { type: 'assistant', cwd: '/work/second', sessionId: ID_A },
    ]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    const minimal = await readCodex(
      transcript([record('session_meta', { id: ID_B, cwd: '/work' }), message('user', 'Hello')]),
    );
    expect(minimal.meta).toEqual({ sessionId: ID_B, permissionMode: '' });
    expect(minimal.events[0]).toMatchObject({
      version: '',
      gitBranch: '',
      entrypoint: '',
      userType: '',
    });
  });

  it('uses the thread id rather than a differing root session_id in strict mode', async () => {
    const result = await readCodex(
      transcript([
        metadata({ session_id: ID_B }),
        message('user', 'Hello'),
        metadata({ id: ID_A.toUpperCase(), session_id: ID_B.toLowerCase() }),
        message('assistant', 'Done'),
      ]),
      { strict: true },
    );
    expect(result.meta.sessionId).toBe(ID_A.toUpperCase());
    expect(result.events.map((event) => event.sessionId)).toEqual([ID_A, ID_A.toUpperCase()]);
    expect(result.malformedCount).toBe(0);
  });

  it('retains function/custom/local-shell calls and output pairings without counting event tool notifications', async () => {
    const outputs = [{ type: 'input_text', text: 'Read complete' }];
    const patch =
      '*** Begin Patch\n*** Add File: src/new.ts\n+new\n*** Update File: src/old.ts\n*** Move to: src/moved.ts\n@@\n-old\n+new\n*** Delete File: src/deleted.ts\n*** End Patch';
    const result = await readCodex(
      transcript([
        metadata(),
        record('response_item', {
          type: 'function_call',
          name: 'functions.read_file',
          arguments: '{"path":"src/input.ts"}',
          call_id: 'call-read',
        }),
        record('event_msg', {
          type: 'exec_command_begin',
          call_id: 'call-read',
          command: ['ignored'],
        }),
        record('response_item', {
          type: 'function_call_output',
          call_id: 'call-read',
          output: outputs,
        }),
        record('response_item', {
          type: 'custom_tool_call',
          name: 'apply_patch',
          input: patch,
          call_id: 'call-patch',
        }),
        record('event_msg', { type: 'patch_apply_begin', call_id: 'call-patch', changes: {} }),
        record('response_item', {
          type: 'custom_tool_call_output',
          call_id: 'call-patch',
          output: 'Success',
        }),
        record('response_item', {
          type: 'custom_tool_call',
          name: 'custom_language',
          input: 'raw custom syntax',
          call_id: 'call-custom',
        }),
        record('response_item', {
          type: 'local_shell_call',
          id: 'shell-id',
          action: { type: 'exec', command: ['pwd'], working_directory: '/work', timeout_ms: 1000 },
        }),
        record('response_item', {
          type: 'function_call_output',
          call_id: 'shell-id',
          output: '/work',
        }),
      ]),
      { strict: true },
    );
    expect(result.events.map((event) => event.type)).toEqual([
      'tool_use',
      'tool_result',
      'tool_use',
      'tool_result',
      'tool_use',
      'tool_use',
      'tool_result',
    ]);
    expect(result.events).toMatchObject([
      {
        tool_use: { id: 'call-read', name: 'functions.read_file', input: { path: 'src/input.ts' } },
      },
      {
        tool_result: {
          tool_use_id: 'call-read',
          content: [{ type: 'text', text: 'Read complete' }],
        },
      },
      {
        tool_use: {
          id: 'call-patch',
          name: 'apply_patch',
          input: {
            input: patch,
            paths: ['src/new.ts', 'src/old.ts', 'src/moved.ts', 'src/deleted.ts'],
          },
        },
      },
      { tool_result: { tool_use_id: 'call-patch', content: 'Success' } },
      { tool_use: { id: 'call-custom', name: 'custom_language', input: 'raw custom syntax' } },
      { tool_use: { id: 'shell-id', name: 'local_shell', input: { command: ['pwd'] } } },
      { tool_result: { tool_use_id: 'shell-id', content: '/work' } },
    ]);
    expect(extractSignals(result.events)[2].files).toEqual([
      'src/new.ts',
      'src/old.ts',
      'src/moved.ts',
      'src/deleted.ts',
    ]);
  });

  it.each(['function_call_output', 'custom_tool_call_output'])(
    'projects only public text from %s arrays',
    async (type) => {
      const result = await readCodex(
        transcript([
          record('response_item', {
            type,
            call_id: 'c',
            output: [
              { type: 'input_text', text: 'ok', encrypted_content: 'PRIVATE_CIPHERTEXT' },
              { type: 'reasoning', encrypted_content: 'PRIVATE_CIPHERTEXT' },
              { type: 'output_text', text: 'done', opaque: { content: 'PRIVATE_OPAQUE' } },
              { type: 'future_output', content: 'PRIVATE_FUTURE' },
            ],
          }),
        ]),
        { strict: true },
      );
      expect(result.events).toMatchObject([
        {
          type: 'tool_result',
          tool_result: {
            tool_use_id: 'c',
            content: [
              { type: 'text', text: 'ok' },
              { type: 'text', text: 'done' },
            ],
          },
        },
      ]);
      expect(result.malformedCount).toBe(0);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    },
  );

  it('treats nullable local-shell working_directory and timeout_ms as absent in strict mode', async () => {
    const logger = loggerSpy();
    const result = await readCodex(
      transcript([
        record('response_item', {
          type: 'local_shell_call',
          call_id: 'c',
          action: { type: 'exec', command: ['pwd'], working_directory: null, timeout_ms: null },
        }),
      ]),
      { strict: true, logger },
    );
    expect(result.events[0]).toMatchObject({
      type: 'tool_use',
      tool_use: { id: 'c', name: 'local_shell' },
    });
    expect(result.events[0].type === 'tool_use' && result.events[0].tool_use.input).toEqual({
      type: 'exec',
      command: ['pwd'],
    });
    expect(result.malformedCount).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('extracts namespaced function apply_patch paths without duplicate or added-content headers', async () => {
    const patch =
      '*** Update File: a.ts\r\n*** Move to: b.ts\r\n+*** Add File: not-a-path\n*** Delete File: a.ts\n*** Add File: space name.ts';
    const result = await readCodex(
      transcript([
        record('response_item', {
          type: 'function_call',
          name: 'functions.apply_patch',
          call_id: 'patch',
          arguments: JSON.stringify({ patch, paths: ['existing.ts', 'a.ts'] }),
        }),
      ]),
    );
    expect(extractSignals(result.events)[0].files).toEqual([
      'existing.ts',
      'a.ts',
      'b.ts',
      'space name.ts',
    ]);
  });

  it.each(['canonical-first', 'event-first'])(
    'deduplicates messages by occurrence, including identical repeated turns (%s)',
    async (order) => {
      const lines: unknown[] = [metadata()];
      for (let turn = 0; turn < 3; turn += 1) {
        for (const role of ['user', 'assistant'] as const) {
          const canonical = message(role, role === 'user' ? 'Again' : 'Done');
          const event = fallback(role, role === 'user' ? 'Again' : 'Done');
          lines.push(...(order === 'canonical-first' ? [canonical, event] : [event, canonical]));
        }
      }
      const result = await readCodex(transcript(lines));
      expect(result.events.map((event) => event.type)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
        'user',
        'assistant',
      ]);
      expect(result.skippedMetaCount).toBe(6);
    },
  );

  it('preserves unmatched fallback occurrences and repeated canonical messages in a batch', async () => {
    const result = await readCodex(
      transcript([
        metadata(),
        fallback('user', 'Repeat'),
        fallback('user', 'Repeat'),
        fallback('user', 'Repeat'),
        message('user', 'Repeat'),
        message('user', 'Repeat'),
        message('assistant', 'Canonical only'),
        message('assistant', 'Canonical only'),
        fallback('assistant', 'Fallback only'),
      ]),
    );
    expect(extractSignals(result.events).map((signal) => signal.text)).toEqual([
      'Repeat',
      'Repeat',
      'Repeat',
      'Canonical only',
      'Canonical only',
      'Fallback only',
    ]);
  });

  it('does not pair identical text across different explicit turns', async () => {
    const result = await readCodex(
      transcript([
        record('turn_context', { cwd: '/work', turn_id: 'turn-one' }),
        fallback('user', 'Again'),
        record('turn_context', { cwd: '/work', turn_id: 'turn-two' }),
        message('user', 'Again'),
      ]),
    );
    expect(result.events.map((event) => event.type)).toEqual(['user', 'user']);
  });

  it('does not pair unidentified turns across intervening opposite-role messages', async () => {
    const result = await readCodex(
      transcript([
        message('user', 'Again'),
        message('assistant', 'Done'),
        fallback('user', 'Again'),
      ]),
    );
    expect(result.events.map((event) => event.type)).toEqual(['user', 'assistant', 'user']);
  });

  it('stops inheriting an explicit turn id when a new turn_context has none', async () => {
    const result = await readCodex(
      transcript([
        record('turn_context', { cwd: '/work', turn_id: 't' }),
        message('user', 'Again'),
        record('turn_context', { cwd: '/work' }),
        message('assistant', 'Done'),
        fallback('user', 'Again'),
      ]),
      { strict: true },
    );
    expect(result.events.map((event) => event.type)).toEqual(['user', 'assistant', 'user']);
  });

  it.each(['canonical-first', 'event-first'])(
    'matches interleaved roles independently within an explicit turn (%s)',
    async (order) => {
      const canonical = [message('user', 'Q'), message('assistant', 'A')];
      const notifications = [fallback('user', 'Q'), fallback('assistant', 'A')];
      const result = await readCodex(
        transcript([
          record('turn_context', { cwd: '/work', turn_id: 't' }),
          ...(order === 'canonical-first'
            ? [...canonical, ...notifications]
            : [...notifications, ...canonical]),
        ]),
        { strict: true },
      );
      expect(result.events.map((event) => event.type)).toEqual(['user', 'assistant']);
      expect(extractSignals(result.events).map((signal) => signal.text)).toEqual(['Q', 'A']);
      expect(result.skippedMetaCount).toBe(3);
    },
  );

  it.each(['canonical-first', 'event-first'])(
    'preserves repeated occurrences in interleaved explicit turns (%s)',
    async (order) => {
      const lines: unknown[] = [metadata()];
      for (const turnId of ['one', 'two']) {
        const canonical = [
          message('user', 'Again'),
          message('user', 'Again'),
          message('assistant', 'Done'),
        ];
        const notifications = [
          fallback('user', 'Again'),
          fallback('assistant', 'Done'),
          fallback('user', 'Again'),
        ];
        lines.push(record('turn_context', { cwd: '/work', turn_id: turnId }));
        lines.push(
          ...(order === 'canonical-first'
            ? [...canonical, ...notifications]
            : [...notifications, ...canonical]),
        );
      }
      const result = await readCodex(transcript(lines), { strict: true });
      const expectedTurn =
        order === 'canonical-first' ? ['user', 'user', 'assistant'] : ['user', 'assistant', 'user'];
      expect(result.events.map((event) => event.type)).toEqual([...expectedTurn, ...expectedTurn]);
      expect(new Set(result.events.map((event) => event.uuid)).size).toBe(6);
      expect(result.skippedMetaCount).toBe(8);
    },
  );

  it.each(['canonical-first', 'event-first'])(
    'preserves legitimate identical messages across compaction (%s)',
    async (order) => {
      const canonical = message('assistant', 'Done');
      const notification = fallback('assistant', 'Done');
      const [before, after] =
        order === 'canonical-first' ? [canonical, notification] : [notification, canonical];
      const result = await readCodex(
        transcript([before, record('compacted', { message: 'Summary' }), after]),
        { strict: true },
      );
      expect(result.events).toMatchObject([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
        { type: 'system', payload: { type: 'compaction', message: 'Summary' } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
      ]);
      expect(result.skippedMetaCount).toBe(0);
    },
  );

  it.each([
    [
      'function call',
      record('response_item', {
        type: 'function_call',
        name: 'read',
        call_id: 'c',
        arguments: '{}',
      }),
    ],
    [
      'custom call',
      record('response_item', {
        type: 'custom_tool_call',
        name: 'patch',
        call_id: 'c',
        input: 'patch',
      }),
    ],
    [
      'shell call',
      record('response_item', {
        type: 'local_shell_call',
        call_id: 'c',
        action: { type: 'exec', command: ['pwd'] },
      }),
    ],
    [
      'function output',
      record('response_item', { type: 'function_call_output', call_id: 'c', output: 'ok' }),
    ],
    [
      'custom output',
      record('response_item', { type: 'custom_tool_call_output', call_id: 'c', output: 'ok' }),
    ],
    [
      'tool notification',
      record('event_msg', { type: 'exec_command_begin', call_id: 'c', command: ['pwd'] }),
    ],
    ['compaction in an explicit turn', record('compacted', { message: 'Summary' })],
  ] as const)(
    'does not match repeated text across %s even with an explicit turn id',
    async (_name, activity) => {
      const result = await readCodex(
        transcript([
          record('turn_context', { cwd: '/work', turn_id: 't' }),
          fallback('assistant', 'Done'),
          activity,
          message('assistant', 'Done'),
        ]),
        { strict: true },
      );
      expect(result.events.filter((event) => event.type === 'assistant')).toHaveLength(2);
      expect(
        result.events.filter(
          (event) =>
            event.type === 'tool_use' || event.type === 'tool_result' || event.type === 'system',
        ),
      ).toHaveLength(activity.type === 'event_msg' ? 0 : 1);
    },
  );

  it('keeps fallback-only repeated messages and ignores progress/tool event duplicates', async () => {
    const result = await readCodex(
      transcript([
        fallback('user', 'Again'),
        fallback('assistant', 'Done'),
        record('event_msg', { type: 'agent_message_delta', delta: 'Done' }),
        record('event_msg', {
          type: 'exec_command_end',
          call_id: 'notification',
          output: 'not a call',
        }),
        fallback('user', 'Again'),
        fallback('assistant', 'Done'),
      ]),
    );
    expect(result.events.map((event) => event.type)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('exposes only public reasoning summaries and marks compaction without replaying history', async () => {
    const result = await readCodex(
      transcript([
        metadata({ base_instructions: 'PRIVATE_BASE_INSTRUCTIONS' }),
        record('response_item', {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Public summary' }],
          encrypted_content: 'PRIVATE_CIPHERTEXT',
          content: [{ type: 'reasoning_text', text: 'PRIVATE_REASONING' }],
        }),
        record('response_item', {
          type: 'reasoning',
          summary: [],
          encrypted_content: 'PRIVATE_CIPHERTEXT',
        }),
        record('response_item', {
          type: 'agent_message',
          encrypted_content: 'PRIVATE_AGENT_CONTENT',
          content: [{ text: 'PRIVATE_UNKNOWN_CONTENT' }],
        }),
        record('compacted', {
          message: 'Compacted public summary',
          replacement_history: [message('user', 'PRIVATE_REPLACEMENT_REQUEST').payload],
        }),
        message('user', 'Continue'),
      ]),
      { strict: true },
    );
    expect(result.events).toMatchObject([
      { type: 'system', payload: { type: 'reasoning', summary: 'Public summary' } },
      { type: 'system', payload: { type: 'compaction', message: 'Compacted public summary' } },
      { type: 'user' },
    ]);
    expect(result.events.filter((event) => event.type === 'user')).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  });

  it('generates unique, deterministic line identities and a single chain through resumes and appends', async () => {
    const repeated = message('user', 'Identical physical content');
    const path = transcript([
      metadata(),
      { ...repeated, ordinal: 0 },
      '',
      '{"unfinished":',
      { ...repeated, ordinal: 0 },
    ]);
    const first = await readCodex(path);
    const again = await readCodex(path);
    expect(first.events.map((event) => event.uuid)).toEqual(
      again.events.map((event) => event.uuid),
    );
    expect(new Set(first.events.map((event) => event.uuid)).size).toBe(2);
    for (const event of first.events)
      expect(event.uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    appendFileSync(
      path,
      JSON.stringify(metadata()) + '\n' + JSON.stringify({ ...repeated, ordinal: 0 }) + '\n',
    );
    const appended = await readCodex(path);
    expect(appended.events.slice(0, 2)).toEqual(first.events);
    expect(appended.events[2].parentUuid).toBe(first.events[1].uuid);
    const graph = buildGraph(appended.meta, appended.events);
    expect(graph.roots).toEqual([appended.events[0].uuid]);
    expect(graph.byUuid.size).toBe(3);
    expect(graph.childrenOf.get(appended.events[0].uuid)).toEqual([appended.events[1].uuid]);
  });

  it('does not renumber canonical IDs when a later fallback copy is appended', async () => {
    const path = transcript([metadata(), message('user', 'Hello')]);
    const initial = await readCodex(path);
    appendFileSync(path, JSON.stringify(fallback('user', 'Hello')) + '\n');
    expect((await readCodex(path)).events).toEqual(initial.events);
  });

  it('does not replace fallback IDs when a later canonical copy is appended', async () => {
    const path = transcript([metadata(), fallback('user', 'Hello')]);
    const initial = await readCodex(path);
    appendFileSync(path, JSON.stringify(message('user', 'Hello')) + '\n');
    expect((await readCodex(path)).events).toEqual(initial.events);
  });

  it('promotes canonical payloads while preserving first occurrence order, timestamps and graph identities after append', async () => {
    const path = transcript([
      metadata(),
      record('turn_context', { cwd: '/work', turn_id: 't' }),
      fallback('user', 'First\nSecond'),
      fallback('assistant', 'Answer'),
    ]);
    const initial = await readCodex(path, { strict: true });
    appendFileSync(
      path,
      JSON.stringify(
        record(
          'response_item',
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: 'First' },
              { type: 'input_text', text: 'Second' },
            ],
          },
          { timestamp: '2025-01-02T03:04:06.000Z' },
        ),
      ) + '\n',
    );
    const appended = await readCodex(path, { strict: true });
    expect(appended.events).toEqual([
      {
        ...initial.events[0],
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'First' },
            { type: 'text', text: 'Second' },
          ],
        },
      },
      initial.events[1],
    ]);
    const graph = buildGraph(appended.meta, appended.events);
    expect(graph.roots).toEqual([initial.events[0].uuid]);
    expect(graph.childrenOf.get(initial.events[0].uuid)).toEqual([initial.events[1].uuid]);
  });
});

describe('Codex validation', () => {
  const malformed = [
    ['missing timestamp', { type: 'session_meta', payload: { id: ID_A, cwd: '/work' } }],
    [
      'invalid timestamp',
      record(
        'event_msg',
        { type: 'agent_message', message: 'Hello' },
        { timestamp: 'DO_NOT_LEAK' },
      ),
    ],
    [
      'invalid ordinal',
      record('event_msg', { type: 'agent_message', message: 'Hello' }, { ordinal: -1 }),
    ],
    ['missing id', record('session_meta', { cwd: '/work' })],
    ['missing id with root session_id', record('session_meta', { session_id: ID_A, cwd: '/work' })],
    ['invalid id', metadata({ id: 'DO_NOT_LEAK' })],
    ['invalid root session_id', metadata({ session_id: 'DO_NOT_LEAK' })],
    ['null root session_id', metadata({ session_id: null })],
    ['missing cwd', record('session_meta', { id: ID_A })],
    ['turn cwd', record('turn_context', { cwd: 7 })],
    ['payload', record('response_item', [])],
    ['item type', record('response_item', {})],
    ['role', record('response_item', { type: 'message', content: [] })],
    ['content', record('response_item', { type: 'message', role: 'user' })],
    [
      'text',
      record('response_item', {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: {} }],
      }),
    ],
    [
      'tool name',
      record('response_item', { type: 'function_call', call_id: 'call', arguments: '{}' }),
    ],
    ['call id', record('response_item', { type: 'function_call', name: 'read', arguments: '{}' })],
    [
      'arguments JSON',
      record('response_item', {
        type: 'function_call',
        name: 'read',
        call_id: 'call',
        arguments: 'DO_NOT_LEAK',
      }),
    ],
    [
      'arguments type',
      record('response_item', {
        type: 'function_call',
        name: 'read',
        call_id: 'call',
        arguments: {},
      }),
    ],
    [
      'custom input',
      record('response_item', {
        type: 'custom_tool_call',
        name: 'custom',
        call_id: 'call',
        input: 7,
      }),
    ],
    [
      'output',
      record('response_item', { type: 'function_call_output', call_id: 'call', output: {} }),
    ],
    ['output id', record('response_item', { type: 'custom_tool_call_output', output: 'done' })],
    ['shell action', record('response_item', { type: 'local_shell_call', call_id: 'call' })],
    [
      'shell command',
      record('response_item', {
        type: 'local_shell_call',
        call_id: 'call',
        action: { type: 'exec', command: 'pwd' },
      }),
    ],
    [
      'shell working directory',
      record('response_item', {
        type: 'local_shell_call',
        call_id: 'call',
        action: { type: 'exec', command: ['pwd'], working_directory: 7 },
      }),
    ],
    [
      'shell timeout type',
      record('response_item', {
        type: 'local_shell_call',
        call_id: 'call',
        action: { type: 'exec', command: ['pwd'], timeout_ms: 'DO_NOT_LEAK' },
      }),
    ],
    [
      'shell negative timeout',
      record('response_item', {
        type: 'local_shell_call',
        call_id: 'call',
        action: { type: 'exec', command: ['pwd'], timeout_ms: -1 },
      }),
    ],
    ['reasoning summary', record('response_item', { type: 'reasoning', summary: {} })],
    ['compaction summary', record('compacted', { replacement_history: [] })],
    ['event message', record('event_msg', { type: 'user_message', message: {} })],
    ['permission mode', metadata({ permissionMode: 7 })],
  ] as const;

  it.each(malformed)(
    'strictly validates %s without disclosing source values',
    async (_name, line) => {
      const path = transcript([line]);
      await expect(readCodex(path, { strict: true })).rejects.toThrow(
        'codex jsonl error at line 1',
      );
      try {
        await readCodex(path, { strict: true });
      } catch (error) {
        expect(String(error)).not.toContain('DO_NOT_LEAK');
      }
      const logger = loggerSpy();
      const result = await readCodex(path, { logger });
      expect(result.malformedCount).toBe(1);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('DO_NOT_LEAK');
    },
  );

  it('does not recover a missing thread id from root session_id in tolerant mode', async () => {
    const result = await readCodex(
      transcript([
        record('session_meta', { session_id: ID_A, cwd: '/work' }),
        message('user', 'Hello'),
      ]),
    );
    expect(result.meta.sessionId).toBe('');
    expect(result.events[0].sessionId).toBe('');
    expect(result.malformedCount).toBe(1);
  });

  it('continues rejecting a changed thread id regardless of root session_id', async () => {
    const path = transcript([
      metadata({ session_id: ID_C }),
      metadata({ id: ID_B, session_id: ID_C }),
      message('user', 'Hello'),
    ]);
    await expect(readCodex(path, { strict: true })).rejects.toThrow('session metadata id changed');
    const result = await readCodex(path);
    expect(result.meta.sessionId).toBe(ID_A);
    expect(result.events[0].sessionId).toBe(ID_A);
    expect(result.malformedCount).toBe(1);
  });

  describe.each(['function_call_output', 'custom_tool_call_output'])('%s arrays', (type) => {
    it.each([null, {}, { type: 7 }, { type: 'input_text', text: {} }, { type: 'output_text' }])(
      'rejects malformed public blocks in strict mode (case %#)',
      async (block) => {
        const logger = loggerSpy();
        const path = transcript([
          record('response_item', {
            type,
            call_id: 'c',
            output: [block, { type: 'input_text', text: 'Keep this' }],
          }),
        ]);
        await expect(readCodex(path, { strict: true })).rejects.toThrow(
          'codex jsonl error at line 1',
        );
        const result = await readCodex(path, { logger });
        expect(result.malformedCount).toBe(1);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(result.events).toMatchObject([
          {
            type: 'tool_result',
            tool_result: { tool_use_id: 'c', content: [{ type: 'text', text: 'Keep this' }] },
          },
        ]);
      },
    );
  });

  it('counts each physical malformed line once and recovers valid public blocks', async () => {
    const logger = loggerSpy();
    const path = transcript([
      metadata(),
      '{"DO_NOT_LEAK":',
      '[]',
      {
        type: 'response_item',
        timestamp: {},
        ordinal: 'DO_NOT_LEAK',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            null,
            { type: 'input_text', text: {} },
            { type: 'input_text', text: 'Keep this' },
          ],
        },
      },
      message('assistant', 'Intact'),
    ]);
    const result = await readCodex(path, { logger });
    expect(result.malformedCount).toBe(3);
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(extractSignals(result.events).map((signal) => signal.text)).toEqual([
      'Keep this',
      'Intact',
    ]);
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('DO_NOT_LEAK');
  });

  it('tolerates future metadata and opaque content without retaining it', async () => {
    const result = await readCodex(
      transcript([
        { type: 'future_rollout_record', payload: 'PRIVATE_FUTURE_METADATA' },
        record('response_item', { type: 'future_item', extra: 'PRIVATE_FUTURE_ITEM' }),
        record('event_msg', { type: 'future_notification', message: 'PRIVATE_FUTURE_EVENT' }),
        record('response_item', {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'future_content', content: 'PRIVATE_FUTURE_CONTENT' },
            { type: 'output_text', text: 'Public answer' },
          ],
        }),
      ]),
      { strict: true },
    );
    expect(result.malformedCount).toBe(0);
    expect(result.skippedMetaCount).toBe(3);
    expect(extractSignals(result.events).map((signal) => signal.text)).toEqual(['Public answer']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  });

  it('handles empty logs and keeps complete events before a truncated final physical line', async () => {
    expect(await readCodex(transcript([]), { strict: true })).toEqual({
      meta: { sessionId: '', permissionMode: '' },
      events: [],
      malformedCount: 0,
      skippedMetaCount: 0,
    });
    const path = transcript([metadata(), message('user', 'Complete')]);
    appendFileSync(path, '{"type":"response_item","payload":');
    const result = await readCodex(path);
    expect(result.events).toHaveLength(1);
    expect(result.malformedCount).toBe(1);
    await expect(readCodex(path, { strict: true })).rejects.toThrow('line 3');
  });

  it('handles BOM, CRLF, blank lines and complete last lines without a newline', async () => {
    const path = join(temporary, 'line-endings.jsonl');
    writeFileSync(
      path,
      '\uFEFF' + JSON.stringify(metadata()) + '\r\n\r\n' + JSON.stringify(message('user', 'Hello')),
    );
    const result = await readCodex(path, { strict: true });
    expect(result.malformedCount).toBe(0);
    expect(result.events).toHaveLength(1);
  });

  it('surfaces missing-file IO errors', async () => {
    await expect(readCodex(join(temporary, 'missing.jsonl'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
