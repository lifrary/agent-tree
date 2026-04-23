import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { expandPath, loadConfig } from '../src/config/loader.js';
import { DEFAULT_CONFIG, mergeConfig } from '../src/config/schema.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'atree-cfg-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('mergeConfig', () => {
  it('returns identity when source is null', () => {
    expect(mergeConfig(DEFAULT_CONFIG, null)).toEqual(DEFAULT_CONFIG);
  });

  it('deep-merges nested objects without mutating source', () => {
    const patched = mergeConfig(DEFAULT_CONFIG, {
      llm: { model: 'claude-haiku-4-5-20251001' } as never,
    });
    expect(patched.llm.model).toBe('claude-haiku-4-5-20251001');
    expect(patched.llm.parallel).toBe(DEFAULT_CONFIG.llm.parallel); // untouched
    expect(DEFAULT_CONFIG.llm.model).toBe('claude-sonnet-4-6'); // not mutated
  });
});

describe('loadConfig layers', () => {
  it('project yaml overrides user yaml overrides defaults', async () => {
    const userCfg = join(tmpRoot, 'user.yaml');
    const projectCwd = tmpRoot;
    writeFileSync(userCfg, 'llm:\n  model: user-model\n', 'utf8');
    writeFileSync(
      join(projectCwd, '.agent-tree.yaml'),
      'llm:\n  model: project-model\n  parallel: 7\n',
      'utf8',
    );
    const { config } = await loadConfig({
      userConfigPath: userCfg,
      projectCwd,
      env: {},
    });
    expect(config.llm.model).toBe('project-model'); // project wins
    expect(config.llm.parallel).toBe(7);
  });

  it('env overrides yaml files', async () => {
    const userCfg = join(tmpRoot, 'user.yaml');
    writeFileSync(userCfg, 'llm:\n  model: user-model\n', 'utf8');
    const { config } = await loadConfig({
      userConfigPath: userCfg,
      projectCwd: tmpRoot,
      env: { AGENT_TREE_MODEL: 'env-model' },
    });
    expect(config.llm.model).toBe('env-model');
  });

  it('AGENT_TREE_NO_LLM=1 disables llm', async () => {
    const { config } = await loadConfig({
      userConfigPath: join(tmpRoot, 'user.yaml'),
      projectCwd: tmpRoot,
      env: { AGENT_TREE_NO_LLM: '1' },
    });
    expect(config.llm.enabled).toBe(false);
  });

  it('ignores missing yaml files gracefully', async () => {
    const { config, layers } = await loadConfig({
      userConfigPath: join(tmpRoot, 'does-not-exist.yaml'),
      projectCwd: tmpRoot,
      env: {},
    });
    expect(layers.user).toBeNull();
    expect(layers.project).toBeNull();
    expect(config.llm.enabled).toBe(DEFAULT_CONFIG.llm.enabled);
  });
});

describe('expandPath', () => {
  it('replaces {project} token', () => {
    expect(expandPath('{project}/out', '/abs/proj')).toBe('/abs/proj/out');
  });

  it('expands leading ~', () => {
    expect(expandPath('~/foo', '/proj')).toBe(join(homedir(), 'foo'));
  });
});
