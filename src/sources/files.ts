import type { Dirent, Stats } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isFullUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isUuidPrefix(value: string): boolean {
  return /^[0-9a-f-]+$/i.test(value) && value.length >= 4 && value.length <= 36;
}

export function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export async function lstatIfPresent(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissingPath(error)) return null;
    throw error;
  }
}

export async function readDirectory(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) return [];
    throw error;
  }
}

export async function isSameDirectory(path: string, original: Stats): Promise<boolean> {
  const current = await lstatIfPresent(path);
  return (
    current !== null &&
    current.isDirectory() &&
    current.dev === original.dev &&
    current.ino === original.ino
  );
}
