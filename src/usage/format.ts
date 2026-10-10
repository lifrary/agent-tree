/** Compact token figures for the `--usage` tree columns. */

import type { MindMapNode, StepUsage } from '../types.js';
import { addUsage } from './sum.js';

/** 950 → "950", 9100 → "9.1k", 182000 → "182k", 2412000 → "2.4M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 9_950) return `${(n / 1000).toFixed(1)}k`;
  if (n < 999_500) return `${Math.round(n / 1000)}k`;
  if (n < 9_950_000) return `${(n / 1e6).toFixed(1)}M`;
  if (n < 999_500_000) return `${Math.round(n / 1e6)}M`;
  if (n < 9_950_000_000) return `${(n / 1e9).toFixed(1)}B`;
  return `${Math.round(n / 1e9)}B`;
}

type Compaction = StepUsage['compactions'][number];

/** Compactions of this node that none of its children hold (a row shows only its own). */
function ownCompactions(node: MindMapNode): Compaction[] {
  const key = (c: Compaction) => JSON.stringify([c.pre_tokens, c.post_tokens, c.trigger]);
  const inChildren = new Map<string, number>();
  for (const child of node.children) {
    for (const c of child.usage?.compactions ?? []) {
      inChildren.set(key(c), (inChildren.get(key(c)) ?? 0) + 1);
    }
  }
  return (node.usage?.compactions ?? []).filter((c) => {
    const left = inChildren.get(key(c)) ?? 0;
    if (left === 0) return true;
    inChildren.set(key(c), left - 1);
    return false;
  });
}

/** What one tree row reports: its subtree's usage, and the compactions in the row itself. */
export interface RowUsage {
  usage: StepUsage;
  compactions: Compaction[];
}

export function rowUsage(node: MindMapNode): RowUsage | undefined {
  return node.usage ? { usage: node.usage, compactions: ownCompactions(node) } : undefined;
}

/** One row standing for several sibling rows (collapsed runs). */
export function sumRowUsage(rows: Array<RowUsage | undefined>): RowUsage | undefined {
  const present = rows.filter((row): row is RowUsage => row !== undefined);
  if (present.length === 0) return undefined;
  return {
    usage: present.map((row) => row.usage).reduce((a, b) => addUsage(a, b)),
    compactions: present.flatMap((row) => row.compactions),
  };
}

/** The usage column of one row; empty when the step made no calls and compacted nothing. */
export function formatUsage(row: RowUsage | undefined): string {
  if (!row) return '';
  const { usage, compactions } = row;
  const parts: string[] = [];
  if (usage.calls > 0) {
    const window = usage.context_window === null ? '' : `/${formatTokens(usage.context_window)}`;
    parts.push(
      `prompt ${formatTokens(usage.prompt_tokens)} · out ${formatTokens(usage.output_tokens)}` +
        ` · ctx ${formatTokens(usage.context_peak)}${window}`,
    );
  }
  for (const c of compactions) {
    parts.push(
      c.pre_tokens === null || c.post_tokens === null
        ? 'compacted'
        : `compacted ${formatTokens(c.pre_tokens)} → ${formatTokens(c.post_tokens)}`,
    );
  }
  const agents = usage.subagents;
  if (agents && agents.calls > 0) {
    parts.push(
      `${agents.count} agent${agents.count === 1 ? '' : 's'} prompt ${formatTokens(agents.prompt_tokens)}` +
        ` · out ${formatTokens(agents.output_tokens)}`,
    );
  }
  return parts.join('  ');
}
