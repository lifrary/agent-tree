import type { RawEvent, SessionMeta } from '../types.js';
import type { Logger } from '../utils/logger.js';

export type SessionSourceId = 'claude' | 'codex';

export interface SessionMatch {
  source: SessionSourceId;
  sessionId: string;
  /** Encoded project directory for Claude; working directory for Codex. */
  projectDir: string;
  jsonlPath: string;
}

export interface SessionEntry extends SessionMatch {
  mtimeMs: number;
  sizeBytes: number;
  archived?: boolean;
  subagent?: {
    id: string;
    parentSessionId: string | null;
    parentAgentId?: string;
    toolUseId?: string;
    createdAt?: string;
  };
}

export interface DiscoverOptions {
  /** Override the adapter's session root, primarily for isolated callers/tests. */
  root?: string;
  projectCwd?: string;
  /** Catalogs remain main-session-only unless explicitly requested. */
  includeSubagents?: boolean;
  /** Codex archives are searched, but excluded from the default recent catalog. */
  includeArchived?: boolean;
}

export interface ReadSessionOptions {
  logger?: Logger;
  strict?: boolean;
}

export interface ReadSessionResult {
  meta: SessionMeta;
  events: RawEvent[];
  malformedCount: number;
  skippedMetaCount: number;
  /** Model calls logged outside the events (Codex token records); Claude usage stays on its events. */
  usage?: UsageSample[];
}

/** One model call's token counts as the source logged them, before attribution to steps. */
export interface UsageSample {
  /** Stable call identity when logged, for deduplicating inherited subagent history. */
  response_id?: string;
  thread_id?: string;
  /** The event the call belongs to; for Codex, the last event emitted before it. */
  eventUuid: string | null;
  timestamp: string;
  prompt_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  context_window: number | null;
}

/** Adapters normalize source logs; analysis and output remain source-independent. */
export interface SessionSource {
  id: SessionSourceId;
  discover(options: DiscoverOptions): Promise<SessionEntry[]>;
  /** Positive identification of one parsed JSONL record; never guess unknown formats. */
  accepts(record: Record<string, unknown>): boolean;
  read(path: string, options?: ReadSessionOptions): Promise<ReadSessionResult>;
}
