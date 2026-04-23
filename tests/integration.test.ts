/**
 * Integration test — end-to-end pipeline with secret redaction.
 *
 * Runs the full pipeline (read → graph → segments → mindmap) on a fixture
 * salted with every redaction-target pattern, then asserts that no original
 * secret literal survives into the rendered text mindmap or any
 * snapshot markdown.
 *
 * SPEC §11 acceptance #8: "Fixture에 심은 sk-ant-dummy-*, ghp_fake* 문자열
 *                          렌더에 노출 0".
 */

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { detectSegments } from '../src/analyzer/segments.js';
import { buildGraph } from '../src/reader/graph.js';
import { readJsonl } from '../src/reader/jsonl.js';
import { renderTextTree } from '../src/render/text.js';
import { buildMindMap } from '../src/tree/builder.js';
import { defaultRedactor } from '../src/utils/redact.js';
import type { MindMapNode } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/secret-laden.jsonl');

async function buildFixtureMindmap(strict = false) {
  const redactor = defaultRedactor({ strict });
  const { meta, events } = await readJsonl(FIXTURE);
  const graph = buildGraph(meta, events);
  const segments = detectSegments(graph.events);
  const mindmap = buildMindMap(graph, segments, {
    jsonlPath: FIXTURE,
    specVersion: 'v0.3-test',
    generatedAt: '2026-04-21T00:00:00.000Z',
    redactor,
  });
  return { mindmap, redactor };
}

function collectAllText(node: MindMapNode): string {
  const parts: string[] = [
    node.label,
    node.summary,
    node.context_snapshot_continue.clipboard_markdown,
    node.context_snapshot_fork.clipboard_markdown,
  ];
  for (const c of node.children) parts.push(collectAllText(c));
  return parts.join('\n');
}

describe('integration — secret redaction end-to-end (terminal-only)', () => {
  it('basic mode: every Cloud / SDK / PAT / private-key pattern stripped from labels and snapshots', async () => {
    const { mindmap } = await buildFixtureMindmap(false);
    const all = collectAllText(mindmap.root);

    const literals = [
      'sk-ant-dummy1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'ghp_fakefakefakefakefakefakefakefakefak',
      'tk_fakefakefakefakefakefakefake',
      'AKIAABCDEFGHIJKLMNOP',
      'AIzaSyDummyDummyDummyDummyDummyDummyDummyD',
    ];
    for (const lit of literals) {
      expect(all, `secret ${lit} leaked into mindmap`).not.toContain(lit);
    }
    expect(all).toContain('***REDACTED***');
  });

  it('strict mode additionally redacts email / phone / credit-card', async () => {
    const { mindmap } = await buildFixtureMindmap(true);
    const all = collectAllText(mindmap.root);

    expect(all).not.toContain('admin@example.com');
    expect(all).not.toContain('4111 1111 1111 1111');
    expect(all).not.toContain('4111111111111111');
    expect(all).toMatch(/\[EMAIL\]|\[CARD\]|\[PHONE\]/);
  });

  it('basic mode leaves benign prose untouched', async () => {
    const { mindmap } = await buildFixtureMindmap(false);
    const all = collectAllText(mindmap.root);
    // The first user message contains "accidentally" alongside the secret —
    // that benign word should survive redaction.
    expect(all).toContain('accidentally');
  });

  it('rendered text tree contains no leaked secret fragments', async () => {
    const { mindmap } = await buildFixtureMindmap(false);
    const tree = renderTextTree(mindmap, { color: false });
    expect(tree.text).not.toMatch(/sk-ant-dummy\d+/);
    expect(tree.text).not.toMatch(/ghp_fake[a-z]+/);
  });
});
