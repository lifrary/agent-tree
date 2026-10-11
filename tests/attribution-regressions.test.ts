import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as pipeline from '../src/cli/pipeline.js';
import { DEFAULT_CONFIG, mergeConfig } from '../src/config/schema.js';
import { readCodex } from '../src/reader/codex.js';
import { mapSession, type MapContext } from '../src/search/map.js';
import { createMatcher } from '../src/search/matcher.js';
import { codexSource, nativeCodexEntry } from '../src/sources/codex.js';
import { findSpawnEvent } from '../src/sources/relations.js';
import type { SessionEntry } from '../src/sources/types.js';
import type { RawEvent } from '../src/types.js';
import { codexSubagentSignature, readCodexSubagents } from '../src/usage/codex_subagents.js';
import { defaultRedactor } from '../src/utils/redact.js';
import * as sessionPaths from '../src/utils/session_path.js';

// Built-in ESM namespace exports are non-configurable. A module-local facade
// lets permission/race tests intercept calls without relying on the runner UID.
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
}));

const ROOT = 'aaaaaaaa-abcd-4abc-8abc-aaaaaaaaaaaa';
const CHILD = 'bbbbbbbb-abcd-4abc-8abc-bbbbbbbbbbbb';
const OTHER = 'cccccccc-abcd-4abc-8abc-cccccccccccc';
const MARKER = 'ATTRIBUTION_CHILD_MARKER';
const at = (second: number) => new Date(Date.UTC(2026, 9, 1, 10, 0, second)).toISOString();
let temporary: string;
let home: string;
let project: string;

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'atree-attribution-'));
  home = join(temporary, 'codex');
  project = join(temporary, 'project');
  mkdirSync(project);
  vi.stubEnv('CODEX_HOME', home);
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(temporary, 'claude'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(temporary, { recursive: true, force: true });
});

function ioError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error('synthetic filesystem failure'), { code });
}

function envelope(uuid: string) {
  return {
    uuid,
    parentUuid: null,
    isSidechain: false,
    timestamp: at(1),
    sessionId: ROOT,
    cwd: project,
    gitBranch: '',
    version: '',
    entrypoint: '',
    userType: '',
  };
}

function childEntry(source: 'claude' | 'codex', toolUseId?: string): SessionEntry {
  return {
    source,
    sessionId: CHILD,
    projectDir: project,
    jsonlPath: 'synthetic-child.jsonl',
    mtimeMs: 0,
    sizeBytes: 0,
    subagent: { id: CHILD, parentSessionId: ROOT, ...(toolUseId ? { toolUseId } : {}) },
  };
}

function claudeCall(uuid = 'claude-call'): RawEvent {
  return {
    ...envelope(uuid),
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'spawn', name: 'Agent', input: {} }],
    },
  };
}

function claudeResult(uuid = 'claude-result') {
  return {
    ...envelope(uuid),
    type: 'user' as const,
    message: { role: 'user' as const, content: [] },
    toolUseResult: { agentId: CHILD },
  };
}

function codexCall(id = 'spawn', uuid = 'codex-call', name = 'spawn_agent'): RawEvent {
  return { ...envelope(uuid), type: 'tool_use', tool_use: { id, name, input: {} } };
}

function codexResult(
  id = 'spawn',
  content: unknown = JSON.stringify({ agent_id: CHILD }),
): RawEvent {
  return {
    ...envelope(`result-${id}`),
    type: 'tool_result',
    tool_result: { tool_use_id: id, content },
  };
}

function record(type: string, payload: unknown, second = 0) {
  return { type, timestamp: at(second), payload };
}

function message(text: string, role = 'user') {
  return record(
    'response_item',
    {
      type: 'message',
      role,
      content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
    },
    role === 'user' ? 1 : 2,
  );
}

function spawn() {
  return [
    record(
      'response_item',
      {
        type: 'function_call',
        call_id: 'spawn',
        name: 'spawn_agent',
        arguments: '{}',
      },
      3,
    ),
    record(
      'response_item',
      {
        type: 'function_call_output',
        call_id: 'spawn',
        output: JSON.stringify({ agent_id: CHILD }),
      },
      4,
    ),
  ];
}

function usage(response: string, input = 10) {
  return record(
    'token_usage_record',
    {
      thread_id: CHILD,
      response_id: response,
      usage: {
        input_tokens: input,
        cached_input_tokens: 0,
        output_tokens: 2,
        reasoning_output_tokens: 0,
      },
    },
    5,
  );
}

function rollout(
  id: string,
  options: {
    parent?: string;
    archived?: boolean;
    directory?: string;
    cwd?: string;
    lines?: unknown[];
  } = {},
): string {
  const directory =
    options.directory ??
    join(home, ...(options.archived ? ['archived_sessions'] : ['sessions', '2026', '10', '01']));
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `rollout-2026-10-01T10-00-00-${id}.jsonl`);
  const header = record('session_meta', {
    id,
    cwd: options.cwd ?? project,
    source: options.parent
      ? { subagent: { thread_spawn: { parent_thread_id: options.parent } } }
      : 'cli',
  });
  writeFileSync(
    file,
    [header, ...(options.lines ?? [])].map((line) => JSON.stringify(line)).join('\n') + '\n',
  );
  return file;
}

function mapContext(entries: SessionEntry[] = []): MapContext {
  return {
    matcher: createMatcher(MARKER),
    redactor: defaultRedactor(),
    includeToolOutput: false,
    config: mergeConfig(DEFAULT_CONFIG, {
      cache: { enabled: false, dir: join(temporary, 'cache') },
    }),
    cwd: project,
    entries,
    relatedEntries: new Map(),
  };
}

async function usageAt(file: string) {
  const result = await readCodex(file);
  return readCodexSubagents(file, result.events, result.usage ?? []);
}

describe('unique source-occurrence spawn attribution', () => {
  it.each(['same UUID', 'distinct UUID'])(
    'rejects duplicated Claude toolUseId occurrences (%s)',
    (kind) => {
      const call = claudeCall();
      const duplicate = claudeCall(kind === 'same UUID' ? call.uuid : 'another-call');
      expect(
        findSpawnEvent([call, claudeResult(), duplicate], childEntry('claude', 'spawn')),
      ).toBeNull();
    },
  );

  it('rejects duplicate tool blocks within one Claude source event', () => {
    const call = claudeCall();
    if (call.type !== 'assistant' || !Array.isArray(call.message.content))
      throw new Error('invalid fixture');
    call.message.content.push({ ...call.message.content[0] });
    expect(findSpawnEvent([call, claudeResult()], childEntry('claude', 'spawn'))).toBeNull();
  });

  it.each([undefined, 'missing-tool'])(
    'rejects ambiguous Claude agentId fallback (%s)',
    (toolUseId) => {
      const result = claudeResult();
      expect(findSpawnEvent([result], childEntry('claude', toolUseId))).toBe(result.uuid);
      expect(findSpawnEvent([result, { ...result }], childEntry('claude', toolUseId))).toBeNull();
      expect(
        findSpawnEvent([result, claudeResult('another-result')], childEntry('claude', toolUseId)),
      ).toBeNull();
    },
  );

  it('keeps a unique explicit Claude tool link stronger than fallback results', () => {
    const call = claudeCall();
    expect(
      findSpawnEvent(
        [claudeResult(), call, claudeResult('another-result')],
        childEntry('claude', 'spawn'),
      ),
    ).toBe(call.uuid);
  });

  it.each(['same UUID', 'distinct UUID', 'wait'])(
    'rejects Codex call ID reuse after a prior result (%s)',
    (kind) => {
      const call = codexCall();
      const duplicate = codexCall(
        'spawn',
        kind === 'same UUID' ? call.uuid : 'another-call',
        kind === 'wait' ? 'wait' : 'spawn_agent',
      );
      expect(findSpawnEvent([call, codexResult(), duplicate], childEntry('codex'))).toBeNull();
      expect(findSpawnEvent([call, duplicate, codexResult()], childEntry('codex'))).toBeNull();
    },
  );

  it('rejects distinct spawning occurrences for one child even when their event UUIDs match', () => {
    const first = codexCall();
    expect(
      findSpawnEvent(
        [first, codexResult(), codexCall('second', first.uuid), codexResult('second')],
        childEntry('codex'),
      ),
    ).toBeNull();
  });

  it('accepts repeated results for one unique spawn, but not wait/resume, reversed results, or text', () => {
    const call = codexCall('spawn', 'call', 'functions.spawn_agent');
    const result = codexResult('spawn', [
      { type: 'text', text: JSON.stringify({ thread_id: CHILD.toUpperCase() }) },
    ]);
    expect(findSpawnEvent([call, result, { ...result }], childEntry('codex'))).toBe(call.uuid);
    expect(findSpawnEvent([result, call], childEntry('codex'))).toBeNull();
    for (const name of [
      'wait',
      'resume_agent',
      'functions.wait',
      'functions.resume_agent',
      'other.spawn_agent',
    ]) {
      expect(
        findSpawnEvent([codexCall('spawn', 'call', name), result], childEntry('codex')),
      ).toBeNull();
    }
    for (const output of [
      `agent_id: ${CHILD}`,
      JSON.stringify({ text: CHILD }),
      `prefix {"agent_id":"${CHILD}"}`,
    ]) {
      expect(findSpawnEvent([call, codexResult('spawn', output)], childEntry('codex'))).toBeNull();
    }
  });
});

describe('optional search parent resolution', () => {
  it.each(['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'ESTALE'])(
    'retains child hits and caches optional parent discovery rejection (%s)',
    async (code) => {
      const file = rollout(CHILD, {
        parent: ROOT,
        lines: [message(MARKER), message('Working.', 'assistant')],
      });
      const child = (await nativeCodexEntry(file))!;
      const discover = vi.spyOn(sessionPaths, 'listSessions').mockRejectedValue(ioError(code));
      const ctx = mapContext([child]);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await mapSession(child, ctx);
        expect(result?.hits[0].snippet).toContain(MARKER);
        expect(result?.subagent).toEqual({
          id: CHILD,
          parent_session_id: ROOT,
          parent_file: null,
          parent_step: null,
        });
      }
      expect(discover).toHaveBeenCalledTimes(1);
      expect(ctx.relatedEntries?.get('codex')).toBe(discover.mock.results[0].value);
    },
  );

  it('keeps cross-project fallback same-source and reuses its discovery promise', async () => {
    const parent = rollout(ROOT, {
      cwd: join(temporary, 'other-project'),
      lines: [message('Delegate review'), ...spawn()],
    });
    const file = rollout(CHILD, {
      parent: ROOT,
      lines: [message(MARKER), message('Working.', 'assistant')],
    });
    const child = (await nativeCodexEntry(file))!;
    const realParent = (await nativeCodexEntry(parent))!;
    const discover = vi
      .spyOn(sessionPaths, 'listSessions')
      .mockResolvedValue([
        { ...realParent, source: 'claude', jsonlPath: join(temporary, 'wrong-source.jsonl') },
        realParent,
      ]);
    const ctx = mapContext([child]);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await mapSession(child, ctx))?.subagent).toMatchObject({
        parent_file: parent,
        parent_step: expect.any(Number),
      });
    }
    expect(discover).toHaveBeenCalledExactlyOnceWith({
      source: 'codex',
      includeSubagents: true,
      includeArchived: true,
    });
  });

  it.each(['discovery', 'parent pipeline'])(
    'propagates unexpected errors from optional %s',
    async (stage) => {
      const parent = rollout(ROOT, { lines: [message('Delegate review'), ...spawn()] });
      const file = rollout(CHILD, {
        parent: ROOT,
        lines: [message(MARKER), message('Working.', 'assistant')],
      });
      const child = (await nativeCodexEntry(file))!;
      const ctx = mapContext([child]);
      const bug = new TypeError('synthetic programming error');
      if (stage === 'discovery') {
        vi.spyOn(sessionPaths, 'listSessions').mockRejectedValue(bug);
      } else {
        ctx.entries!.push((await nativeCodexEntry(parent))!);
        const original = pipeline.runPipeline;
        vi.spyOn(pipeline, 'runPipeline').mockImplementation(async (options) => {
          if (options.match.jsonlPath === parent) throw bug;
          return original(options);
        });
      }
      await expect(mapSession(child, ctx)).rejects.toBe(bug);
    },
  );
});

describe('per-entry Codex catalog isolation', () => {
  it.each(['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'ELOOP', 'EISDIR', 'ENXIO', 'ESTALE'])(
    'keeps readable catalog entries and child usage when an unrelated open fails (%s)',
    async (code) => {
      const parent = rollout(ROOT, { lines: spawn() });
      const child = rollout(CHILD, { parent: ROOT, lines: [usage('child-response')] });
      const inaccessible = rollout(OTHER);
      const original = fs.open;
      vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        if (args[0] === inaccessible) throw ioError(code);
        return original(...args);
      });
      expect((await codexSource.discover({})).map((entry) => entry.jsonlPath)).toEqual([parent]);
      expect(
        (await codexSource.discover({ includeSubagents: true }))
          .map((entry) => entry.jsonlPath)
          .sort(),
      ).toEqual([parent, child].sort());
      expect(await usageAt(parent)).toEqual([
        {
          agentId: CHILD,
          eventUuid: expect.any(String),
          calls: 1,
          prompt_tokens: 10,
          output_tokens: 2,
        },
      ]);
    },
  );

  it.each(['EACCES', 'EPERM'])('isolates initial per-entry lstat failures (%s)', async (code) => {
    const parent = rollout(ROOT);
    const inaccessible = rollout(OTHER);
    const original = fs.lstat;
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      if (args[0] === inaccessible) throw ioError(code);
      return original(...args);
    });
    expect((await codexSource.discover({})).map((entry) => entry.jsonlPath)).toEqual([parent]);
  });

  it.each(['open', 'lstat'] as const)(
    'propagates programming errors and unexpected IO failures from %s',
    async (operation) => {
      rollout(ROOT);
      for (const error of [new TypeError('synthetic programming error'), ioError('EIO')]) {
        const failing = vi.spyOn(fs, operation).mockRejectedValueOnce(error);
        await expect(codexSource.discover({})).rejects.toBe(error);
        failing.mockRestore();
      }
    },
  );
});

describe('exact selected native Codex root', () => {
  it('uses an archived selected duplicate without losing children or append-sensitive signatures', async () => {
    const active = rollout(ROOT);
    const archived = rollout(ROOT, { archived: true, lines: spawn() });
    const child = rollout(CHILD, { parent: ROOT, lines: [usage('child-response')] });
    rollout(CHILD, { parent: ROOT, archived: true, lines: [usage('archive-only-response', 900)] });
    expect(
      (await codexSource.discover({ includeSubagents: true, includeArchived: true })).find(
        (entry) => entry.sessionId === ROOT,
      )?.jsonlPath,
    ).toBe(active);
    expect(await nativeCodexEntry(archived)).toMatchObject({ jsonlPath: archived, archived: true });
    expect(await usageAt(archived)).toEqual([
      {
        agentId: CHILD,
        eventUuid: expect.any(String),
        calls: 1,
        prompt_tokens: 10,
        output_tokens: 2,
      },
    ]);
    const before = await codexSubagentSignature(archived);
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    appendFileSync(child, JSON.stringify(usage('appended-response', 20)) + '\n');
    expect(await codexSubagentSignature(archived)).not.toBe(before);
    expect(await usageAt(archived)).toEqual([
      {
        agentId: CHILD,
        eventUuid: expect.any(String),
        calls: 2,
        prompt_tokens: 30,
        output_tokens: 4,
      },
    ]);
  });

  it('accepts native date directories and flat or dated archives', async () => {
    rollout(CHILD, { parent: ROOT, lines: [usage('child-response')] });
    for (const directory of [
      join(home, 'sessions', '2026', '10', '01'),
      join(home, 'archived_sessions'),
      join(home, 'archived_sessions', '2026', '10', '01'),
    ]) {
      const file = rollout(ROOT, { directory, lines: spawn() });
      expect(await nativeCodexEntry(file)).toMatchObject({ sessionId: ROOT, jsonlPath: file });
      expect(await usageAt(file)).toMatchObject([{ agentId: CHILD, prompt_tokens: 10 }]);
    }
  });

  it.each([
    ['portable'],
    ['sessions-impostor', '2026', '10', '01'],
    ['sessions'],
    ['sessions', 'misc'],
    ['sessions', '2026', '10'],
    ['sessions', '2026', '13', '01'],
    ['sessions', '2026', '10', '01', 'extra'],
    ['archived_sessions', 'misc'],
  ])('never discovers host-family usage for nonnative layout %j', async (...parts) => {
    rollout(ROOT);
    rollout(CHILD, { parent: ROOT, lines: [usage('child-response')] });
    const directory = parts[0] === 'portable' ? join(temporary, 'export') : join(home, ...parts);
    const file = rollout(ROOT, { directory, lines: spawn() });
    const discover = vi.spyOn(codexSource, 'discover');
    expect(await nativeCodexEntry(file)).toBeNull();
    expect(await readCodexSubagents(file, [], [])).toBeUndefined();
    expect(await codexSubagentSignature(file)).toBe('');
    expect(discover).not.toHaveBeenCalled();
  });

  it.each(['wrong ID', 'missing cwd', 'wrong header', 'wrong filename', 'directory', 'FIFO'])(
    'rejects native-looking impostors (%s) before catalog lookup',
    async (kind) => {
      let file = rollout(ROOT);
      rollout(CHILD, { parent: ROOT, lines: [usage('child-response')] });
      if (kind === 'wrong ID')
        writeFileSync(
          file,
          JSON.stringify(record('session_meta', { id: OTHER, cwd: project })) + '\n',
        );
      if (kind === 'missing cwd')
        writeFileSync(file, JSON.stringify(record('session_meta', { id: ROOT })) + '\n');
      if (kind === 'wrong header')
        writeFileSync(file, JSON.stringify(message('Not metadata')) + '\n');
      if (kind === 'wrong filename') {
        const wrong = join(dirname(file), 'export.jsonl');
        renameSync(file, wrong);
        file = wrong;
      }
      if (kind === 'directory' || kind === 'FIFO') {
        rmSync(file);
        if (kind === 'directory') mkdirSync(file);
        else execFileSync('mkfifo', [file]);
      }
      const discover = vi.spyOn(codexSource, 'discover');
      expect(await nativeCodexEntry(file)).toBeNull();
      expect(await readCodexSubagents(file, [], [])).toBeUndefined();
      expect(await codexSubagentSignature(file)).toBe('');
      expect(discover).not.toHaveBeenCalled();
    },
  );

  it.each(['file', 'home', 'sessions', 'year', 'month', 'day'])(
    'rejects a selected root reached through a symlink (%s)',
    async (kind) => {
      const file = rollout(ROOT, { lines: spawn() });
      rollout(CHILD, { parent: ROOT, lines: [usage('child-response')] });
      const paths = [
        home,
        join(home, 'sessions'),
        join(home, 'sessions', '2026'),
        join(home, 'sessions', '2026', '10'),
        dirname(file),
      ];
      const selected =
        kind === 'file' ? file : paths[['home', 'sessions', 'year', 'month', 'day'].indexOf(kind)];
      const moved = join(temporary, 'moved');
      renameSync(selected, moved);
      symlinkSync(moved, selected, kind === 'file' ? 'file' : 'dir');
      const discover = vi.spyOn(codexSource, 'discover');
      expect(await nativeCodexEntry(file)).toBeNull();
      expect(await readCodexSubagents(file, [], [])).toBeUndefined();
      expect(await codexSubagentSignature(file)).toBe('');
      expect(discover).not.toHaveBeenCalled();
    },
  );

  it.each([0, 1, 2, 3, 4])(
    'rejects replaced native ancestor %i even when the file inode survives',
    async (depth) => {
      const file = rollout(ROOT);
      const components = ['sessions', '2026', '10', '01', basename(file)];
      const replaced = join(home, ...components.slice(0, depth));
      const moved = join(temporary, 'replaced-directory');
      const original = fs.open;
      vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
        const handle = await original(...args);
        renameSync(replaced, moved);
        mkdirSync(replaced);
        renameSync(join(moved, components[depth]), join(replaced, components[depth]));
        return handle;
      });
      expect(await nativeCodexEntry(file)).toBeNull();
    },
  );

  it('does not infer host ancestry from a renamed portable copy even with identical metadata', async () => {
    const native = rollout(ROOT, { lines: spawn() });
    rollout(CHILD, { parent: ROOT, lines: [usage('child-response')] });
    const portable = join(temporary, basename(native));
    copyFileSync(native, portable);
    const discover = vi.spyOn(codexSource, 'discover');
    expect(await usageAt(portable)).toBeUndefined();
    expect(await codexSubagentSignature(portable)).toBe('');
    expect(discover).not.toHaveBeenCalled();
  });
});
