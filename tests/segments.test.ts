import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { detectSegments } from '../src/analyzer/segments.js';
import { readJsonl } from '../src/reader/jsonl.js';
import type { RawEvent } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/minimal-session.jsonl');

describe('detectSegments (§7.2)', () => {
  it('returns at least 2 segments because of the 20-min gap + topic-shift phrase', async () => {
    const { events } = await readJsonl(FIXTURE);
    const segs = detectSegments(events);
    expect(segs.length).toBeGreaterThanOrEqual(2);
  });

  it('records gap boundary reason when gap > 5 min', async () => {
    const { events } = await readJsonl(FIXTURE);
    const segs = detectSegments(events);
    const withGap = segs.find((s) => s.boundary_reasons.includes('gap'));
    expect(withGap).toBeDefined();
  });

  it('flags sidechain_transition when events cross the main↔sidechain boundary', async () => {
    const { events } = await readJsonl(FIXTURE);
    const segs = detectSegments(events);
    const sidechainReason = segs.find((s) =>
      s.boundary_reasons.includes('sidechain_transition'),
    );
    expect(sidechainReason).toBeDefined();
  });

  it('detects slash-command boundary on /wrap turn', async () => {
    const { events } = await readJsonl(FIXTURE);
    const segs = detectSegments(events);
    const slashSeg = segs.find((s) =>
      s.boundary_reasons.includes('slash_command'),
    );
    expect(slashSeg).toBeDefined();
  });

  it('first segment has empty boundary_reasons', async () => {
    const { events } = await readJsonl(FIXTURE);
    const segs = detectSegments(events);
    expect(segs[0].boundary_reasons).toEqual([]);
  });

  it('emits ids seg_001…seg_00N in order', async () => {
    const { events } = await readJsonl(FIXTURE);
    const segs = detectSegments(events);
    segs.forEach((s, i) => {
      expect(s.id).toBe(`seg_${String(i + 1).padStart(3, '0')}`);
    });
  });

  it('returns empty array for empty event list', () => {
    expect(detectSegments([] as RawEvent[])).toEqual([]);
  });

  it('captures dominant files from Edit/Read tool_use events', async () => {
    const { events } = await readJsonl(FIXTURE);
    const segs = detectSegments(events);
    const allFiles = segs.flatMap((s) => s.dominant_files);
    expect(allFiles).toEqual(
      expect.arrayContaining(['src/foo.ts', 'src/bar.ts']),
    );
  });
});
