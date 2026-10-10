#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = resolve(root, 'tests/fixtures/minimal-session.jsonl');
const codexFixture = resolve(root, 'tests/fixtures/codex-session.jsonl');
const expectedSessionId = 'aaaa1111-2222-3333-4444-555566667777';
const otherSessionId = 'bbbb1111-2222-3333-4444-555566667777';
const expectedTools = [
  'agent_tree_diff',
  'agent_tree_list',
  'agent_tree_picks',
  'agent_tree_search',
  'agent_tree_sessions',
  'agent_tree_snapshot',
  'agent_tree_unstar',
];
const timeoutMs = 120_000;
let tempDir;

async function main() {
  tempDir = await mkdtemp(join(tmpdir(), 'agent-tree-release-'));
  try {
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    const version = pkg.version;
    const tarball = await pack(tempDir);
    await run(
      'npm',
      ['install', tarball, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
      tempDir,
    );

    const bin =
      process.platform === 'win32'
        ? join(tempDir, 'node_modules/.bin/agent-tree.cmd')
        : join(tempDir, 'node_modules/.bin/agent-tree');
    assert.equal((await runOut(bin, ['--version'], tempDir)).trim(), version);
    const help = await runOut(bin, ['--help'], tempDir);
    assert.match(help, /Claude Code or Codex sessions/);
    assert.match(help, /--source/);
    const invalid = await run(bin, ['--file', fixture, '--json', '--filter', 'foo'], tempDir, [2]);
    assert.match(invalid.stderr, /--json exports the complete tree/);

    const json = await runOut(bin, ['--file', fixture, '--no-llm', '--strict', '--json'], tempDir);
    const parsed = JSON.parse(json);
    assert.equal(parsed.source, 'claude');
    assert.equal(parsed.session_id, expectedSessionId);
    assert.ok(parsed.root.children.length > 0, 'strict JSON fixture should produce child nodes');
    assert.ok(parsed.stats.total_nodes > 0, 'strict JSON fixture should count nodes');

    const codex = JSON.parse(
      await runOut(bin, ['--file', codexFixture, '--no-llm', '--strict', '--json'], tempDir),
    );
    assertCodex(codex);
    const selected = JSON.parse(
      await runOut(bin, ['--file', codexFixture, '--source', 'codex', '--json'], tempDir),
    );
    assertCodex(selected);
    for (const [file, source] of [
      [codexFixture, 'claude'],
      [fixture, 'codex'],
    ]) {
      const mismatch = await run(bin, ['--file', file, '--source', source, '--json'], tempDir, [1]);
      assert.equal(mismatch.stdout, '');
      assert.match(mismatch.stderr, /does not match the selected source/);
      assert.doesNotMatch(mismatch.stderr, /SYNTHETIC_PRIVATE|owner@example\.com/);
    }
    const badSource = await run(
      bin,
      ['--source', 'invalid', '--file', codexFixture, '--json'],
      tempDir,
      [2],
    );
    assert.equal(badSource.stdout, '');
    assert.match(badSource.stderr, /source/);

    const rolloutPath = await prepareCodexDiscovery();
    const catalog = JSON.parse(
      await runOut(
        bin,
        ['--source', 'codex', '--sessions', '--cwd', tempDir, '--limit', '1', '--json'],
        tempDir,
      ),
    );
    assertCatalog(catalog, rolloutPath);
    const all = JSON.parse(
      await runOut(bin, ['--source', 'codex', '--sessions', '--json'], tempDir),
    );
    assert.deepEqual(
      all.sessions.map((entry) => entry.sessionId),
      [otherSessionId, expectedSessionId],
    );
    assert.deepEqual(JSON.parse(await runOut(bin, ['--sessions', '--json'], tempDir)).sessions, []);
    const byId = JSON.parse(
      await runOut(bin, ['--source', 'codex', expectedSessionId.slice(0, 8), '--json'], tempDir),
    );
    assertCodex(byId);
    assert.equal(
      JSON.parse(await runOut(bin, ['--source', 'codex', '--latest', '--json'], tempDir))
        .session_id,
      otherSessionId,
    );

    await smokeMcp(
      join(tempDir, 'node_modules/@seungwoolee/agent-tree/dist/mcp-server.js'),
      version,
      rolloutPath,
    );
    console.log(`PASS smoke-release: packed, installed and exercised ${version}`);
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

async function prepareCodexDiscovery() {
  const directory = join(tempDir, 'home', '.codex', 'sessions', '2026', '01', '02');
  const otherProject = join(tempDir, 'other-project');
  await Promise.all([mkdir(directory, { recursive: true }), mkdir(otherProject)]);
  const raw = await readFile(codexFixture, 'utf8');
  const paths = [];
  for (const [sessionId, cwd, modified] of [
    [expectedSessionId, tempDir, 1_700_000_000],
    [otherSessionId, otherProject, 1_700_000_100],
  ]) {
    const records = raw
      .trim()
      .split('\n')
      .map((line) => {
        const record = JSON.parse(line);
        if (record.type === 'session_meta') record.payload.id = sessionId;
        if (record.payload.cwd) record.payload.cwd = cwd;
        return JSON.stringify(record);
      });
    const path = join(directory, `rollout-2026-01-02T03-04-05-${sessionId}.jsonl`);
    await writeFile(path, records.join('\n') + '\n');
    await utimes(path, modified, modified);
    paths.push(path);
  }
  return paths[0];
}

function assertCodex(map) {
  assert.equal(map.source, 'codex');
  assert.equal(map.session_id, expectedSessionId);
  assert.equal(map.stats.total_events, 10);
  assert.equal(map.stats.total_turns, 4);
  assert.equal(map.stats.total_tool_calls, 2);
  assert.ok(map.root.children.length > 0);
  assert.ok(map.root.files_touched.includes('src/app.ts'));
  assert.ok(map.root.tools_used.includes('apply_patch'));
  assert.ok(map.root.tools_used.includes('read_file'));
  assert.doesNotMatch(
    JSON.stringify(map),
    /SYNTHETIC_PRIVATE_INSTRUCTIONS|SYNTHETIC_PRIVATE_REASONING|dddd1111-2222-3333-4444-555566667777/,
  );
}

function assertCatalog(catalog, rolloutPath) {
  assert.equal(catalog.sessions.length, 1);
  const entry = catalog.sessions[0];
  assert.equal(entry.source, 'codex');
  assert.equal(entry.sessionId, expectedSessionId);
  assert.equal(entry.projectDir, tempDir);
  assert.equal(entry.jsonlPath, rolloutPath);
  assert.ok(entry.sizeBytes > 0);
  assert.ok(Number.isFinite(entry.mtimeMs));
  assert.deepEqual(
    Object.keys(entry).sort(),
    ['source', 'sessionId', 'projectDir', 'jsonlPath', 'mtimeMs', 'sizeBytes'].sort(),
  );
  assert.doesNotMatch(
    JSON.stringify(catalog),
    /SYNTHETIC_PRIVATE|owner@example\.com|Please update/,
  );
}

async function pack(destination) {
  const stdout = await runOut('npm', ['pack', '--json', '--pack-destination', destination], root);
  const parsed = JSON.parse(stdout);
  const item = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  assert.ok(item?.filename, 'npm pack --json did not report a filename');
  return join(destination, item.filename);
}

async function smokeMcp(serverPath, version, rolloutPath) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: tempDir,
    env: childEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let nextId = 0;
  let stdoutBuffer = '';
  let stderr = '';
  let stopping = false;
  const timer = setTimeout(
    () => fail(new Error(`MCP smoke timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  const closed = new Promise((resolveClosed) => {
    child.on('close', (code, signal) => {
      if (!stopping)
        fail(new Error(`MCP exited: code=${code} signal=${signal}\n${redact(stderr)}`));
      resolveClosed();
    });
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let newline;
    while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line) onMessage(line);
    }
  });
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.on('error', fail);
  try {
    const init = await rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agent-tree-smoke-release', version: '1.0.0' },
    });
    assert.equal(init.serverInfo?.version, version);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const list = await rpc('tools/list', {});
    assert.deepEqual(list.tools.map((tool) => tool.name).sort(), expectedTools);
    const schemas = Object.fromEntries(list.tools.map((tool) => [tool.name, tool.inputSchema]));
    assert.equal(schemas.agent_tree_sessions.properties.limit.default, 20);
    assert.equal(schemas.agent_tree_sessions.properties.limit.minimum, 1);
    assert.equal(schemas.agent_tree_sessions.properties.limit.maximum, 1000);
    assert.deepEqual(Object.keys(schemas.agent_tree_picks.properties ?? {}), ['source']);
    for (const name of expectedTools) {
      assert.equal(schemas[name].properties.source.type, 'string');
      assert.deepEqual(schemas[name].properties.source.enum, ['claude', 'codex']);
      assert.ok(
        !(schemas[name].required ?? []).includes('source'),
        `${name} source should be optional`,
      );
    }
    for (const name of [
      'agent_tree_list',
      'agent_tree_snapshot',
      'agent_tree_diff',
      'agent_tree_unstar',
    ]) {
      assert.ok(schemas[name].required.includes('cwd'), `${name} should require cwd`);
      assert.equal(schemas[name].properties.file.type, 'string');
      assert.equal(schemas[name].properties.sessionId.type, 'string');
    }
    const result = await rpc('tools/call', {
      name: 'agent_tree_list',
      arguments: { cwd: tempDir, file: fixture, format: 'json' },
    });
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent?.mindmap?.source, 'claude');
    assert.equal(result.structuredContent?.mindmap?.session_id, expectedSessionId);
    assert.match(
      result.content?.[0]?.text ?? '',
      new RegExp(`"session_id": "${expectedSessionId}"`),
    );
    for (const selection of [
      { file: codexFixture },
      { file: codexFixture, source: 'codex' },
      { sessionId: expectedSessionId.slice(0, 8), source: 'codex' },
      { source: 'codex' },
    ]) {
      const codex = await rpc('tools/call', {
        name: 'agent_tree_list',
        arguments: { cwd: tempDir, format: 'json', ...selection },
      });
      assert.notEqual(codex.isError, true);
      assertCodex(codex.structuredContent?.mindmap);
      assert.deepEqual(JSON.parse(codex.content[0].text), codex.structuredContent.mindmap);
    }
    const catalog = await rpc('tools/call', {
      name: 'agent_tree_sessions',
      arguments: { source: 'codex', cwd: tempDir, limit: 1 },
    });
    assert.notEqual(catalog.isError, true);
    assertCatalog(catalog.structuredContent, rolloutPath);
    assert.deepEqual(JSON.parse(catalog.content[0].text), catalog.structuredContent);
    const defaultCatalog = await rpc('tools/call', { name: 'agent_tree_sessions', arguments: {} });
    assert.notEqual(defaultCatalog.isError, true);
    assert.deepEqual(defaultCatalog.structuredContent?.sessions, []);
    for (const [file, source] of [
      [codexFixture, 'claude'],
      [fixture, 'codex'],
    ]) {
      const mismatch = await rpc('tools/call', {
        name: 'agent_tree_list',
        arguments: { cwd: tempDir, file, source, format: 'json' },
      });
      assert.equal(mismatch.isError, true);
      assert.equal(mismatch.structuredContent, undefined);
      assert.match(mismatch.content[0].text, /does not match the selected source/);
      assert.doesNotMatch(mismatch.content[0].text, /SYNTHETIC_PRIVATE|owner@example\.com/);
    }
  } finally {
    clearTimeout(timer);
    stopping = true;
    child.kill('SIGTERM');
    await closed;
  }

  function rpc(method, params) {
    const id = ++nextId;
    const promise = new Promise((resolveRpc, reject) =>
      pending.set(id, { resolve: resolveRpc, reject }),
    );
    send({ jsonrpc: '2.0', id, method, params });
    return promise;
  }

  function send(message) {
    child.stdin.write(JSON.stringify(message) + '\n');
  }

  function onMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      fail(error);
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  }

  function fail(error) {
    clearTimeout(timer);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    child.kill('SIGTERM');
  }
}

function runOut(command, args, cwd) {
  return run(command, args, cwd).then(({ stdout }) => stdout);
}

function run(command, args, cwd, okCodes = [0]) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (okCodes.includes(code ?? -1)) resolveRun({ stdout, stderr });
      else {
        reject(
          new Error(
            `${command} ${args.join(' ')} failed: code=${code} signal=${signal}\n${redact(stderr)}`,
          ),
        );
      }
    });
  });
}

function childEnv() {
  const home = join(tempDir, 'home');
  const cache = join(tempDir, 'npm-cache');
  return {
    CI: '1',
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    HOME: home,
    TMPDIR: tempDir,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CODEX_HOME: join(home, '.codex'),
    NPM_CONFIG_CACHE: cache,
    NPM_CONFIG_USERCONFIG: join(tempDir, '.npmrc'),
    npm_config_cache: cache,
    AGENT_TREE_NO_LLM: 'true',
    ANTHROPIC_API_KEY: '',
    NO_COLOR: '1',
  };
}

function redact(text) {
  return text.replaceAll(tempDir, '<release-smoke-temp>');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
