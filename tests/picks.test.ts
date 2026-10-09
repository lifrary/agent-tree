import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionSourceId } from '../src/sources/types.js';
import { listAllPicks, readPicks, recordPick, removePicksForNode } from '../src/utils/picks.js';

const ID_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID_B = 'BBBBBBBB-0000-4000-8000-000000000002';
const ID_C = 'cccccccc-0000-4000-8000-000000000003';
const EARLY = '2026-01-01T00:00:00.000Z';
const MIDDLE = '2026-01-02T00:00:00.000Z';
const LATE = '2026-01-03T00:00:00.000Z';
let workdir: string;
let root: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'agent-tree-source-picks-'));
  root = join(workdir, 'picks');
  await mkdir(root);
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

async function writeHistory(source: string, sessionId: string, body: string): Promise<string> {
  const directory = join(root, source);
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${sessionId}.jsonl`);
  await writeFile(file, body, 'utf8');
  return file;
}

describe('source-scoped pick history', () => {
  it('isolates identical session and node IDs while defaulting per-session calls to Claude', async () => {
    await recordPick(ID_A, 'shared', 'continue', { root });
    await recordPick(ID_A, 'claude-only', 'fork', { root, source: 'claude' });
    await recordPick(ID_A, 'shared', 'fork', { root, source: 'codex' });
    await recordPick(ID_A, 'codex-only', 'continue', { root, source: 'codex' });

    const claude = await readPicks(ID_A, { root });
    expect(claude).toEqual({
      total: 2,
      modesByNode: new Map([
        ['shared', new Set(['continue'])],
        ['claude-only', new Set(['fork'])],
      ]),
    });
    expect(await readPicks(ID_A, { root, source: 'claude' })).toEqual(claude);
    expect(await readPicks(ID_A, { root, source: 'codex' })).toEqual({
      total: 2,
      modesByNode: new Map([
        ['shared', new Set(['fork'])],
        ['codex-only', new Set(['continue'])],
      ]),
    });
    expect((await readdir(root)).sort()).toEqual(['claude', 'codex']);
    const lines = (await readFile(join(root, 'claude', `${ID_A}.jsonl`), 'utf8'))
      .trim()
      .split('\n');
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { node_id: 'shared', mode: 'continue', ts: expect.any(String) },
      { node_id: 'claude-only', mode: 'fork', ts: expect.any(String) },
    ]);
  });

  it('removes all Codex picks for a node without changing Claude stars or other Codex nodes', async () => {
    await recordPick(ID_A, 'shared', 'continue', { root });
    await recordPick(ID_A, 'shared', 'fork', { root });
    await recordPick(ID_A, 'shared', 'continue', { root, source: 'codex' });
    await recordPick(ID_A, 'keep', 'fork', { root, source: 'codex' });
    await recordPick(ID_A, 'shared', 'fork', { root, source: 'codex' });
    const claudeFile = join(root, 'claude', `${ID_A}.jsonl`);
    const originalClaude = await readFile(claudeFile, 'utf8');

    expect(await removePicksForNode(ID_A, 'shared', { root, source: 'codex' })).toBe(2);
    expect(await readFile(claudeFile, 'utf8')).toBe(originalClaude);
    expect(await readPicks(ID_A, { root })).toEqual({
      total: 2,
      modesByNode: new Map([['shared', new Set(['continue', 'fork'])]]),
    });
    expect(await readPicks(ID_A, { root, source: 'codex' })).toEqual({
      total: 1,
      modesByNode: new Map([['keep', new Set(['fork'])]]),
    });
    expect(await removePicksForNode(ID_A, 'shared', { root, source: 'codex' })).toBe(0);
    expect(await readdir(join(root, 'codex'))).toEqual([`${ID_A}.jsonl`]);

    expect(await removePicksForNode(ID_A, 'shared', { root })).toBe(2);
    expect(await readFile(claudeFile, 'utf8')).toBe('');
    expect((await readPicks(ID_A, { root, source: 'codex' })).total).toBe(1);
  });

  it('does not read, migrate, or remove legacy flat histories', async () => {
    const legacyFile = join(root, `${ID_A}.jsonl`);
    const legacy = JSON.stringify({ node_id: 'legacy', mode: 'fork', ts: EARLY }) + '\n';
    await writeFile(legacyFile, legacy, 'utf8');

    for (const source of ['claude', 'codex'] as const) {
      expect(await readPicks(ID_A, { root, source })).toEqual({ total: 0, modesByNode: new Map() });
      expect(await removePicksForNode(ID_A, 'legacy', { root, source })).toBe(0);
    }
    expect(await listAllPicks({ root })).toEqual([]);
    await recordPick(ID_A, 'new', 'continue', { root });
    expect((await readPicks(ID_A, { root })).modesByNode.has('legacy')).toBe(false);
    expect(await readFile(legacyFile, 'utf8')).toBe(legacy);
    expect(await listAllPicks({ root })).toEqual([
      {
        source: 'claude',
        sessionId: ID_A,
        picks: [{ node_id: 'new', mode: 'continue', ts: expect.any(String) }],
      },
    ]);
  });

  it('lists both sources and filters each source, ordered by last recorded activity', async () => {
    const first = { node_id: 'first', mode: 'continue', ts: EARLY };
    const middle = { node_id: 'middle', mode: 'fork', ts: MIDDLE };
    const last = { node_id: 'last', mode: 'fork', ts: LATE };
    await writeHistory('claude', ID_A, `${JSON.stringify(last)}\n${JSON.stringify(first)}\n`);
    await writeHistory('codex', ID_A, `${JSON.stringify(first)}\n${JSON.stringify(last)}\n`);
    await writeHistory('claude', ID_B, JSON.stringify(middle) + '\n');
    await writeHistory('unknown-source', ID_A, JSON.stringify(last) + '\n');
    await writeHistory('codex', ID_C, '\ninvalid-json\n{}\nnull\n');

    const claudeA = { source: 'claude', sessionId: ID_A, picks: [last, first] };
    const claudeB = { source: 'claude', sessionId: ID_B, picks: [middle] };
    const codexA = { source: 'codex', sessionId: ID_A, picks: [first, last] };
    expect(await listAllPicks({ root })).toEqual([codexA, claudeB, claudeA]);
    expect(await listAllPicks({ root, source: 'claude' })).toEqual([claudeB, claudeA]);
    expect(await listAllPicks({ root, source: 'codex' })).toEqual([codexA]);
  });

  it('keeps best-effort reads for missing or non-file histories and absent sources', async () => {
    const absentRoot = join(workdir, 'absent');
    expect(await listAllPicks({ root: absentRoot })).toEqual([]);
    expect(await listAllPicks({ root })).toEqual([]);
    expect(await readPicks(ID_A, { root, source: 'codex' })).toEqual({
      total: 0,
      modesByNode: new Map(),
    });
    expect(await removePicksForNode(ID_A, 'missing', { root, source: 'codex' })).toBe(0);
    await mkdir(join(root, 'claude', `${ID_A}.jsonl`), { recursive: true });
    await writeFile(join(root, 'codex'), 'not a directory', 'utf8');
    expect(await listAllPicks({ root })).toEqual([]);
    expect(await listAllPicks({ root: join(root, 'codex') })).toEqual([]);
    expect(await readPicks(ID_A, { root })).toEqual({ total: 0, modesByNode: new Map() });
    expect(await removePicksForNode(ID_A, 'missing', { root })).toBe(0);
  });

  it('preserves malformed-line handling and keeps unrelated lines during removal', async () => {
    const removed = { node_id: 'remove', mode: 'continue', ts: EARLY };
    const kept = { node_id: 'keep', mode: 'fork', ts: MIDDLE };
    const invalidMode = { node_id: 'invalid-mode', mode: 'other', ts: LATE };
    const file = await writeHistory(
      'codex',
      ID_A,
      [
        '',
        'not-json',
        'null',
        '{}',
        '[]',
        JSON.stringify(removed),
        `  ${JSON.stringify(kept)}  `,
        JSON.stringify(invalidMode),
        '',
      ].join('\n'),
    );

    expect(await readPicks(ID_A, { root, source: 'codex' })).toEqual({
      total: 2,
      modesByNode: new Map([
        ['remove', new Set(['continue'])],
        ['keep', new Set(['fork'])],
      ]),
    });
    // Listing retains the existing node_id-only check; indexing also checks mode.
    expect(await listAllPicks({ root })).toEqual([
      { source: 'codex', sessionId: ID_A, picks: [removed, kept, invalidMode] },
    ]);
    expect(await removePicksForNode(ID_A, 'remove', { root, source: 'codex' })).toBe(1);
    expect(await readFile(file, 'utf8')).toBe(
      ['not-json', 'null', '{}', '[]', JSON.stringify(kept), JSON.stringify(invalidMode), ''].join(
        '\n',
      ),
    );
    expect(await readPicks(ID_A, { root, source: 'codex' })).toEqual({
      total: 1,
      modesByNode: new Map([['keep', new Set(['fork'])]]),
    });
  });
});

describe('pick path validation and listing boundaries', () => {
  it.each([
    '',
    'Claude',
    'unknown',
    '../claude',
    '/codex',
    'codex/../claude',
    'codex\\..',
    'codex\0',
    null,
    1234,
  ])('rejects runtime source %j in every API before accessing paths', async (invalid) => {
    const opts = { root, source: invalid as SessionSourceId };
    await expect(recordPick(ID_A, 'node', 'continue', opts)).rejects.toThrow(/invalid source/);
    await expect(readPicks(ID_A, opts)).rejects.toThrow(/invalid source/);
    await expect(removePicksForNode(ID_A, 'node', opts)).rejects.toThrow(/invalid source/);
    await expect(listAllPicks(opts)).rejects.toThrow(/invalid source/);
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    '',
    ' ',
    'abc',
    'a'.repeat(41),
    '../abcd',
    '/abcd',
    'abcd/efab',
    'abcd\\efab',
    'abcd.jsonl',
    'abcd\0',
    null,
    1234,
  ])('rejects runtime session identifier %j for both sources', async (invalid) => {
    for (const source of ['claude', 'codex'] as const) {
      const opts = { root, source };
      const sessionId = invalid as string;
      await expect(recordPick(sessionId, 'node', 'continue', opts)).rejects.toThrow(
        /invalid sessionId/,
      );
      await expect(readPicks(sessionId, opts)).rejects.toThrow(/invalid sessionId/);
      await expect(removePicksForNode(sessionId, 'node', opts)).rejects.toThrow(
        /invalid sessionId/,
      );
    }
    expect(await readdir(root)).toEqual([]);
  });

  it('reads only valid session filenames and skips symlink files and nested directories', async () => {
    const pick = { node_id: 'visible', mode: 'continue', ts: EARLY };
    const body = JSON.stringify(pick) + '\n';
    await writeHistory('claude', ID_A, body);
    const directory = join(root, 'claude');
    for (const filename of [
      'invalid.jsonl',
      'abc.jsonl',
      `${'a'.repeat(41)}.jsonl`,
      '.jsonl',
      `${ID_A}.jsonl.tmp-1`,
      `${ID_A}.JSONL`,
    ]) {
      await writeFile(join(directory, filename), body, 'utf8');
    }
    const outside = join(workdir, 'outside.jsonl');
    await writeFile(outside, body, 'utf8');
    await symlink(outside, join(directory, `${ID_B}.jsonl`));
    await mkdir(join(directory, `${ID_C}.jsonl`));
    await writeFile(join(directory, `${ID_C}.jsonl`, `${ID_A}.jsonl`), body, 'utf8');
    await symlink(join(workdir, 'missing'), join(directory, 'dddd.jsonl'));
    await symlink(join(directory, `${ID_C}.jsonl`), join(directory, 'eeee.jsonl'), 'dir');

    expect(await listAllPicks({ root })).toEqual([
      { source: 'claude', sessionId: ID_A, picks: [pick] },
    ]);
  });

  it('does not traverse symlink source directories or a symlink root', async () => {
    const pick = { node_id: 'visible', mode: 'fork', ts: EARLY };
    const body = JSON.stringify(pick) + '\n';
    await writeHistory('claude', ID_A, body);
    const outside = join(workdir, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, `${ID_B}.jsonl`), body, 'utf8');
    await symlink(outside, join(root, 'codex'), 'dir');
    const linkedRoot = join(workdir, 'linked-picks');
    await symlink(root, linkedRoot, 'dir');

    expect(await listAllPicks({ root })).toEqual([
      { source: 'claude', sessionId: ID_A, picks: [pick] },
    ]);
    expect(await listAllPicks({ root, source: 'codex' })).toEqual([]);
    expect(await listAllPicks({ root: linkedRoot })).toEqual([]);
  });
});
