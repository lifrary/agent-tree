import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline } from '../src/cli/pipeline.js';
import { DEFAULT_CONFIG } from '../src/config/schema.js';
import { renderTextTree } from '../src/render/text.js';
import { sessionFromFile } from '../src/utils/session_path.js';
import { createLoggerSync } from '../src/utils/logger.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// Long credentials used as tool/path metadata must be redacted before labels
// are truncated; output-boundary redaction cannot recognize a sliced key.
describe('source-independent tool metadata redaction', () => {
  it.each(['claude', 'codex'] as const)(
    'redacts %s tool labels before shortening',
    async (source) => {
      const root = await mkdtemp(join(tmpdir(), 'atree-source-redaction-'));
      directories.push(root);
      const file = join(root, 'export.jsonl');
      const secret = 'github_pat_' + 'Z'.repeat(82);
      const id = 'aaaaaaaa-0000-4000-8000-000000000001';
      const timestamp = '2026-10-09T00:00:00Z';
      const records =
        source === 'claude'
          ? [
              { type: 'permission-mode', sessionId: id },
              {
                type: 'tool_use',
                uuid: 'event-1',
                sessionId: id,
                timestamp,
                tool_use: { id: 'call-1', name: secret, input: { path: `/work/${secret}.ts` } },
              },
            ]
          : [
              { type: 'session_meta', timestamp, payload: { id, cwd: '/work', source: 'cli' } },
              {
                type: 'response_item',
                timestamp,
                payload: {
                  type: 'function_call',
                  name: secret,
                  call_id: 'call-1',
                  arguments: JSON.stringify({ path: `/work/${secret}.ts` }),
                },
              },
            ];
      await writeFile(file, records.map((record) => JSON.stringify(record)).join('\n'));
      const result = await runPipeline({
        match: await sessionFromFile(file),
        opts: { llm: false, dryRun: true, strict: true },
        config: DEFAULT_CONFIG,
        logger: createLoggerSync('error'),
        quiet: true,
      });
      expect(result.mindmap.root.children.length).toBeGreaterThan(0);
      const text = renderTextTree(result.mindmap, { color: false }).text;
      expect(text).not.toContain('Z'.repeat(12));
      expect(text).toContain('REDACTED');
    },
  );
});
