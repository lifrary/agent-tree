/** Query rules shared by the CLI and the MCP tool. */
export const MAX_SEARCH_LENGTH = 200;

/** Why a query cannot be searched, or null when it can. */
export function searchQueryProblem(query: string): string | null {
  if (!query.trim()) return 'needs a non-empty query';
  if (query.length > MAX_SEARCH_LENGTH)
    return `queries are limited to ${MAX_SEARCH_LENGTH} characters`;
  if (/[\r\n]/.test(query)) return 'queries must be a single line';
  return null;
}
