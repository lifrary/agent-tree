import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

async function loadLayers(userYaml?: string, projectYaml?: string, env: NodeJS.ProcessEnv = {}) {
  const userConfigPath = join(tmpRoot, 'user.yaml');
  if (userYaml !== undefined) writeFileSync(userConfigPath, userYaml, 'utf8');
  if (projectYaml !== undefined) {
    writeFileSync(join(tmpRoot, '.agent-tree.yaml'), projectYaml, 'utf8');
  }
  const warn = vi.fn();
  const result = await loadConfig({
    userConfigPath,
    projectCwd: tmpRoot,
    env,
    logger: { warn },
  });
  return { ...result, warn };
}

describe('mergeConfig', () => {
  it.each([null, undefined])('returns a detached copy when source is %s', (source) => {
    const before = structuredClone(DEFAULT_CONFIG);
    const merged = mergeConfig(DEFAULT_CONFIG, source);
    merged.llm.model = 'changed-model';
    merged.redaction.extra_patterns.push('changed-pattern');
    expect(DEFAULT_CONFIG).toEqual(before);
    expect(merged).not.toBe(DEFAULT_CONFIG);
    expect(merged.llm).not.toBe(DEFAULT_CONFIG.llm);
  });

  it('deep-merges nested objects without mutating source', () => {
    const patched = mergeConfig(DEFAULT_CONFIG, {
      llm: { model: 'claude-haiku-4-5-20251001' },
    });
    expect(patched.llm.model).toBe('claude-haiku-4-5-20251001');
    expect(patched.llm.parallel).toBe(DEFAULT_CONFIG.llm.parallel); // untouched
    expect(DEFAULT_CONFIG.llm.model).toBe('claude-sonnet-4-6'); // not mutated
  });

  it('replaces arrays without retaining references to either input', () => {
    const target = mergeConfig(DEFAULT_CONFIG, {
      redaction: { extra_patterns: ['old-pattern'] },
    });
    const source = { redaction: { extra_patterns: ['new-pattern'] } };
    const merged = mergeConfig(target, source);
    expect(merged.redaction.extra_patterns).toEqual(['new-pattern']);
    merged.redaction.extra_patterns.push('changed-pattern');
    merged.cache.dir = '/changed';
    expect(source.redaction.extra_patterns).toEqual(['new-pattern']);
    expect(target.redaction.extra_patterns).toEqual(['old-pattern']);
    expect(target.cache.dir).toBe(DEFAULT_CONFIG.cache.dir);
  });

  it('ignores undefined overrides without erasing lower-layer values', () => {
    const target = mergeConfig(DEFAULT_CONFIG, { llm: { model: 'lower-model' } });
    const merged = mergeConfig(target, {
      llm: { model: undefined, parallel: 2 },
      log: undefined,
    });
    expect(merged.llm.model).toBe('lower-model');
    expect(merged.llm.parallel).toBe(2);
    expect(merged.log).toEqual(target.log);
  });

  it('ignores prototype keys and malformed fields in direct merge callers', () => {
    const source = JSON.parse(`{
      "__proto__": {"polluted": true},
      "constructor": {"prototype": {"polluted": true}},
      "prototype": {"polluted": true},
      "llm": {
        "__proto__": {"polluted": true},
        "constructor": {"prototype": {"polluted": true}},
        "prototype": {"polluted": true},
        "model": "safe-model",
        "max_input_tokens": -1
      },
      "cache": null
    }`);
    const merged = mergeConfig(DEFAULT_CONFIG, source);
    expect(merged.llm.model).toBe('safe-model');
    expect(merged.llm.max_input_tokens).toBe(DEFAULT_CONFIG.llm.max_input_tokens);
    expect(merged.cache).toEqual(DEFAULT_CONFIG.cache);
    for (const value of [merged, merged.llm]) {
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
      for (const key of ['__proto__', 'constructor', 'prototype', 'polluted']) {
        expect(Object.hasOwn(value, key)).toBe(false);
      }
    }
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
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

  it('retains valid siblings and lower-layer overrides when project fields fail', async () => {
    const { config, layers, warn } = await loadLayers(
      [
        'llm: { model: user-model, max_input_tokens: 2000, parallel: 4 }',
        'redaction: { extra_patterns: ["user-pattern"], strict: true }',
        'cache: { dir: /user-cache }',
      ].join('\n'),
      [
        'llm: { model: project-model, max_input_tokens: 0, parallel: 2 }',
        'redaction: { extra_patterns: ["valid", 12], strict: false }',
        'cache: null',
      ].join('\n'),
      { AGENT_TREE_MODEL: 'env-model' },
    );
    expect(config.llm).toMatchObject({
      model: 'env-model',
      max_input_tokens: 2000,
      parallel: 2,
    });
    expect(config.redaction).toMatchObject({
      extra_patterns: ['user-pattern'],
      strict: false,
    });
    expect(config.cache.dir).toBe('/user-cache');
    expect(layers.project).toEqual({
      llm: { model: 'project-model', parallel: 2 },
      redaction: { strict: false },
    });
    expect(warn).toHaveBeenCalledWith(
      'project config: ignored invalid config value at llm.max_input_tokens',
    );
    expect(warn).toHaveBeenCalledWith(
      'project config: ignored invalid config value at redaction.extra_patterns[1]',
    );
    expect(warn).toHaveBeenCalledWith(
      'project config: ignored invalid config section cache: expected an object',
    );
  });

  it('does not expose mutable defaults or share resolved values with layers', async () => {
    const before = structuredClone(DEFAULT_CONFIG);
    const { config, layers } = await loadLayers(
      'redaction: { extra_patterns: ["user-pattern"] }\n',
    );
    config.redaction.extra_patterns.push('resolved-pattern');
    config.llm.model = 'resolved-model';
    layers.defaults.llm.model = 'layer-model';
    layers.defaults.redaction.extra_patterns.push('layer-pattern');
    expect(layers.user?.redaction?.extra_patterns).toEqual(['user-pattern']);
    expect(DEFAULT_CONFIG).toEqual(before);
    const next = await loadConfig({
      userConfigPath: join(tmpRoot, 'missing.yaml'),
      projectCwd: join(tmpRoot, 'missing-project'),
      env: {},
    });
    expect(next.config).toEqual(before);
  });
});

describe('config validation', () => {
  it.each(['null', 'false', '42', '"secret-root-value"', '- llm\n- model', '2026-01-01'])(
    'ignores a non-object YAML root: %s',
    async (yaml) => {
      const { config, layers, warn } = await loadLayers('llm: { model: lower-model }\n', yaml);
      expect(layers.project).toBeNull();
      expect(config.llm.model).toBe('lower-model');
      expect(warn).toHaveBeenCalledWith(
        'project config: ignored invalid config root: expected an object',
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-root-value');
    },
  );

  it.each([
    ['llm', 'null'],
    ['redaction', '[]'],
    ['render', '"invalid-section"'],
    ['analyzer', '2026-01-01'],
    ['cache', '12'],
    ['log', 'false'],
    ['telemetry', '["enabled"]'],
  ] as const)(
    'rejects invalid %s sections without dropping valid siblings',
    async (section, value) => {
      const sibling = section === 'log' ? 'cache: { enabled: false }' : 'log: { level: debug }';
      const { config, layers, warn } = await loadLayers(
        undefined,
        `${section}: ${value}\n${sibling}\n`,
      );
      expect(config[section]).toEqual(DEFAULT_CONFIG[section]);
      if (section === 'log') expect(config.cache.enabled).toBe(false);
      else expect(config.log.level).toBe('debug');
      expect(layers.project).not.toHaveProperty(section);
      expect(warn).toHaveBeenCalledWith(
        `project config: ignored invalid config section ${section}: expected an object`,
      );
    },
  );

  describe.each(['max_input_tokens', 'max_output_tokens', 'parallel'] as const)(
    'llm.%s',
    (field) => {
      it.each(['0', '-1', '1.5', '.nan', '.inf', '-.inf', '9007199254740992', '"42"'])(
        'rejects invalid numeric value %s',
        async (value) => {
          const { config, layers, warn } = await loadLayers(
            `llm: { ${field}: 9 }\n`,
            `llm: { ${field}: ${value}, model: valid-sibling }\n`,
          );
          expect(config.llm[field]).toBe(9);
          expect(config.llm.model).toBe('valid-sibling');
          expect(layers.project?.llm).not.toHaveProperty(field);
          expect(warn).toHaveBeenCalledWith(
            `project config: ignored invalid config value at llm.${field}`,
          );
        },
      );
    },
  );

  it.each([
    ['llm', 'enabled', '"false"'],
    ['llm', 'cache', '1'],
    ['llm', 'provider', '""'],
    ['llm', 'provider', '"another-provider"'],
    ['llm', 'provider', '"Anthropic"'],
    ['llm', 'model', '"   "'],
    ['redaction', 'enabled', 'null'],
    ['redaction', 'enabled', 'false'],
    ['redaction', 'strict', '"true"'],
    ['render', 'lang', '"EN"'],
    ['analyzer', 'sidechain_handling', '"Flatten"'],
    ['analyzer', 'topic_gap_minutes', '-0.1'],
    ['analyzer', 'topic_gap_minutes', '.inf'],
    ['analyzer', 'file_jaccard_threshold', '-0.1'],
    ['analyzer', 'file_jaccard_threshold', '1.1'],
    ['analyzer', 'file_jaccard_threshold', '.nan'],
    ['cache', 'dir', '[]'],
    ['cache', 'dir', '"   "'],
    ['cache', 'enabled', '"true"'],
    ['log', 'level', '"INFO"'],
    ['telemetry', 'enabled', '1'],
    ['telemetry', 'enabled', 'true'],
  ] as const)('rejects invalid leaf %s.%s = %s', async (section, field, value) => {
    const { config, layers, warn } = await loadLayers(`${section}: { ${field}: ${value} }\n`);
    expect(config[section]).toEqual(DEFAULT_CONFIG[section]);
    expect(layers.user?.[section]).not.toHaveProperty(field);
    expect(warn).toHaveBeenCalledWith(
      `user config: ignored invalid config value at ${section}.${field}`,
    );
  });

  it('rejects unsupported capabilities while preserving supported sibling overrides', async () => {
    const { config, layers, warn } = await loadLayers(
      [
        'llm: { provider: anthropic, model: user-model }',
        'redaction: { enabled: true, extra_patterns: ["user-pattern"] }',
        'telemetry: { enabled: false }',
      ].join('\n'),
      [
        'llm: { provider: another-provider, model: project-model }',
        'redaction: { enabled: false, strict: true }',
        'telemetry: { enabled: true }',
      ].join('\n'),
    );
    expect(config.llm).toMatchObject({ provider: 'anthropic', model: 'project-model' });
    expect(config.redaction).toEqual({
      enabled: true,
      strict: true,
      extra_patterns: ['user-pattern'],
    });
    expect(config.telemetry.enabled).toBe(false);
    expect(layers.project).toEqual({
      llm: { model: 'project-model' },
      redaction: { strict: true },
      telemetry: {},
    });
    for (const field of ['llm.provider', 'redaction.enabled', 'telemetry.enabled']) {
      expect(warn).toHaveBeenCalledWith(`project config: ignored invalid config value at ${field}`);
    }
    expect(JSON.stringify(warn.mock.calls)).not.toContain('another-provider');
  });

  it.each(['["valid", 12]', '[false]', 'null', '"not-an-array"', '{ pattern: value }'])(
    'rejects invalid pattern arrays atomically: %s',
    async (value) => {
      const { config, layers, warn } = await loadLayers(
        'redaction: { extra_patterns: ["lower-pattern"] }\n',
        `redaction: { extra_patterns: ${value}, strict: true }\n`,
      );
      expect(config.redaction.extra_patterns).toEqual(['lower-pattern']);
      expect(config.redaction.strict).toBe(true);
      expect(layers.project?.redaction).not.toHaveProperty('extra_patterns');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('redaction.extra_patterns'));
    },
  );

  it('accepts supported fields, numeric boundaries and empty replacement arrays', async () => {
    const { config, warn } = await loadLayers(
      'redaction: { extra_patterns: ["lower-pattern"] }\n',
      [
        'llm:',
        '  enabled: false',
        '  provider: anthropic',
        '  model: another-model',
        '  max_input_tokens: 1',
        '  max_output_tokens: 9007199254740991',
        '  cache: false',
        '  parallel: 1',
        'redaction: { enabled: true, strict: true, extra_patterns: [] }',
        'render: { lang: ko }',
        'analyzer: { sidechain_handling: drop, topic_gap_minutes: 0, file_jaccard_threshold: 0 }',
        'cache: { dir: "{project}/cache", enabled: false }',
        'log: { level: trace }',
        'telemetry: { enabled: false }',
      ].join('\n'),
    );
    expect(config).toEqual({
      llm: {
        enabled: false,
        provider: 'anthropic',
        model: 'another-model',
        max_input_tokens: 1,
        max_output_tokens: Number.MAX_SAFE_INTEGER,
        cache: false,
        parallel: 1,
      },
      redaction: { enabled: true, strict: true, extra_patterns: [] },
      render: { lang: 'ko' },
      analyzer: { sidechain_handling: 'drop', topic_gap_minutes: 0, file_jaccard_threshold: 0 },
      cache: { dir: '{project}/cache', enabled: false },
      log: { level: 'trace' },
      telemetry: { enabled: false },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts fractional topic gaps and an inclusive Jaccard upper bound', async () => {
    const { config, warn } = await loadLayers(
      'analyzer: { topic_gap_minutes: 0.25, file_jaccard_threshold: 1, sidechain_handling: flatten }\n',
    );
    expect(config.analyzer).toEqual({
      topic_gap_minutes: 0.25,
      file_jaccard_threshold: 1,
      sidechain_handling: 'flatten',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns about unknown and prototype keys without logging their values', async () => {
    const secret = 'secret-config-value-not-for-logs';
    const { config, layers, warn } = await loadLayers(
      [
        `__proto__: { polluted: "${secret}" }`,
        `constructor: { prototype: { polluted: "${secret}" } }`,
        `prototype: { polluted: "${secret}" }`,
        `unknown_section: "${secret}"`,
        'llm:',
        `  __proto__: { polluted: "${secret}" }`,
        `  constructor: "${secret}"`,
        `  prototype: "${secret}"`,
        `  unknown_field: "${secret}"`,
        `  model: ["${secret}"]`,
        '  parallel: 2',
        `render: { collapse_depth: "${secret}", lang: en }`,
      ].join('\n'),
    );
    expect(config.llm.parallel).toBe(2);
    expect(config.render.lang).toBe('en');
    expect(config.llm.model).toBe(DEFAULT_CONFIG.llm.model);
    expect(layers.user).toEqual({ llm: { parallel: 2 }, render: { lang: 'en' } });
    for (const field of [
      '__proto__',
      'constructor',
      'prototype',
      'unknown_section',
      'llm.__proto__',
      'llm.constructor',
      'llm.prototype',
      'llm.unknown_field',
      'render.collapse_depth',
    ]) {
      expect(warn).toHaveBeenCalledWith(`user config: ignored unknown config field ${field}`);
    }
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
    expect(Object.getPrototypeOf(config)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(config.llm)).toBe(Object.prototype);
  });

  it.each(['unknown\\nfield', 'unknown\\n'])(
    'escapes control characters in unknown field paths: %s',
    async (field) => {
      const { warn } = await loadLayers(`"${field}": value\n`);
      expect(warn).toHaveBeenCalledWith(`user config: ignored unknown config field ["${field}"]`);
      expect(warn.mock.calls[0][0]).not.toContain('\n');
    },
  );

  it('handles cyclic YAML aliases without recursively merging unknown fields', async () => {
    const { config, layers, warn } = await loadLayers(
      'llm: &llm\n  model: alias-model\n  unknown: *llm\n',
    );
    expect(config.llm.model).toBe('alias-model');
    expect(layers.user).toEqual({ llm: { model: 'alias-model' } });
    expect(warn).toHaveBeenCalledWith('user config: ignored unknown config field llm.unknown');
  });

  it.each([
    'llm: [secret-yaml-value\n',
    'llm: { model: secret-yaml-value }\nllm: { model: duplicate }\n',
    'llm: !!unsupported secret-yaml-value\n',
  ])('ignores YAML parse errors without exposing source snippets', async (yaml) => {
    const { config, layers, warn } = await loadLayers(yaml, 'llm: { model: valid-project }\n');
    expect(layers.user).toBeNull();
    expect(config.llm.model).toBe('valid-project');
    expect(warn).toHaveBeenCalledWith('failed to read or parse user config YAML');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-yaml-value');
  });

  it.each(['', '# Only a comment\n'])('skips empty YAML without warning', async (yaml) => {
    const { layers, warn } = await loadLayers(yaml, 'llm: { model: project-model }\n');
    expect(layers.user).toBeNull();
    expect(layers.project?.llm?.model).toBe('project-model');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('environment validation', () => {
  it.each([
    '',
    '0',
    '-1',
    '1.5',
    '1e3',
    '0x10',
    '12trailing',
    ' 12',
    '12 ',
    '12\n',
    '+12',
    'NaN',
    'Infinity',
    '9007199254740992',
  ])('ignores invalid AGENT_TREE_MAX_TOK=%j without partial parsing', async (value) => {
    const { config, layers, warn } = await loadLayers(
      'llm: { max_input_tokens: 1234 }\n',
      undefined,
      { AGENT_TREE_MAX_TOK: value, AGENT_TREE_MODEL: 'valid-env-sibling' },
    );
    expect(config.llm.max_input_tokens).toBe(1234);
    expect(config.llm.model).toBe('valid-env-sibling');
    expect(layers.env.llm).not.toHaveProperty('max_input_tokens');
    expect(warn).toHaveBeenCalledWith(
      'ignored invalid environment variable AGENT_TREE_MAX_TOK: expected a positive safe integer',
    );
  });

  it.each(['1', '0012', '9007199254740991'])('accepts AGENT_TREE_MAX_TOK=%s', async (value) => {
    const { config, warn } = await loadLayers(
      'llm: { max_input_tokens: 1234 }\n',
      'llm: { max_input_tokens: 5678 }\n',
      { AGENT_TREE_MAX_TOK: value },
    );
    expect(config.llm.max_input_tokens).toBe(Number(value));
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores invalid model and language env values while applying valid flags', async () => {
    const { config, warn } = await loadLayers(
      'llm: { model: user-model }\nrender: { lang: ko }\n',
      undefined,
      {
        AGENT_TREE_MODEL: ' ',
        AGENT_TREE_LANG: 'secret-invalid-language',
        AGENT_TREE_NO_LLM: 'true',
        AGENT_TREE_REDACT_STRICT: 'true',
        AGENT_TREE_VERBOSE: '1',
      },
    );
    expect(config.llm).toMatchObject({ enabled: false, model: 'user-model' });
    expect(config.render.lang).toBe('ko');
    expect(config.redaction.strict).toBe(true);
    expect(config.log.level).toBe('debug');
    expect(warn).toHaveBeenCalledWith(
      'environment config: ignored invalid config value at llm.model',
    );
    expect(warn).toHaveBeenCalledWith('ignored invalid environment variable AGENT_TREE_LANG');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-invalid-language');
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
