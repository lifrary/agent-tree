/**
 * Data model — SPEC v0.3 §6
 *
 * Shapes are derived from real Claude Code 2.1.114 JSONL (SPEC §4.2 / Appendix D).
 * Kept intentionally permissive on payload fields because schema may drift across
 * Claude Code versions (§14 risk row); reader performs graceful degrade on unknown
 * shapes rather than failing the whole run.
 */

// ---------------------------------------------------------------------------
// Raw ingestion
// ---------------------------------------------------------------------------

export interface EventEnvelope {
  uuid: string;
  parentUuid: string | null;
  isSidechain: boolean;
  timestamp: string; // ISO-8601
  sessionId: string;
  cwd: string;
  gitBranch: string;
  version: string;
  entrypoint: string;
  userType: string;
}

export type RawEventType =
  | 'attachment'
  | 'user'
  | 'assistant'
  | 'tool_use'
  | 'tool_result'
  | 'system'
  | 'other';

/**
 * Known JSONL `type` values that carry no `uuid` and are not part of the event
 * DAG — they're session-wide metadata lines we skip at ingest time. Discovered
 * empirically (SPEC Appendix D.4 M1 task): counting them as "malformed" would
 * be misleading.
 */
export const UUIDLESS_META_TYPES = new Set<string>([
  'permission-mode', // line 1 + subsequent permission-mode changes
  'last-prompt',
  'file-history-snapshot',
  'queue-operation',
]);

export interface AttachmentPayload {
  type: string; // 'hook_success' | 'hook_system_message' | ...
  hookName?: string;
  hookEvent?: string;
  content?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  command?: string;
  durationMs?: number;
  toolUseID?: string;
  [key: string]: unknown;
}

export type MessageContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string | unknown }
  | { type: 'thinking'; thinking?: string; [key: string]: unknown }
  | { type: string; [key: string]: unknown };

export interface MessagePayload {
  role: 'user' | 'assistant';
  content: MessageContentBlock[] | string;
  [key: string]: unknown;
}

export interface ToolUsePayload {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultPayload {
  tool_use_id: string;
  content: string | unknown;
}

export type RawEvent = EventEnvelope &
  (
    | { type: 'attachment'; attachment: AttachmentPayload }
    | { type: 'user'; message: MessagePayload }
    | { type: 'assistant'; message: MessagePayload }
    | { type: 'tool_use'; tool_use: ToolUsePayload }
    | { type: 'tool_result'; tool_result: ToolResultPayload }
    | { type: 'system'; payload: Record<string, unknown> }
    /**
     * Fallback bucket for event types that carry `uuid` but aren't enumerated
     * above (e.g. future Claude Code additions). Raw JSON body retained so
     * downstream analyzers can inspect by key without a schema bump.
     */
    | { type: 'other'; originalType: string; payload: Record<string, unknown> }
  );

// ---------------------------------------------------------------------------
// Session metadata (JSONL line 1)
// ---------------------------------------------------------------------------

export interface SessionMeta {
  sessionId: string;
  permissionMode: string;
}

// ---------------------------------------------------------------------------
// Graph view — DAG reconstruction from parentUuid chain
// ---------------------------------------------------------------------------

export interface SessionGraph {
  meta: SessionMeta;
  events: RawEvent[]; // linear order (jsonl line order)
  childrenOf: Map<string, string[]>; // parentUuid → [childUuid]
  roots: string[]; // parentUuid === null
  byUuid: Map<string, RawEvent>;
}

// JSON-serializable projection of SessionGraph (Map is not stringifiable by default)
export interface SessionGraphDump {
  meta: SessionMeta;
  events: RawEvent[];
  childrenOf: Record<string, string[]>;
  roots: string[];
  stats: {
    total_events: number;
    root_count: number;
    sidechain_count: number;
    orphan_count: number;
  };
}

// ---------------------------------------------------------------------------
// Heuristic segmentation — §7.2
// ---------------------------------------------------------------------------

export type BoundarySignal =
  | 'gap'
  | 'file_shift'
  | 'topic_shift_phrase'
  | 'slash_command'
  | 'sidechain_transition'
  | 'turn_force_split';

export interface TopicSegment {
  id: string; // 'seg_001'
  start_index: number; // inclusive (event array)
  end_index: number; // inclusive
  event_uuids: string[];
  dominant_files: string[];
  dominant_tools: string[];
  is_sidechain_only: boolean;
  time_range: [string, string];
  gap_before_ms: number;
  boundary_reasons: BoundarySignal[]; // why this segment started
}

// ---------------------------------------------------------------------------
// Mindmap — future (M2+)
// ---------------------------------------------------------------------------

export type NodeType =
  | 'root'
  | 'topic'
  | 'action'
  | 'decision'
  | 'error'
  | 'dead_end'
  | 'turn';

export interface ContextSnapshot {
  mode: 'continue' | 'fork';
  session_id: string;
  node_id: string;
  clipboard_markdown: string;
  related_files: Array<{ path: string; summary: string }>;
  next_steps: string[];
}

export interface MindMapNode {
  id: string; // 'n_042'
  type: NodeType;
  label: string; // ≤ 60 chars
  summary: string;
  index_range: [number, number];
  event_uuids: string[];
  files_touched: string[];
  tools_used: string[];
  is_sidechain: boolean;
  children: MindMapNode[];
  context_snapshot_continue: ContextSnapshot;
  context_snapshot_fork: ContextSnapshot;
  color?: 'green' | 'yellow' | 'red';
  icon?: string;
  shape?: 'rect' | 'circle' | 'diamond';
  /**
   * The TopicSegment id that produced this leaf (`undefined` for root and
   * container nodes like the 🔀 Sidechains bucket). Lets the LLM labeler do
   * an exact-id lookup instead of fragile first-uuid identity matching.
   */
  segment_id?: string;
  /**
   * Milliseconds elapsed between session start and this node's first event.
   * Used by the text renderer to print `T+1h 23m` anchors so identical-looking
   * user prompts are distinguishable across a long session. Root = 0.
   */
  time_offset_ms?: number;
  /**
   * Inline summary appended to phase-head labels (e.g. "7 actions · 3 files · 11min").
   * Lets users gauge phase weight without expanding sub-actions. Only set on
   * phase head nodes (those that contain children other than the root).
   */
  phase_meta?: string;
}

export interface MindMap {
  session_id: string;
  project_path: string;
  generated_at: string;
  spec_version: string;
  root: MindMapNode;
  stats: {
    total_events: number;
    total_turns: number;
    total_nodes: number;
    total_tool_calls: number;
    total_files_touched: number;
    duration_minutes: number;
    sidechain_count: number;
  };
}
