/**
 * Per-mode runners — each consumes a fully-built PipelineResult and emits the
 * mode-specific output. Terminal-only product: list / snapshot / tui / dump.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { graphToDump } from '../reader/graph.js';
import { lookupSnapshot, renderTextTree } from '../render/text.js';
import type { MindMap, SessionGraph, TopicSegment } from '../types.js';
import type { Logger } from '../utils/logger.js';
import type { Redactor } from '../utils/redact.js';
import type { SessionMatch } from '../utils/session_path.js';

import type { CliOptions } from './options.js';
import type { ResolvedConfig } from './pipeline.js';
import { runTui } from './tui.js';
import { copyToClipboard } from '../utils/clipboard.js';
import { formatGitContextMarkdown, getGitContext } from '../utils/git.js';
import {
  listAllPicks,
  readPicks,
  recordPick,
  removePicksForNode,
} from '../utils/picks.js';

export interface ModeContext {
  match: SessionMatch;
  opts: CliOptions;
  config: ResolvedConfig;
  logger: Logger;
  mindmap: MindMap;
  graph: SessionGraph;
  segments: TopicSegment[];
  redactor: Redactor;
  cacheHash: string;
}

// ---------------------------------------------------------------------------
// --list — numbered ASCII tree → stdout
// ---------------------------------------------------------------------------

export async function runListMode(ctx: ModeContext): Promise<number> {
  const picks = await readPicks(ctx.match.sessionId);
  const tree = renderTextTree(ctx.mindmap, {
    filter: ctx.opts.filter,
    groupConsecutive: ctx.opts.group !== false,
    color: ctx.opts.color !== false && !!process.stdout.isTTY,
    picks: picks.modesByNode,
    maxDepth: ctx.opts.phasesOnly ? 1 : undefined,
  });
  process.stdout.write(tree.text + '\n\n');
  process.stdout.write(
    `Pick a node by number. Re-run as:\n` +
      `  agent-tree ${ctx.match.sessionId.slice(0, 8)} --snapshot <number> --mode continue|fork\n`,
  );
  if (picks.total > 0) {
    const starred = picks.modesByNode.size;
    process.stdout.write(
      `(⭐ = previously picked — ${starred} node${starred === 1 ? '' : 's'} starred, ${picks.total} total pick${picks.total === 1 ? '' : 's'})\n`,
    );
  }
  return 0;
}

// ---------------------------------------------------------------------------
// --snapshot <id> --mode continue|fork — single snapshot → stdout
// ---------------------------------------------------------------------------

export async function runSnapshotMode(ctx: ModeContext): Promise<number> {
  const tree = renderTextTree(ctx.mindmap);
  const node = lookupSnapshot(ctx.mindmap, ctx.opts.snapshot!, tree);
  if (!node) {
    console.error(
      `error: no node matches "${ctx.opts.snapshot}". Run --list to see numbers.`,
    );
    return 2;
  }
  const wantFork = (ctx.opts.mode ?? 'continue') === 'fork';
  const baseSnap = wantFork
    ? node.context_snapshot_fork
    : node.context_snapshot_continue;

  // Probe git for the source cwd at snapshot time — it's cheap (~50ms) and
  // gives the new session a concrete code-state anchor to work against.
  const sourceCwd = ctx.graph.events[0]?.cwd || process.cwd();
  const gitCtx = await getGitContext(sourceCwd);
  const gitMd = gitCtx.available ? formatGitContextMarkdown(gitCtx) : null;
  const finalMarkdown = gitMd
    ? appendGitSection(baseSnap.clipboard_markdown, gitMd)
    : baseSnap.clipboard_markdown;

  process.stdout.write(finalMarkdown);

  // Record this pick so future --list / --tui can mark visited nodes.
  // Best-effort — swallow errors so a busted cache dir never blocks output.
  await recordPick(ctx.match.sessionId, node.id, wantFork ? 'fork' : 'continue').catch(
    (err) => ctx.logger.warn?.('pick history write failed', { error: String(err) }),
  );

  // TTY-only: also push to system clipboard so the user can immediately paste
  // into a new `claude` session without remembering `| pbcopy`. When piped or
  // redirected, skip — caller is presumably orchestrating themselves.
  if (process.stdout.isTTY && process.stderr.isTTY) {
    const result = await copyToClipboard(finalMarkdown);
    if (result.ok) {
      console.error(
        `\n✓ ${wantFork ? 'fork' : 'continue'} snapshot for ${node.id} copied via ${result.command}.\n` +
          `  Paste into a new \`claude\` session to resume.`,
      );
    } else {
      console.error(
        `\n(snapshot above is also on stdout — pipe it: agent-tree ... --snapshot ${node.id} | pbcopy)`,
      );
    }
  }
  return 0;
}

/**
 * Insert the git context section just before the trailing "---" footer of
 * a continue snapshot, or just before the "Full session reference" heading
 * for a fork snapshot. Falls back to appending at the end if neither anchor
 * is found (defensive — the snapshot factory always emits one of them).
 */
function appendGitSection(snapshotMd: string, gitMd: string): string {
  const fullRefIdx = snapshotMd.indexOf('## Full session reference');
  if (fullRefIdx >= 0) {
    return snapshotMd.slice(0, fullRefIdx) + gitMd + '\n\n' + snapshotMd.slice(fullRefIdx);
  }
  return snapshotMd + '\n\n' + gitMd + '\n';
}

// ---------------------------------------------------------------------------
// --picks — list every pick across every session (no session arg needed)
// ---------------------------------------------------------------------------

export async function runPicksMode(): Promise<number> {
  const all = await listAllPicks();
  if (all.length === 0) {
    process.stderr.write('No picks recorded yet.\n');
    return 0;
  }
  const lines: string[] = [];
  let totalPicks = 0;
  for (const session of all) {
    lines.push(`session ${session.sessionId.slice(0, 8)}  (${session.picks.length} pick${session.picks.length === 1 ? '' : 's'})`);
    for (const p of session.picks) {
      const when = p.ts.replace('T', ' ').slice(0, 19);
      const mode = p.mode === 'fork' ? 'fork    ' : 'continue';
      lines.push(`  ${when}  ${mode}  ${p.node_id}`);
      totalPicks += 1;
    }
    lines.push('');
  }
  lines.push(`(${totalPicks} total pick${totalPicks === 1 ? '' : 's'} across ${all.length} session${all.length === 1 ? '' : 's'})`);
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

// ---------------------------------------------------------------------------
// --unstar <id> — remove ⭐ from a previously picked node
// ---------------------------------------------------------------------------

export async function runUnstarMode(ctx: ModeContext): Promise<number> {
  const tree = renderTextTree(ctx.mindmap);
  const node = lookupSnapshot(ctx.mindmap, ctx.opts.unstar!, tree);
  if (!node) {
    console.error(
      `error: no node matches "${ctx.opts.unstar}". Run --list to see numbers.`,
    );
    return 2;
  }
  const removed = await removePicksForNode(ctx.match.sessionId, node.id);
  if (removed === 0) {
    process.stderr.write(`No picks recorded for ${node.id} — nothing to unstar.\n`);
    return 0;
  }
  process.stderr.write(
    `✓ Unstarred ${node.id} — removed ${removed} pick entr${removed === 1 ? 'y' : 'ies'}.\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// --diff <a> <b> — summarise what happened between two nodes
// ---------------------------------------------------------------------------

export function runDiffMode(ctx: ModeContext): number {
  const ids = ctx.opts.diff ?? [];
  if (ids.length !== 2) {
    console.error('error: --diff requires exactly two node ids/numbers (e.g. --diff 3 8).');
    return 2;
  }
  const tree = renderTextTree(ctx.mindmap);
  const a = lookupSnapshot(ctx.mindmap, ids[0], tree);
  const b = lookupSnapshot(ctx.mindmap, ids[1], tree);
  if (!a || !b) {
    console.error(
      `error: could not resolve both ids: a=${ids[0]} (${a ? 'ok' : 'missing'}), b=${ids[1]} (${b ? 'ok' : 'missing'})`,
    );
    return 2;
  }
  // Order by index_range start so the "from → to" semantic is consistent
  const [from, to] = a.index_range[0] <= b.index_range[0] ? [a, b] : [b, a];
  const startEvent = from.index_range[0];
  const endEvent = to.index_range[1];
  const span = endEvent - startEvent + 1;

  // Walk the segments slice between the two nodes to collect file/tool churn.
  const sliceSegments = ctx.segments.filter(
    (s) => s.start_index >= startEvent && s.end_index <= endEvent,
  );
  const fileSet = new Set<string>();
  const toolSet = new Set<string>();
  for (const s of sliceSegments) {
    for (const f of s.dominant_files) fileSet.add(f);
    for (const t of s.dominant_tools) toolSet.add(t);
  }

  const lines: string[] = [];
  lines.push(`# Diff: ${from.id} → ${to.id}`);
  lines.push('');
  lines.push(`**From**: ${from.label}`);
  lines.push(`**To**:   ${to.label}`);
  lines.push('');
  lines.push(`- event range: ${startEvent}–${endEvent} (${span} events)`);
  lines.push(`- segments crossed: ${sliceSegments.length}`);
  if (fileSet.size > 0) {
    lines.push(`- files touched (${fileSet.size}):`);
    for (const f of Array.from(fileSet).sort()) lines.push(`  - \`${f}\``);
  }
  if (toolSet.size > 0) {
    lines.push(`- tools used: ${Array.from(toolSet).sort().join(', ')}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

// ---------------------------------------------------------------------------
// --tui — readline interactive
// ---------------------------------------------------------------------------

export async function runTuiMode(ctx: ModeContext): Promise<number> {
  const result = await runTui(ctx.mindmap);
  return result.emitted ? 0 : 130;
}

// ---------------------------------------------------------------------------
// --dump-json — debug artifact dump (independent of output mode)
// ---------------------------------------------------------------------------

export async function dumpArtifacts(
  dir: string,
  graph: SessionGraph,
  segments: TopicSegment[],
  mindmap: MindMap,
): Promise<void> {
  const outDir = resolve(dir);
  await mkdir(outDir, { recursive: true });

  await Promise.all([
    writeFile(
      resolve(outDir, 'raw-events.json'),
      JSON.stringify({ meta: graph.meta, events: graph.events }, null, 2),
      'utf8',
    ),
    writeFile(
      resolve(outDir, 'graph.json'),
      JSON.stringify(graphToDump(graph), null, 2),
      'utf8',
    ),
    writeFile(
      resolve(outDir, 'segments.json'),
      JSON.stringify(
        { session_id: graph.meta.sessionId, count: segments.length, segments },
        null,
        2,
      ),
      'utf8',
    ),
    writeFile(
      resolve(outDir, 'tree.json'),
      JSON.stringify(mindmap, null, 2),
      'utf8',
    ),
  ]);
}
