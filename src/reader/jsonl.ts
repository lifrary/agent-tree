/**
 * JSONL streaming reader — SPEC §7.1 pass 1
 *
 * Line 1 → SessionMeta (permission-mode envelope, no event payload)
 * Line 2+ → RawEvent[] preserving jsonl order
 *
 * Observed in real Claude Code 2.1.114 JSONL (SPEC Appendix D.4 M1 task):
 *   - Enumerated: attachment, user, assistant (spec §6)
 *   - UUID-carrying but not enumerated: system  → mapped to `type: 'system'`
 *   - UUIDless metadata: last-prompt, file-history-snapshot, queue-operation,
 *     mid-session permission-mode → counted as `skipped_meta`, not malformed
 *   - Unknown types with uuid  → `type: 'other'` (raw payload retained)
 *
 * Failure modes follow §7.8: truly malformed lines are skipped with a warning;
 * missing envelope fields fall back to sane defaults.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import { UUIDLESS_META_TYPES } from '../types.js';
import type { RawEvent, SessionMeta } from '../types.js';
import type { Logger } from '../utils/logger.js';

export interface ReadJsonlResult {
  meta: SessionMeta;
  events: RawEvent[];
  malformedCount: number;
  skippedMetaCount: number;
}

export interface ReadJsonlOptions {
  logger?: Logger;
  /** If true, throw on the first malformed line instead of skipping. Default false. */
  strict?: boolean;
}

export async function readJsonl(
  path: string,
  opts: ReadJsonlOptions = {},
): Promise<ReadJsonlResult> {
  const { logger, strict = false } = opts;

  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let meta: SessionMeta | null = null;
  const events: RawEvent[] = [];
  let malformedCount = 0;
  let skippedMetaCount = 0;
  let lineNo = 0;

  try {
    for await (const raw of rl) {
      lineNo += 1;
      const line = raw.trim();
      if (line.length === 0) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        malformedCount += 1;
        if (strict) {
          throw new Error(
            `jsonl parse error at ${path}:${lineNo} — ${(err as Error).message}`,
          );
        }
        logger?.warn(`skipped malformed jsonl line`, { path, lineNo });
        continue;
      }

      if (!isRecord(parsed)) {
        malformedCount += 1;
        logger?.warn(`skipped non-object jsonl line`, { path, lineNo });
        continue;
      }

      const type = typeof parsed.type === 'string' ? parsed.type : undefined;

      // First permission-mode line establishes the session meta.
      if (meta === null && type === 'permission-mode') {
        meta = {
          sessionId: String(parsed.sessionId ?? ''),
          permissionMode: String(parsed.permissionMode ?? 'default'),
        };
        continue;
      }

      // UUIDless metadata types are valid but don't participate in the DAG.
      if (type && UUIDLESS_META_TYPES.has(type)) {
        skippedMetaCount += 1;
        logger?.trace(`skipped uuidless meta line`, { lineNo, type });
        continue;
      }

      const ev = coerceRawEvent(parsed, lineNo, logger);
      if (ev) events.push(ev);
      else malformedCount += 1;
    }
  } finally {
    rl.close();
    stream.close();
  }

  if (!meta) {
    const first = events[0];
    meta = {
      sessionId: first?.sessionId ?? '',
      permissionMode: 'default',
    };
    logger?.warn(`no permission-mode meta line; synthesized from first event`);
  }

  return { meta, events, malformedCount, skippedMetaCount };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function coerceRawEvent(
  obj: Record<string, unknown>,
  lineNo: number,
  logger?: Logger,
): RawEvent | null {
  const uuid = typeof obj.uuid === 'string' ? obj.uuid : undefined;
  if (!uuid) {
    logger?.debug(`event missing uuid, skipping`, {
      lineNo,
      type: obj.type,
    });
    return null;
  }
  const type = typeof obj.type === 'string' ? obj.type : undefined;
  if (!type) {
    logger?.debug(`event missing type, skipping`, { lineNo, uuid });
    return null;
  }

  const envelope = {
    uuid,
    parentUuid:
      typeof obj.parentUuid === 'string' || obj.parentUuid === null
        ? (obj.parentUuid as string | null)
        : null,
    isSidechain: Boolean(obj.isSidechain),
    timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : '',
    sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : '',
    cwd: typeof obj.cwd === 'string' ? obj.cwd : '',
    gitBranch: typeof obj.gitBranch === 'string' ? obj.gitBranch : '',
    version: typeof obj.version === 'string' ? obj.version : '',
    entrypoint: typeof obj.entrypoint === 'string' ? obj.entrypoint : '',
    userType: typeof obj.userType === 'string' ? obj.userType : '',
  };

  switch (type) {
    case 'attachment':
      return {
        ...envelope,
        type: 'attachment',
        attachment: (isRecord(obj.attachment)
          ? obj.attachment
          : { type: 'unknown' }) as RawEvent extends {
          type: 'attachment';
          attachment: infer A;
        }
          ? A
          : never,
      };
    case 'user':
    case 'assistant':
      return {
        ...envelope,
        type,
        message: (isRecord(obj.message)
          ? obj.message
          : { role: type, content: [] }) as RawEvent extends {
          type: 'user' | 'assistant';
          message: infer M;
        }
          ? M
          : never,
      };
    case 'tool_use':
      return {
        ...envelope,
        type: 'tool_use',
        tool_use: (isRecord(obj.tool_use)
          ? obj.tool_use
          : { id: '', name: '', input: null }) as RawEvent extends {
          type: 'tool_use';
          tool_use: infer T;
        }
          ? T
          : never,
      };
    case 'tool_result':
      return {
        ...envelope,
        type: 'tool_result',
        tool_result: (isRecord(obj.tool_result)
          ? obj.tool_result
          : { tool_use_id: '', content: '' }) as RawEvent extends {
          type: 'tool_result';
          tool_result: infer T;
        }
          ? T
          : never,
      };
    case 'system':
      return {
        ...envelope,
        type: 'system',
        payload: obj,
      };
    default:
      return {
        ...envelope,
        type: 'other',
        originalType: type,
        payload: obj,
      };
  }
}
