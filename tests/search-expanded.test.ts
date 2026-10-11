import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runPipeline } from '../src/cli/pipeline.js';
import { DEFAULT_CONFIG, mergeConfig } from '../src/config/schema.js';
import { renderTextTree } from '../src/render/text.js';
import { formatSessionBlocks } from '../src/search/format.js';
import { searchSessions, type SearchOptions } from '../src/search/run.js';
import type { SearchReport } from '../src/search/types.js';
import { encodeProjectPath } from '../src/sources/claude.js';
import type { SessionSourceId } from '../src/sources/types.js';
import type { MindMapNode, RawEvent } from '../src/types.js';
import { createLoggerSync } from '../src/utils/logger.js';
import { defaultRedactor } from '../src/utils/redact.js';
import { sessionFromFile } from '../src/utils/session_path.js';

const exec = promisify(execFile);
const ids = {
  parent: '11111111-2222-4333-8444-555555555551',
  child: '22222222-2222-4333-8444-555555555552',
  archive: '33333333-2222-4333-8444-555555555553',
  missing: '44444444-2222-4333-8444-555555555554',
  other: '55555555-2222-4333-8444-555555555555',
};
const now = Date.UTC(2026, 9, 10);
const day = 24 * 60 * 60 * 1000;
let root: string;
let project: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-tree-search-expanded 'quoted'-"));
  project = join(root, "project with 'quotes'");
  await mkdir(project);
  await mkdir(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('USERPROFILE', join(root, 'home'));
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'claude'));
  vi.stubEnv('CODEX_HOME', join(root, 'codex'));
  vi.stubEnv('AGENT_TREE_NO_LLM', 'true');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('AGENT_TREE_REDACT_STRICT', 'false');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

function config() {
  return mergeConfig(DEFAULT_CONFIG, { cache: { enabled: false, dir: join(root, 'cache') } });
}

async function put(file: string, records: unknown[], age = 0) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  await utimes(file, (now - age * day) / 1000, (now - age * day) / 1000);
  return file;
}

interface Turn {
  prompt: string;
  reply?: string;
  tool?: {
    id: string;
    name: string;
    input?: Record<string, unknown>;
    output: string;
    agentId?: string;
  };
}

async function claude(
  id: string,
  turns: Turn[],
  options: { parent?: string; metadata?: unknown; cwd?: string; age?: number } = {},
) {
  const cwd = options.cwd ?? project;
  const directory = join(root, 'claude', 'projects', encodeProjectPath(cwd));
  const file = options.parent
    ? join(directory, options.parent, 'subagents', `agent-${id}.jsonl`)
    : join(directory, `${id}.jsonl`);
  const records: Record<string, unknown>[] = [];
  let parentUuid: string | null = null;
  const push = (record: Record<string, unknown>, offset: number) => {
    const uuid = `${id}-event-${records.length}`;
    records.push({
      uuid,
      parentUuid,
      sessionId: options.parent ?? id,
      cwd,
      isSidechain: Boolean(options.parent),
      timestamp: new Date(now - day + offset * 1000).toISOString(),
      ...record,
    });
    parentUuid = uuid;
  };
  turns.forEach((turn, index) => {
    push({ type: 'user', message: { role: 'user', content: turn.prompt } }, index * 3600);
    const content: unknown[] = [{ type: 'text', text: turn.reply ?? 'Working on this task.' }];
    if (turn.tool)
      content.push({
        type: 'tool_use',
        id: turn.tool.id,
        name: turn.tool.name,
        input: turn.tool.input ?? {},
      });
    push({ type: 'assistant', message: { role: 'assistant', content } }, index * 3600 + 1);
    if (turn.tool)
      push(
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: turn.tool.id, content: turn.tool.output },
            ],
          },
          ...(turn.tool.agentId ? { toolUseResult: { agentId: turn.tool.agentId } } : {}),
        },
        index * 3600 + 2,
      );
  });
  await put(file, records, options.age);
  if (options.metadata !== undefined)
    await writeFile(file.replace(/\.jsonl$/, '.meta.json'), JSON.stringify(options.metadata));
  return file;
}

async function codex(
  id: string,
  turns: Turn[],
  options: {
    parent?: string;
    genericChild?: boolean;
    archived?: boolean;
    cwd?: string;
    age?: number;
  } = {},
) {
  const cwd = options.cwd ?? project;
  const records: unknown[] = [
    {
      type: 'session_meta',
      timestamp: new Date(now - day).toISOString(),
      payload: {
        id,
        cwd,
        source: options.genericChild
          ? 'subagent'
          : options.parent
            ? { subagent: { thread_spawn: { parent_thread_id: options.parent } } }
            : 'cli',
      },
    },
  ];
  const push = (payload: unknown, offset: number) =>
    records.push({
      type: 'response_item',
      timestamp: new Date(now - day + offset * 1000).toISOString(),
      payload,
    });
  turns.forEach((turn, index) => {
    push(
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: turn.prompt }] },
      index * 3600,
    );
    push(
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: turn.reply ?? 'Working on this task.' }],
      },
      index * 3600 + 1,
    );
    if (turn.tool) {
      push(
        {
          type: 'function_call',
          call_id: turn.tool.id,
          name: turn.tool.name,
          arguments: JSON.stringify(turn.tool.input ?? {}),
        },
        index * 3600 + 2,
      );
      push(
        { type: 'function_call_output', call_id: turn.tool.id, output: turn.tool.output },
        index * 3600 + 3,
      );
    }
  });
  return put(
    join(
      root,
      'codex',
      options.archived ? 'archived_sessions' : 'sessions/2026/10/09',
      `rollout-2026-10-09T00-00-00-${id}.jsonl`,
    ),
    records,
    options.age,
  );
}

function search(query: string, overrides: Partial<SearchOptions> = {}) {
  return searchSessions({
    query,
    sources: ['claude', 'codex'],
    limit: 20,
    includeToolOutput: false,
    redactor: defaultRedactor(),
    config: config(),
    cwd: project,
    now: () => now,
    ...overrides,
  });
}

async function renderedStep(
  file: string,
  source: SessionSourceId,
  accepts: (event: RawEvent) => boolean,
) {
  const pipeline = await runPipeline({
    match: await sessionFromFile(file, source),
    opts: { llm: false, cwd: project },
    config: config(),
    logger: createLoggerSync('error'),
    quiet: true,
    usage: false,
  });
  const event = pipeline.graph.events.find(accepts);
  expect(event, 'fixture event must survive the normal reader').toBeDefined();
  let selected: MindMapNode | undefined;
  const visit = (node: MindMapNode) => {
    if (node.event_uuids.includes(event!.uuid)) selected = node;
    for (const child of node.children) visit(child);
  };
  visit(pipeline.mindmap.root);
  expect(selected, 'matching event must have a visible tree node').toBeDefined();
  const step = renderTextTree(pipeline.mindmap).idToNumber.get(selected!.id);
  expect(step).toBeDefined();
  return { step: step!, node: selected! };
}

const claudeCall = (id: string) => (event: RawEvent) =>
  event.type === 'assistant' &&
  Array.isArray(event.message.content) &&
  event.message.content.some((block) => block.type === 'tool_use' && block.id === id);
const codexCall = (id: string) => (event: RawEvent) =>
  event.type === 'tool_use' && event.tool_use.id === id;
const promptContains = (text: string) => (event: RawEvent) =>
  event.type === 'user' && JSON.stringify(event.message.content).includes(text);
const quote = (value: string) =>
  /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;

async function cli(...args: string[]) {
  return exec(process.execPath, ['--import', 'tsx', resolve('src/cli.ts'), ...args], {
    cwd: process.cwd(),
    env: process.env,
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function snapshot(file: string, source: SessionSourceId, step: number) {
  return cli(
    '--source',
    source,
    '--file',
    file,
    '--snapshot',
    String(step),
    '--mode',
    'continue',
    '--cwd',
    project,
  );
}

describe('search expanded session catalogs', () => {
  it('searches both sources, children and archives by default through the CLI', async () => {
    const claudeFile = await claude('cli-worker', [{ prompt: 'CLI_EXPANDED_MARKER' }], {
      parent: ids.missing,
    });
    const archivedFile = await codex(ids.archive, [{ prompt: 'CLI_EXPANDED_MARKER' }], {
      archived: true,
    });
    const childFile = await codex(ids.child, [{ prompt: 'CLI_EXPANDED_MARKER' }], {
      parent: ids.missing,
    });
    const { stdout } = await cli('--search', 'CLI_EXPANDED_MARKER', '--json', '--cwd', project);
    const report = JSON.parse(stdout) as SearchReport;
    expect(report.results.map((result) => result.file).sort()).toEqual(
      [claudeFile, archivedFile, childFile].sort(),
    );
    expect(report.scope.sources).toEqual(['claude', 'codex']);
    const scoped = await cli(
      '--search',
      'CLI_EXPANDED_MARKER',
      '--source',
      'claude',
      '--cwd',
      project,
    );
    expect(scoped.stdout).toContain('[subagent]');
    expect(scoped.stdout).toContain(`--file ${quote(claudeFile)}`);
    expect(scoped.stdout).not.toContain('[archived]');
  }, 45_000);

  it('finds a child-only Claude match and links toolUseId to the normal rendered parent step', async () => {
    const parent = await claude(ids.parent, [
      { prompt: 'Set up the project' },
      {
        prompt: 'Delegate a focused task',
        tool: { id: 'spawn-1', name: 'Task', output: 'Started' },
      },
    ]);
    const child = await claude('worker', [{ prompt: 'CHILD_ONLY_MARKER fix the parser' }], {
      parent: ids.parent,
      metadata: { toolUseId: 'spawn-1' },
    });
    const { report } = await search('CHILD_ONLY_MARKER');
    expect(report.results).toHaveLength(1);
    const result = report.results[0];
    const childStep = await renderedStep(child, 'claude', promptContains('CHILD_ONLY_MARKER'));
    const parentStep = await renderedStep(parent, 'claude', claudeCall('spawn-1'));
    expect(result).toMatchObject({
      file: child,
      source: 'claude',
      subagent: {
        id: 'worker',
        parent_session_id: ids.parent,
        parent_file: parent,
        parent_step: parentStep.step,
      },
    });
    expect(result.hits[0]).toMatchObject({ step: childStep.step, node_id: childStep.node.id });
    expect(result).not.toHaveProperty('archived');
  });

  it('uses structured Claude toolUseResult.agentId when optional child metadata is absent', async () => {
    const parent = await claude(ids.parent, [
      {
        prompt: 'Delegate work',
        tool: {
          id: 'spawn-result',
          name: 'Task',
          output: 'Started successfully',
          agentId: 'result-worker',
        },
      },
    ]);
    await claude('result-worker', [{ prompt: 'RESULT_LINK_MARKER' }], { parent: ids.parent });
    const expected = await renderedStep(
      parent,
      'claude',
      (event) =>
        (event as unknown as { toolUseResult?: { agentId?: string } }).toolUseResult?.agentId ===
        'result-worker',
    );
    const { report } = await search('RESULT_LINK_MARKER');
    expect(report.results[0].subagent).toMatchObject({
      parent_file: parent,
      parent_step: expected.step,
    });
  });

  it('links nested Claude work to its parent child transcript, even without the main transcript', async () => {
    const outer = await claude(
      'outer',
      [
        {
          prompt: 'Delegate nested task',
          tool: {
            id: 'nested-spawn',
            name: 'Task',
            output: 'Started',
          },
        },
      ],
      { parent: ids.missing },
    );
    const inner = await claude('inner', [{ prompt: 'NESTED_CHILD_MARKER' }], {
      parent: ids.missing,
      metadata: { parentAgentId: 'outer', toolUseId: 'nested-spawn' },
    });
    const expected = await renderedStep(outer, 'claude', claudeCall('nested-spawn'));
    const { report } = await search('NESTED_CHILD_MARKER');
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      file: inner,
      subagent: {
        id: 'inner',
        parent_session_id: 'agent-outer',
        parent_file: outer,
        parent_step: expected.step,
      },
    });
  });

  it.each(['agent_id', 'thread_id'])(
    'links archived Codex children from structured spawn_agent %s results',
    async (field) => {
      const parent = await codex(ids.parent, [
        { prompt: 'Set up workspace' },
        {
          prompt: 'Delegate review',
          tool: {
            id: 'spawn-code',
            name: 'spawn_agent',
            output: JSON.stringify({ [field]: ids.child }),
          },
        },
      ]);
      const child = await codex(ids.child, [{ prompt: 'CODEX_CHILD_MARKER' }], {
        parent: ids.parent,
        archived: true,
      });
      const expected = await renderedStep(parent, 'codex', codexCall('spawn-code'));
      const childStep = await renderedStep(child, 'codex', promptContains('CODEX_CHILD_MARKER'));
      const { report } = await search('CODEX_CHILD_MARKER');
      expect(report.results).toHaveLength(1);
      expect(report.results[0]).toMatchObject({
        file: child,
        archived: true,
        subagent: {
          id: ids.child,
          parent_session_id: ids.parent,
          parent_file: parent,
          parent_step: expected.step,
        },
      });
      expect(report.results[0].hits[0]).toMatchObject({
        step: childStep.step,
        node_id: childStep.node.id,
      });
    },
  );

  it('keeps explicit null linkage for missing parents and generic Codex subagents', async () => {
    const claudeFile = await claude('orphan', [{ prompt: 'ORPHAN_MARKER' }], {
      parent: ids.missing,
    });
    const codexFile = await codex(ids.child, [{ prompt: 'ORPHAN_MARKER' }], {
      parent: ids.missing,
    });
    const genericFile = await codex(ids.other, [{ prompt: 'ORPHAN_MARKER' }], {
      genericChild: true,
    });
    const { report, commandId } = await search('ORPHAN_MARKER');
    expect(report.results).toHaveLength(3);
    for (const file of [claudeFile, codexFile, genericFile]) {
      expect(report.results.find((result) => result.file === file)?.subagent).toMatchObject({
        parent_session_id: file === genericFile ? null : ids.missing,
        parent_file: null,
        parent_step: null,
      });
    }
    const text = formatSessionBlocks(report, { commandId }).join('\n');
    expect(text).toContain('originating step unavailable');
    expect(text).not.toContain('parent: agent-tree');
  });

  it('does not invent Claude linkage from incidental mentions or wait tools', async () => {
    const parent = await claude(ids.parent, [
      {
        prompt: 'The child is worker',
        reply: 'agentId: worker',
        tool: {
          id: 'wait-1',
          name: 'wait',
          input: { agent_id: 'worker' },
          output: '{"agent_id":"worker"}',
        },
      },
    ]);
    await claude('worker', [{ prompt: 'UNPROVEN_CLAUDE_MARKER' }], { parent: ids.parent });
    const { report } = await search('UNPROVEN_CLAUDE_MARKER');
    expect(report.results[0].subagent).toMatchObject({ parent_file: parent, parent_step: null });
  });

  it.each(['wait', 'spawn_agent'])(
    'does not infer Codex linkage from %s without a structured spawn result',
    async (name) => {
      const output =
        name === 'wait' ? JSON.stringify({ agent_id: ids.child }) : `Started child ${ids.child}`;
      const parent = await codex(ids.parent, [
        {
          prompt: `Mention ${ids.child}`,
          tool: {
            id: 'unproven',
            name,
            input: { agent_id: ids.child },
            output,
          },
        },
      ]);
      await codex(ids.child, [{ prompt: 'UNPROVEN_CODEX_MARKER' }], { parent: ids.parent });
      const { report } = await search('UNPROVEN_CODEX_MARKER');
      expect(report.results[0].subagent).toMatchObject({ parent_file: parent, parent_step: null });
    },
  );

  it('applies source/project filters to matches while resolving a parent from another project', async () => {
    const other = join(root, 'other');
    await mkdir(other);
    const parent = await codex(
      ids.parent,
      [
        {
          prompt: 'Delegate to another workspace',
          tool: {
            id: 'cross-project',
            name: 'spawn_agent',
            output: JSON.stringify({ thread_id: ids.child }),
          },
        },
      ],
      { cwd: other },
    );
    const child = await codex(ids.child, [{ prompt: 'FILTER_MARKER' }], { parent: ids.parent });
    await codex(ids.other, [{ prompt: 'FILTER_MARKER' }], { cwd: other, archived: true });
    await claude('worker', [{ prompt: 'FILTER_MARKER' }], { parent: ids.parent });
    const expected = await renderedStep(parent, 'codex', codexCall('cross-project'));
    const { report } = await search('FILTER_MARKER', { sources: ['codex'], projectCwd: project });
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      file: child,
      source: 'codex',
      subagent: {
        parent_file: parent,
        parent_step: expected.step,
      },
    });
    const claudeOnly = await search('FILTER_MARKER', { sources: ['claude'], projectCwd: project });
    expect(claudeOnly.report.results.map((result) => result.source)).toEqual(['claude']);
  });

  it('honors since and limit across archived/child work and ignores duplicate archived content', async () => {
    const newest = await codex(ids.child, [{ prompt: 'RECENT_MARKER' }], { parent: ids.missing });
    const middle = await codex(ids.archive, [{ prompt: 'RECENT_MARKER' }], {
      archived: true,
      age: 1,
    });
    await claude('old-worker', [{ prompt: 'RECENT_MARKER' }], { parent: ids.missing, age: 10 });
    await codex(ids.other, [{ prompt: 'Active copy has no marker' }]);
    await codex(ids.other, [{ prompt: 'ARCHIVE_DUPLICATE_ONLY' }], { archived: true });
    const recent = await search('RECENT_MARKER', { sinceDays: 2 });
    expect(recent.report.results.map((result) => result.file)).toEqual([newest, middle]);
    const limited = await search('RECENT_MARKER', { limit: 1 });
    expect(limited.report.results.map((result) => result.file)).toEqual([newest]);
    expect(limited.report.scanned.stopped_early).toBe(true);
    expect((await search('ARCHIVE_DUPLICATE_ONLY')).report.results).toEqual([]);
  });

  it('preserves the normal main-session result shape', async () => {
    await claude(ids.parent, [{ prompt: 'MAIN_ONLY_MARKER' }]);
    const { report } = await search('MAIN_ONLY_MARKER');
    expect(report.results).toHaveLength(1);
    expect(Object.keys(report.results[0]).sort()).toEqual(
      ['source', 'session_id', 'project_dir', 'mtime', 'hits', 'more_hits'].sort(),
    );
  });

  it('prints exact file commands for child/archive and a separate usable parent snapshot command', async () => {
    const parent = await codex(ids.parent, [
      {
        prompt: 'PARENT_COMMAND_MARKER delegate review',
        tool: {
          id: 'command-spawn',
          name: 'spawn_agent',
          output: JSON.stringify({ agent_id: ids.child }),
        },
      },
    ]);
    const child = await codex(ids.child, [{ prompt: 'CHILD_COMMAND_MARKER' }], {
      parent: ids.parent,
      archived: true,
    });
    const archive = await codex(ids.archive, [{ prompt: 'ARCHIVED_COMMAND_MARKER' }], {
      archived: true,
    });
    for (const [query, file] of [
      ['CHILD_COMMAND_MARKER', child],
      ['ARCHIVED_COMMAND_MARKER', archive],
    ]) {
      const { report, commandId } = await search(query, { projectCwd: project });
      const result = report.results[0];
      const text = formatSessionBlocks(report, { commandId }).join('\n');
      expect(text).toContain(
        `snapshot: agent-tree --source codex --cwd ${quote(project)} --file ${quote(file)} --snapshot ${result.hits[0].step} --mode continue`,
      );
      expect(text).toContain('[archived]');
      expect((await snapshot(file, 'codex', result.hits[0].step)).stdout).toContain(query);
      if (result.subagent) {
        expect(text).toContain('[subagent]');
        expect(text).toContain(
          `parent: agent-tree --source codex --cwd ${quote(project)} --file ${quote(parent)} --snapshot ${result.subagent.parent_step} --mode continue`,
        );
        expect((await snapshot(parent, 'codex', result.subagent.parent_step!)).stdout).toContain(
          'PARENT_COMMAND_MARKER',
        );
      } else {
        expect(text).not.toContain('parent:');
      }
    }
  }, 60_000);

  it('redacts expanded snippets, queries, paths and metadata and never executes transcript commands', async () => {
    const secret = `ghp_${'A'.repeat(36)}`;
    const sentinel = join(root, 'transcript-was-executed');
    const command = `touch ${quote(sentinel)}`;
    await claude(
      secret,
      [
        {
          prompt: `SAFE_MARKER token ${secret}`,
          tool: {
            id: 'unsafe-input',
            name: 'Bash',
            input: { command },
            output: `OUTPUT_MARKER ${secret}`,
          },
        },
      ],
      { parent: ids.missing },
    );
    await codex(
      ids.archive,
      [
        {
          prompt: `SAFE_MARKER ${secret}`,
          tool: {
            id: 'unsafe-code',
            name: 'shell',
            input: { cmd: command },
            output: `OUTPUT_MARKER ${secret}`,
          },
        },
      ],
      { archived: true },
    );
    const outcome = await search('SAFE_MARKER');
    expect(outcome.report.results).toHaveLength(2);
    const text = formatSessionBlocks(outcome.report, { commandId: outcome.commandId }).join('\n');
    expect(JSON.stringify(outcome.report)).not.toContain(secret);
    expect(text).not.toContain(secret);
    expect(text).toContain('REDACTED');
    expect((await search(secret)).report).toMatchObject({
      results: [],
      query: expect.not.stringContaining(secret),
    });
    expect((await search('OUTPUT_MARKER')).report.results).toEqual([]);
    const output = await search('OUTPUT_MARKER', { includeToolOutput: true });
    expect(output.report.results).toHaveLength(2);
    expect(JSON.stringify(output.report)).not.toContain(secret);
    expect((await search('touch')).report.results).toHaveLength(2);
    await expect(access(sentinel)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
