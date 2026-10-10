/**
 * Stage 1 of --search: find the JSONL lines that may hold the query without
 * decoding or parsing the rest of the file. Chunks are read as latin1, so one
 * character is one byte and offsets stay byte offsets; the RegExp runs once
 * per chunk, and only the lines around a match are decoded as UTF-8.
 */
import { open } from 'node:fs/promises';

import type { Matcher } from './matcher.js';

export const DEFAULT_CHUNK_BYTES = 1024 * 1024;
const NEWLINE = 10;

export interface ScanOptions {
  chunkBytes?: number;
  /** Return early once this signal aborts; lines already reported stay reported. */
  signal?: AbortSignal;
}

/**
 * Calls `onLine` with each candidate line, decoded and in file order; it returns
 * whether to continue. A match never spans a line: the needle is JSON-escaped,
 * so it holds no raw newline byte.
 */
export async function scanFile(
  path: string,
  matcher: Matcher,
  onLine: (line: string) => boolean,
  options: ScanOptions = {},
): Promise<void> {
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  const overlapBytes = Math.max(0, matcher.maxNeedleBytes - 1);
  const regex = new RegExp(matcher.prefilter.source, matcher.prefilter.flags);
  const handle = await open(path, 'r');
  const buffer = Buffer.allocUnsafe(chunkBytes);

  const readLine = async (start: number, end: number, chunk: Buffer, chunkStart: number) => {
    if (start >= chunkStart) return decode(chunk.subarray(start - chunkStart, end - chunkStart));
    // The line began in an earlier chunk; read it back whole.
    const line = Buffer.allocUnsafe(end - start);
    let filled = 0;
    while (filled < line.length) {
      const { bytesRead } = await handle.read(line, filled, line.length - filled, start + filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return decode(line.subarray(0, filled));
  };

  try {
    let chunkStart = 0;
    // Start of the line in progress at the current chunk's first byte.
    let lineStart = 0;
    // The line in progress already holds a match and is reported at its newline.
    let pending = false;
    // Latin1 tail of the previous chunk after its last newline, for split matches.
    let overlap = '';
    for (;;) {
      if (options.signal?.aborted) return;
      const { bytesRead } = await handle.read(buffer, 0, chunkBytes, chunkStart);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      const text = overlap + chunk.toString('latin1');
      const base = chunkStart - overlap.length;
      regex.lastIndex = 0;

      if (pending) {
        const newline = chunk.indexOf(NEWLINE);
        if (newline < 0) {
          chunkStart += bytesRead;
          continue;
        }
        if (onLine(await readLine(lineStart, chunkStart + newline, chunk, chunkStart)) === false)
          return;
        pending = false;
        regex.lastIndex = chunkStart + newline + 1 - base;
      }

      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const at = base + match.index - chunkStart;
        const before = at > 0 ? chunk.lastIndexOf(NEWLINE, at - 1) : -1;
        const start = before >= 0 ? chunkStart + before + 1 : lineStart;
        const after = chunk.indexOf(NEWLINE, Math.max(at, 0));
        if (after < 0) {
          pending = true;
          break;
        }
        if (onLine(await readLine(start, chunkStart + after, chunk, chunkStart)) === false) return;
        regex.lastIndex = chunkStart + after + 1 - base;
      }

      const last = chunk.lastIndexOf(NEWLINE);
      if (last >= 0) lineStart = chunkStart + last + 1;
      // The overlap may span several chunks smaller than the needle.
      const tailStart = Math.max(text.lastIndexOf('\n') + 1, text.length - overlapBytes);
      overlap = pending ? '' : text.slice(tailStart);
      chunkStart += bytesRead;
    }
    if (pending && lineStart < chunkStart) {
      onLine(await readLine(lineStart, chunkStart, buffer.subarray(0, 0), chunkStart));
    }
  } finally {
    await handle.close();
  }
}

function decode(bytes: Buffer): string {
  const end = bytes.length > 0 && bytes[bytes.length - 1] === 13 ? bytes.length - 1 : bytes.length;
  return bytes.toString('utf8', 0, end);
}
