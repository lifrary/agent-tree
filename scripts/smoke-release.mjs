#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = resolve(root, 'tests/fixtures/minimal-session.jsonl');
const expectedSessionId = 'aaaa1111-2222-3333-4444-555566667777';
const expectedTools = [
  'agent_tree_diff',
  'agent_tree_list',
  'agent_tree_picks',
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
    assert.match(await runOut(bin, ['--help'], tempDir), /Navigate a Claude Code session/);
    const invalid = await run(bin, ['--file', fixture, '--json', '--filter', 'foo'], tempDir, [2]);
    assert.match(invalid.stderr, /--json exports the complete tree/);

    const json = await runOut(bin, ['--file', fixture, '--no-llm', '--strict', '--json'], tempDir);
    const parsed = JSON.parse(json);
    assert.equal(parsed.session_id, expectedSessionId);
    assert.ok(parsed.root.children.length > 0, 'strict JSON fixture should produce child nodes');
    assert.ok(parsed.stats.total_nodes > 0, 'strict JSON fixture should count nodes');

    await smokeMcp(
      join(tempDir, 'node_modules/@seungwoolee/agent-tree/dist/mcp-server.js'),
      version,
    );
    console.log(`PASS smoke-release: packed, installed and exercised ${version}`);
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

async function pack(destination) {
  const stdout = await runOut('npm', ['pack', '--json', '--pack-destination', destination], root);
  const parsed = JSON.parse(stdout);
  const item = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  assert.ok(item?.filename, 'npm pack --json did not report a filename');
  return join(destination, item.filename);
}

async function smokeMcp(serverPath, version) {
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
    assert.deepEqual(schemas.agent_tree_picks.properties ?? {}, {});
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
    assert.equal(result.structuredContent?.mindmap?.session_id, expectedSessionId);
    assert.match(
      result.content?.[0]?.text ?? '',
      new RegExp(`"session_id": "${expectedSessionId}"`),
    );
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
    NPM_CONFIG_CACHE: cache,
    NPM_CONFIG_USERCONFIG: join(tempDir, '.npmrc'),
    npm_config_cache: cache,
    AGENT_TREE_NO_LLM: 'true',
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
