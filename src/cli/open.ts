/** --open: start a new agent session from a step's continue or fork prompt. */
import type { ModeContext } from './modes.js';

export async function runOpenMode(_ctx: ModeContext): Promise<number> {
  console.error('error: --open is not implemented yet');
  return 1;
}
