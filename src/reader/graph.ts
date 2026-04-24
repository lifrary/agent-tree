/**
 * Graph builder — SPEC §7.1 pass 2
 *
 * Reconstruct the parentUuid → children DAG from the linear event list.
 *
 * Edge cases handled per §7.8:
 *   - `parentUuid` self-reference → skip edge + warn (cycle)
 *   - `parentUuid` points to unseen uuid → keep event as an orphan root (warn)
 *   - Duplicate uuid → last one wins in byUuid map, but childrenOf keeps order
 */

import type {
  RawEvent,
  SessionGraph,
  SessionGraphDump,
  SessionMeta,
} from '../types.js';
import type { Logger } from '../utils/logger.js';

export interface BuildGraphOptions {
  logger?: Logger;
}

export function buildGraph(
  meta: SessionMeta,
  events: RawEvent[],
  opts: BuildGraphOptions = {},
): SessionGraph {
  const { logger } = opts;

  const childrenOf = new Map<string, string[]>();
  const byUuid = new Map<string, RawEvent>();
  const roots: string[] = [];

  // First pass: collect all uuids so we can distinguish true orphans from
  // forward references (child appears before parent in the jsonl).
  const seenUuids = new Set<string>();
  for (const e of events) seenUuids.add(e.uuid);

  for (const e of events) {
    if (byUuid.has(e.uuid)) {
      logger?.warn(`duplicate uuid in jsonl, later event overwrites earlier`, {
        uuid: e.uuid,
      });
    }
    byUuid.set(e.uuid, e);

    if (e.parentUuid === null) {
      roots.push(e.uuid);
      continue;
    }

    if (e.parentUuid === e.uuid) {
      logger?.warn(`self-referencing parentUuid, treating as root`, {
        uuid: e.uuid,
      });
      roots.push(e.uuid);
      continue;
    }

    if (!seenUuids.has(e.parentUuid)) {
      logger?.warn(`dangling parentUuid, treating as orphan root`, {
        uuid: e.uuid,
        parentUuid: e.parentUuid,
      });
      roots.push(e.uuid);
      continue;
    }

    let bucket = childrenOf.get(e.parentUuid);
    if (!bucket) {
      bucket = [];
      childrenOf.set(e.parentUuid, bucket);
    }
    bucket.push(e.uuid);
  }

  // Defense in depth — the build loop catches direct self-reference
  // (A→A) but not indirect cycles (A→B→A). A duplicate-uuid jsonl entry
  // with a conflicting parentUuid is enough to synthesize one. If a
  // downstream consumer walks `childrenOf` without its own guard, a cycle
  // sends it into an infinite loop. Break back-edges here so the returned
  // DAG is guaranteed acyclic.
  breakIndirectCycles(roots, childrenOf, logger);

  return { meta, events, childrenOf, roots, byUuid };
}

/**
 * Iterative DFS over the built `childrenOf` map. When we revisit a node
 * that's still on the active traversal stack, that edge closes a cycle;
 * drop it from the parent's children array and warn. The iterative form
 * avoids blowing the call stack on deep linear-ish parent chains (a long
 * session can chain thousands of turns).
 */
function breakIndirectCycles(
  roots: string[],
  childrenOf: Map<string, string[]>,
  logger: Logger | undefined,
): void {
  const visited = new Set<string>();
  for (const root of roots) {
    if (visited.has(root)) continue;
    const stack: Array<{ uuid: string; childIdx: number }> = [
      { uuid: root, childIdx: 0 },
    ];
    const inStack = new Set<string>([root]);
    visited.add(root);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const children = childrenOf.get(top.uuid);
      if (!children || top.childIdx >= children.length) {
        inStack.delete(top.uuid);
        stack.pop();
        continue;
      }
      const child = children[top.childIdx];
      if (inStack.has(child)) {
        logger?.warn('cycle detected in parentUuid chain, dropping back-edge', {
          from: top.uuid,
          to: child,
        });
        children.splice(top.childIdx, 1);
        // Do not advance childIdx — splice shifted the next child down.
        continue;
      }
      top.childIdx += 1;
      if (visited.has(child)) continue;
      visited.add(child);
      inStack.add(child);
      stack.push({ uuid: child, childIdx: 0 });
    }
  }
}

export function graphToDump(graph: SessionGraph): SessionGraphDump {
  const childrenOf: Record<string, string[]> = {};
  for (const [k, v] of graph.childrenOf) childrenOf[k] = v;

  let sidechainCount = 0;
  for (const e of graph.events) if (e.isSidechain) sidechainCount += 1;

  // An orphan is an event whose parentUuid is set but not present in byUuid.
  let orphanCount = 0;
  for (const e of graph.events) {
    if (e.parentUuid !== null && !graph.byUuid.has(e.parentUuid)) {
      orphanCount += 1;
    }
  }

  return {
    meta: graph.meta,
    events: graph.events,
    childrenOf,
    roots: graph.roots,
    stats: {
      total_events: graph.events.length,
      root_count: graph.roots.length,
      sidechain_count: sidechainCount,
      orphan_count: orphanCount,
    },
  };
}
