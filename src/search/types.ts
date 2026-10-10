/** The --search report: the CLI's --json output and the MCP tool's structuredContent. */
import type { SessionSourceId } from '../sources/types.js';
import type { SearchField } from './project.js';

export interface SearchHit {
  step: number;
  node_id: string;
  /** Field of the first match in the step. */
  field: SearchField;
  timestamp: string;
  snippet: string;
  /** Matching fields in the step, the first one included. */
  matches_in_step: number;
}

export interface SessionResult {
  source: SessionSourceId;
  session_id: string;
  project_dir: string;
  mtime: string;
  hits: SearchHit[];
  /** Matching steps beyond `hits`. */
  more_hits: number;
}

export interface SearchReport {
  query: string;
  case_sensitive: boolean;
  scope: {
    sources: SessionSourceId[];
    project: string | null;
    since_days: number | null;
    include_tool_output: boolean;
  };
  scanned: {
    sessions: number;
    bytes: number;
    seconds: number;
    /** True when --limit was reached before every session in scope was scanned. */
    stopped_early: boolean;
  };
  /** Sessions found; an MCP reply trimmed to its size budget may list fewer. */
  total_sessions: number;
  results: SessionResult[];
}
