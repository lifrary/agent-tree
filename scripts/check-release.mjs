#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const timeoutMs = 15_000;

async function main() {
  const pkg = await readJson('package.json');
  const lock = await readJson('package-lock.json');
  const plugin = await readJson('.claude-plugin/plugin.json');
  const marketplace = await readJson('.claude-plugin/marketplace.json');
  const skill = await readFile(resolve(root, 'skills/agent-tree/SKILL.md'), 'utf8');
  const version = pkg.version;

  check('package.json#version exists', typeof version === 'string' && version.length > 0);
  equal('package-lock.json#version', lock.version, version);
  equal('package-lock.json#packages[""].version', lock.packages?.['']?.version, version);
  equal('.claude-plugin/plugin.json#version', plugin.version, version);
  equal('.claude-plugin/marketplace.json#metadata.version', marketplace.metadata?.version, version);
  equal(
    '.claude-plugin/marketplace.json#plugins[0].version',
    marketplace.plugins?.[0]?.version,
    version,
  );
  equal('skills/agent-tree/SKILL.md frontmatter version', skillVersion(skill), version);

  const cliVersion = await run(process.execPath, [resolve(root, 'dist/cli.js'), '--version']);
  equal('dist/cli.js --version', cliVersion.stdout.trim(), version);

  const init = await initializeMcp(resolve(root, 'dist/mcp-server.js'));
  equal('dist/mcp-server.js initialize serverInfo.version', init.serverInfo?.version, version);
  equal('dist/mcp-server.js initialize serverInfo.name', init.serverInfo?.name, 'agent-tree');

  console.log(`PASS check-release: ${version}`);
}

function skillVersion(markdown) {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  return frontmatter.match(/^version:\s*([^\s]+)\s*$/m)?.[1];
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'));
}

function check(label, ok) {
  if (!ok) throw new Error(`FAIL ${label}`);
  console.log(`OK ${label}`);
}

function equal(label, actual, expected) {
  assert.equal(actual, expected, `${label}: expected ${expected}, got ${actual}`);
  console.log(`OK ${label} = ${actual}`);
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
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
      if (code === 0) resolveRun({ stdout, stderr });
      else {
        reject(
          new Error(
            `${command} ${args.join(' ')} failed: code=${code} signal=${signal}\n${stderr}`,
          ),
        );
      }
    });
  });
}

function initializeMcp(serverPath) {
  return new Promise((resolveInit, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdoutBuffer = '';
    let settled = false;
    const timer = setTimeout(
      () => fail(new Error(`MCP initialize timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.on('error', fail);
    child.on('close', (code, signal) => {
      if (!settled) {
        fail(new Error(`MCP exited before initialize: code=${code} signal=${signal}\n${stderr}`));
      }
    });

    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'agent-tree-check-release', version: '1.0.0' },
        },
      }) + '\n',
    );

    function onData(chunk) {
      stdoutBuffer += chunk;
      let newline;
      while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        const trimmed = line.trim();
        if (!trimmed) continue;
        let message;
        try {
          message = JSON.parse(trimmed);
        } catch (error) {
          fail(error);
          return;
        }
        if (message.id !== 1) continue;
        if (message.error) {
          fail(new Error(JSON.stringify(message.error)));
          return;
        }
        settled = true;
        clearTimeout(timer);
        child.stdin.write(
          JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
        );
        child.kill('SIGTERM');
        resolveInit(message.result);
      }
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      reject(error);
    }
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
