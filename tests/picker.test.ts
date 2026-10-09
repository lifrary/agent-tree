import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as readline from 'node:readline/promises';
import { PassThrough } from 'node:stream';

import { pickSession } from '../src/utils/picker.js';
import { listSessions, type SessionEntry } from '../src/utils/session_path.js';

vi.mock('../src/utils/session_path.js', () => ({
  listSessions: vi.fn(),
}));

vi.mock('node:readline/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:readline/promises')>()),
}));

const candidates: SessionEntry[] = [
  {
    source: 'claude',
    sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
    projectDir: '-work-first',
    jsonlPath: '/sessions/first.jsonl',
    mtimeMs: 1_700_000_001_000,
    sizeBytes: 20,
  },
  {
    source: 'claude',
    sessionId: 'bbbbbbbb-0000-4000-8000-000000000002',
    projectDir: '-work-second',
    jsonlPath: '/sessions/second.jsonl',
    mtimeMs: 1_700_000_000_000,
    sizeBytes: 10,
  },
];
const openStreams: PassThrough[] = [];
const openInterfaces: readline.Interface[] = [];

beforeEach(() => {
  vi.mocked(listSessions).mockReset().mockResolvedValue(candidates);
});

afterEach(() => {
  for (const rl of openInterfaces.splice(0)) rl.close();
  for (const stream of openStreams.splice(0)) stream.destroy();
  vi.restoreAllMocks();
});

function createStreams() {
  const input = new PassThrough();
  const output = new PassThrough();
  openStreams.push(input, output);
  return { input, output };
}

async function startPicker() {
  const { input, output } = createStreams();
  let text = '';
  const prompted = new Promise<void>((resolve) => {
    output.on('data', (chunk: Buffer) => {
      text += chunk.toString();
      if (text.includes('Pick a number (blank to cancel): ')) resolve();
    });
  });
  const createSpy = vi.spyOn(readline, 'createInterface');
  const result = pickSession({
    root: '/chosen/root',
    source: 'claude',
    projectCwd: '/work/project',
    limit: 2,
    input,
    output,
  });
  await prompted;
  const rl = createSpy.mock.results[0].value as readline.Interface;
  openInterfaces.push(rl);
  const closeSpy = vi.spyOn(rl, 'close');
  return { input, result, rl, closeSpy, text };
}

describe('pickSession', () => {
  it('uses shared discovery and returns the selected session without metadata', async () => {
    const picker = await startPicker();
    expect(listSessions).toHaveBeenCalledExactlyOnceWith({
      root: '/chosen/root',
      source: 'claude',
      projectCwd: '/work/project',
      limit: 2,
    });
    expect(picker.text).toContain('aaaaaaaa');
    expect(picker.text).toContain('bbbbbbbb');
    picker.input.write('  2  \n');

    await expect(picker.result).resolves.toEqual({
      source: candidates[1].source,
      sessionId: candidates[1].sessionId,
      projectDir: candidates[1].projectDir,
      jsonlPath: candidates[1].jsonlPath,
    });
    expect(picker.closeSpy).toHaveBeenCalledOnce();
    expect(picker.input.listenerCount('data')).toBe(0);
    expect(picker.rl.listenerCount('SIGINT')).toBe(0);
    expect(picker.rl.listenerCount('close')).toBe(0);
  });

  it.each(['', 'abc', '1garbage', '1.5', '1e0', '0x1', '-1', '0', '3', '9007199254740993'])(
    'rejects invalid selection %j and closes readline',
    async (answer) => {
      const picker = await startPicker();
      picker.input.write(`${answer}\n`);
      await expect(picker.result).resolves.toBeNull();
      expect(picker.closeSpy).toHaveBeenCalledOnce();
      expect(picker.input.listenerCount('data')).toBe(0);
    },
  );

  it('settles Ctrl-C cancellation and closes readline', async () => {
    const picker = await startPicker();
    picker.rl.emit('SIGINT');
    await expect(picker.result).resolves.toBeNull();
    expect(picker.closeSpy).toHaveBeenCalledOnce();
    expect(picker.input.listenerCount('data')).toBe(0);
    expect(picker.rl.listenerCount('SIGINT')).toBe(0);
    expect(picker.rl.listenerCount('close')).toBe(0);
  });

  it('settles EOF cancellation instead of leaving question pending', async () => {
    const picker = await startPicker();
    picker.input.end();
    await expect(picker.result).resolves.toBeNull();
    expect(picker.closeSpy).toHaveBeenCalled();
    expect(picker.input.listenerCount('data')).toBe(0);
    expect(picker.rl.listenerCount('SIGINT')).toBe(0);
    expect(picker.rl.listenerCount('close')).toBe(0);
  });

  it('closes readline and propagates unexpected prompt failures', async () => {
    const streams = createStreams();
    const error = new Error('prompt failed');
    vi.spyOn(readline.Interface.prototype, 'question').mockRejectedValueOnce(error);
    const closeSpy = vi.spyOn(readline.Interface.prototype, 'close');
    await expect(pickSession(streams)).rejects.toBe(error);
    expect(closeSpy).toHaveBeenCalledOnce();
    expect(streams.input.listenerCount('data')).toBe(0);
  });

  it('does not open readline when discovery has no candidates', async () => {
    vi.mocked(listSessions).mockResolvedValueOnce([]);
    const createSpy = vi.spyOn(readline, 'createInterface');
    expect(await pickSession(createStreams())).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('propagates discovery failures without opening readline', async () => {
    const error = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    vi.mocked(listSessions).mockRejectedValueOnce(error);
    const createSpy = vi.spyOn(readline, 'createInterface');
    await expect(pickSession(createStreams())).rejects.toBe(error);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
