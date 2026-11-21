#!/usr/bin/env node
'use strict';

// Run maintained regression suites in isolated Node processes. Every suite has
// a deadline, and a timed-out process group is terminated before the next test.
const fs = require('node:fs');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BASE_TIMEOUT_MS = Math.max(10000, Number(process.env.TEST_SUITE_TIMEOUT_MS || 120000));

const SUITES = [
  ['SWN import validation', 'import-validation.cjs'],
  ['Export worker thread', 'export-worker.cjs'],
  ['Maintenance regressions', 'maintenance-regressions.cjs'],
  ['Simulation foundation and migration', 'simulation-foundation.cjs'],
  ['Local economy engine', 'economy-engine.cjs'],
  ['Logistics engine', 'logistics-engine.cjs'],
  ['Living-sector integration', 'living-sector.cjs'],
  ['Commerce and recurring contracts', 'commerce.cjs'],
  ['Strategic and transport systems', 'strategic-transport.cjs'],
  ['Political state coordinator', 'politics-turn-coordinator.cjs'],
  ['Market competition', 'market-competition.cjs'],
  ['Integrated campaign scenario', 'integrated-scenario.cjs'],
  ['Campaign hardening', 'hardening.cjs'],
  ['Runtime global and asynchronous loader hygiene', 'runtime-hygiene.cjs'],
  ['Post-release defect regressions', 'defect-regressions.cjs'],
  ['Feature completion and recovery', 'feature-completion.cjs'],
  ['Political/logistics turn ordering', 'political-turn-order.cjs'],
  ['Generation output regressions', 'generation-regressions.cjs'],
  ['Generation/economy stress audit', 'run-audit.cjs', {
    timeout: BASE_TIMEOUT_MS,
    env: {
      SWN_CORE_RUNS: process.env.SWN_CORE_RUNS || '100',
      SWN_EXPANDED_RUNS: process.env.SWN_EXPANDED_RUNS || '50',
      SWN_FACTION_SECTORS: process.env.SWN_FACTION_SECTORS || '2',
      SWN_FACTION_TURNS: process.env.SWN_FACTION_TURNS || '6',
      SWN_ECONOMY_SECTORS: process.env.SWN_ECONOMY_SECTORS || '2',
      SWN_ECONOMY_TURNS: process.env.SWN_ECONOMY_TURNS || '6'
    }
  }],
  ['Full campaign performance benchmark', 'performance.cjs', {
    timeout: Math.max(BASE_TIMEOUT_MS, Number(process.env.TEST_PERFORMANCE_TIMEOUT_MS || 240000))
  }],
  ['Chromium browser end-to-end suite', 'e2e.cjs', {
    timeout: Math.max(BASE_TIMEOUT_MS, Number(process.env.TEST_E2E_TIMEOUT_MS || 300000)),
    env: {
      E2E_INLINE: process.env.E2E_INLINE || '1',
      E2E_COMMAND_TIMEOUT_MS: process.env.E2E_COMMAND_TIMEOUT_MS || '45000'
    }
  }]
];

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(fullPath));
    else if (entry.isFile() && /\.(?:js|cjs)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function terminateProcessGroup(child, signal) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (_) {
    // The process may already have exited.
  }
}

function checkSyntax(files) {
  const failures = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 15000
    });
    if (result.error || result.status !== 0) {
      failures.push({
        file: path.relative(ROOT, file),
        detail: (result.stderr || result.error?.message || 'node --check failed').trim()
      });
    }
  }
  console.log((failures.length ? 'FAIL' : 'PASS') + ': JavaScript/CommonJS syntax (' + (files.length - failures.length) + '/' + files.length + ')');
  for (const failure of failures) console.error(failure.file + ': ' + failure.detail);
  return failures;
}

function runSuite(label, filename, options = {}) {
  return new Promise(resolve => {
    const timeoutMs = options.timeout || BASE_TIMEOUT_MS;
    const child = spawn(process.execPath, [path.join(__dirname, filename)], {
      cwd: ROOT,
      env: {...process.env, ...(options.env || {})},
      stdio: 'inherit',
      detached: process.platform !== 'win32'
    });
    let completed = false;
    let timedOut = false;
    let forceKillTimer;
    const timeoutTimer = setTimeout(() => {
      if (completed) return;
      timedOut = true;
      console.error('\nTIMEOUT: ' + label + ' exceeded ' + timeoutMs + ' ms; terminating its process group.');
      terminateProcessGroup(child, 'SIGTERM');
      forceKillTimer = setTimeout(() => terminateProcessGroup(child, 'SIGKILL'), 1500);
      forceKillTimer.unref();
    }, timeoutMs);

    child.once('error', error => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      console.error('Could not start ' + label + ': ' + error.message);
      resolve({label, ok: false, reason: 'spawn error'});
    });

    child.once('close', (code, signal) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      const ok = !timedOut && code === 0;
      const suffix = timedOut ? ' (timeout)' : signal ? ' (signal ' + signal + ')' : code === 0 ? '' : ' (exit ' + code + ')';
      console.log((ok ? 'PASS: ' : 'FAIL: ') + label + suffix);
      resolve({label, ok, reason: timedOut ? 'timeout' : code === 0 ? '' : 'exit ' + code});
    });
  });
}

async function main() {
  const sourceFiles = collectSourceFiles(ROOT);
  console.log('Sector Forge 1.4.1 release test runner');
  console.log('Node ' + process.version + ' | ' + sourceFiles.length + ' source files | ' + SUITES.length + ' suites');

  const syntaxFailures = checkSyntax(sourceFiles);
  const results = [];
  for (const [label, filename, options = {}] of SUITES) {
    console.log('\n=== ' + label + ' ===');
    results.push(await runSuite(label, filename, options));
  }

  const failed = results.filter(result => !result.ok);
  console.log('\n=== Release test summary ===');
  console.log(JSON.stringify({
    version: '1.4.1',
    syntaxFiles: sourceFiles.length,
    syntaxFailures,
    suites: results.length,
    passed: results.length - failed.length,
    failed: failed.map(item => ({name: item.label, reason: item.reason}))
  }, null, 2));

  if (syntaxFailures.length || failed.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
