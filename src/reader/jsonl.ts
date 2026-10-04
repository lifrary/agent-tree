/**
 * JSONL streaming reader — SPEC §7.1 pass 1
 *
 * Line 1 → SessionMeta (permission-mode envelope, no event payload)
 * Line 2+ → RawEvent[] preserving jsonl order
 *
 * Observed in real Claude Code 2.1.114 JSONL (SPEC Appendix D.4 M1 task):
 *   - Enumerated: attachment, user, assistant (spec §6)
 *   - UUID-carrying but not enumerated: system  → mapped to `type: 'system'`
 *   - UUIDless lines of any non-event type (last-prompt, custom-title, mode,
 *     mid-session permission-mode, …) → counted as `skipped_meta`, not malformed
 *   - Unknown types with uuid  → `type: 'other'` (raw payload retained)
 *
 * Invalid lines are warned about once; recoverable payloads are sanitized.
 * Missing optional envelope fields fall back to sane defaults.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import { UUID_EVENT_TYPES } from '../types.js';
import type {
  AttachmentPayload,
  MessageContentBlock,
  MessagePayload,
  RawEvent,
  SessionMeta,
  ToolResultPayload,
  ToolUsePayload,
} from '../types.js';
import type { Logger } from '../utils/logger.js';

export interface ReadJsonlResult {
  meta: SessionMeta;
  events: RawEvent[];
  malformedCount: number;
  skippedMetaCount: number;
}

export interface ReadJsonlOptions {
  logger?: Logger;
  /** Reject malformed JSON, envelopes and payloads instead of recovering. Default false. */
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
      } catch {
        malformedCount += 1;
        if (strict) {
          // JSON.parse diagnostics can contain the source text, including secrets.
          throw new Error(`jsonl error at ${path}:${lineNo} — invalid JSON`);
        }
        logger?.warn(`skipped malformed jsonl line`, { path, lineNo });
        continue;
      }

      if (!isRecord(parsed)) {
        malformedCount += 1;
        if (strict) {
          throw new Error(`jsonl error at ${path}:${lineNo} — expected an object`);
        }
        logger?.warn(`skipped non-object jsonl line`, { path, lineNo });
        continue;
      }

      const issues = new Set<string>();
      const invalid = (reason: string): void => {
        if (strict) {
          throw new Error(`jsonl error at ${path}:${lineNo} — ${reason}`);
        }
        issues.add(reason);
      };
      const type = typeof parsed.type === 'string' ? parsed.type : undefined;
      const uuidless = parsed.uuid === undefined || parsed.uuid === null;

      // First permission-mode line establishes the session meta; subsequent
      // changes are metadata too, but still validate their known fields.
      if (type === 'permission-mode' && uuidless) {
        const permissionMeta = {
          sessionId: stringField(parsed, 'sessionId', invalid),
          permissionMode: stringField(parsed, 'permissionMode', invalid, 'default'),
        };
        if (meta === null) {
          meta = permissionMeta;
        } else {
          skippedMetaCount += 1;
          logger?.trace(`skipped uuidless meta line`, { lineNo, type });
        }
      } else if (type?.trim() && !UUID_EVENT_TYPES.has(type) && uuidless) {
        // UUID-carrying records still participate in the DAG, even when their
        // type is commonly used for metadata.
        skippedMetaCount += 1;
        logger?.trace(`skipped uuidless meta line`, { lineNo, type });
      } else {
        const ev = coerceRawEvent(parsed, invalid);
        if (ev) events.push(ev);
      }

      if (issues.size > 0) {
        malformedCount += 1;
        logger?.warn(`malformed jsonl line; recovered valid fields where possible`, {
          path,
          lineNo,
          reasons: [...issues],
        });
      }
    }
  } finally {
    rl.close();
    stream.destroy();
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

type Invalid = (reason: string) => void;

function stringField(
  obj: Record<string, unknown>,
  key: string,
  invalid: Invalid,
  fallback = '',
  required = false,
): string {
  const value = obj[key];
  if (typeof value === 'string') return value;
  if (value !== undefined || required) invalid(`${key} must be a string`);
  return fallback;
}

function recordField(
  obj: Record<string, unknown>,
  key: string,
  invalid: Invalid,
): Record<string, unknown> {
  if (isRecord(obj[key])) return obj[key];
  invalid(`${key} must be an object`);
  return {};
}

function toolUse(obj: Record<string, unknown>, invalid: Invalid): ToolUsePayload {
  return {
    ...obj,
    id: stringField(obj, 'id', invalid, '', true),
    name: stringField(obj, 'name', invalid, '', true),
    input: obj.input ?? null,
  };
}

function toolResult(obj: Record<string, unknown>, invalid: Invalid): ToolResultPayload {
  return {
    ...obj,
    tool_use_id: stringField(obj, 'tool_use_id', invalid, '', true),
    content: obj.content === undefined ? '' : obj.content,
  };
}

function messageContent(value: unknown, invalid: Invalid): MessagePayload['content'] {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) {
    invalid('message.content must be a string or an array');
    return [];
  }
  const blocks: MessageContentBlock[] = [];
  for (const block of value) {
    if (!isRecord(block) || typeof block.type !== 'string' || !block.type) {
      invalid('message.content blocks must be objects with a nonempty string type');
      continue;
    }
    switch (block.type) {
      case 'text':
        blocks.push({
          ...block,
          type: 'text',
          text: stringField(block, 'text', invalid, '', true),
        });
        break;
      case 'tool_use':
        blocks.push({ ...toolUse(block, invalid), type: 'tool_use' });
        break;
      case 'tool_result':
        blocks.push({ ...toolResult(block, invalid), type: 'tool_result' });
        break;
      case 'thinking':
        if (block.thinking !== undefined && typeof block.thinking !== 'string') {
          invalid('thinking must be a string');
          const sanitized: Record<string, unknown> & { type: string } = {
            ...block,
            type: 'thinking',
          };
          delete sanitized.thinking;
          blocks.push(sanitized);
        } else {
          blocks.push({ ...block, type: 'thinking' });
        }
        break;
      default:
        // New content types (images, documents, server tools, redacted thinking,
        // etc.) are opaque, not malformed. Preserve their complete payload.
        blocks.push({ ...block, type: block.type });
    }
  }
  return blocks;
}

function attachment(obj: Record<string, unknown>, invalid: Invalid): AttachmentPayload {
  const payload: AttachmentPayload = {
    ...obj,
    type: stringField(obj, 'type', invalid, 'unknown', true),
  };
  for (const key of [
    'hookName',
    'hookEvent',
    'content',
    'stdout',
    'stderr',
    'command',
    'toolUseID',
  ] as const) {
    if (payload[key] !== undefined && typeof payload[key] !== 'string') {
      // Claude Code writes list/object `content` for some attachment types
      // (hook_additional_context, file, nested_memory). That is valid input,
      // but nothing reads non-string content, so it is dropped unflagged.
      if (key !== 'content') invalid(`attachment.${key} must be a string`);
      delete payload[key];
    }
  }
  for (const key of ['exitCode', 'durationMs'] as const) {
    if (payload[key] !== undefined && !Number.isFinite(payload[key])) {
      invalid(`attachment.${key} must be a finite number`);
      delete payload[key];
    }
  }
  return payload;
}

function coerceRawEvent(obj: Record<string, unknown>, invalid: Invalid): RawEvent | null {
  const uuid = typeof obj.uuid === 'string' ? obj.uuid : undefined;
  if (!uuid?.trim()) {
    invalid('event requires a nonempty string uuid');
    return null;
  }
  const type = typeof obj.type === 'string' ? obj.type : undefined;
  if (!type?.trim()) {
    invalid('event requires a nonempty string type');
    return null;
  }

  if (obj.parentUuid != null && typeof obj.parentUuid !== 'string') {
    invalid('parentUuid must be a string or null');
  }
  if (obj.isSidechain !== undefined && typeof obj.isSidechain !== 'boolean') {
    invalid('isSidechain must be a boolean');
  }
  const envelope = {
    ...obj,
    uuid,
    parentUuid: typeof obj.parentUuid === 'string' ? obj.parentUuid : null,
    isSidechain: obj.isSidechain === true,
    timestamp: stringField(obj, 'timestamp', invalid),
    sessionId: stringField(obj, 'sessionId', invalid),
    cwd: stringField(obj, 'cwd', invalid),
    gitBranch: stringField(obj, 'gitBranch', invalid),
    version: stringField(obj, 'version', invalid),
    entrypoint: stringField(obj, 'entrypoint', invalid),
    userType: stringField(obj, 'userType', invalid),
  };

  switch (type) {
    case 'attachment':
      return {
        ...envelope,
        type: 'attachment',
        attachment: attachment(recordField(obj, 'attachment', invalid), invalid),
      };
    case 'user':
    case 'assistant': {
      const message = recordField(obj, 'message', invalid);
      const role = message.role;
      if (role !== undefined && role !== 'user' && role !== 'assistant') {
        invalid('message.role must be user or assistant');
      }
      return {
        ...envelope,
        type,
        message: {
          ...message,
          role: role === 'user' || role === 'assistant' ? role : type,
          content: messageContent(message.content, invalid),
        },
      };
    }
    case 'tool_use':
      return {
        ...envelope,
        type: 'tool_use',
        tool_use: toolUse(recordField(obj, 'tool_use', invalid), invalid),
      };
    case 'tool_result':
      return {
        ...envelope,
        type: 'tool_result',
        tool_result: toolResult(recordField(obj, 'tool_result', invalid), invalid),
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
