import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { readJsonl } from '../src/reader/jsonl.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/minimal-session.jsonl');

describe('readJsonl (§7.1 pass 1)', () => {
  it('extracts session meta from line 1', async () => {
    const { meta } = await readJsonl(FIXTURE);
    expect(meta.sessionId).toBe('aaaa1111-2222-3333-4444-555566667777');
    expect(meta.permissionMode).toBe('default');
  });

  it('parses all 9 events (skips line 1 permission-mode)', async () => {
    const { events } = await readJsonl(FIXTURE);
    expect(events).toHaveLength(9);
  });

  it('preserves jsonl order', async () => {
    const { events } = await readJsonl(FIXTURE);
    const uuids = events.map((e) => e.uuid);
    expect(uuids).toEqual([
      'u-001',
      'u-002',
      'u-003',
      'u-004',
      'u-005',
      'u-006',
      'u-007',
      'u-008',
      'u-009',
    ]);
  });

  it('discriminates by type union', async () => {
    const { events } = await readJsonl(FIXTURE);
    const types = events.map((e) => e.type);
    expect(types).toContain('attachment');
    expect(types).toContain('user');
    expect(types).toContain('assistant');
    expect(types).toContain('tool_result');
  });

  it('reports 0 malformed lines on a clean fixture', async () => {
    const { malformedCount } = await readJsonl(FIXTURE);
    expect(malformedCount).toBe(0);
  });
});
