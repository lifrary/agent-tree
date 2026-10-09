/** MCP tools for discovering sessions and generating source-independent resume prompts. */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { loadConfig } from '../config/loader.js';
import { buildRedactor, runPipeline, type PipelineResult } from '../cli/pipeline.js';
import { lookupSnapshot, renderTextTree } from '../render/text.js';
import { createLoggerSync } from '../utils/logger.js';
import { safeGitCwd } from '../utils/safe_path.js';
import { defaultRedactor, redactDeep } from '../utils/redact.js';
import {
  findLatestSession,
  findLatestSessionInProject,
  listSessions,
  locateSession,
  sessionFromFile,
  type SessionMatch,
} from '../utils/session_path.js';
import { formatGitContextMarkdown, getGitContext } from '../utils/git.js';
import { listAllPicks, readPicks, recordPick, removePicksForNode } from '../utils/picks.js';
import { VERSION } from '../version.js';
import type { SessionSourceId } from '../sources/types.js';

const logger = createLoggerSync('warn');
const sourceInput = z
  .enum(['claude', 'codex'])
  .optional()
  .describe('Session source. Discovery defaults to claude; file imports auto-detect.');
const sessionInput = {
  source: sourceInput,
  sessionId: z.string().optional().describe('UUID prefix; omit for the latest session in cwd.'),
  file: z
    .string()
    .optional()
    .describe('Claude Code or Codex JSONL path; mutually exclusive with sessionId.'),
  cwd: z
    .string()
    .min(1)
    .transform((cwd) => resolve(cwd))
    .describe('Caller project directory for session selection and configuration.'),
};
type SessionInput = { sessionId?: string; file?: string; cwd: string; source?: SessionSourceId };
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

function safely<T>(
  handler: (args: T) => Promise<CallToolResult>,
): (args: T) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await handler(args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ...text(defaultRedactor().apply(message)), isError: true };
    }
  };
}

async function resolveMatch({ sessionId, file, cwd, source }: SessionInput): Promise<SessionMatch> {
  if (file) {
    if (sessionId) throw new Error('Use either sessionId or file, not both.');
    return sessionFromFile(file, source);
  }
  if (sessionId) {
    const matches = await locateSession(sessionId, { source });
    if (matches.length > 1) throw new Error('Ambiguous session id; use a longer UUID prefix.');
    if (matches.length === 1) return matches[0];
  } else {
    const match =
      (await findLatestSessionInProject(cwd, { source })) ?? (await findLatestSession({ source }));
    if (match) return match;
  }
  throw new Error('No matching session found.');
}

/** Each server owns its bounded cache; config and file changes invalidate it. */
export function createServer(): McpServer {
  const server = new McpServer({ name: 'agent-tree', version: VERSION });
  const cache: Array<{ key: string; result: PipelineResult }> = [];

  async function analyze(
    input: SessionInput,
  ): Promise<{ match: SessionMatch; result: PipelineResult }> {
    if (!(await stat(input.cwd)).isDirectory()) throw new Error('cwd must name a directory.');
    const match = await resolveMatch(input);
    const { config } = await loadConfig({ projectCwd: input.cwd, logger });
    const info = await stat(match.jsonlPath);
    const key = JSON.stringify([
      match.source,
      match.jsonlPath,
      info.mtimeMs,
      info.ctimeMs,
      info.size,
      input.cwd,
      config,
    ]);
    const index = config.cache.enabled ? cache.findIndex((entry) => entry.key === key) : -1;
    let result: PipelineResult;
    if (index >= 0) {
      const [hit] = cache.splice(index, 1);
      cache.unshift(hit);
      result = hit.result;
    } else {
      result = await runPipeline({
        match,
        opts: { llm: false, cwd: input.cwd },
        config,
        logger,
        quiet: true,
      });
      if (config.cache.enabled) {
        cache.unshift({ key, result });
        if (cache.length > 3) cache.pop();
      }
    }
    match.sessionId = result.graph.meta.sessionId || match.sessionId;
    return { match, result };
  }

  server.registerTool(
    'agent_tree_sessions',
    {
      description:
        'List recent sessions for one source (default claude). Codex reads metadata headers only. Returns sources, ids, paths, modification times and sizes.',
      inputSchema: {
        source: sourceInput,
        cwd: z
          .string()
          .min(1)
          .transform((cwd) => resolve(cwd))
          .optional()
          .describe('Restrict discovery to this project. Omit to search all projects.'),
        limit: z.number().int().min(1).max(1000).default(20),
      },
      annotations: readOnly,
    },
    safely(async ({ cwd, limit, source }) => {
      if (cwd && !(await stat(cwd)).isDirectory()) throw new Error('cwd must name a directory.');
      const { config } = await loadConfig({ projectCwd: cwd, logger });
      const redactor = buildRedactor({}, config, logger);
      const sessions = redactDeep(await listSessions({ source, projectCwd: cwd, limit }), redactor);
      return { ...text(JSON.stringify({ sessions }, null, 2)), structuredContent: { sessions } };
    }),
  );

  server.registerTool(
    'agent_tree_list',
    {
      description:
        'Render a numbered tree of a Claude Code or Codex session, or export its complete redacted mindmap as JSON.',
      inputSchema: {
        ...sessionInput,
        phasesOnly: z.boolean().optional().describe('Hide sub-actions; show phase headers only.'),
        filter: z
          .string()
          .optional()
          .describe('Case-insensitive label, time or event-range filter.'),
        format: z.enum(['text', 'json']).default('text'),
      },
      annotations: readOnly,
    },
    safely(async (input) => {
      if (input.format === 'json' && (input.phasesOnly || input.filter)) {
        throw new Error('JSON exports the complete tree; display filters are not supported.');
      }
      const { match, result } = await analyze(input);
      if (input.format === 'json') {
        const mindmap = redactDeep(result.mindmap, result.redactor);
        return { ...text(JSON.stringify(mindmap, null, 2)), structuredContent: { mindmap } };
      }
      if (result.isEmpty) return text('Session is empty.');
      const picks = await readPicks(match.sessionId, { source: match.source });
      const tree = renderTextTree(result.mindmap, {
        filter: input.filter,
        groupConsecutive: true,
        color: false,
        picks: picks.modesByNode,
        maxDepth: input.phasesOnly ? 1 : undefined,
      });
      const footer =
        picks.total > 0
          ? `\n\n(${picks.modesByNode.size} starred nodes, ${picks.total} total picks)`
          : '';
      return text(
        result.redactor.apply(
          `${match.source} session ${match.sessionId.slice(0, 8)} (${match.projectDir})\n\n${tree.text}${footer}`,
        ),
      );
    }),
  );

  server.registerTool(
    'agent_tree_snapshot',
    {
      description: 'Get resume markdown for one node and record the pick for future star display.',
      inputSchema: {
        ...sessionInput,
        nodeId: z.string().describe('Node display number or raw n_NNN id.'),
        mode: z.enum(['continue', 'fork']).default('continue'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    safely(async (input) => {
      const { match, result } = await analyze(input);
      if (result.isEmpty) throw new Error('Session is empty.');
      const { mindmap, graph, redactor } = result;
      const node = lookupSnapshot(mindmap, input.nodeId, renderTextTree(mindmap));
      if (!node) throw new Error('No matching node. Call agent_tree_list to see node numbers.');
      const snap =
        input.mode === 'fork' ? node.context_snapshot_fork : node.context_snapshot_continue;
      const sourceCwd = await safeGitCwd(graph.events[0]?.cwd, input.cwd);
      const git = sourceCwd ? await getGitContext(sourceCwd) : null;
      const gitMd = git?.available ? formatGitContextMarkdown(git) : null;
      let markdown = snap.clipboard_markdown;
      if (gitMd) {
        const index = markdown.indexOf('## Full session reference');
        markdown =
          index >= 0
            ? markdown.slice(0, index) + gitMd + '\n\n' + markdown.slice(index)
            : markdown + '\n\n' + gitMd + '\n';
      }
      await recordPick(match.sessionId, node.id, input.mode, { source: match.source }).catch(
        (error) =>
          logger.warn('pick history write failed', { error: redactor.apply(String(error)) }),
      );
      return text(redactor.apply(markdown));
    }),
  );

  server.registerTool(
    'agent_tree_picks',
    {
      description:
        'List every recorded pick across every session: session, node, mode and timestamp.',
      inputSchema: { source: sourceInput },
      annotations: readOnly,
    },
    safely(async ({ source }) => {
      const all = await listAllPicks({ source });
      if (all.length === 0) return text('No picks recorded yet.');
      const lines: string[] = [];
      let total = 0;
      for (const session of all) {
        lines.push(
          `${session.source} session ${session.sessionId.slice(0, 8)}  (${session.picks.length} picks)`,
        );
        for (const pick of session.picks) {
          lines.push(`  ${pick.ts}  ${pick.mode}  ${pick.node_id}`);
          total++;
        }
        lines.push('');
      }
      lines.push(`(${total} total picks across ${all.length} sessions)`);
      return text(defaultRedactor().apply(lines.join('\n')));
    }),
  );

  server.registerTool(
    'agent_tree_diff',
    {
      description: 'Summarize the event range, files and tools between two nodes.',
      inputSchema: {
        ...sessionInput,
        from: z.string().describe('First node display number or raw id.'),
        to: z.string().describe('Second node display number or raw id.'),
      },
      annotations: readOnly,
    },
    safely(async (input) => {
      const { result } = await analyze(input);
      if (result.isEmpty) throw new Error('Session is empty.');
      const tree = renderTextTree(result.mindmap);
      const a = lookupSnapshot(result.mindmap, input.from, tree);
      const b = lookupSnapshot(result.mindmap, input.to, tree);
      if (!a || !b)
        throw new Error('Could not resolve both nodes. Call agent_tree_list to see node numbers.');
      const [from, to] = a.index_range[0] <= b.index_range[0] ? [a, b] : [b, a];
      const start = from.index_range[0];
      const end = to.index_range[1];
      const segments = result.segments.filter(
        (segment) => segment.start_index >= start && segment.end_index <= end,
      );
      const files = new Set(segments.flatMap((segment) => segment.dominant_files));
      const tools = new Set(segments.flatMap((segment) => segment.dominant_tools));
      const lines = [
        `# Diff: ${from.id} → ${to.id}`,
        '',
        `**From**: ${from.label}`,
        `**To**: ${to.label}`,
        '',
        `- event range: ${start}–${end} (${end - start + 1} events)`,
        `- segments crossed: ${segments.length}`,
      ];
      if (files.size)
        lines.push(
          `- files touched (${files.size}):`,
          ...Array.from(files)
            .sort()
            .map((file) => `  - \`${file}\``),
        );
      if (tools.size) lines.push(`- tools used: ${Array.from(tools).sort().join(', ')}`);
      return text(result.redactor.apply(lines.join('\n')));
    }),
  );

  server.registerTool(
    'agent_tree_unstar',
    {
      description: 'Remove a node star by deleting its pick-history entries.',
      inputSchema: {
        ...sessionInput,
        nodeId: z.string().describe('Node display number or raw id.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safely(async (input) => {
      const { match, result } = await analyze(input);
      if (result.isEmpty) throw new Error('Session is empty.');
      const node = lookupSnapshot(result.mindmap, input.nodeId, renderTextTree(result.mindmap));
      if (!node) throw new Error('No matching node.');
      const removed = await removePicksForNode(match.sessionId, node.id, { source: match.source });
      return text(
        removed === 0
          ? `No picks recorded for ${node.id}.`
          : `Unstarred ${node.id}; removed ${removed} pick entries.`,
      );
    }),
  );
  return server;
}

if (process.argv[1] && /(?:^|\/)(?:mcp-server\.js|server\.ts)$/.test(process.argv[1])) {
  createServer()
    .connect(new StdioServerTransport())
    .catch((error) => {
      console.error(
        'mcp-server fatal:',
        defaultRedactor().apply(error instanceof Error ? error.message : String(error)),
      );
      process.exitCode = 1;
    });
}
