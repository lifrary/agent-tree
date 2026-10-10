/**
 * The searchable projection of a transcript record: user prompts, assistant
 * text, tool names and tool inputs, and tool results on request. Thinking,
 * Codex reasoning, system and developer instructions, attachments, hook output,
 * compaction summaries and account data (`rate_limits`) are never projected.
 *
 * Two entry points must agree record for record: `eventItems` reads parsed
 * events (both sources) and raw Claude records, which share the event shape;
 * `codexRecordItems` reads raw Codex records the way `readCodex` normalizes them.
 */

export type SearchField = 'user' | 'assistant' | 'tool_name' | 'tool_input' | 'tool_output';

export interface FieldText {
  field: SearchField;
  text: string;
}

export type Item =
  | { kind: 'text'; field: 'user' | 'assistant'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; id: string; content: unknown };

export interface ProjectionState {
  includeToolOutput: boolean;
  /** Ids of agent-tree search calls seen so far; their results are skipped too. */
  searchCalls: Set<string>;
}

const MAX_LEAF_DEPTH = 8;
// Running the search itself: `agent-tree --search …` or `npx atree … --search …`. The
// name must be a command word, not part of a path such as `~/Code/agent-tree-work`.
const SEARCH_COMMAND = /(?:^|[\s/;&|(`'"])(?:agent-tree|atree)\s(?:[^\n]*\s)?--search\b/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Items of a parsed event, or of a raw Claude record (the same shape). */
export function eventItems(record: Record<string, unknown>): Item[] {
  switch (record.type) {
    case 'user':
    case 'assistant': {
      // Claude Code marks text it injected itself (skill bodies, hook and
      // command output, compaction summaries); none of it is a prompt.
      if (record.isMeta === true || record.isCompactSummary === true) return [];
      const message = record.message;
      if (!isRecord(message)) return [];
      return messageItems(record.type, message.content);
    }
    case 'tool_use':
      return isRecord(record.tool_use) ? toolUseItems(record.tool_use) : [];
    case 'tool_result':
      return isRecord(record.tool_result) ? toolResultItems(record.tool_result) : [];
    default:
      return [];
  }
}

function messageItems(role: 'user' | 'assistant', content: unknown): Item[] {
  if (typeof content === 'string') return [{ kind: 'text', field: role, text: content }];
  if (!Array.isArray(content)) return [];
  const items: Item[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      items.push({ kind: 'text', field: role, text: block.text });
    } else if (block.type === 'tool_use') {
      items.push(...toolUseItems(block));
    } else if (block.type === 'tool_result') {
      items.push(...toolResultItems(block));
    }
  }
  return items;
}

function toolUseItems(block: Record<string, unknown>): Item[] {
  if (typeof block.name !== 'string') return [];
  const id = typeof block.id === 'string' ? block.id : '';
  return [{ kind: 'tool_use', id, name: block.name, input: block.input }];
}

function toolResultItems(block: Record<string, unknown>): Item[] {
  const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
  return [{ kind: 'tool_result', id, content: block.content }];
}

/** Items of a raw Claude record; like the reader, only records with a uuid are events. */
export function claudeRecordItems(record: Record<string, unknown>): Item[] {
  return typeof record.uuid === 'string' && record.uuid.trim() ? eventItems(record) : [];
}

/** Items of a raw Codex rollout record, mirroring what `readCodex` keeps. */
export function codexRecordItems(record: Record<string, unknown>): Item[] {
  const payload = record.payload;
  if (!isRecord(payload)) return [];
  if (record.type === 'event_msg') {
    if (typeof payload.message !== 'string') return [];
    if (payload.type === 'user_message')
      return [{ kind: 'text', field: 'user', text: payload.message }];
    if (payload.type === 'agent_message')
      return [{ kind: 'text', field: 'assistant', text: payload.message }];
    return [];
  }
  if (record.type !== 'response_item') return [];
  // The reader drops tool records without a nonempty call id.
  const id = typeof payload.call_id === 'string' ? payload.call_id.trim() && payload.call_id : '';
  const named = typeof payload.name === 'string' && payload.name.trim() !== '';
  switch (payload.type) {
    case 'message': {
      const role = payload.role;
      if ((role !== 'user' && role !== 'assistant') || !Array.isArray(payload.content)) return [];
      return publicTexts(payload.content).map((text) => ({ kind: 'text', field: role, text }));
    }
    case 'function_call': {
      if (!id || !named || typeof payload.arguments !== 'string') return [];
      let input: unknown;
      try {
        input = JSON.parse(payload.arguments);
      } catch {
        return [];
      }
      return [{ kind: 'tool_use', id, name: payload.name as string, input }];
    }
    case 'custom_tool_call':
      return id && named && typeof payload.input === 'string'
        ? [{ kind: 'tool_use', id, name: payload.name as string, input: payload.input }]
        : [];
    case 'local_shell_call': {
      const action = payload.action;
      if (!isRecord(action) || action.type !== 'exec') return [];
      // Earlier records used id instead of call_id for local shell calls.
      const shellId =
        payload.call_id === undefined && typeof payload.id === 'string' ? payload.id : id;
      return shellId.trim()
        ? [{ kind: 'tool_use', id: shellId, name: 'local_shell', input: action }]
        : [];
    }
    case 'function_call_output':
    case 'custom_tool_call_output': {
      const output = payload.output;
      if (!id || (typeof output !== 'string' && !Array.isArray(output))) return [];
      const content = typeof output === 'string' ? output : publicTexts(output);
      return [{ kind: 'tool_result', id, content }];
    }
    default:
      return [];
  }
}

function publicTexts(blocks: unknown[]): string[] {
  const texts: string[] = [];
  for (const block of blocks) {
    if (
      isRecord(block) &&
      (block.type === 'input_text' || block.type === 'output_text') &&
      typeof block.text === 'string'
    ) {
      texts.push(block.text);
    }
  }
  return texts;
}

/** Searchable texts of `items`, in order. Records search calls in `state`. */
export function fieldsOf(items: Item[], state: ProjectionState): FieldText[] {
  const fields: FieldText[] = [];
  for (const item of items) {
    if (item.kind === 'text') {
      if (item.field === 'user' && looksLikeSystemNoise(item.text)) continue;
      fields.push({ field: item.field, text: item.text });
    } else if (item.kind === 'tool_use') {
      const leaves = stringLeaves(item.input);
      if (isSearchCall(item.name, leaves)) {
        if (item.id) state.searchCalls.add(item.id);
        continue;
      }
      fields.push({ field: 'tool_name', text: item.name });
      for (const text of leaves) fields.push({ field: 'tool_input', text });
    } else if (state.includeToolOutput && !state.searchCalls.has(item.id)) {
      for (const text of outputTexts(item.content)) fields.push({ field: 'tool_output', text });
    }
  }
  return fields;
}

function isSearchCall(name: string, leaves: string[]): boolean {
  return name.endsWith('agent_tree_search') || leaves.some((leaf) => SEARCH_COMMAND.test(leaf));
}

/** String values anywhere in a tool input (commands, paths, patch text). */
function stringLeaves(value: unknown, depth = 0, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (depth < MAX_LEAF_DEPTH && Array.isArray(value)) {
    for (const entry of value) stringLeaves(entry, depth + 1, out);
  } else if (depth < MAX_LEAF_DEPTH && isRecord(value)) {
    for (const entry of Object.values(value)) stringLeaves(entry, depth + 1, out);
  }
  return out;
}

/** Text of a tool result; images and other binary blocks are skipped. */
function outputTexts(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') texts.push(block);
    else if (isRecord(block) && typeof block.text === 'string') texts.push(block.text);
  }
  return texts;
}

/**
 * The tree builder's rule for user-shaped text that no person typed (hook
 * output, skill bootstrap, environment blocks, shell pastes); kept identical to
 * `looksLikeSystemNoise` in src/tree/builder.ts.
 */
export function looksLikeSystemNoise(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.startsWith('<') || t.startsWith('[SYSTEM')) return true;
  if (t.startsWith('Stop hook ')) return true;
  if (t.startsWith('Base directory for this skill:')) return true;
  if (/^[❯>$#] /.test(t)) return true;
  return false;
}
