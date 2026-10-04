/**
 * Config schema — SPEC §17 / Appendix F
 *
 * Config layers may omit any field. Precedence is defaults < user YAML
 * < project YAML < environment; callers apply explicit CLI overrides last.
 * Invalid fields are ignored independently so valid siblings still apply.
 */

import { z } from 'zod';

// NOTE: the historical `output.*` and `render.{collapse_depth,node_size_scale,
// default_branch_mode}` keys were removed when the HTML renderer was deleted.
// `render.lang` controls LLM label, summary and next-step language.

const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonblankString = z.string().refine((value) => value.trim().length > 0);

export const CONFIG_SCHEMA = z.object({
  llm: z.object({
    enabled: z.boolean(),
    provider: z.literal('anthropic'),
    model: nonblankString,
    max_input_tokens: positiveInteger,
    max_output_tokens: positiveInteger,
    cache: z.boolean(),
    parallel: positiveInteger,
  }),
  redaction: z.object({
    enabled: z.literal(true), // Security sinks must always redact.
    strict: z.boolean(),
    extra_patterns: z.array(z.string()),
  }),
  render: z.object({
    lang: z.enum(['auto', 'ko', 'en']),
  }),
  analyzer: z.object({
    sidechain_handling: z.enum(['include', 'flatten', 'drop']),
    topic_gap_minutes: z.number().finite().nonnegative(),
    file_jaccard_threshold: z.number().finite().min(0).max(1),
  }),
  cache: z.object({
    dir: nonblankString,
    enabled: z.boolean(),
  }),
  log: z.object({
    level: z.enum(['error', 'warn', 'info', 'debug', 'trace']),
  }),
  telemetry: z.object({
    enabled: z.literal(false), // Telemetry is not implemented.
  }),
});

const overridesSchema = z.object({
  llm: CONFIG_SCHEMA.shape.llm.partial().optional(),
  redaction: CONFIG_SCHEMA.shape.redaction.partial().optional(),
  render: CONFIG_SCHEMA.shape.render.partial().optional(),
  analyzer: CONFIG_SCHEMA.shape.analyzer.partial().optional(),
  cache: CONFIG_SCHEMA.shape.cache.partial().optional(),
  log: CONFIG_SCHEMA.shape.log.partial().optional(),
  telemetry: CONFIG_SCHEMA.shape.telemetry.partial().optional(),
});

export type ClaudeMapConfig = z.infer<typeof CONFIG_SCHEMA>;
export type ConfigOverrides = z.infer<typeof overridesSchema>;
export type SidechainHandling = ClaudeMapConfig['analyzer']['sidechain_handling'];
export type LangMode = ClaudeMapConfig['render']['lang'];
export type LogLevel = ClaudeMapConfig['log']['level'];

export const DEFAULT_CONFIG: ClaudeMapConfig = {
  llm: {
    enabled: true,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    max_input_tokens: 50_000,
    max_output_tokens: 5_000,
    cache: true,
    parallel: 3,
  },
  redaction: {
    enabled: true,
    strict: false,
    extra_patterns: [],
  },
  render: {
    lang: 'auto',
  },
  analyzer: {
    sidechain_handling: 'include',
    topic_gap_minutes: 5,
    file_jaccard_threshold: 0.3,
  },
  cache: {
    dir: '~/.cache/agent-tree',
    enabled: true,
  },
  log: {
    level: 'info',
  },
  telemetry: {
    enabled: false,
  },
};

/**
 * Validate a partial layer one field at a time. Warnings contain only field
 * paths, never rejected values or Zod messages (which can include input).
 * Arrays are single values: an invalid entry rejects the entire override.
 */
export function parseConfigLayer(
  source: unknown,
  warn?: (message: string) => void,
): ConfigOverrides | null {
  if (!isRecord(source)) {
    warn?.('ignored invalid config root: expected an object');
    return null;
  }

  const out: Record<string, Record<string, unknown>> = {};
  for (const [section, value] of Object.entries(source)) {
    if (!Object.hasOwn(CONFIG_SCHEMA.shape, section)) {
      warn?.(`ignored unknown config field ${formatPath([section])}`);
      continue;
    }
    if (value === undefined) continue;
    if (!isRecord(value)) {
      warn?.(`ignored invalid config section ${section}: expected an object`);
      continue;
    }

    const fields: Record<string, z.ZodType> =
      CONFIG_SCHEMA.shape[section as keyof ClaudeMapConfig].shape;
    const validFields: Record<string, unknown> = {};
    for (const [field, input] of Object.entries(value)) {
      if (!Object.hasOwn(fields, field)) {
        warn?.(`ignored unknown config field ${formatPath([section, field])}`);
        continue;
      }
      if (input === undefined) continue;
      const result = fields[field].safeParse(input);
      if (result.success) {
        validFields[field] = result.data;
      } else {
        for (const issue of result.error.issues) {
          warn?.(`ignored invalid config value at ${formatPath([section, field, ...issue.path])}`);
        }
      }
    }
    out[section] = validFields;
  }
  return overridesSchema.parse(out);
}

/**
 * Merge validated partial sections; arrays and primitives are replaced.
 * Every returned section and array is detached from both inputs, including
 * when `source` is absent. Unknown and prototype keys are never copied.
 */
export function mergeConfig(
  target: ClaudeMapConfig,
  source: ConfigOverrides | undefined | null,
): ClaudeMapConfig {
  const out = CONFIG_SCHEMA.parse(target);
  const overrides = source == null ? null : parseConfigLayer(source);
  for (const [section, values] of Object.entries(overrides ?? {})) {
    Object.assign(out[section as keyof ClaudeMapConfig], values);
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const prototype = Object.getPrototypeOf(v);
  return prototype === Object.prototype || prototype === null;
}

function formatPath(parts: PropertyKey[]): string {
  return parts
    .map((part, index) => {
      if (typeof part === 'number') return `[${part}]`;
      const key = String(part);
      if (/^[a-z_]/i.test(key) && !/[^a-z0-9_]/i.test(key)) {
        return `${index === 0 ? '' : '.'}${key}`;
      }
      return `[${JSON.stringify(key)}]`;
    })
    .join('');
}
