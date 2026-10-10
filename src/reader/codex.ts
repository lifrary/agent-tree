import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { isFullUuid } from '../sources/files.js';
import type { ReadSessionOptions, ReadSessionResult } from '../sources/types.js';
import type { EventEnvelope, MessageContentBlock, RawEvent, SessionMeta } from '../types.js';
import { createCodexUsageCollector } from '../usage/codex.js';

type Invalid = (reason: string) => void;
type EventPayload<Event = RawEvent> = Event extends RawEvent
  ? Omit<Event, keyof EventEnvelope>
  : never;

interface MessageOrigin {
  kind: 'canonical' | 'fallback';
  role: 'user' | 'assistant';
  text: string;
  turnId: string;
  boundary: number;
}

interface Candidate {
  event: RawEvent;
  origin?: MessageOrigin;
  suppressed?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textField(
  obj: Record<string, unknown>,
  key: string,
  invalid: Invalid,
  required = true,
): string | undefined {
  const value = obj[key];
  if (typeof value === 'string') return value;
  if (required || value !== undefined) invalid(`${key} must be a string`);
  return undefined;
}

function identifier(
  obj: Record<string, unknown>,
  key: string,
  invalid: Invalid,
): string | undefined {
  const value = textField(obj, key, invalid);
  if (value !== undefined && !value.trim()) {
    invalid(`${key} must be nonempty`);
    return undefined;
  }
  return value;
}

function publicText(
  value: unknown,
  allowed: readonly string[],
  invalid: Invalid,
): MessageContentBlock[] {
  if (!Array.isArray(value)) {
    invalid('content must be an array');
    return [];
  }
  const blocks: MessageContentBlock[] = [];
  for (const block of value) {
    if (!isRecord(block) || typeof block.type !== 'string' || !block.type.trim()) {
      invalid('content blocks require a nonempty string type');
      continue;
    }
    if (!allowed.includes(block.type)) continue;
    const text = textField(block, 'text', invalid);
    if (text !== undefined) blocks.push({ type: 'text', text });
  }
  return blocks;
}

function blockText(blocks: MessageContentBlock[]): string {
  return blocks
    .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
    .join('\n');
}

function patchInput(name: string, input: unknown): unknown {
  if (name.split('.').at(-1) !== 'apply_patch') return input;
  const object = isRecord(input) ? input : undefined;
  const patch = typeof input === 'string' ? input : (object?.input ?? object?.patch);
  if (typeof patch !== 'string') return input;
  const paths = new Set<string>();
  if (Array.isArray(object?.paths)) {
    for (const path of object.paths) if (typeof path === 'string') paths.add(path);
  }
  for (const line of patch.split('\n')) {
    const match = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+?)\r?$/.exec(line);
    if (match && match[1].trim()) paths.add(match[1].trim());
  }
  return { ...(object ?? { input: patch }), paths: [...paths] };
}

function toolCall(payload: Record<string, unknown>, invalid: Invalid): EventPayload | null {
  const name = identifier(payload, 'name', invalid);
  const id = identifier(payload, 'call_id', invalid);
  let input: unknown;
  if (payload.type === 'function_call') {
    const argumentsText = textField(payload, 'arguments', invalid);
    if (argumentsText === undefined) return null;
    try {
      input = JSON.parse(argumentsText);
    } catch {
      invalid('arguments must contain valid JSON');
      return null;
    }
  } else {
    input = textField(payload, 'input', invalid);
    if (input === undefined) return null;
  }
  return name && id
    ? { type: 'tool_use', tool_use: { id, name, input: patchInput(name, input) } }
    : null;
}

function localShell(payload: Record<string, unknown>, invalid: Invalid): EventPayload | null {
  // Earlier Responses records used id instead of call_id for local shell calls.
  const id = identifier(payload, payload.call_id === undefined ? 'id' : 'call_id', invalid);
  if (!isRecord(payload.action)) {
    invalid('action must be an object');
    return null;
  }
  const action = payload.action;
  const type = identifier(action, 'type', invalid);
  if (type !== 'exec') return null;
  if (
    !Array.isArray(action.command) ||
    action.command.length === 0 ||
    !action.command.every((part) => typeof part === 'string')
  ) {
    invalid('command must be a nonempty array of strings');
    return null;
  }
  const input = { ...action };
  if (action.working_directory === null) {
    delete input.working_directory;
  } else if (
    action.working_directory !== undefined &&
    typeof action.working_directory !== 'string'
  ) {
    invalid('working_directory must be a string');
    delete input.working_directory;
  }
  if (action.timeout_ms === null) {
    delete input.timeout_ms;
  } else if (
    action.timeout_ms !== undefined &&
    (typeof action.timeout_ms !== 'number' ||
      !Number.isFinite(action.timeout_ms) ||
      action.timeout_ms < 0)
  ) {
    invalid('timeout_ms must be a nonnegative finite number');
    delete input.timeout_ms;
  }
  return id ? { type: 'tool_use', tool_use: { id, name: 'local_shell', input } } : null;
}

function responseItem(payload: Record<string, unknown>, invalid: Invalid): EventPayload | null {
  const type = identifier(payload, 'type', invalid);
  switch (type) {
    case 'message': {
      const role = identifier(payload, 'role', invalid);
      const content = publicText(payload.content, ['input_text', 'output_text'], invalid);
      // Never retain system/developer instructions, encrypted blocks, or opaque
      // future message content. Only the public text projection crosses here.
      return (role === 'user' || role === 'assistant') && Array.isArray(payload.content)
        ? { type: role, message: { role, content } }
        : null;
    }
    case 'function_call':
    case 'custom_tool_call':
      return toolCall(payload, invalid);
    case 'function_call_output':
    case 'custom_tool_call_output': {
      const id = identifier(payload, 'call_id', invalid);
      if (typeof payload.output !== 'string' && !Array.isArray(payload.output)) {
        invalid('output must be a string or an array');
        return null;
      }
      const content =
        typeof payload.output === 'string'
          ? payload.output
          : publicText(payload.output, ['input_text', 'output_text'], invalid);
      return id ? { type: 'tool_result', tool_result: { tool_use_id: id, content } } : null;
    }
    case 'local_shell_call':
      return localShell(payload, invalid);
    case 'reasoning': {
      const summary = blockText(publicText(payload.summary, ['summary_text'], invalid));
      return summary ? { type: 'system', payload: { type: 'reasoning', summary } } : null;
    }
    default:
      // In particular, agent_message is not the public role/content schema.
      return null;
  }
}

function permissionMode(payload: Record<string, unknown>, invalid: Invalid): string | undefined {
  for (const key of ['permissionMode', 'permission_mode']) {
    if (payload[key] !== undefined) return textField(payload, key, invalid);
  }
  // Structured future approval policies have no lossless string projection.
  return typeof payload.approval_policy === 'string' ? payload.approval_policy : undefined;
}

function recordUuid(raw: string, lineNo: number): string {
  // Neither ordinal (which can reset on resume) nor the emitted-event index is
  // an identity. Physical line + contents stays stable after append and dedup.
  const hex = createHash('sha256').update(`codex\0${lineNo}\0`).update(raw).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Match occurrences, not text sets: two identical legitimate turns stay two. */
function suppressFallbacks(candidates: Candidate[]): number {
  let role: MessageOrigin['role'] | undefined;
  let turnId = '';
  let boundary = 0;
  let suppressed = 0;
  const pending = new Map<
    string,
    { kind: MessageOrigin['kind']; items: Candidate[]; next: number }
  >();
  for (const candidate of candidates) {
    const origin = candidate.origin;
    if (!origin) continue;
    if (
      boundary !== origin.boundary ||
      ((!turnId || !origin.turnId) && (role !== origin.role || turnId !== origin.turnId))
    ) {
      pending.clear();
    }
    role = origin.role;
    turnId = origin.turnId;
    boundary = origin.boundary;
    // Explicit turns allow independently interleaved role queues. Without one,
    // an opposite-role message is the only available conversational boundary.
    const key = JSON.stringify([turnId, role, origin.text]);
    const queue = pending.get(key);
    if (queue && queue.kind !== origin.kind) {
      const other = queue.items[queue.next++];
      if (
        origin.kind === 'canonical' &&
        (candidate.event.type === 'user' || candidate.event.type === 'assistant') &&
        (other.event.type === 'user' || other.event.type === 'assistant')
      ) {
        // Authority belongs to the canonical payload, but append must not
        // replace the first occurrence's identity or chronological position.
        other.event.message = candidate.event.message;
      }
      candidate.suppressed = true;
      suppressed += 1;
      if (queue.next === queue.items.length) pending.delete(key);
    } else if (queue) {
      queue.items.push(candidate);
    } else {
      pending.set(key, { kind: origin.kind, items: [candidate], next: 0 });
    }
  }
  return suppressed;
}

export async function readCodex(
  path: string,
  opts: ReadSessionOptions = {},
): Promise<ReadSessionResult> {
  const { logger, strict = false } = opts;
  const stream = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const meta: SessionMeta = { sessionId: '', permissionMode: '' };
  const context = { cwd: '', gitBranch: '', version: '', entrypoint: '', isSidechain: false };
  const candidates: Candidate[] = [];
  const usage = createCodexUsageCollector();
  let turnId = '';
  let boundary = 0;
  let malformedCount = 0;
  let skippedMetaCount = 0;
  let lineNo = 0;
  let sawMeta = false;

  try {
    for await (const raw of lines) {
      lineNo += 1;
      if (!raw.trim()) continue;
      const issues = new Set<string>();
      const invalid: Invalid = (reason) => {
        if (strict) throw new Error(`codex jsonl error at line ${lineNo} — ${reason}`);
        issues.add(reason);
      };
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.trim());
      } catch {
        invalid('invalid JSON');
      }
      let event: EventPayload | null = null;
      let origin: MessageOrigin | undefined;
      let timestamp = '';
      let metadata = true;
      if (parsed !== undefined) {
        if (!isRecord(parsed)) {
          invalid('expected an object');
        } else {
          const type = identifier(parsed, 'type', invalid);
          if (type === 'token_usage_record') {
            // Metadata for the event stream; never a strict-mode error, so a
            // future shape degrades to "no data" instead of rejecting the file.
            const recordTime = typeof parsed.timestamp === 'string' ? parsed.timestamp : '';
            usage.tokenUsageRecord(parsed.payload, recordTime, candidates.length - 1);
          } else if (
            type &&
            ['session_meta', 'turn_context', 'response_item', 'event_msg', 'compacted'].includes(
              type,
            )
          ) {
            timestamp = textField(parsed, 'timestamp', invalid) ?? '';
            if (typeof parsed.timestamp === 'string' && !Number.isFinite(Date.parse(timestamp))) {
              invalid('timestamp must be a valid date');
            }
            if (
              parsed.ordinal !== undefined &&
              (typeof parsed.ordinal !== 'number' ||
                !Number.isSafeInteger(parsed.ordinal) ||
                parsed.ordinal < 0)
            ) {
              invalid('ordinal must be a nonnegative safe integer');
            }
            if (!isRecord(parsed.payload)) {
              invalid('payload must be an object');
            } else {
              const payload = parsed.payload;
              switch (type) {
                case 'session_meta': {
                  const id = identifier(payload, 'id', invalid);
                  if (id && !isFullUuid(id)) invalid('session id must be a UUID');
                  // id identifies this thread/rollout; session_id identifies its
                  // root thread and may legitimately name a different UUID.
                  if (
                    payload.session_id !== undefined &&
                    (typeof payload.session_id !== 'string' || !isFullUuid(payload.session_id))
                  ) {
                    invalid('root session id must be a UUID');
                  }
                  if (id && isFullUuid(id)) {
                    if (meta.sessionId && id.toLowerCase() !== meta.sessionId.toLowerCase()) {
                      invalid('session metadata id changed');
                    } else {
                      meta.sessionId = id;
                    }
                  }
                  const cwd = identifier(payload, 'cwd', invalid);
                  if (cwd !== undefined) context.cwd = cwd;
                  const version = textField(payload, 'cli_version', invalid, false);
                  if (version !== undefined) context.version = version;
                  if (payload.git !== undefined && payload.git !== null) {
                    if (!isRecord(payload.git)) invalid('git must be an object');
                    else if (payload.git.branch !== null) {
                      const branch = textField(payload.git, 'branch', invalid, false);
                      if (branch !== undefined) context.gitBranch = branch;
                    }
                  }
                  context.entrypoint = typeof payload.source === 'string' ? payload.source : '';
                  context.isSidechain =
                    payload.source === 'subagent' ||
                    (isRecord(payload.source) && Object.hasOwn(payload.source, 'subagent'));
                  const permission = permissionMode(payload, invalid);
                  if (permission !== undefined) meta.permissionMode = permission;
                  metadata = sawMeta;
                  sawMeta = true;
                  break;
                }
                case 'turn_context': {
                  const cwd = identifier(payload, 'cwd', invalid);
                  if (cwd !== undefined) context.cwd = cwd;
                  turnId = '';
                  if (payload.turn_id !== undefined) {
                    const id = identifier(payload, 'turn_id', invalid);
                    if (id !== undefined) turnId = id;
                  }
                  const permission = permissionMode(payload, invalid);
                  if (permission !== undefined) meta.permissionMode = permission;
                  break;
                }
                case 'response_item':
                  if (
                    typeof payload.type === 'string' &&
                    (payload.type.endsWith('_call') || payload.type.endsWith('_call_output'))
                  ) {
                    boundary += 1;
                  }
                  event = responseItem(payload, invalid);
                  if (event?.type === 'user' || event?.type === 'assistant') {
                    origin = {
                      kind: 'canonical',
                      role: event.type,
                      turnId,
                      boundary,
                      text: blockText(event.message.content as MessageContentBlock[]),
                    };
                  }
                  break;
                case 'event_msg': {
                  const eventType = identifier(payload, 'type', invalid);
                  // Tool notifications are not emitted as duplicate calls, but
                  // intervening work still separates message occurrences.
                  if (payload.call_id !== undefined) boundary += 1;
                  if (payload.turn_id !== undefined && typeof payload.turn_id === 'string')
                    turnId = payload.turn_id;
                  if (eventType === 'token_count') {
                    usage.tokenCount(payload, timestamp, candidates.length - 1);
                  } else if (eventType === 'user_message' || eventType === 'agent_message') {
                    const text = textField(payload, 'message', invalid);
                    if (text !== undefined) {
                      const role = eventType === 'user_message' ? 'user' : 'assistant';
                      event = { type: role, message: { role, content: [{ type: 'text', text }] } };
                      origin = { kind: 'fallback', role, text, turnId, boundary };
                    }
                  }
                  break;
                }
                case 'compacted': {
                  boundary += 1;
                  const message = textField(payload, 'message', invalid);
                  if (message !== undefined)
                    event = { type: 'system', payload: { type: 'compaction', message } };
                  break;
                }
              }
            }
          }
        }
      }
      if (event) {
        candidates.push({
          event: {
            ...context,
            uuid: recordUuid(raw, lineNo),
            parentUuid: null,
            timestamp,
            sessionId: meta.sessionId,
            userType: '',
            ...event,
          },
          origin,
        });
      } else if (metadata && issues.size === 0) {
        skippedMetaCount += 1;
      }
      if (issues.size > 0) {
        malformedCount += 1;
        logger?.warn('malformed codex jsonl line; recovered valid fields where possible', {
          lineNo,
          reasons: [...issues],
        });
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  skippedMetaCount += suppressFallbacks(candidates);
  const events: RawEvent[] = [];
  // survivors[i]: the last event at or before candidate i that is emitted.
  const survivors: Array<string | null> = [];
  let parentUuid: string | null = null;
  for (const candidate of candidates) {
    if (!candidate.suppressed) {
      candidate.event.parentUuid = parentUuid;
      events.push(candidate.event);
      parentUuid = candidate.event.uuid;
    }
    survivors.push(parentUuid);
  }
  const samples = usage.finish((after) => (after < 0 ? null : survivors[after]));
  if (usage.unrecognized > 0) {
    logger?.debug('skipped codex usage records with an unrecognized shape', {
      count: usage.unrecognized,
    });
  }
  return {
    meta,
    events,
    malformedCount,
    skippedMetaCount,
    ...(samples.length > 0 ? { usage: samples } : {}),
  };
}
