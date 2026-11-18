'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isolation = require('./lib/isolation');
const { ProcessManager } = require('./lib/processManager');
const { launchElectronWithCdp, sleep } = require('./lib/cdpClient');
const { MockServer } = require('./lib/mockServer');
const metrics = require('./lib/metrics');

const { tier1Tests } = require('./suites/tier1-features');
const { tier2Tests } = require('./suites/tier2-boundaries');
const { tier3Tests } = require('./suites/tier3-combinations');
const { tier4Tests } = require('./suites/tier4-scenarios');
const { tier5Tests } = require('./suites/tier5-stress');

function parseArgs(argv) {
  const opts = {
    tier: 'all',
    filter: '',
    json: false,
    verbose: false,
    list: false,
    selfCheck: false
  };
  for (const arg of argv) {
    if (arg.startsWith('--tier=')) {
      opts.tier = arg.slice('--tier='.length).trim().toLowerCase();
    } else if (arg.startsWith('--filter=')) {
      opts.filter = arg.slice('--filter='.length).trim();
    } else if (arg === '--tier' || arg === '--filter') {
      throw new Error(`Flag "${arg}" requires "=" syntax (e.g. ${arg}=value)`);
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--verbose') {
      opts.verbose = true;
    } else if (arg === '--list') {
      opts.list = true;
    } else if (arg === '--self-check') {
      opts.selfCheck = true;
    } else {
      throw new Error(`Unknown or invalid CLI argument: "${arg}"`);
    }
  }
  return opts;
}

function getSelectedTests(opts) {
  let pool = [];
  if (opts.tier === '1') pool = tier1Tests;
  else if (opts.tier === '2') pool = tier2Tests;
  else if (opts.tier === '3') pool = tier3Tests;
  else if (opts.tier === '4') pool = tier4Tests;
  else if (opts.tier === '5') pool = tier5Tests;
  else if (opts.tier === 'all') pool = [...tier1Tests, ...tier2Tests, ...tier3Tests, ...tier4Tests, ...tier5Tests];
  else {
    throw new Error(`Invalid --tier value "${opts.tier}". Expected 1|2|3|4|5|all`);
  }

  if (opts.filter) {
    const q = opts.filter.toLowerCase();
    pool = pool.filter(
      (tc) =>
        tc.id.toLowerCase().includes(q) ||
        tc.feature.toLowerCase().includes(q) ||
        tc.name.toLowerCase().includes(q)
    );
  }
  return pool;
}

async function runSelfCheck(opts) {
  const runId = `selfcheck_${Date.now()}`;
  const pm = new ProcessManager(runId);
  pm.installSignalHandlers();
  const prodBefore = isolation.getProdSnapshot();
  const checks = [];
  const tmpDirs = [];

  async function record(id, name, fn) {
    const t0 = Date.now();
    try {
      await fn();
      const ms = Date.now() - t0;
      checks.push({ id, name, status: 'PASS', durationMs: ms });
      if (!opts.json) console.log(`[PASS] ${id} (${ms}ms) - ${name}`);
    } catch (err) {
      const ms = Date.now() - t0;
      checks.push({ id, name, status: 'FAIL', durationMs: ms, error: err.message });
      if (!opts.json) console.error(`[FAIL] ${id} (${ms}ms) - ${name}: ${err.message}`);
    }
  }

  // 1. WCAG contrast math & worst-case alpha compositing
  await record('SC-01', 'WCAG 2.1 contrast & alpha compositing math', async () => {
    const fgLight = metrics.parseCssColor('#F7F3E8');
    const bgDark = metrics.parseCssColor('#040406');
    const cr = metrics.contrastRatio(fgLight, bgDark);
    assert.ok(cr > 18.0 && cr < 19.0, `Expected ~18.48:1, got ${cr}`);
    const wc = metrics.computeWorstCaseContrast('#F7F3E8', [
      { backgroundColor: 'rgba(9, 8, 12, 0.86)', backgroundImage: 'none' }
    ]);
    assert.ok(wc >= 7.0, `Worst-case contrast unexpectedly low: ${wc}`);
  });

  // 2. Zero-emoji scanner (catches pictographs/flags/keycaps, preserves 7 M.P.E glyphs)
  await record('SC-02', 'Zero-emoji scanner precision & M.P.E 7-glyph preservation', async () => {
    const safe = 'Δ Π ϟ — • ← → 0123456789 # * Bloco de Notas';
    assert.deepStrictEqual(metrics.scanStringForEmojis(safe, 'safe'), []);
    assert.ok(metrics.scanStringForEmojis(`Test ${String.fromCodePoint(0x1F680)}`, 'e1').length === 1);
    assert.ok(metrics.scanStringForEmojis(`Flag ${String.fromCodePoint(0x1F1E7, 0x1F1F7)}`, 'e2').length >= 1);
    assert.ok(metrics.scanStringForEmojis(`Key ${String.fromCodePoint(0x31, 0xFE0F, 0x20E3)}`, 'e3').length >= 1);
    const selfScan = metrics.scanDirectoriesForEmojis([isolation.E2E_DIR]);
    assert.strictEqual(selfScan.violations.length, 0, `Emojis in e2e suite: ${JSON.stringify(selfScan.violations)}`);
  });

  // 3. Local HTTP MockServer GET/POST/status
  await record('SC-03', 'MockServer GET, POST webhook, and error status recording', async () => {
    const mock = new MockServer();
    await mock.start();
    try {
      const r1 = await fetch(mock.url('/ok?a=1'));
      assert.strictEqual(r1.status, 200);
      const r2 = await fetch(mock.url('/hook'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: 'https://mpe.local' })
      });
      assert.strictEqual(r2.status, 200);
      mock.setRouteStatus('/bot', 401);
      const r3 = await fetch(mock.url('/bot123/sendMessage'), { method: 'POST' });
      assert.strictEqual(r3.status, 401);
      assert.strictEqual(mock.getRequests().length, 3);
    } finally {
      await mock.stop();
    }
  });

  // 4. Python py_compile & --dry-run stdlib verification
  await record('SC-04', 'Python 3 stdlib py_compile & --dry-run verification', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mpe_e2e_${runId}_py_`));
    tmpDirs.push(dir);
    const pyFile = path.join(dir, 'sample_auto.py');
    fs.writeFileSync(
      pyFile,
      [
        'import argparse, ctypes, sys, time',
        'STEPS = [(120, 240, "left", 0), (360, 480, "left", 350)]',
        'def main():',
        '    p = argparse.ArgumentParser()',
        '    p.add_argument("--dry-run", action="store_true")',
        '    args = p.parse_args()',
        '    for idx, (x, y, btn, wait_ms) in enumerate(STEPS):',
        '        if args.dry_run:',
        '            print(f"DRY_STEP {idx} {btn} {x} {y} {wait_ms}")',
        '    return 0',
        'if __name__ == "__main__":',
        '    sys.exit(main())'
      ].join('\n'),
      'utf8'
    );
    const comp = spawnSync('python', ['-m', 'py_compile', pyFile], { encoding: 'utf8', windowsHide: true });
    assert.strictEqual(comp.status, 0, comp.stderr);
    const dry = spawnSync('python', [pyFile, '--dry-run'], { encoding: 'utf8', windowsHide: true });
    assert.strictEqual(dry.status, 0, dry.stderr);
    assert.ok(dry.stdout.includes('DRY_STEP 1 left 360 480 350'));
  });

  // 5. Isolated Temp Electron Mini-App + CDP Click + Live DOM Contrast + Zero-Orphan Teardown
  let spawnedPid = null;
  const miniToken = `mpe_e2e_${runId}_miniapp`;
  await record('SC-05', 'Isolated Electron CDP launch, click, DOM contrast audit, and PID-tree teardown', async () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), `${miniToken}_`));
    const udDir = path.join(appDir, 'userData');
    fs.mkdirSync(udDir, { recursive: true });
    tmpDirs.push(appDir);

    fs.writeFileSync(
      path.join(appDir, 'package.json'),
      JSON.stringify({ name: 'mpe-e2e-selfcheck', version: '1.0.0', main: 'main.js' }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(appDir, 'index.html'),
      `<!doctype html><html><head><meta charset="utf-8"><style>
        body { margin:0; background:#040406; color:#F7F3E8; font-family:sans-serif; }
        #btn-sc { background:#E5B84B; color:#060508; font-size:15px; font-weight:700; padding:10px 18px; border:0; }
      </style></head><body>
        <button id="btn-sc" data-slot-number="1" onclick="window.__clicked=(window.__clicked||0)+1">1</button>
      </body></html>`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(appDir, 'main.js'),
      [
        "const { app, BrowserWindow } = require('electron');",
        "const path = require('path');",
        'app.whenReady().then(() => {',
        '  const w = new BrowserWindow({ width: 320, height: 200, show: false });',
        "  w.loadFile(path.join(__dirname, 'index.html'));",
        '});',
        "app.on('window-all-closed', () => app.quit());"
      ].join('\n'),
      'utf8'
    );

    pm.registerToken(miniToken);
    const session = await launchElectronWithCdp({
      electronExe: isolation.ELECTRON_EXE,
      args: [appDir, `--user-data-dir=${udDir}`, '--remote-debugging-port=0', `--mpe-e2e-token=${miniToken}`],
      env: process.env,
      cwd: appDir,
      userDataDir: udDir,
      processManager: pm,
      timeoutMs: 12000,
      verbose: opts.verbose
    });
    spawnedPid = session.pid;
    try {
      const page = await session.connectTarget('index.html', 8000);
      await page.waitForSelector('#btn-sc', 4000);
      await page.click('#btn-sc');
      const clicks = await page.eval(() => window.__clicked);
      assert.strictEqual(clicks, 1, 'CDP click did not trigger DOM handler');
      const contrast = await metrics.auditPageContrast(page);
      assert.ok(contrast.checkedCount > 0, 'Self-check contrast audit must check > 0 elements');
      assert.strictEqual(contrast.failures.length, 0, `Self-check contrast failures: ${JSON.stringify(contrast.failures)}`);
    } finally {
      await session.close();
    }
  });

  await pm.cleanupAll();
  await sleep(300);
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch (_) {}
  }

  await record('SC-06', 'Zero-orphan process check & production codigo/mpe.config.json SHA-256 unchanged', async () => {
    const orphans = pm.findOrphanProcesses(spawnedPid ? [spawnedPid] : [], [miniToken]);
    assert.strictEqual(orphans.length, 0, `Orphans found: ${JSON.stringify(orphans)}`);
    isolation.verifyProdUnchanged(prodBefore);
  });

  const passed = checks.filter((c) => c.status === 'PASS').length;
  const failed = checks.filter((c) => c.status === 'FAIL').length;

  if (opts.json) {
    console.log(JSON.stringify({ mode: 'self-check', total: checks.length, pass: passed, fail: failed, checks }, null, 2));
  } else {
    console.log(`\nSELF-CHECK SUMMARY: Total=${checks.length} PASS=${passed} FAIL=${failed}`);
  }
  return failed === 0 ? 0 : 1;
}

async function runSuite(opts) {
  const selected = getSelectedTests(opts);

  if (opts.list) {
    const counts = {
      tier1: tier1Tests.length,
      tier2: tier2Tests.length,
      tier3: tier3Tests.length,
      tier4: tier4Tests.length,
      tier5: tier5Tests.length,
      total: tier1Tests.length + tier2Tests.length + tier3Tests.length + tier4Tests.length + tier5Tests.length
    };
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            counts,
            selectedCount: selected.length,
            tests: selected.map((tc) => ({ id: tc.id, tier: tc.tier, feature: tc.feature, name: tc.name }))
          },
          null,
          2
        )
      );
    } else {
      for (const tc of selected) {
        console.log(`${tc.id} [Tier ${tc.tier}] [${tc.feature}] ${tc.name}`);
      }
      console.log(
        `\nCounts: Tier 1: ${counts.tier1}, Tier 2: ${counts.tier2}, Tier 3: ${counts.tier3}, Tier 4: ${counts.tier4}, Total: ${counts.total}`
      );
      if (opts.filter || opts.tier !== 'all') {
        console.log(`Selected: ${selected.length}`);
      }
    }
    return 0;
  }

  if (opts.selfCheck) {
    return runSelfCheck(opts);
  }

  if (opts.filter && selected.length === 0) {
    throw new Error(`No tests matched filter "${opts.filter}" in tier "${opts.tier}"`);
  }

  const runId = `${Date.now()}_${process.pid}`;
  const pm = new ProcessManager(runId);
  pm.installSignalHandlers();

  const prodBefore = isolation.getProdSnapshot();
  const ctx = {
    runId,
    processManager: pm,
    verbose: opts.verbose
  };

  const results = [];
  for (const tc of selected) {
    const start = Date.now();
    try {
      await tc.fn(ctx);
      const durationMs = Date.now() - start;
      results.push({ id: tc.id, tier: tc.tier, feature: tc.feature, name: tc.name, status: 'PASS', durationMs });
      if (!opts.json) console.log(`[PASS] ${tc.id} (${durationMs}ms) - ${tc.name}`);
    } catch (err) {
      const durationMs = Date.now() - start;
      const msg = err && err.message ? err.message : String(err);
      results.push({ id: tc.id, tier: tc.tier, feature: tc.feature, name: tc.name, status: 'FAIL', durationMs, error: msg });
      if (!opts.json) console.error(`[FAIL] ${tc.id} (${durationMs}ms) - ${tc.name}: ${msg}`);
    } finally {
      await pm.cleanupAll();
    }
  }

  // Final safety assertions: 0 orphans & production config SHA-256 unchanged
  const orphans = pm.findOrphanProcesses();
  let safetyError = null;
  try {
    isolation.verifyProdUnchanged(prodBefore);
    if (orphans.length > 0) {
      throw new Error(`Leaked test processes after suite exit: ${JSON.stringify(orphans)}`);
    }
  } catch (err) {
    safetyError = err.message;
    await pm.cleanupAll();
  }

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const perTier = {};
  for (const tierNum of [1, 2, 3, 4]) {
    const tr = results.filter((r) => r.tier === tierNum);
    if (tr.length > 0) {
      perTier[`tier${tierNum}`] = {
        total: tr.length,
        pass: tr.filter((x) => x.status === 'PASS').length,
        fail: tr.filter((x) => x.status === 'FAIL').length
      };
    }
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          total: results.length,
          pass,
          fail,
          perTier,
          safetyError,
          results
        },
        null,
        2
      )
    );
  } else {
    console.log(`\nE2E SUMMARY: Total=${results.length} PASS=${pass} FAIL=${fail}`);
    for (const [k, v] of Object.entries(perTier)) {
      console.log(`  ${k}: Total=${v.total} PASS=${v.pass} FAIL=${v.fail}`);
    }
    if (safetyError) {
      console.error(`SAFETY CHECK FAILED: ${safetyError}`);
    }
  }

  return fail === 0 && !safetyError ? 0 : 1;
}

(async () => {
  const wantsJson = process.argv.includes('--json');
  try {
    const opts = parseArgs(process.argv.slice(2));
    const exitCode = await runSuite(opts);
    process.exit(exitCode);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (wantsJson) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.error(`[E2E RUNNER ERROR] ${err && err.stack ? err.stack : msg}`);
    }
    process.exit(1);
  }
})();
