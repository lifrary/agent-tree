/**
 * Step numbers shared by search, usage and open. A step is the display number
 * `renderTextTree` assigns (preorder over the complete tree), so every feature
 * speaks the numbers `--snapshot` accepts.
 */

import { renderTextTree } from '../render/text.js';
import type { MindMap, MindMapNode } from '../types.js';

export interface StepIndex {
  /** Step of the deepest node holding the event; undefined when no node holds it. */
  stepOfEvent(uuid: string): number | undefined;
  nodeOfStep(step: number): MindMapNode | undefined;
  stepOfNode(id: string): number | undefined;
}

export function buildStepIndex(mindmap: MindMap): StepIndex {
  const { numberToId, idToNumber } = renderTextTree(mindmap);
  const nodes = new Map<string, MindMapNode>();
  const deepest = new Map<string, { step: number; depth: number }>();

  const visit = (node: MindMapNode, depth: number): void => {
    nodes.set(node.id, node);
    const step = idToNumber.get(node.id);
    if (step !== undefined) {
      for (const uuid of node.event_uuids) {
        const current = deepest.get(uuid);
        // Strictly deeper wins; between equals the lower step number stays.
        if (!current || depth > current.depth) deepest.set(uuid, { step, depth });
      }
    }
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(mindmap.root, 0);

  return {
    stepOfEvent: (uuid) => deepest.get(uuid)?.step,
    nodeOfStep: (step) => {
      const id = numberToId.get(step);
      return id === undefined ? undefined : nodes.get(id);
    },
    stepOfNode: (id) => idToNumber.get(id),
  };
}
