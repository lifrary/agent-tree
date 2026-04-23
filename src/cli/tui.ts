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
} from '../render/text.js';

export interface TuiOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export interface TuiResult {
  /** True if user picked a node and we emitted a snapshot. */
  emitted: boolean;
  /** Selected node id, or null on quit. */
  nodeId: string | null;
  mode: 'continue' | 'fork' | null;
}

export async function runTui(
  mindmap: MindMap,
  opts: TuiOptions = {},
): Promise<TuiResult> {
  const out = opts.output ?? process.stderr;
  const inn = opts.input ?? process.stdin;

  const tree = renderTextTree(mindmap);
  out.write(tree.text + '\n\n');
  out.write(
    'Pick a number to copy that node\'s context.\n' +
      '  • "N"        → continue mode (preserve decisions, change direction)\n' +
      '  • "N fork"   → fork mode (discard subsequent turns)\n' +
      '  • "q"        → quit\n\n',
  );

  const rl = createInterface({ input: inn, output: out });
  try {
    for (;;) {
      const ans = await rl.question('> ');
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
      const snapshot =
        parsed.mode === 'continue'
          ? node.context_snapshot_continue
          : node.context_snapshot_fork;
      // Snapshot markdown goes to STDOUT so users can pipe it directly:
      //   agent-tree 69c2f35e --tui | pbcopy
      process.stdout.write(snapshot.clipboard_markdown);
      out.write(
        `\n\n✓ ${parsed.mode} snapshot for ${node.id} written to stdout` +
          ` (${snapshot.clipboard_markdown.length} chars).\n` +
          `  Paste into a new \`claude\` session to resume from this point.\n`,
      );
      return { emitted: true, nodeId: node.id, mode: parsed.mode };
    }
  } finally {
    rl.close();
  }
}

function notSelected(): TuiResult {
  return { emitted: false, nodeId: null, mode: null };
}
