import { build } from 'esbuild';
import { chmod, mkdir } from 'node:fs/promises';

const outfile = 'dist/cli.js';

await mkdir('dist', { recursive: true });

const sharedBuild = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: {
    js: [
      '#!/usr/bin/env node',
      // Polyfill `require` for CJS deps (commander, pino, js-yaml) bundled
      // into ESM output — esbuild's dynamic-require shim otherwise throws.
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  sourcemap: true,
  external: ['@anthropic-ai/sdk'],
  logLevel: 'info',
};

await build({
  ...sharedBuild,
  entryPoints: ['src/cli.ts'],
  outfile,
});
await chmod(outfile, 0o755);

const mcpOutfile = 'dist/mcp-server.js';
await build({
  ...sharedBuild,
  entryPoints: ['src/mcp/server.ts'],
  outfile: mcpOutfile,
});
await chmod(mcpOutfile, 0o755);

console.log(`✔ built ${outfile} + ${mcpOutfile}`);
