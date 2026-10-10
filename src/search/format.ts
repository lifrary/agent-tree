/** Text rendering of a search report, shared by the CLI and the MCP tool. */
import type { Matcher } from './matcher.js';
import type { SearchReport, SessionResult } from './types.js';

export const TEXT_STEPS_PER_SESSION = 5;
const FIELD_WIDTH = 11;
const HIGHLIGHT = ['\x1b[1;31m', '\x1b[0m'] as const;

export interface FormatOptions {
  commandId(result: SessionResult): string;
  /** Wrap the match in ANSI bold red (terminals only). */
  highlight?: Matcher;
}

/** One block per session, newest first, separated by blank lines. */
export function formatSessionBlocks(report: SearchReport, options: FormatOptions): string[] {
  return report.results.map((result) => formatSession(result, options));
}

function formatSession(result: SessionResult, options: FormatOptions): string {
  const shown = result.hits.slice(0, TEXT_STEPS_PER_SESSION);
  const more = result.hits.length - shown.length + result.more_hits;
  const stepWidth = Math.max(...shown.map((hit) => `step ${hit.step}`.length));
  const lines = [
    `${result.source}  ${result.session_id.slice(0, 8)}  ${result.project_dir}  ${localTime(result.mtime)}`,
    ...shown.map(
      (hit) =>
        `  ${`step ${hit.step}`.padEnd(stepWidth)}  ${hit.field.padEnd(FIELD_WIDTH)} ${highlight(hit.snippet, options.highlight)}`,
    ),
  ];
  if (more > 0) lines.push(`  +${more} more step${more === 1 ? '' : 's'}`);
  lines.push(
    `  open: agent-tree --source ${result.source} ${options.commandId(result)} --snapshot ${result.hits[0].step} --mode continue`,
  );
  return lines.join('\n');
}

/** One line on what was scanned, for stderr (CLI) or the end of the MCP text. */
export function formatSummary(report: SearchReport, limit: number): string {
  const { sessions, bytes, seconds, stopped_early } = report.scanned;
  const found =
    report.total_sessions === 0
      ? 'No matches'
      : `${report.total_sessions} session${report.total_sessions === 1 ? '' : 's'} with matches`;
  const scanned = `${sessions} session${sessions === 1 ? '' : 's'} (${formatBytes(bytes)}) scanned in ${seconds} s`;
  const stop = stopped_early
    ? `; stopped at the limit of ${limit}, older sessions were not searched`
    : '';
  return `${found}; ${scanned}${stop}.`;
}

function highlight(snippet: string, matcher: Matcher | undefined): string {
  if (!matcher) return snippet;
  const at = matcher.indexIn(snippet);
  if (at < 0) return snippet;
  const end = at + matcher.query.length;
  return `${snippet.slice(0, at)}${HIGHLIGHT[0]}${snippet.slice(at, end)}${HIGHLIGHT[1]}${snippet.slice(end)}`;
}

function localTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}
