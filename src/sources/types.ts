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
}

export interface DiscoverOptions {
  /** Override the adapter's session root, primarily for isolated callers/tests. */
  root?: string;
  projectCwd?: string;
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
}

/** Adapters normalize source logs; analysis and output remain source-independent. */
export interface SessionSource {
  id: SessionSourceId;
  discover(options: DiscoverOptions): Promise<SessionEntry[]>;
  /** Positive identification of one parsed JSONL record; never guess unknown formats. */
  accepts(record: Record<string, unknown>): boolean;
  read(path: string, options?: ReadSessionOptions): Promise<ReadSessionResult>;
}
