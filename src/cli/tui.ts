/**
 * Interactive TUI — readline-based numeric selection over the mindmap.
 *
 * Shown to the user when they run `agent-tree <sid>` in a terminal (default
 * on TTY stdout) without `--list`. The skill / MCP flow uses `--list` +
 * `--snapshot` directly; this TUI is for direct shell use.
 */

import { createInterface } from 'node:readline/promises';

import type { MindMap } from '../types.js';
import {
  lookupSnapshot,
  parseSelection,
  renderTextTree,
  type TextRenderOptions,
} from '../render/text.js';

export interface TuiOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  render?: TextRenderOptions;
}

export type TuiResult =
  | { selected: true; nodeId: string; mode: 'continue' | 'fork' }
  | { selected: false; nodeId: null; mode: null };

export async function runTui(mindmap: MindMap, opts: TuiOptions = {}): Promise<TuiResult> {
  const out = opts.output ?? process.stderr;
  const inn = opts.input ?? process.stdin;

  const tree = renderTextTree(mindmap, opts.render);
  out.write(tree.text + '\n\n');
  out.write(
    "Pick a number to copy that node's context.\n" +
      '  • "N"        → continue mode (preserve decisions, change direction)\n' +
      '  • "N fork"   → fork mode (discard subsequent turns)\n' +
      '  • "q"        → quit\n\n',
  );

  const rl = createInterface({ input: inn, output: out });
  const controller = new AbortController();
  const abort = () => controller.abort();
  rl.once('SIGINT', abort);
  rl.once('close', abort);
  try {
    for (;;) {
      const ans = await rl.question('> ', { signal: controller.signal });
      const parsed = parseSelection(ans);
      if (!parsed.ok) {
        if (parsed.reason === 'user quit') return notSelected();
        out.write(`  ! ${parsed.reason}\n`);
        continue;
      }
      const node = lookupSnapshot(mindmap, parsed.numberOrId!, tree);
      if (!node) {
        out.write(`  ! no node matches "${parsed.numberOrId}"\n`);
        continue;
      }
      // The caller shares the snapshot path with --snapshot: git context,
      // redaction, history and clipboard behavior must not diverge here.
      return { selected: true, nodeId: node.id, mode: parsed.mode };
    }
  } catch (error) {
    if (controller.signal.aborted && error instanceof Error && error.name === 'AbortError') {
      return notSelected();
    }
    throw error;
  } finally {
    rl.off('SIGINT', abort);
    rl.off('close', abort);
    rl.close();
  }
}

function notSelected(): TuiResult {
  return { selected: false, nodeId: null, mode: null };
}
