/**
 * Security-hardening regression suite.
 *
 * Covers patches landed during the post-rebrand audit pass:
 *   - new redaction patterns (gcp_oauth_token, github_pat_finegrained,
 *     openai_project_key, stripe_secret_key, huggingface_token)
 *   - dumpArtifacts redactor threading + protected-path rejection +
 *     flag:'wx' overwrite refusal + mode:0o600 file perms
 *   - picksFileFor SESSION_ID_RE validator (defense-in-depth path-traversal)
 *   - removePicksForNode atomic tmp+rename
 *   - safeGitCwd realpath/isAbsolute/null-byte rejection
 *   - looksLikeSystemNoise expansion (Stop hook / Base directory / shell
 *     prompt prefixes filtered out of phase headers)
 *
 * Each block is intentionally narrow — the goal is fast lock-in for the new
 * code paths so a future regression turns the bar red instead of silently
 * shipping.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { detectSegments } from '../src/analyzer/segments.js';
import { dumpArtifacts } from '../src/cli/modes.js';
import { labelMindMap } from '../src/llm/labeler.js';
import { buildGraph } from '../src/reader/graph.js';
import { readJsonl } from '../src/reader/jsonl.js';
import { buildMindMap } from '../src/tree/builder.js';
import { defaultRedactor } from '../src/utils/redact.js';
import {
  readPicks,
  recordPick,
  removePicksForNode,
} from '../src/utils/picks.js';
import { safeGitCwd } from '../src/utils/safe_path.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/minimal-session.jsonl');

// ---------------------------------------------------------------------------
// 1. New redaction patterns
// ---------------------------------------------------------------------------

describe('redactor — new patterns added in audit pass', () => {
  const r = defaultRedactor();

  it('catches GitHub fine-grained PATs (github_pat_<82+ chars>)', () => {
    const fake =
      'github_pat_11ABCDEFG0' +
      'qwertyuiopasdfghjklzxcvbnm0123456789' +
      '_QWERTYUIOPASDFGHJKLZXCVBNM0123456789ab';
    expect(fake.length).toBeGreaterThanOrEqual(82 + 'github_pat_'.length);
    const text = `My PAT is ${fake} for testing.`;
    expect(r.apply(text)).not.toContain(fake);
    expect(r.apply(text)).toContain('github_pat_***REDACTED***');
  });

  it('catches OpenAI project / svcacct / admin keys (sk-(proj|svcacct|admin)-…)', () => {
    for (const variant of ['proj', 'svcacct', 'admin']) {
      const fake = `sk-${variant}-abcdefghijklmnopqrstu`;
      const text = `key=${fake}`;
      expect(r.apply(text)).not.toContain(fake);
      expect(r.apply(text)).toContain('sk-***REDACTED***');
    }
  });

  it('catches Stripe live + test secret keys', () => {
    for (const env of ['live', 'test']) {
      const fake = `sk_${env}_abcdefghij0123456789ABCD`;
      expect(fake.length).toBeGreaterThanOrEqual(`sk_${env}_`.length + 24);
      const text = `Stripe key is ${fake}.`;
      expect(r.apply(text)).not.toContain(fake);
      expect(r.apply(text)).toContain('sk_***REDACTED***');
    }
  });

  it('catches npm automation tokens (npm_<36 alnum>) from pasted .npmrc', () => {
    const fake = 'npm_abcdefghij0123456789ABCDEFGHIJ012345';
    expect(fake.length).toBe('npm_'.length + 36);
    const text = `//registry.npmjs.org/:_authToken=${fake}\n`;
    expect(r.apply(text)).not.toContain(fake);
    expect(r.apply(text)).toContain('npm_***REDACTED***');
  });

  it('catches Hugging Face access tokens (hf_<30+ chars>)', () => {
    const fake = 'hf_abcdefghij0123456789ABCDEFGHIJ';
    const text = `auth=${fake}`;
    expect(r.apply(text)).not.toContain(fake);
    expect(r.apply(text)).toContain('hf_***REDACTED***');
  });

  it('catches GCP OAuth access tokens (ya29.…)', () => {
    const fake = 'ya29.A0AfH6SMC_thisIsNotARealToken123';
    const text = `Authorization: Bearer ${fake}`;
    // Bearer pattern fires too — both should redact, neither should leak.
    expect(r.apply(text)).not.toContain(fake);
  });

  it('does NOT mangle `sk-ant-…` keys via the openai pattern (regression)', () => {
    const fakeAnthropic =
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const text = `key=${fakeAnthropic}`;
    const out = r.apply(text);
    // Anthropic-specific replacement wins; no leftover sk-ant- substring.
    expect(out).not.toContain(fakeAnthropic);
    expect(out).toContain('sk-ant-***REDACTED***');
  });
});

// ---------------------------------------------------------------------------
// 1b. Token class-boundary audit — trailing `-`/`_` characters
//
// Patterns whose character class contains `-` and use a trailing `\b` to
// terminate had a latent bug: `\b` requires a word↔non-word transition, but
// a token ending on `-` (non-word) followed by space / `.` / EOF (non-word)
// has no such transition — `\b` fails to match, and the token either leaks
// partially or not at all. Fixed via negative-lookahead `(?![class])`.
// This block pins the fix and also locks in the "already safe" status of
// audited-but-untouched patterns (hf_token has no `-` in class;
// bearer_token has no trailing anchor).
// ---------------------------------------------------------------------------

describe('token class-boundary audit — trailing `-`/`_` hardening', () => {
  const r = defaultRedactor();

  it('redacts GCP API key whose 35th char is `-` (fixed-length {35} + \\b bug)', () => {
    // 35 chars after `AIza`; last one is `-`. Old regex `/\bAIza[0-9A-Za-z_-]{35}\b/g`
    // could not shorten the match (fixed length), so `\b` failure on the
    // trailing `-` left the whole key unredacted.
    const key = 'AIza' + 'x'.repeat(34) + '-';
    expect(key.length).toBe(4 + 35);
    const text = `key=${key} done`;
    const out = r.apply(text);
    expect(out).not.toContain(key);
    expect(out).toContain('AIza***REDACTED***');
  });

  it('redacts GCP API key whose 35th char is `_`', () => {
    const key = 'AIza' + 'y'.repeat(34) + '_';
    // `_` IS a word char, so the old regex caught this one — but we want the
    // new lookahead to keep behaving identically (no regression).
    expect(r.apply(`auth=${key}.`)).toContain('AIza***REDACTED***');
  });

  it('redacts JWT whose signature ends in `--`', () => {
    // base64url signature can end with `-`. With multiple trailing `-`s the
    // old regex could not back off within `{10,}` to land on a word char
    // (would undershoot the minimum) — the entire JWT would leak.
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.' +
      'eyJzdWIiOiIxMjM0NSJ9.' +
      'abcdefghij--';
    const text = `auth: ${jwt} next`;
    const out = r.apply(text);
    expect(out).not.toContain('abcdefghij--');
    expect(out).toContain('eyJ***REDACTED.JWT***');
  });

  it('redacts JWT at end-of-input (no trailing char at all)', () => {
    // Lookahead `(?![class])` is satisfied at EOF (no next char).
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.' +
      'eyJzdWIiOiIxMjM0NSJ9.' +
      'SlGGjaSU_SigFin';
    expect(r.apply(jwt)).toBe('eyJ***REDACTED.JWT***');
  });

  it('audit: hf_token class has no `-`, so trailing \\b is already safe', () => {
    // Lock in the audit finding — `hf_[A-Za-z0-9]` has no `-`, so `\b` works.
    const token = 'hf_' + 'Z'.repeat(35);
    expect(r.apply(`auth=${token}`)).toContain('hf_***REDACTED***');
  });

  it('audit: bearer_token has no trailing anchor, so greedy match eats the seam', () => {
    // Bearer pattern uses `{20,}` unbounded-greedy with no end anchor — the
    // trailing-class-`\b` bug can't apply. Whatever characters the class
    // accepts get eaten.
    const payload = 'X'.repeat(30) + '-._-';
    const out = r.apply(`Bearer ${payload} done`);
    expect(out).toContain('Bearer ***REDACTED***');
    expect(out).not.toContain(payload);
  });
});

// ---------------------------------------------------------------------------
// 2. picksFileFor validator + atomic removePicksForNode
// ---------------------------------------------------------------------------

describe('picks — sessionId validator + atomic delete', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agent-tree-picks-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('rejects path-traversal sessionId before composing a path', async () => {
    await expect(
      recordPick('../../etc/passwd', 'n_001', 'continue', { root }),
    ).rejects.toThrow(/invalid sessionId/);
  });

  it('rejects empty / whitespace sessionId', async () => {
    await expect(recordPick('', 'n_001', 'continue', { root })).rejects.toThrow();
    await expect(
      recordPick('   ', 'n_001', 'continue', { root }),
    ).rejects.toThrow();
  });

  it('accepts a valid UUID-shape sessionId', async () => {
    const sid = 'fd8b7e83-8302-4f55-8e09-d18d37880159';
    await recordPick(sid, 'n_001', 'continue', { root });
    const picks = await readPicks(sid, { root });
    expect(picks.total).toBe(1);
  });

  it('removePicksForNode atomically replaces the file (no half-written intermediate)', async () => {
    const sid = 'aaaaaaaa-1111-2222-3333-444444444444';
    await recordPick(sid, 'n_001', 'continue', { root });
    await recordPick(sid, 'n_002', 'fork', { root });
    await recordPick(sid, 'n_001', 'fork', { root });
    const removed = await removePicksForNode(sid, 'n_001', { root });
    expect(removed).toBe(2);
    const after = await readPicks(sid, { root });
    expect(after.total).toBe(1);
    // The implementation writes a `.tmp-…` sibling then renames; after the
    // rename completes there must be no leftover tmp file.
    const file = join(root, `${sid}.jsonl`);
    const dir = dirname(file);
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir);
    expect(entries.some((e) => e.startsWith(`${sid}.jsonl.tmp-`))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. dumpArtifacts redaction + protected-path rejection + flag:'wx'
// ---------------------------------------------------------------------------

describe('dumpArtifacts — security hardening', () => {
  let outRoot: string;
  beforeEach(async () => {
    outRoot = await mkdtemp(join(tmpdir(), 'agent-tree-dump-'));
  });
  afterEach(async () => {
    await rm(outRoot, { recursive: true, force: true });
  });

  async function buildFixtureBundle() {
    const redactor = defaultRedactor();
    const { meta, events } = await readJsonl(FIXTURE);
    const graph = buildGraph(meta, events);
    const segments = detectSegments(graph.events);
    const mindmap = buildMindMap(graph, segments, {
      jsonlPath: FIXTURE,
      specVersion: 'v0.3-test',
    });
    return { graph, segments, mindmap, redactor };
  }

  it('refuses to dump under protected paths (matches PROTECTED_DUMP_PREFIXES)', async () => {
    const { graph, segments, mindmap, redactor } = await buildFixtureBundle();
    // Each path matches a prefix in src/cli/modes.ts PROTECTED_DUMP_PREFIXES
    // and is rejected BEFORE the mkdir would even fire (so OS perms don't
    // shadow our defense).
    for (const banned of [
      '/etc/atree-test',
      '/var/log/atree-test',
      '/bin/atree-test',
      '/System/atree-test',
    ]) {
      await expect(
        dumpArtifacts(banned, graph, segments, mindmap, redactor),
      ).rejects.toThrow(/refusing to dump/i);
    }
  });

  it('runs every payload through the redactor (no raw graph.events leak)', async () => {
    // Construct a graph whose first event carries a fake API key in `cwd`.
    const { graph, segments, mindmap, redactor } = await buildFixtureBundle();
    const SECRET = 'sk-ant-api03-CANARY0CANARY0CANARY0CANARY0CANARY';
    if (graph.events.length > 0) {
      // mutate in-place — buildFixtureBundle returned us the graph by ref
      (graph.events[0] as { cwd?: string }).cwd =
        `/Users/dev/path-with-${SECRET}`;
    }
    const dir = join(outRoot, 'subdir');
    await dumpArtifacts(dir, graph, segments, mindmap, redactor);
    const raw = await readFile(join(dir, 'raw-events.json'), 'utf8');
    expect(raw).not.toContain(SECRET);
    expect(raw).toContain('sk-ant-***REDACTED***');
  });

  it('uses flag:"wx" so a second dump into the same dir fails loudly', async () => {
    const { graph, segments, mindmap, redactor } = await buildFixtureBundle();
    const dir = join(outRoot, 'twice');
    await dumpArtifacts(dir, graph, segments, mindmap, redactor);
    await expect(
      dumpArtifacts(dir, graph, segments, mindmap, redactor),
    ).rejects.toThrow(); // EEXIST from O_EXCL
  });

  it('writes files with mode 0o600 (owner-only read/write)', async () => {
    const { graph, segments, mindmap, redactor } = await buildFixtureBundle();
    const dir = join(outRoot, 'perms');
    await dumpArtifacts(dir, graph, segments, mindmap, redactor);
    const st = await stat(join(dir, 'raw-events.json'));
    // mask off type bits, keep perm bits
    const perms = st.mode & 0o777;
    // Some CI / umask combos can clamp; assert no group/other bits at minimum.
    expect(perms & 0o077).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. safeGitCwd
// ---------------------------------------------------------------------------

describe('safeGitCwd — git-spawn cwd hardening', () => {
  it('rejects non-absolute paths', async () => {
    expect(await safeGitCwd('relative/path', '')).toBeNull();
    expect(await safeGitCwd(undefined, 'relative/cwd')).toBeNull();
  });

  it('rejects null-byte paths', async () => {
    expect(await safeGitCwd('/foo\0bar', '/baz\0qux')).toBeNull();
  });

  it('returns realpath for an existing absolute path (events wins over caller)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'agent-tree-safe-'));
    try {
      const got = await safeGitCwd(tmp, '/nonexistent-fallback');
      expect(got).toBeTruthy();
      // realpath may resolve macOS /var → /private/var; just assert absolute
      // and that it ends with our tmp dir's basename.
      expect(got!.endsWith(tmp.split('/').pop()!)).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('falls through to caller cwd if events cwd does not exist', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'agent-tree-safe-'));
    try {
      const got = await safeGitCwd('/this/path/should/not/exist/anywhere', tmp);
      expect(got).toBeTruthy();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns null when no candidate is trustworthy', async () => {
    expect(
      await safeGitCwd('/a/b/c/does/not/exist', '/x/y/z/also/missing'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Labeler defense-in-depth: re-redact LLM-derived output before assignment
// ---------------------------------------------------------------------------

describe('labeler — re-redacts LLM output before assignment', () => {
  it('strips secret-shaped strings from model label/summary/next_steps', async () => {
    // Simulate a misbehaving / hallucinating LLM that emits an API-key-shaped
    // string. The labeler should redact it before assigning to the node so
    // the snapshot factory and renderer never see the raw token.
    const SECRET = 'sk-ant-api03-HALLUCINATED0HALLUCINATED0HALLUCINATED';
    const redactor = defaultRedactor();
    const { meta, events } = await readJsonl(FIXTURE);
    const graph = buildGraph(meta, events);
    const segments = detectSegments(graph.events);
    const mindmap = buildMindMap(graph, segments, {
      jsonlPath: FIXTURE,
      specVersion: 'v0.3-test',
      redactor,
    });

    const client = {
      messages: {
        create: vi.fn(async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                // every model-derived field carries the canary
                label: `Use ${SECRET} for auth`,
                summary: `The session uses ${SECRET} as the upstream key.`,
                type: 'topic',
                color: 'green',
                next_steps: [`Rotate ${SECRET} immediately`],
              }),
            },
          ],
          usage: { input_tokens: 100, output_tokens: 20 },
        })),
      },
    };

    await labelMindMap(mindmap, graph, segments, {
      client,
      model: 'claude-sonnet-4-6',
      jsonlPath: FIXTURE,
      redactor,
    });

    // Walk the tree: nowhere should the canary survive.
    const seen: string[] = [];
    const walk = (n: {
      label: string;
      summary: string;
      context_snapshot_continue: { clipboard_markdown: string };
      context_snapshot_fork: { clipboard_markdown: string };
      children: unknown[];
    }): void => {
      seen.push(n.label, n.summary);
      seen.push(n.context_snapshot_continue.clipboard_markdown);
      seen.push(n.context_snapshot_fork.clipboard_markdown);
      for (const c of n.children as Array<typeof n>) walk(c);
    };
    walk(mindmap.root as unknown as Parameters<typeof walk>[0]);
    const joined = seen.join('\n');
    expect(joined).not.toContain(SECRET);
    expect(joined).toContain('sk-ant-***REDACTED***');
  });
});

// ---------------------------------------------------------------------------
// 6. looksLikeSystemNoise — expanded shapes
//
// Indirect test via the public phase grouping: each noise prefix should
// NOT become a phase head label. We construct a tiny synthetic JSONL on-disk
// so we can run readJsonl → graph → segments → mindmap end-to-end.
// ---------------------------------------------------------------------------

describe('looksLikeSystemNoise — expanded prefix coverage', () => {
  let workdir: string;
  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'agent-tree-noise-'));
  });
  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  async function buildFromText(userTexts: string[]): Promise<string> {
    // Each user message gets a sibling assistant turn so the segment detector
    // produces real segments. parentUuid links them in a chain.
    const lines: string[] = [];
    let prev: string | null = null;
    const sessionId = 'aaaaaaaa-1111-2222-3333-444444444444';
    lines.push(
      JSON.stringify({
        type: 'summary',
        sessionId,
        summary: 'noise-filter test session',
      }),
    );
    userTexts.forEach((text, i) => {
      const userUuid = `u-${i}`;
      const asstUuid = `a-${i}`;
      const ts = new Date(Date.UTC(2026, 0, 1, i, 0, 0)).toISOString();
      lines.push(
        JSON.stringify({
          type: 'user',
          uuid: userUuid,
          parentUuid: prev,
          sessionId,
          timestamp: ts,
          cwd: '/tmp/x',
          message: { role: 'user', content: text },
          isSidechain: false,
        }),
      );
      lines.push(
        JSON.stringify({
          type: 'assistant',
          uuid: asstUuid,
          parentUuid: userUuid,
          sessionId,
          timestamp: new Date(
            Date.UTC(2026, 0, 1, i, 0, 30),
          ).toISOString(),
          cwd: '/tmp/x',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
          },
          isSidechain: false,
        }),
      );
      prev = asstUuid;
    });
    const file = join(workdir, 'noise.jsonl');
    await writeFile(file, lines.join('\n') + '\n', 'utf8');
    return file;
  }

  it('filters Stop hook / Base directory / shell-prompt prefixes from phase labels', async () => {
    // Mix of noise + real prompt; only the real prompt should become a phase
    // head label.
    const file = await buildFromText([
      'Stop hook feedback: [RALPH LOOP - ITERATION 2/100]',
      'Base directory for this skill: cancel',
      '❯ git push --force-with-lease=main:abc123',
      '$ rm -rf node_modules && npm i',
      'Build a CLI tool that does X', // <-- the only real user intent
    ]);
    const { meta, events } = await readJsonl(file);
    const graph = buildGraph(meta, events);
    const segments = detectSegments(graph.events);
    const mindmap = buildMindMap(graph, segments, {
      jsonlPath: file,
      specVersion: 'v0.3-test',
    });
    const allLabels: string[] = [];
    const walk = (n: { label: string; children: unknown[] }): void => {
      allLabels.push(n.label);
      for (const c of n.children as Array<{
        label: string;
        children: unknown[];
      }>) {
        walk(c);
      }
    };
    walk(mindmap.root as unknown as { label: string; children: unknown[] });
    const joined = allLabels.join('\n');
    // None of the noise prefixes should appear as a phase label.
    expect(joined).not.toContain('Stop hook feedback');
    expect(joined).not.toContain('Base directory for this skill');
    expect(joined).not.toMatch(/^❯ /m);
    expect(joined).not.toMatch(/^\$ /m);
  });
});

// ---------------------------------------------------------------------------
// 7. Phone regex ReDoS hardening
// ---------------------------------------------------------------------------

describe('phone regex — ReDoS hardening', () => {
  const r = defaultRedactor({ strict: true });

  it('does not hang on long digit-only pathological input', () => {
    // Old regex had nested optional separators (`[-.\s]?` ×3 + optional
    // prefix group) → exponential backtracking on a long digit run with no
    // word-boundary terminator that matches the full pattern.
    const pathological = '1'.repeat(1000) + 'x';
    const start = Date.now();
    const out = r.apply(pathological);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // typical <1ms; 100ms leaves CI slack
    expect(out).toBe(pathological); // no phone should match this
  });

  it('does not hang on long digit-with-dash pathological input', () => {
    // Another common ReDoS trigger: alternating digit/separator runs that
    // almost match but fail at the word boundary.
    const pathological = '1-'.repeat(500) + 'x';
    const start = Date.now();
    r.apply(pathological);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('still redacts common separated phone formats', () => {
    expect(r.apply('call 010-1234-5678 asap')).toBe('call [PHONE] asap');
    expect(r.apply('US office (415) 555-0123')).toBe('US office [PHONE]');
    expect(r.apply('intl: +82 10-1234-5678')).toBe('intl: [PHONE]');
    expect(r.apply('dial +1-415-555-0123')).toBe('dial [PHONE]');
  });

  it('redacts E.164 pure-digit international numbers', () => {
    expect(r.apply('hit +14155550123 now')).toBe('hit [PHONE] now');
    expect(r.apply('kr: +821012345678')).toBe('kr: [PHONE]');
  });

  it('does not false-positive on long digit runs without separators', () => {
    // Acceptable recall loss: separator-less domestic digits look identical
    // to order / SKU / tracking numbers, so we skip rather than over-redact.
    expect(r.apply('order 12345678901')).toBe('order 12345678901');
    expect(r.apply('sku 0987654321')).toBe('sku 0987654321');
  });
});
