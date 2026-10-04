import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCliArgs, resolveMode } from '../src/cli/options.js';

function parse(...args: string[]) {
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  return parseCliArgs(['node', 'agent-tree', ...args]);
}
afterEach(() => vi.restoreAllMocks());

describe('CLI argument validation', () => {
  it.each([
    ['--file', 'export.jsonl', '--latest'],
    ['aaaa', '--pick'],
    ['--list', '--snapshot', '1'],
    ['--sessions', '--picks'],
    ['--drop-sidechains', '--flatten-sidechains'],
    ['--mode', 'invalid', '--snapshot', '1'],
    ['--mode', 'fork'],
    ['--diff', '1'],
    ['--diff', '1', '2', '3'],
    ['--limit', '5'],
    ['--sessions', 'aaaa'],
    ['--sessions', '--dry-run'],
    ['--sessions', '--model', 'ignored'],
    ['--sessions', '--max-llm-tokens', '10'],
    ['--sessions', '--drop-sidechains'],
    ['--picks', '--flatten-sidechains'],
    ['--picks', '--no-llm'],
    ['--sessions', '--redact-dryrun'],
    ['--json', '--tui'],
    ['--json', '--filter', 'file'],
    ['--json', '--phases-only'],
    ['--unknown'],
  ])('rejects invalid or conflicting arguments %j', (...args) => {
    expect(parse(...args)).toEqual({ ok: false, exitCode: 2 });
  });

  it.each(['0', '-1', '1.5', '1e3', '10junk', '9007199254740992'])(
    'rejects invalid token budget %s',
    (budget) => {
      expect(parse('--max-llm-tokens', budget)).toEqual({ ok: false, exitCode: 2 });
      expect(parse('--sessions', '--limit', budget)).toEqual({ ok: false, exitCode: 2 });
    },
  );

  it('leaves LLM defaults to the resolved config', () => {
    const parsed = parse('--list');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.opts.model).toBeUndefined();
    expect(parsed.opts.maxLlmTokens).toBeUndefined();
  });

  it('parses explicit budgets and portable JSON output', () => {
    const parsed = parse(
      '--file',
      './export.jsonl',
      '--json',
      '--max-llm-tokens',
      '1200',
      '--strict',
    );
    expect(parsed).toMatchObject({
      ok: true,
      opts: { file: './export.jsonl', json: true, maxLlmTokens: 1200, strict: true },
    });
    if (!parsed.ok) return;
    expect(resolveMode(parsed.opts, true)).toMatchObject({ list: true, tui: false });
  });
});
