import { readFileSync } from 'node:fs';

// Replaced at bundle time; source execution reads the same manifest.
declare const __PKG_VERSION__: string;
export const VERSION: string =
  typeof __PKG_VERSION__ === 'string'
    ? __PKG_VERSION__
    : (
        JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
          version: string;
        }
      ).version;
