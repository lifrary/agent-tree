import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPipeline } from '../src/cli/pipeline.js';
import { mergeConfig, DEFAULT_CONFIG } from '../src/config/schema.js';
import type { SessionMatch } from '../src/sources/types.js';
import { createLoggerSync } from '../src/utils/logger.js';

const mocks = vi.hoisted(() => ({
  countTokens: vi.fn(async (_args: unknown) => ({ input_tokens: 5 })),
  create: vi.fn(async (_args: unknown) => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          label: 'Verified label',
          summary: 'Summary',
          type: 'topic',
          color: 'green',
          next_steps: ['Check results'],
        }),
      },
    ],
    usage: { input_tokens: 5, output_tokens: 10 },
  })),
}));
vi.mock('../src/llm/anthropic.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/llm/anthropic.js')>();
  return { ...actual, createAnthropicClient: vi.fn(async () => ({ messages: mocks })) };
});
let root: string;
const match: SessionMatch = {
  source: 'claude',
  sessionId: 'aaaa1111-2222-3333-4444-555566667777',
  projectDir: '-fixture',
  jsonlPath: resolve('tests/fixtures/minimal-session.jsonl'),
};
const logger = createLoggerSync('error');
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-tree-pipeline-'));
});
afterEach(async () => {
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('resolved pipeline configuration', () => {
  it('forwards configured model, language, output cap and cache policy without CLI defaults masking them', async () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      llm: {
        model: 'configured-model',
        max_input_tokens: 5,
        max_output_tokens: 321,
        parallel: 1,
        cache: false,
      },
      render: { lang: 'ko' },
    });
    await runPipeline({ match, opts: {}, config, logger, quiet: true });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const request = mocks.create.mock.calls[0][0] as {
      model: string;
      max_tokens: number;
      system: Array<{ text: string; cache_control?: unknown }>;
    };
    expect(request.model).toBe('configured-model');
    expect(request.max_tokens).toBe(321);
    expect(request.system[0].text).toContain('in Korean');
    expect(request.system[0].cache_control).toBeUndefined();
  });

  it('honors explicit CLI model and budget overrides', async () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      llm: { model: 'config-model', max_input_tokens: 5, parallel: 1 },
    });
    await runPipeline({
      match,
      opts: { model: 'cli-model', maxLlmTokens: 10 },
      config,
      logger,
      quiet: true,
    });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ model: 'cli-model' });
  });

  it('writes redacted debug artifacts only to the configured cache directory', async () => {
    const config = mergeConfig(DEFAULT_CONFIG, { cache: { dir: join(root, 'cache') } });
    const result = await runPipeline({
      match,
      opts: { llm: false, verbose: true },
      config,
      logger,
      quiet: true,
    });
    const dir = join(root, 'cache', result.cacheHash);
    expect((await readdir(dir)).sort()).toEqual(['graph.json', 'segments.json', 'tree.json']);
    expect(JSON.parse(await readFile(join(dir, 'tree.json'), 'utf8')).session_id).toBe(
      match.sessionId,
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    { enabled: false, dryRun: false },
    { enabled: true, dryRun: true },
  ])('does not persist disabled or dry-run caches: %j', async ({ enabled, dryRun }) => {
    const cache = join(root, 'cache');
    const config = mergeConfig(DEFAULT_CONFIG, { cache: { dir: cache, enabled } });
    await runPipeline({
      match,
      opts: { llm: false, verbose: true, dryRun },
      config,
      logger,
      quiet: true,
    });
    await expect(readdir(cache)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
