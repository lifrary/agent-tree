import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeProjectPath } from '../src/sources/claude.js';
import { findLatestSession, listSessions, locateSession } from '../src/utils/session_path.js';

const ids = {
  main: '11111111-2222-4333-8444-555555555551',
  child: '22222222-2222-4333-8444-555555555552',
  archive: '33333333-2222-4333-8444-555555555553',
  orphan: '44444444-2222-4333-8444-555555555554',
  other: '55555555-2222-4333-8444-555555555555',
};
const time = Date.UTC(2026, 9, 1);
let root: string;
let project: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-tree-discovery-expanded-'));
  project = join(root, 'project');
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'claude'));
  vi.stubEnv('CODEX_HOME', join(root, 'codex'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function put(file: string, contents: string, mtime = time): Promise<string> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents);
  await utimes(file, mtime / 1000, mtime / 1000);
  return file;
}

function claudePath(cwd = project): string {
  return join(root, 'claude', 'projects', encodeProjectPath(cwd));
}

async function claudeChild(parent: string, id: string, cwd = project, metadata?: unknown) {
  const directory = join(claudePath(cwd), parent, 'subagents');
  const file = await put(join(directory, `agent-${id}.jsonl`), '{}\n', time + 1000);
  if (metadata !== undefined)
    await put(join(directory, `agent-${id}.meta.json`), JSON.stringify(metadata));
  return file;
}

async function codex(
  id: string,
  options: { location?: string; source?: unknown; cwd?: string; mtime?: number } = {},
) {
  return put(
    join(
      root,
      'codex',
      options.location ?? 'sessions/2026/10/01',
      `rollout-2026-10-01T00-00-00-${id}.jsonl`,
    ),
    JSON.stringify({
      type: 'session_meta',
      timestamp: '2026-10-01T00:00:00.000Z',
      payload: { id, cwd: options.cwd ?? project, source: options.source ?? 'cli' },
    }) + '\n',
    options.mtime,
  );
}

const spawnedBy = (parent: string) => ({
  subagent: { thread_spawn: { parent_thread_id: parent } },
});

describe('expanded Claude discovery', () => {
  it('keeps default catalogs and latest selection main-only, with explicit child opt-in', async () => {
    const main = await put(join(claudePath(), `${ids.main}.jsonl`), '{}\n');
    const child = await claudeChild(ids.main, 'worker', project, { toolUseId: 'spawn-1' });

    expect((await listSessions()).map((entry) => entry.jsonlPath)).toEqual([main]);
    expect(await findLatestSession()).toMatchObject({ jsonlPath: main });
    expect((await listSessions({ includeArchived: true })).map((entry) => entry.jsonlPath)).toEqual(
      [main],
    );
    const expanded = await listSessions({ includeSubagents: true });
    expect(expanded.map((entry) => entry.jsonlPath)).toEqual([child, main]);
    expect(expanded[0]).toMatchObject({
      source: 'claude',
      subagent: { id: 'worker', parentSessionId: ids.main, toolUseId: 'spawn-1' },
    });
    expect(expanded[1]).not.toHaveProperty('subagent');
    expect(expanded[0]).not.toHaveProperty('archived');
  });

  it('discovers orphan and nested child transcripts without a parent main file', async () => {
    const child = await claudeChild(ids.orphan, 'outer');
    const nested = await claudeChild(ids.orphan, 'inner', project, {
      parentAgentId: 'outer',
      toolUseId: 'nested-spawn',
    });
    const entries = await listSessions({ includeSubagents: true });
    expect(entries.map((entry) => entry.jsonlPath).sort()).toEqual([child, nested].sort());
    expect(entries.find((entry) => entry.jsonlPath === nested)?.subagent).toEqual({
      id: 'inner',
      parentSessionId: ids.orphan,
      parentAgentId: 'outer',
      toolUseId: 'nested-spawn',
    });
    expect(await listSessions()).toEqual([]);
  });

  it('applies the project filter and limit to expanded children, not just main files', async () => {
    const wanted = await claudeChild(ids.main, 'wanted');
    await claudeChild(ids.other, 'elsewhere', join(root, 'other'));
    expect(
      (await listSessions({ includeSubagents: true, projectCwd: project, limit: 1 })).map(
        (entry) => entry.jsonlPath,
      ),
    ).toEqual([wanted]);
    expect(
      await listSessions({ includeSubagents: true, projectCwd: join(root, 'missing') }),
    ).toEqual([]);
  });
});

describe('expanded Codex discovery', () => {
  it('opts into children and archived_sessions independently, including flat and dated archives', async () => {
    const main = await codex(ids.main);
    const child = await codex(ids.child, { source: spawnedBy(ids.main) });
    const flat = await codex(ids.archive, { location: 'archived_sessions' });
    const datedChild = await codex(ids.orphan, {
      location: 'archived_sessions/2026/10/01',
      source: spawnedBy(ids.main),
    });
    await codex(ids.other, { location: 'archived-sessions' });
    const paths = async (includeSubagents = false, includeArchived = false) =>
      (await listSessions({ source: 'codex', includeSubagents, includeArchived }))
        .map((entry) => entry.jsonlPath)
        .sort();

    expect(await paths()).toEqual([main]);
    expect(await paths(true)).toEqual([main, child].sort());
    expect(await paths(false, true)).toEqual([main, flat].sort());
    expect(await paths(true, true)).toEqual([main, child, flat, datedChild].sort());
    const entries = await listSessions({
      source: 'codex',
      includeSubagents: true,
      includeArchived: true,
    });
    expect(entries.find((entry) => entry.jsonlPath === flat)).toMatchObject({ archived: true });
    expect(entries.find((entry) => entry.jsonlPath === datedChild)).toMatchObject({
      archived: true,
      subagent: { id: ids.orphan, parentSessionId: ids.main },
    });
    expect(entries.find((entry) => entry.jsonlPath === main)).not.toHaveProperty('archived');
  });

  it('represents a generic subagent with an unknown parent instead of dropping or inventing it', async () => {
    const file = await codex(ids.child, { source: 'subagent' });
    expect(await listSessions({ source: 'codex' })).toEqual([]);
    expect(await listSessions({ source: 'codex', includeSubagents: true })).toMatchObject([
      {
        jsonlPath: file,
        subagent: { id: ids.child, parentSessionId: null },
      },
    ]);
  });

  it('deduplicates UUIDs case-insensitively and prefers the active copy even when archive is newer', async () => {
    const id = 'abcdefab-2222-4333-8444-555555555551';
    const active = await codex(id, { mtime: time });
    await codex(id.toUpperCase(), { location: 'archived_sessions', mtime: time + 10_000 });
    const entries = await listSessions({ source: 'codex', includeArchived: true });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ sessionId: id, jsonlPath: active });
    expect(entries[0]).not.toHaveProperty('archived');
    expect(await locateSession(id.slice(0, 8), { source: 'codex' })).toMatchObject([
      { jsonlPath: active },
    ]);
  });

  it('resolves archived main UUIDs and prefixes without adding archives to default latest selection', async () => {
    const active = await codex(ids.main);
    const archive = await codex(ids.archive, {
      location: 'archived_sessions',
      mtime: time + 10_000,
    });
    await codex(ids.child, { location: 'archived_sessions', source: spawnedBy(ids.archive) });
    expect(await findLatestSession({ source: 'codex' })).toMatchObject({ jsonlPath: active });
    for (const query of [ids.archive, ids.archive.slice(0, 8)]) {
      expect(await locateSession(query, { source: 'codex' })).toEqual([
        {
          source: 'codex',
          sessionId: ids.archive,
          projectDir: project,
          jsonlPath: archive,
        },
      ]);
    }
    expect(await locateSession(ids.child, { source: 'codex' })).toEqual([]);
  });

  it('filters archived and child projects using metadata cwd and limits after newest-first ordering', async () => {
    const older = await codex(ids.archive, { location: 'archived_sessions', mtime: time });
    const newer = await codex(ids.child, { source: spawnedBy(ids.main), mtime: time + 1000 });
    await codex(ids.other, { cwd: join(root, 'other'), mtime: time + 2000 });
    const options = {
      source: 'codex' as const,
      projectCwd: project,
      includeSubagents: true,
      includeArchived: true,
    };
    expect((await listSessions(options)).map((entry) => entry.jsonlPath)).toEqual([newer, older]);
    expect((await listSessions({ ...options, limit: 1 })).map((entry) => entry.jsonlPath)).toEqual([
      newer,
    ]);
    expect(await listSessions({ ...options, projectCwd: join(root, 'missing') })).toEqual([]);
  });
});
