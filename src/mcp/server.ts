/**
 * MCP server — exposes agent-tree functionality as native MCP tools so
 * Claude Code sessions can call `agent_tree_list` / `agent_tree_snapshot`
 * directly without spawning a CLI subprocess. Mirrors `wrap` / `ooo` skill
 * patterns.
 *
 * Tools surfaced:
 *   - agent_tree_list       — numbered ASCII tree (string)
 *   - agent_tree_snapshot   — single node's resume markdown (string)
 *   - agent_tree_picks      — all-session pick history (string)
 *   - agent_tree_diff       — what happened between two nodes (string)
 *   - agent_tree_unstar     — remove ⭐ from a node (string ack)
 *
 * Transport: stdio (claude-plugin spawns this process).
 */

import { stat } from 'node:fs/promises';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { loadConfig } from '../config/loader.js';
import { runPipeline, type PipelineResult } from '../cli/pipeline.js';
import { lookupSnapshot, renderTextTree } from '../render/text.js';
import { createLoggerSync } from '../utils/logger.js';
import { safeGitCwd } from '../utils/safe_path.js';
import {
  findLatestSession,
  findLatestSessionInProject,
  locateSession,
  type SessionMatch,
} from '../utils/session_path.js';
import {
  formatGitContextMarkdown,
  getGitContext,
} from '../utils/git.js';
import {
  listAllPicks,
  readPicks,
  recordPick,
  removePicksForNode,
} from '../utils/picks.js';

async function resolveMatch(
  sessionId: string | undefined,
  cwd: string,
): Promise<SessionMatch | null> {
  if (sessionId) {
    const matches = await locateSession(sessionId);
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous session id "${sessionId}" — ${matches.length} matches; use a longer prefix`,
      );
    }
    return matches[0];
  }
  const inProject = await findLatestSessionInProject(cwd);
  if (inProject) return inProject;
  return findLatestSession();
}

type ToolErrorResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
};

type ResolveResult =
  | { ok: true; value: SessionMatch }
  | { ok: false; errorResponse: ToolErrorResponse };

/**
 * MCP-friendly wrapper that converts the throwing/null variants of
 * `resolveMatch` into a structured `isError: true` response. Centralizes the
 * error shape so every tool's "no match" / "ambiguous prefix" path looks the
 * same to the caller (api-reviewer follow-up).
 */
async function resolveMatchSafe(
  sessionId: string | undefined,
  cwd: string,
): Promise<ResolveResult> {
  try {
    const match = await resolveMatch(sessionId, cwd);
    if (!match) {
      return {
        ok: false,
        errorResponse: {
          content: [{ type: 'text', text: 'No matching session found.' }],
          isError: true,
        },
      };
    }
    return { ok: true, value: match };
  } catch (err) {
    return {
      ok: false,
      errorResponse: {
        content: [
          {
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Pipeline cache — tiny in-process LRU
//
// A single MCP session typically calls `agent_tree_list` → `agent_tree_snapshot`
// (or `diff`) back-to-back on the same session. Without a cache each call
// re-parses the same JSONL, rebuilds the graph, re-segments, and re-renders
// the mindmap — O(events) work per tool invocation, wasted on an unchanged
// file.
//
// Cache key folds in the JSONL's mtime so an in-progress session that gains
// new events between calls invalidates automatically (user switches to an
// active session, runs another Claude turn, calls back). Size is intentionally
// small (3 entries) — three is enough to cover the list → snapshot → diff
// pattern plus one spare, while keeping resident memory modest (each entry
// carries a full graph / segments / mindmap tree, ~MB scale for long
// sessions).
// ---------------------------------------------------------------------------

interface PipelineCacheEntry {
  key: string;
  result: PipelineResult;
}

const PIPELINE_CACHE_MAX = 3;
const pipelineCache: PipelineCacheEntry[] = [];

async function pipelineFor(match: SessionMatch): Promise<PipelineResult> {
  let mtimeMs: number | null = null;
  try {
    mtimeMs = (await stat(match.jsonlPath)).mtimeMs;
  } catch {
    // stat failure → bypass cache + run fresh; runPipeline's own readJsonl
    // will surface any real I/O problem.
    mtimeMs = null;
  }

  if (mtimeMs !== null) {
    const key = `${match.sessionId}:${match.jsonlPath}:${mtimeMs}`;
    const idx = pipelineCache.findIndex((e) => e.key === key);
    if (idx >= 0) {
      // LRU hit — move to front.
      const [hit] = pipelineCache.splice(idx, 1);
      pipelineCache.unshift(hit);
      return hit.result;
    }

    const { config } = await loadConfig({ logger });
    const result = await runPipeline({
      match,
      opts: { llm: false },
      config,
      logger,
      quiet: true,
    });
    pipelineCache.unshift({ key, result });
    if (pipelineCache.length > PIPELINE_CACHE_MAX) pipelineCache.pop();
    return result;
  }

  const { config } = await loadConfig({ logger });
  return runPipeline({
    match,
    opts: { llm: false },
    config,
    logger,
    quiet: true,
  });
}

const logger = createLoggerSync('warn');

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'agent-tree',
  version: '0.1.1',
});

// agent_tree_list ------------------------------------------------------------

server.tool(
  'agent_tree_list',
  'Render a numbered ASCII tree of an agent (Claude Code, Codex, Gemini) session. Phase headers (user prompts) at depth 1, sub-actions at depth 2. Returns text suitable for chat display.',
  {
    sessionId: z
      .string()
      .optional()
      .describe('UUID prefix (e.g. 69c2f35e). Omit to use latest session in current cwd.'),
    cwd: z.string().describe('Caller cwd — used for smart-default session pick.'),
    phasesOnly: z
      .boolean()
      .optional()
      .describe('Show only phase headers; hide sub-actions.'),
    filter: z
      .string()
      .optional()
      .describe('Case-insensitive keyword filter on labels / time / range.'),
  },
  async ({ sessionId, cwd, phasesOnly, filter }) => {
    const matched = await resolveMatchSafe(sessionId, cwd);
    if (!matched.ok) return matched.errorResponse;
    const match = matched.value;
    const result = await pipelineFor(match);
    if (result.isEmpty) {
      return { content: [{ type: 'text', text: 'Session is empty.' }] };
    }
    const picks = await readPicks(match.sessionId);
    const tree = renderTextTree(result.mindmap, {
      filter,
      groupConsecutive: true,
      color: false,
      picks: picks.modesByNode,
      maxDepth: phasesOnly ? 1 : undefined,
    });
    const footer = picks.total > 0
      ? `\n\n(⭐ = previously picked — ${picks.modesByNode.size} starred, ${picks.total} total picks)`
      : '';
    return {
      content: [
        {
          type: 'text',
          text: `Session ${match.sessionId.slice(0, 8)} (${match.projectDir})\n\n${tree.text}${footer}`,
        },
      ],
    };
  },
);

// agent_tree_snapshot --------------------------------------------------------

server.tool(
  'agent_tree_snapshot',
  'Get the resume markdown for a specific node so the user can paste it into a new claude session. Records the pick for future ⭐ display.',
  {
    sessionId: z.string().optional().describe('UUID prefix; omit for cwd latest.'),
    cwd: z.string().describe('Caller cwd for smart-default session pick.'),
    nodeId: z
      .string()
      .describe('Node display number ("7") or raw id ("n_007").'),
    mode: z
      .enum(['continue', 'fork'])
      .default('continue')
      .describe('continue = preserve decisions; fork = discard subsequent turns.'),
  },
  async ({ sessionId, cwd, nodeId, mode }) => {
    const matched = await resolveMatchSafe(sessionId, cwd);
    if (!matched.ok) return matched.errorResponse;
    const match = matched.value;
    const result = await pipelineFor(match);
    if (result.isEmpty) {
      return {
        content: [{ type: 'text', text: 'Session is empty.' }],
        isError: true,
      };
    }
    const { mindmap, graph } = result;
    const tree = renderTextTree(mindmap);
    const node = lookupSnapshot(mindmap, nodeId, tree);
    if (!node) {
      return {
        content: [
          {
            type: 'text',
            text: `No node matches "${nodeId}". Call agent_tree_list to see numbers.`,
          },
        ],
        isError: true,
      };
    }
    const snap =
      mode === 'fork' ? node.context_snapshot_fork : node.context_snapshot_continue;
    const sourceCwd = await safeGitCwd(graph.events[0]?.cwd, cwd);
    const gitCtx = sourceCwd ? await getGitContext(sourceCwd) : { available: false as const, cwd: '' };
    const gitMd = gitCtx.available ? formatGitContextMarkdown(gitCtx) : null;
    const fullRefIdx = snap.clipboard_markdown.indexOf('## Full session reference');
    const finalMd = gitMd && fullRefIdx >= 0
      ? snap.clipboard_markdown.slice(0, fullRefIdx) +
        gitMd +
        '\n\n' +
        snap.clipboard_markdown.slice(fullRefIdx)
      : snap.clipboard_markdown;
    await recordPick(match.sessionId, node.id, mode).catch(() => undefined);
    return { content: [{ type: 'text', text: finalMd }] };
  },
);

// agent_tree_picks -----------------------------------------------------------

server.tool(
  'agent_tree_picks',
  'List every recorded pick across every session. Shows session id × node × mode × timestamp.',
  {
    cwd: z
      .string()
      .optional()
      .describe(
        'Caller cwd (currently unused; accepted for tool-shape symmetry with the other agent_tree_* tools).',
      ),
  },
  async () => {
    const all = await listAllPicks();
    if (all.length === 0) {
      return { content: [{ type: 'text', text: 'No picks recorded yet.' }] };
    }
    const lines: string[] = [];
    let total = 0;
    for (const session of all) {
      lines.push(`session ${session.sessionId.slice(0, 8)}  (${session.picks.length} picks)`);
      for (const p of session.picks) {
        const when = p.ts.replace('T', ' ').slice(0, 19);
        const mode = p.mode === 'fork' ? 'fork    ' : 'continue';
        lines.push(`  ${when}  ${mode}  ${p.node_id}`);
        total += 1;
      }
      lines.push('');
    }
    lines.push(`(${total} total picks across ${all.length} sessions)`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

// agent_tree_diff ------------------------------------------------------------

server.tool(
  'agent_tree_diff',
  'Summarise what happened between two nodes (event range, files touched, tools used). Useful for "what did I do between fork point X and Y?".',
  {
    sessionId: z.string().optional().describe('UUID prefix; omit for cwd latest.'),
    cwd: z.string().describe('Caller cwd for smart-default session pick.'),
    from: z.string().describe('First node (number or n_NNN id).'),
    to: z.string().describe('Second node (number or n_NNN id).'),
  },
  async ({ sessionId, cwd, from, to }) => {
    const matched = await resolveMatchSafe(sessionId, cwd);
    if (!matched.ok) return matched.errorResponse;
    const result = await pipelineFor(matched.value);
    if (result.isEmpty) {
      return {
        content: [{ type: 'text', text: 'Session is empty.' }],
        isError: true,
      };
    }
    const { mindmap, segments } = result;
    const tree = renderTextTree(mindmap);
    const a = lookupSnapshot(mindmap, from, tree);
    const b = lookupSnapshot(mindmap, to, tree);
    if (!a || !b) {
      return {
        content: [
          {
            type: 'text',
            text: `Could not resolve both nodes: from=${from} (${a ? 'ok' : 'missing'}), to=${to} (${b ? 'ok' : 'missing'})`,
          },
        ],
        isError: true,
      };
    }
    const [head, tail] = a.index_range[0] <= b.index_range[0] ? [a, b] : [b, a];
    const startEv = head.index_range[0];
    const endEv = tail.index_range[1];
    const slice = segments.filter(
      (s) => s.start_index >= startEv && s.end_index <= endEv,
    );
    const fileSet = new Set<string>();
    const toolSet = new Set<string>();
    for (const s of slice) {
      for (const f of s.dominant_files) fileSet.add(f);
      for (const t of s.dominant_tools) toolSet.add(t);
    }
    const lines: string[] = [];
    lines.push(`# Diff: ${head.id} → ${tail.id}`);
    lines.push('');
    lines.push(`**From**: ${head.label}`);
    lines.push(`**To**:   ${tail.label}`);
    lines.push('');
    lines.push(`- event range: ${startEv}–${endEv} (${endEv - startEv + 1} events)`);
    lines.push(`- segments crossed: ${slice.length}`);
    if (fileSet.size > 0) {
      lines.push(`- files touched (${fileSet.size}):`);
      for (const f of Array.from(fileSet).sort()) lines.push(`  - \`${f}\``);
    }
    if (toolSet.size > 0) {
      lines.push(`- tools used: ${Array.from(toolSet).sort().join(', ')}`);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

// agent_tree_unstar ----------------------------------------------------------

server.tool(
  'agent_tree_unstar',
  'Remove the ⭐ marker from a previously picked node (deletes its pick history entries).',
  {
    sessionId: z.string().optional().describe('UUID prefix; omit for cwd latest.'),
    cwd: z.string().describe('Caller cwd for smart-default session pick.'),
    nodeId: z.string().describe('Node display number or raw id.'),
  },
  async ({ sessionId, cwd, nodeId }) => {
    const matched = await resolveMatchSafe(sessionId, cwd);
    if (!matched.ok) return matched.errorResponse;
    const match = matched.value;
    const result = await pipelineFor(match);
    if (result.isEmpty) {
      return {
        content: [{ type: 'text', text: 'Session is empty.' }],
        isError: true,
      };
    }
    const tree = renderTextTree(result.mindmap);
    const node = lookupSnapshot(result.mindmap, nodeId, tree);
    if (!node) {
      return {
        content: [
          { type: 'text', text: `No node matches "${nodeId}".` },
        ],
        isError: true,
      };
    }
    const removed = await removePicksForNode(match.sessionId, node.id);
    return {
      content: [
        {
          type: 'text',
          text:
            removed === 0
              ? `No picks recorded for ${node.id} — nothing to unstar.`
              : `✓ Unstarred ${node.id} — removed ${removed} pick entr${removed === 1 ? 'y' : 'ies'}.`,
        },
      ],
    };
  },
);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes.
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('mcp-server fatal:', err);
  process.exit(1);
});
