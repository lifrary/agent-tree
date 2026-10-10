/** Usage facts located at an event, before attribution to steps. */

export interface CompactionAt {
  eventUuid: string | null;
  pre_tokens: number | null;
  post_tokens: number | null;
  trigger: string;
}

/** One subagent's calls, linked to the main event that started it (null: unlinked). */
export interface SubagentUsageAt {
  agentId: string;
  eventUuid: string | null;
  calls: number;
  prompt_tokens: number;
  output_tokens: number;
}
