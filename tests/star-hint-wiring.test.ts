import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runTuiMode = vi.fn();
const maybeShowStarHint = vi.fn();

vi.mock('../src/cli/modes.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/cli/modes.js')>()),
  runTuiMode: (...args: unknown[]) => runTuiMode(...args),
}));
vi.mock('../src/utils/star_hint.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/star_hint.js')>()),
  maybeShowStarHint: (...args: unknown[]) => maybeShowStarHint(...args),
}));

const { main } = await import('../src/cli.js');
const fixture = resolve('tests/fixtures/minimal-session.jsonl');
const streams = [process.stdin, process.stdout, process.stderr] as const;
const saved = streams.map((stream) => Object.getOwnPropertyDescriptor(stream, 'isTTY'));

function setTTY(value: boolean): void {
  for (const stream of streams) {
    Object.defineProperty(stream, 'isTTY', { value, configurable: true, writable: true });
  }
}

beforeEach(() => {
  runTuiMode.mockReset();
  maybeShowStarHint.mockReset();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  streams.forEach((stream, index) => {
    const descriptor = saved[index];
    if (descriptor) Object.defineProperty(stream, 'isTTY', descriptor);
    else delete (stream as { isTTY?: boolean }).isTTY;
  });
});

const argv = (...args: string[]) => ['node', 'agent-tree', '--file', fixture, '--no-llm', ...args];

describe('star hint wiring in main()', () => {
  it('offers the hint after a successful interactive resume', async () => {
    setTTY(true);
    runTuiMode.mockResolvedValue(0);
    expect(await main(argv())).toBe(0);
    expect(runTuiMode).toHaveBeenCalledTimes(1);
    expect(maybeShowStarHint).toHaveBeenCalledTimes(1);
    expect(maybeShowStarHint.mock.calls[0][0]).toMatchObject({ stdoutIsTTY: true, stderrIsTTY: true });
  });

  it('does not offer it when the user quits the interactive tree', async () => {
    setTTY(true);
    runTuiMode.mockResolvedValue(130);
    expect(await main(argv())).toBe(130);
    expect(maybeShowStarHint).not.toHaveBeenCalled();
  });

  it('does not offer it outside the interactive tree', async () => {
    setTTY(false);
    expect(await main(argv('--list'))).toBe(0);
    expect(runTuiMode).not.toHaveBeenCalled();
    expect(maybeShowStarHint).not.toHaveBeenCalled();
  });
});
