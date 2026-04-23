/**
 * Config loader — SPEC §17.1 precedence chain:
 *   CLI flags > env vars > ~/.config/agent-tree/config.yaml > <project>/.agent-tree.yaml > defaults
 *
 * Both YAML files are optional — if absent, their layer is skipped. Schema
 * mismatches log a warning but don't fail the run (graceful degrade §7.8).
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  DEFAULT_CONFIG,
  mergeConfig,
  type ClaudeMapConfig,
} from './schema.js';

export interface LoadConfigOptions {
  projectCwd?: string; // used for `<project>/.agent-tree.yaml` and `{project}` token
  userConfigPath?: string; // override ~/.config/agent-tree/config.yaml (tests)
  env?: NodeJS.ProcessEnv;
  logger?: { warn?: (msg: string, extra?: unknown) => void };
}

const USER_CONFIG_DEFAULT = join(
  homedir(),
  '.config',
  'agent-tree',
  'config.yaml',
);

/**
 * Parse env vars that carry config (SPEC §17.2 catalog).
 * Returns a partial config matching the schema shape.
 */
function envToPartial(env: NodeJS.ProcessEnv): Partial<ClaudeMapConfig> {
  const out: Partial<ClaudeMapConfig> = {};
  const llm: Partial<ClaudeMapConfig['llm']> = {};
  if (env.AGENT_TREE_NO_LLM === '1' || env.AGENT_TREE_NO_LLM === 'true') {
    llm.enabled = false;
  }
  if (env.AGENT_TREE_MODEL) llm.model = env.AGENT_TREE_MODEL;
  if (env.AGENT_TREE_MAX_TOK) {
    const n = parseInt(env.AGENT_TREE_MAX_TOK, 10);
    if (!Number.isNaN(n)) llm.max_input_tokens = n;
  }
  if (Object.keys(llm).length > 0) out.llm = llm as ClaudeMapConfig['llm'];

  const redaction: Partial<ClaudeMapConfig['redaction']> = {};
  if (
    env.AGENT_TREE_REDACT_STRICT === '1' ||
    env.AGENT_TREE_REDACT_STRICT === 'true'
  ) {
    redaction.strict = true;
  }
  if (Object.keys(redaction).length > 0) {
    out.redaction = redaction as ClaudeMapConfig['redaction'];
  }

  const render: Partial<ClaudeMapConfig['render']> = {};
  if (env.AGENT_TREE_LANG === 'ko' || env.AGENT_TREE_LANG === 'en' || env.AGENT_TREE_LANG === 'auto') {
    render.lang = env.AGENT_TREE_LANG;
  }
  if (Object.keys(render).length > 0) {
    out.render = render as ClaudeMapConfig['render'];
  }

  const log: Partial<ClaudeMapConfig['log']> = {};
  if (
    env.AGENT_TREE_VERBOSE === '1' ||
    env.AGENT_TREE_VERBOSE === 'true'
  ) {
    log.level = 'debug';
  }
  if (Object.keys(log).length > 0) out.log = log as ClaudeMapConfig['log'];

  return out;
}

async function readYamlIfPresent(
  path: string,
  logger?: LoadConfigOptions['logger'],
): Promise<Partial<ClaudeMapConfig> | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const mod = await import('js-yaml');
    const parsed = mod.load(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Partial<ClaudeMapConfig>;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return null;
    logger?.warn?.(`failed to parse yaml at ${path}`, {
      error: String(err),
    });
    return null;
  }
}

/**
 * Load + merge config, returning both the final config and the per-layer
 * partials for debuggability.
 */
export async function loadConfig(
  opts: LoadConfigOptions = {},
): Promise<{
  config: ClaudeMapConfig;
  layers: {
    defaults: ClaudeMapConfig;
    user: Partial<ClaudeMapConfig> | null;
    project: Partial<ClaudeMapConfig> | null;
    env: Partial<ClaudeMapConfig>;
  };
}> {
  const env = opts.env ?? process.env;
  const projectCwd = opts.projectCwd ?? process.cwd();
  const userPath = opts.userConfigPath ?? USER_CONFIG_DEFAULT;
  const projectPath = resolve(projectCwd, '.agent-tree.yaml');

  const [userYaml, projectYaml] = await Promise.all([
    readYamlIfPresent(userPath, opts.logger),
    readYamlIfPresent(projectPath, opts.logger),
  ]);

  const envPartial = envToPartial(env);

  let merged = DEFAULT_CONFIG;
  merged = mergeConfig(merged, userYaml);
  merged = mergeConfig(merged, projectYaml);
  merged = mergeConfig(merged, envPartial);

  return {
    config: merged,
    layers: {
      defaults: DEFAULT_CONFIG,
      user: userYaml,
      project: projectYaml,
      env: envPartial,
    },
  };
}

/**
 * Expand `{project}` and `~` tokens in a path template.
 */
export function expandPath(template: string, projectCwd: string): string {
  let p = template;
  if (p.startsWith('~/') || p === '~') {
    p = join(homedir(), p.slice(1));
  }
  p = p.replace('{project}', projectCwd);
  return resolve(p);
}
