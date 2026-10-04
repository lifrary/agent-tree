import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { detectSegments, eventsForSegment } from '../src/analyzer/segments.js';
import { readJsonl } from '../src/reader/jsonl.js';
import type { RawEvent } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/minimal-session.jsonl');

function userEvent(
  index: number,
  isSidechain = false,
  text = 'Continue the current task',
): RawEvent {
  return {
    uuid: `event-${index}`,
    parentUuid: null,
    isSidechain,
    timestamp: new Date(Date.UTC(2026, 3, 21, 0, index)).toISOString(),
    sessionId: 'interleaved-session',
    cwd: '/project',
    gitBranch: 'main',
    version: 'test',
    entrypoint: 'test',
    userType: 'test',
    type: 'user',
    message: { role: 'user', content: text },
  };
}

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
    const sidechainReason = segs.find((s) => s.boundary_reasons.includes('sidechain_transition'));
    expect(sidechainReason).toBeDefined();
  });

  it('detects slash-command boundary on /wrap turn', async () => {
    const { events } = await readJsonl(FIXTURE);
    const segs = detectSegments(events);
    const slashSeg = segs.find((s) => s.boundary_reasons.includes('slash_command'));
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
    expect(allFiles).toEqual(expect.arrayContaining(['src/foo.ts', 'src/bar.ts']));
  });

  it('keeps original source indexes and does not micro-merge across dropped intervals', () => {
    const events = [
      userEvent(0, true),
      userEvent(1),
      userEvent(2, true),
      userEvent(3),
      userEvent(4, true),
    ];
    const original = structuredClone(events);
    const segments = detectSegments(events, { sidechainHandling: 'drop' });

    expect(segments.map((s) => [s.start_index, s.end_index])).toEqual([
      [1, 1],
      [3, 3],
    ]);
    expect(segments.map((s) => s.event_uuids)).toEqual([['event-1'], ['event-3']]);
    expect(segments[0].boundary_reasons).toEqual([]);
    expect(segments[1].boundary_reasons).toContain('sidechain_transition');
    expect(segments.every((s) => !s.is_sidechain_only)).toBe(true);
    expect(events).toEqual(original);
  });

  it('returns no segments when every event is dropped', () => {
    expect(
      detectSegments([userEvent(0, true), userEvent(1, true)], {
        sidechainHandling: 'drop',
      }),
    ).toEqual([]);
  });

  it('flattens sidechain-only segments and transition boundaries without changing source events', () => {
    const events = [
      userEvent(0),
      userEvent(1, true),
      userEvent(2),
      userEvent(3, true, '/review the implementation'),
    ];
    const original = structuredClone(events);
    const segments = detectSegments(events, { sidechainHandling: 'flatten' });

    expect(segments.map((s) => [s.start_index, s.end_index])).toEqual([
      [0, 2],
      [3, 3],
    ]);
    expect(segments.map((s) => s.event_uuids)).toEqual([
      ['event-0', 'event-1', 'event-2'],
      ['event-3'],
    ]);
    expect(segments.every((s) => !s.is_sidechain_only)).toBe(true);
    expect(segments[1].boundary_reasons).toContain('slash_command');
    expect(segments.some((s) => s.boundary_reasons.includes('sidechain_transition'))).toBe(false);
    expect(events).toEqual(original);
  });

  it('preserves included sidechain grouping and source positions by default', () => {
    const events = [
      userEvent(0),
      userEvent(1),
      userEvent(2, true),
      userEvent(3, true),
      userEvent(4),
      userEvent(5),
    ];
    const segments = detectSegments(events);
    expect(segments.map((s) => [s.start_index, s.end_index])).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    expect(segments.map((s) => s.is_sidechain_only)).toEqual([false, true, false]);
    expect(segments.flatMap((s) => s.event_uuids)).toEqual(events.map((e) => e.uuid));
  });

  it('does not merge a one-event main segment into a following sidechain', () => {
    const segments = detectSegments([userEvent(0), userEvent(1, true), userEvent(2, true)]);
    expect(segments.map((segment) => segment.event_uuids)).toEqual([
      ['event-0'],
      ['event-1', 'event-2'],
    ]);
    expect(segments.map((segment) => segment.is_sidechain_only)).toEqual([false, true]);
  });
});

describe('eventsForSegment', () => {
  it('selects membership in source order within the bounded source interval', () => {
    const events = [
      { ...userEvent(0, true), uuid: 'event-1' },
      userEvent(1),
      userEvent(2, true),
      userEvent(3),
      { ...userEvent(4, true), uuid: 'event-3' },
    ];
    const [segment] = detectSegments(events, { sidechainHandling: 'drop' });
    const sparseSegment = {
      ...segment,
      start_index: 1,
      end_index: 3,
      event_uuids: ['event-3', 'event-1'],
    };

    const selected = eventsForSegment(events, sparseSegment);
    expect(selected).toEqual([events[1], events[3]]);
    expect(selected[0]).toBe(events[1]);
    expect(selected[1]).toBe(events[3]);
    expect(eventsForSegment(events, { ...sparseSegment, event_uuids: [] })).toEqual([]);
    expect(eventsForSegment([], sparseSegment)).toEqual([]);
  });
});
