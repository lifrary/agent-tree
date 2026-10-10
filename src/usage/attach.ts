/**
 * Attribute usage to steps and sum it over subtrees.
 *
 * Each call, compaction and subagent belongs to the step of its event (the
 * deepest node holding it, `buildStepIndex`); one whose event no node holds,
 * for example a dropped sidechain, belongs to the root, so the root always
 * holds the session total. A node's usage is inclusive of its subtree.
 *
 * A session whose logs carry no calls gets no usage anywhere ("no data");
 * otherwise every node gets usage, zeros included, so absence keeps meaning
 * "not logged" rather than "nothing happened here".
 */

import type { SessionSourceId, UsageSample } from '../sources/types.js';
import { buildStepIndex } from '../tree/steps.js';
import type { MindMap, MindMapNode, RawEvent, StepUsage } from '../types.js';
import type { Logger } from '../utils/logger.js';
import { claudeMainUsage } from './claude.js';
import { codexCompactions } from './codex.js';
import { readClaudeSubagents } from './subagents.js';
import { addUsage, emptyUsage } from './sum.js';
import type { CompactionAt, SubagentUsageAt } from './types.js';

export interface SessionUsage {
  calls: UsageSample[];
  compactions: CompactionAt[];
  /** Undefined when the source has no subagent transcripts for this session. */
  subagents?: SubagentUsageAt[];
}

export interface CollectUsageInput {
  source: SessionSourceId;
  jsonlPath: string;
  events: RawEvent[];
  /** Samples the reader logged outside the events (Codex). */
  samples?: UsageSample[];
  logger?: Logger;
}

export async function collectSessionUsage(input: CollectUsageInput): Promise<SessionUsage> {
  if (input.source === 'codex') {
    return { calls: input.samples ?? [], compactions: codexCompactions(input.events) };
  }
  const main = claudeMainUsage(input.events);
  const files = await readClaudeSubagents(input.jsonlPath, input.events, input.logger);
  const subagents =
    files === undefined && main.sidechains.length === 0
      ? undefined
      : [...main.sidechains, ...(files ?? [])];
  return { calls: main.samples, compactions: main.compactions, subagents };
}

/** Read the session's usage and attach it to the mindmap (one pipeline call). */
export async function attachSessionUsage(
  mindmap: MindMap,
  input: CollectUsageInput,
): Promise<void> {
  attachUsage(mindmap, await collectSessionUsage(input));
}

export function attachUsage(mindmap: MindMap, usage: SessionUsage): void {
  const subagentCalls = usage.subagents?.reduce((sum, agent) => sum + agent.calls, 0) ?? 0;
  if (usage.calls.length === 0 && subagentCalls === 0) return;

  const index = buildStepIndex(mindmap);
  const ownerOf = (uuid: string | null): MindMapNode => {
    if (uuid === null) return mindmap.root;
    const step = index.stepOfEvent(uuid);
    return (step === undefined ? undefined : index.nodeOfStep(step)) ?? mindmap.root;
  };
  const withSubagents = usage.subagents !== undefined;
  const own = new Map<MindMapNode, StepUsage>();
  const ownUsage = (node: MindMapNode): StepUsage => {
    let entry = own.get(node);
    if (!entry) {
      entry = emptyUsage(withSubagents);
      own.set(node, entry);
    }
    return entry;
  };

  for (const call of usage.calls) {
    const entry = ownUsage(ownerOf(call.eventUuid));
    entry.calls += 1;
    entry.prompt_tokens += call.prompt_tokens;
    entry.cache_read_tokens += call.cache_read_tokens;
    entry.cache_write_tokens += call.cache_write_tokens;
    entry.output_tokens += call.output_tokens;
    entry.reasoning_tokens += call.reasoning_tokens;
    entry.context_peak = Math.max(entry.context_peak, call.prompt_tokens);
    if (call.context_window !== null) entry.context_window = call.context_window;
  }
  for (const { eventUuid, ...compaction } of usage.compactions) {
    ownUsage(ownerOf(eventUuid)).compactions.push(compaction);
  }
  for (const agent of usage.subagents ?? []) {
    const subagents = ownUsage(ownerOf(agent.eventUuid)).subagents!;
    subagents.count += 1;
    subagents.calls += agent.calls;
    subagents.prompt_tokens += agent.prompt_tokens;
    subagents.output_tokens += agent.output_tokens;
  }

  const inclusive = (node: MindMapNode): StepUsage => {
    let total = own.get(node) ?? emptyUsage(withSubagents);
    for (const child of node.children) total = addUsage(total, inclusive(child));
    node.usage = total;
    return total;
  };
  mindmap.stats.usage = structuredClone(inclusive(mindmap.root));
}
