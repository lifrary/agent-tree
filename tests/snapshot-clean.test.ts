/**
 * Regression test for the snapshot UX bug fix.
 *
 * Catches any future drift back to the "M3 narrative placeholder" /
 * "M4 will paste..." style of internal-jargon leakage in the user-visible
 * clipboard markdown.
 */

import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { detectSegments } from '../src/analyzer/segments.js';
import { labelMindMap } from '../src/llm/labeler.js';
import { buildGraph } from '../src/reader/graph.js';
import { readJsonl } from '../src/reader/jsonl.js';
import { buildMindMap } from '../src/tree/builder.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'fixtures/minimal-session.jsonl');

const FORBIDDEN_PHRASES = [
  '(M3 narrative placeholder)',
  '(M3 next-step bullet)',
  '(M4 will paste',
  '(M4 will extract',
  '(M3 LLM summary will populate',
  'M3 placeholder',
  'M4 placeholder',
];

async function buildFixtureMindmap() {
  const { meta, events } = await readJsonl(FIXTURE);
  const graph = buildGraph(meta, events);
  const segments = detectSegments(graph.events);
  const mindmap = buildMindMap(graph, segments, {
    jsonlPath: FIXTURE,
    specVersion: 'v0.3-test',
    generatedAt: '2026-04-22T00:00:00.000Z',
  });
  return { mindmap, graph, segments };
}

function walkMarkdown(
  node: import('../src/types.js').MindMapNode,
  fn: (md: string, mode: 'continue' | 'fork', nodeId: string) => void,
): void {
  fn(node.context_snapshot_continue.clipboard_markdown, 'continue', node.id);
  fn(node.context_snapshot_fork.clipboard_markdown, 'fork', node.id);
  for (const c of node.children) walkMarkdown(c, fn);
}

describe('heuristic snapshot UX (no LLM)', () => {
  it('no node leaks internal milestone jargon into the clipboard markdown', async () => {
    const { mindmap } = await buildFixtureMindmap();
    walkMarkdown(mindmap.root, (md, mode, nodeId) => {
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(
          md,
          `node ${nodeId} (${mode}) leaked "${phrase}"`,
        ).not.toContain(phrase);
      }
    });
  });

  it('root snapshot embeds the FIRST user instruction verbatim', async () => {
    const { mindmap } = await buildFixtureMindmap();
    // Fixture's first user msg: "Please read src/foo.ts and explain"
    expect(mindmap.root.context_snapshot_continue.clipboard_markdown).toContain(
      '> Please read src/foo.ts and explain',
    );
  });

  it('a segment snapshot embeds its LAST user instruction verbatim', async () => {
    const { mindmap } = await buildFixtureMindmap();
    // Fixture seg containing the topic-shift event has user text "이제 다른 작업..."
    let foundQuoted = false;
    walkMarkdown(mindmap.root, (md) => {
      if (md.includes('> 이제 다른 작업. Edit src/bar.ts')) foundQuoted = true;
    });
    expect(foundQuoted).toBe(true);
  });

  it('section headings exist; sections without data are omitted, not stubbed', async () => {
    const { mindmap } = await buildFixtureMindmap();
    const md = mindmap.root.context_snapshot_continue.clipboard_markdown;
    // Heuristic root: no LLM → no "Decisions locked in" or "Suggested continuation"
    expect(md).not.toContain('## Decisions locked in before this point');
    expect(md).not.toContain('## Suggested continuation');
    // But Last user instruction IS present (we anchored to first user event)
    expect(md).toContain('## Last user instruction at this point');
    expect(md).toContain('## Full session reference');
  });
});

describe('LLM-enriched snapshot', () => {
  it('adds Decisions / Suggested continuation when label is supplied', async () => {
    const { mindmap, graph, segments } = await buildFixtureMindmap();

    const client = {
      messages: {
        create: vi.fn(async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                label: 'Mocked label',
                summary: 'Mocked summary of segment work.',
                type: 'topic',
                color: 'green',
                next_steps: ['Refactor X', 'Add tests for Y'],
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
    });

    let foundEnriched = false;
    walkMarkdown(mindmap.root, (md) => {
      // The LLM enrichment must surface in the snapshot:
      //   - the model's `summary` lands in the "Context up to this point" block
      //   - each `next_steps` entry lands in the "Suggested continuation" block
      // ("Decisions locked in" was dropped in the audit pass — its body was
      // identical to "Context up to this point" so it added no info; the test
      // used to assert both for redundancy.)
      if (
        md.includes('## Context up to this point') &&
        md.includes('## Suggested continuation') &&
        md.includes('- Refactor X') &&
        md.includes('Mocked summary of segment work.')
      ) {
        foundEnriched = true;
      }
      // And still no jargon leaks through the rebuild
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(md).not.toContain(phrase);
      }
    });
    expect(foundEnriched).toBe(true);
  });
});
