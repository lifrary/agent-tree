/**
 * Config schema — SPEC §17 / Appendix F
 *
 * All fields optional; missing keys inherit from DEFAULT_CONFIG. The loader
 * merges CLI > env > ~/.config/agent-tree/config.yaml > <project>/.agent-tree.yaml
 * > DEFAULT_CONFIG and validates the result against this schema before use.
 */

export type SidechainHandling = 'include' | 'flatten' | 'drop';
export type LangMode = 'auto' | 'ko' | 'en';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

// NOTE: the historical `output.*` and `render.{collapse_depth,node_size_scale,
// default_branch_mode}` keys were removed when the HTML renderer was deleted.
// `render.lang` survives for LLM prompt locale selection.

export interface ClaudeMapConfig {
  llm: {
    enabled: boolean;
    provider: string;
    model: string;
    max_input_tokens: number;
    max_output_tokens: number;
    cache: boolean;
    parallel: number;
  };
  redaction: {
    enabled: boolean;
    strict: boolean;
    extra_patterns: string[];
  };
  render: {
    lang: LangMode;
  };
  analyzer: {
    sidechain_handling: SidechainHandling;
    topic_gap_minutes: number;
    file_jaccard_threshold: number;
  };
  cache: {
    dir: string;
    enabled: boolean;
  };
  log: {
    level: LogLevel;
  };
  telemetry: {
    enabled: boolean;
  };
}

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
 * Deep-merge `source` into `target`. Objects are merged recursively; arrays
 * and primitives are replaced. Returns a fresh copy — neither argument is
 * mutated (honors project-wide immutability rule).
 */
export function mergeConfig(
  target: ClaudeMapConfig,
  source: Partial<ClaudeMapConfig> | undefined | null,
): ClaudeMapConfig {
  if (!source) return target;
  const out: Record<string, unknown> = { ...(target as unknown as Record<string, unknown>) };
  for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
    const tv = out[k];
    if (isRecord(v) && isRecord(tv)) {
      out[k] = mergeConfig(
        tv as unknown as ClaudeMapConfig,
        v as Partial<ClaudeMapConfig>,
      );
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as unknown as ClaudeMapConfig;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
