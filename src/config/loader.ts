/**
 * Config loader — SPEC §17.1 precedence chain:
 *   defaults < ~/.config/agent-tree/config.yaml < <project>/.agent-tree.yaml
 *   < env vars < explicit CLI flags (applied by the caller)
 *
 * Both YAML files are optional — if absent, their layer is skipped. Schema
 * mismatches log a warning but don't fail the run (graceful degrade §7.8).
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  DEFAULT_CONFIG,
  CONFIG_SCHEMA,
  mergeConfig,
  parseConfigLayer,
  type ClaudeMapConfig,
  type ConfigOverrides,
} from './schema.js';

export interface LoadConfigOptions {
  projectCwd?: string; // used for `<project>/.agent-tree.yaml` and `{project}` token
  userConfigPath?: string; // override ~/.config/agent-tree/config.yaml (tests)
  env?: NodeJS.ProcessEnv;
  logger?: { warn?: (msg: string, extra?: unknown) => void };
}

const USER_CONFIG_DEFAULT = join(homedir(), '.config', 'agent-tree', 'config.yaml');

/**
 * Parse env vars that carry config (SPEC §17.2 catalog).
 * Returns a partial config matching the schema shape.
 */
function envToPartial(
  env: NodeJS.ProcessEnv,
  logger?: LoadConfigOptions['logger'],
): ConfigOverrides {
  const out: ConfigOverrides = {};
  const llm: Partial<ClaudeMapConfig['llm']> = {};
  if (env.AGENT_TREE_NO_LLM === '1' || env.AGENT_TREE_NO_LLM === 'true') {
    llm.enabled = false;
  }
  if (env.AGENT_TREE_MODEL !== undefined) llm.model = env.AGENT_TREE_MODEL;
  if (env.AGENT_TREE_MAX_TOK !== undefined) {
    const raw = env.AGENT_TREE_MAX_TOK;
    const n = Number(raw);
    if (raw.length > 0 && !/[^0-9]/.test(raw) && Number.isSafeInteger(n) && n > 0) {
      llm.max_input_tokens = n;
    } else {
      logger?.warn?.(
        'ignored invalid environment variable AGENT_TREE_MAX_TOK: expected a positive safe integer',
      );
    }
  }
  if (Object.keys(llm).length > 0) out.llm = llm;

  const redaction: Partial<ClaudeMapConfig['redaction']> = {};
  if (env.AGENT_TREE_REDACT_STRICT === '1' || env.AGENT_TREE_REDACT_STRICT === 'true') {
    redaction.strict = true;
  }
  if (Object.keys(redaction).length > 0) {
    out.redaction = redaction;
  }

  if (env.AGENT_TREE_LANG !== undefined) {
    const lang = CONFIG_SCHEMA.shape.render.shape.lang.safeParse(env.AGENT_TREE_LANG);
    if (lang.success) {
      out.render = { lang: lang.data };
    } else {
      logger?.warn?.('ignored invalid environment variable AGENT_TREE_LANG');
    }
  }

  const log: Partial<ClaudeMapConfig['log']> = {};
  if (env.AGENT_TREE_VERBOSE === '1' || env.AGENT_TREE_VERBOSE === 'true') {
    log.level = 'debug';
  }
  if (Object.keys(log).length > 0) out.log = log;

  return parseConfigLayer(out, (message) => logger?.warn?.(`environment config: ${message}`)) ?? {};
}

async function readYamlIfPresent(
  path: string,
  layer: 'user' | 'project',
  logger?: LoadConfigOptions['logger'],
): Promise<ConfigOverrides | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const mod = await import('js-yaml');
    const documents = mod.loadAll(raw);
    if (documents.length === 0) return null;
    if (documents.length !== 1) throw new Error('expected one config document');
    const [parsed] = documents;
    return parseConfigLayer(parsed, (message) => logger?.warn?.(`${layer} config: ${message}`));
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    // YAML exception text includes source snippets; never log it.
    logger?.warn?.(`failed to read or parse ${layer} config YAML`);
    return null;
  }
}

/**
 * Load + merge config, returning both the final config and the per-layer
 * partials for debuggability.
 */
export async function loadConfig(opts: LoadConfigOptions = {}): Promise<{
  config: ClaudeMapConfig;
  layers: {
    defaults: ClaudeMapConfig;
    user: ConfigOverrides | null;
    project: ConfigOverrides | null;
    env: ConfigOverrides;
  };
}> {
  const env = opts.env ?? process.env;
  const projectCwd = opts.projectCwd ?? process.cwd();
  const userPath = opts.userConfigPath ?? USER_CONFIG_DEFAULT;
  const projectPath = resolve(projectCwd, '.agent-tree.yaml');

  const [userYaml, projectYaml] = await Promise.all([
    readYamlIfPresent(userPath, 'user', opts.logger),
    readYamlIfPresent(projectPath, 'project', opts.logger),
  ]);

  const envPartial = envToPartial(env, opts.logger);

  let merged = DEFAULT_CONFIG;
  merged = mergeConfig(merged, userYaml);
  merged = mergeConfig(merged, projectYaml);
  merged = mergeConfig(merged, envPartial);

  return {
    config: merged,
    layers: {
      defaults: mergeConfig(DEFAULT_CONFIG, null),
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
