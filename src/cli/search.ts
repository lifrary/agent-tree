/** --search: find the sessions and steps where a text appears. */
import type { Logger } from '../utils/logger.js';
import type { Redactor } from '../utils/redact.js';
import type { CliOptions } from './options.js';
import type { ResolvedConfig } from './pipeline.js';

export interface SearchModeContext {
  opts: CliOptions;
  config: ResolvedConfig;
  logger: Logger;
  /** Set when --cwd limits the search to one project; undefined searches every project. */
  projectCwd?: string;
  redactor: Redactor;
}

export async function runSearchMode(_ctx: SearchModeContext): Promise<number> {
  console.error('error: --search is not implemented yet');
  return 1;
}
