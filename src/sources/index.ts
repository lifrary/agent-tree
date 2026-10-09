import { open } from 'node:fs/promises';
import { claudeSource } from './claude.js';
import { codexSource } from './codex.js';
import type { SessionSource, SessionSourceId } from './types.js';

const sources: readonly SessionSource[] = [claudeSource, codexSource];

export function getSessionSource(id: SessionSourceId = 'claude'): SessionSource {
  const source = sources.find((candidate) => candidate.id === id);
  if (!source) throw new Error('Unsupported session source.');
  return source;
}

/** Inspect only a bounded prefix. Explicit source selection also handles headerless exports. */
export async function detectSessionSource(
  path: string,
  selected?: SessionSourceId,
): Promise<SessionSourceId> {
  const file = await open(path, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  let bytes = 0;
  try {
    while (bytes < buffer.length) {
      const chunk = await file.read(buffer, bytes, buffer.length - bytes, bytes);
      if (chunk.bytesRead === 0) break;
      bytes += chunk.bytesRead;
    }
  } finally {
    await file.close();
  }
  const text = buffer.toString('utf8', 0, bytes);
  const lines = text.split('\n');
  // A bounded read may end in the middle of a record.
  if (bytes === buffer.length) lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line.trim());
    } catch {
      continue;
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const source = sources.find((candidate) =>
      candidate.accepts(record as Record<string, unknown>),
    );
    if (!source) continue;
    if (selected && source.id !== selected) {
      throw new Error('Session file does not match the selected source.');
    }
    return source.id;
  }
  if (selected) return getSessionSource(selected).id;
  if (bytes < buffer.length && !text.trim()) return 'claude';
  throw new Error('Cannot identify session format; select --source explicitly.');
}
