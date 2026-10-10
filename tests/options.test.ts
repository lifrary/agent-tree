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
    ['--source'],
    ['--source', 'invalid'],
    ['--source', 'CODEX'],
    ['--source', '../codex'],
    ['--source', ''],
    ['--unknown'],
    ['--search', ''],
    ['--search', '   '],
    ['--search', 'x'.repeat(201)],
    ['--search', 'a\nb'],
    ['--search', 'x', '--list'],
    ['--search', 'x', '--sessions'],
    ['--search', 'x', 'aaaa'],
    ['--search', 'x', '--latest'],
    ['--search', 'x', '--file', 'export.jsonl'],
    ['--search', 'x', '--dry-run'],
    ['--search', 'x', '--strict'],
    ['--search', 'x', '--no-llm'],
    ['--search', 'x', '--phases-only'],
    ['--search', 'x', '--since', '0'],
    ['--since', '3'],
    ['--include-tool-output'],
    ['--list', '--include-tool-output'],
    ['--search', 'x', '--usage'],
    ['--sessions', '--usage'],
    ['--snapshot', '1', '--usage'],
    ['--diff', '1', '2', '--usage'],
    ['--open', '1', '--usage'],
    ['--open', '1', '--json'],
    ['--open', '1', '--dump-json', 'out'],
    ['--open', '1', '--dry-run'],
    ['--open', '1', '--snapshot', '2'],
    ['--open', '1', '--agent', 'gemini'],
    ['--agent', 'codex'],
    ['--open-dir', '/tmp'],
    ['--snapshot', '1', '--agent', 'codex'],
    ['--open', ''],
    ['--open', ' '],
    ['--sessions', '--no-color'],
    ['--search', 'x', '--no-group'],
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

  it.each(['claude', 'codex'])('accepts optional source %s with every workflow', (source) => {
    for (const args of [
      ['--sessions', '--json'],
      ['--picks'],
      ['--file', 'export.jsonl', '--json'],
      ['aaaa1111', '--list'],
      ['--latest', '--snapshot', '1'],
      ['--file', 'export.jsonl', '--unstar', '1'],
      ['--file', 'export.jsonl', '--diff', '1', '2'],
      ['--pick'],
      ['--search', 'redactor'],
      ['--file', 'export.jsonl', '--open', '1'],
    ]) {
      expect(parse('--source', source, ...args)).toMatchObject({ ok: true, opts: { source } });
    }
  });

  it('preserves absent source for file auto-detection and cross-source picks', () => {
    for (const args of [['--file', 'export.jsonl', '--json'], ['--picks'], ['--sessions']]) {
      const parsed = parse(...args);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.opts.source).toBeUndefined();
    }
  });

  it('parses search with every scope option', () => {
    const parsed = parse(
      '--search',
      'Redactor',
      '--json',
      '--limit',
      '5',
      '--since',
      '7',
      '--include-tool-output',
      '--cwd',
      '/tmp',
      '--redact-strict',
    );
    expect(parsed).toMatchObject({
      ok: true,
      opts: {
        search: 'Redactor',
        json: true,
        limit: 5,
        since: 7,
        includeToolOutput: true,
        cwd: '/tmp',
      },
    });
    expect(parse('--search', 'x'.repeat(200))).toMatchObject({ ok: true });
    expect(parse('--search', 'x', '--no-color')).toMatchObject({ ok: true, opts: { color: false } });
  });

  it.each([['--list'], ['--json'], ['--phases-only'], ['--tui'], []])(
    'accepts --usage with tree output %j',
    (...args) => {
      expect(parse(...args, '--usage')).toMatchObject({ ok: true, opts: { usage: true } });
    },
  );

  it('parses --open as its own mode', () => {
    const parsed = parse(
      'aaaa1111',
      '--open',
      '12',
      '--mode',
      'fork',
      '--agent',
      'codex',
      '--open-dir',
      '/tmp',
    );
    expect(parsed).toMatchObject({
      ok: true,
      opts: { open: '12', mode: 'fork', agent: 'codex', openDir: '/tmp' },
    });
    if (!parsed.ok) return;
    expect(resolveMode(parsed.opts, true)).toMatchObject({
      open: true,
      tui: false,
      list: false,
      snapshot: false,
    });
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
