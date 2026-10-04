/**
 * Graph builder — SPEC §7.1 pass 2
 *
 * Reconstruct the parentUuid → children DAG from the linear event list.
 *
 * Edge cases handled per §7.8:
 *   - `parentUuid` self-reference → skip edge + warn (cycle)
 *   - `parentUuid` points to unseen uuid → keep event as an orphan root (warn)
 *   - Duplicate uuid → last one wins in all indexes; events retain source order
 */

import type { RawEvent, SessionGraph, SessionGraphDump, SessionMeta } from '../types.js';
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

  // Resolve duplicates before building edges. Earlier occurrences must not
  // leave roots or edges inconsistent with the event selected by byUuid.
  for (const e of events) {
    if (byUuid.has(e.uuid)) {
      logger?.warn(`duplicate uuid in jsonl, later event overwrites earlier`, {
        uuid: e.uuid,
      });
      byUuid.delete(e.uuid);
    }
    byUuid.set(e.uuid, e);
  }

  // Map order is the source order of the final occurrences. Keep the original
  // event array untouched: segment indexes refer to its source positions.
  for (const e of byUuid.values()) {
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

    if (!byUuid.has(e.parentUuid)) {
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

  // Pure cycles have no roots, so traversal must cover every indexed uuid.
  breakIndirectCycles(roots, childrenOf, byUuid.keys(), logger);

  return { meta, events, childrenOf, roots, byUuid };
}

/**
 * Iterative DFS over the built `childrenOf` map. When we revisit a node
 * that's still on the active traversal stack, that edge closes a cycle;
 * drop it from the parent's children array, promote its child to a root and
 * warn. Source parentUuid values stay intact for diagnostics. The iterative form
 * avoids blowing the call stack on deep linear-ish parent chains (a long
 * session can chain thousands of turns).
 */
function breakIndirectCycles(
  roots: string[],
  childrenOf: Map<string, string[]>,
  uuids: Iterable<string>,
  logger: Logger | undefined,
): void {
  const visited = new Set<string>();
  for (const root of uuids) {
    if (visited.has(root)) continue;
    const stack: Array<{ uuid: string; childIdx: number }> = [{ uuid: root, childIdx: 0 }];
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
        if (children.length === 0) childrenOf.delete(top.uuid);
        roots.push(child);
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
  // Object.fromEntries creates own properties even for UUIDs such as
  // "__proto__", which assignment to a plain object would silently lose.
  const childrenOf: Record<string, string[]> = Object.fromEntries(graph.childrenOf);

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
