import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cacheDirFor,
  clearCache,
  computeInputHash,
  readJsonCache,
  writeJsonCache,
} from '../src/cache/disk.js';

let tmpRoot: string;
let jsonlPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'atree-cache-'));
  jsonlPath = join(tmpRoot, 'session.jsonl');
  writeFileSync(jsonlPath, 'hello jsonl', 'utf8');
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('computeInputHash', () => {
  it('is deterministic for the same inputs', async () => {
    const a = await computeInputHash({
      jsonlPath,
      configJson: '{"x":1}',
      specVersion: 'v0.3',
    });
    const b = await computeInputHash({
      jsonlPath,
      configJson: '{"x":1}',
      specVersion: 'v0.3',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when spec_version changes', async () => {
    const a = await computeInputHash({
      jsonlPath,
      configJson: '{}',
      specVersion: 'v0.3',
    });
    const b = await computeInputHash({
      jsonlPath,
      configJson: '{}',
      specVersion: 'v0.4',
    });
    expect(a).not.toBe(b);
  });

  it('changes when jsonl bytes change', async () => {
    const a = await computeInputHash({
      jsonlPath,
      configJson: '{}',
      specVersion: 'v0.3',
    });
    writeFileSync(jsonlPath, 'different content', 'utf8');
    const b = await computeInputHash({
      jsonlPath,
      configJson: '{}',
      specVersion: 'v0.3',
    });
    expect(a).not.toBe(b);
  });
});

describe('JSON artifact cache', () => {
  const cacheRoot = () => join(tmpRoot, '.cache', 'agent-tree');

  it('cacheDirFor composes the per-hash subdirectory', () => {
    expect(cacheDirFor('abc', { root: '/X' })).toBe('/X/abc');
  });

  it('clearCache removes the entire cache root', async () => {
    const hash = 'b'.repeat(64);
    await writeJsonCache(hash, 'segments.json', { foo: 1 }, { root: cacheRoot() });
    await clearCache({ root: cacheRoot() });
    const entry = await readJsonCache(hash, 'segments.json', {
      root: cacheRoot(),
    });
    expect(entry).toBeNull();
  });

  it('writeJsonCache/readJsonCache round-trip arbitrary JSON', async () => {
    const hash = 'c'.repeat(64);
    const data = { count: 3, items: [1, 2, 3], nested: { ok: true } };
    await writeJsonCache(hash, 'segments.json', data, { root: cacheRoot() });
    const loaded = await readJsonCache<typeof data>(hash, 'segments.json', {
      root: cacheRoot(),
    });
    expect(loaded).toEqual(data);
  });

  it('readJsonCache returns null for missing file', async () => {
    const got = await readJsonCache('0'.repeat(64), 'tree.json', {
      root: cacheRoot(),
    });
    expect(got).toBeNull();
  });
});
