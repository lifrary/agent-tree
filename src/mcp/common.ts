/** Schema pieces and result helpers shared by every MCP tool module. */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { defaultRedactor } from '../utils/redact.js';

export const sourceInput = z
  .enum(['claude', 'codex'])
  .optional()
  .describe('Session source. Discovery defaults to claude; file imports auto-detect.');

export const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

export function safely<T>(
  handler: (args: T) => Promise<CallToolResult>,
): (args: T) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await handler(args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ...text(defaultRedactor().apply(message)), isError: true };
    }
  };
}
