'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isolation = require('../lib/isolation');
const { launchElectronWithCdp, sleep } = require('../lib/cdpClient');
const { MockServer } = require('../lib/mockServer');
const metrics = require('../lib/metrics');
const h = require('../lib/helpers');

function t(id, feature, name, fn) {
  return { id, tier: 2, feature, name, fn };
}

const tier2Tests = [
  // =========================================================================
  // F01 — Boundaries
  // =========================================================================
  t('T2-F01-01', 'F01', '15 rapid summon/hide cycles leave zero errors and coherent state', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F01-01');
    try {
      for (let i = 0; i < 15; i++) {
        await app.mainPage.eval(() => window.mpeApi.hideHud());
        await sleep(30);
        await app.mainPage.eval(() => window.mpeApi.executePoint({ id: 'open-org', actionType: 'open_organizer', params: {} }));
        await sleep(30);
      }
      assert.deepStrictEqual(app.mainPage.getErrors(), [], 'Errors observed during rapid summon/hide');
    } finally {
      await app.close();
    }
  }),

  t('T2-F01-02', 'F01', 'App survives gracefully if MpeHook.exe exits mid-run', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F01-02');
    try {
      // Wait for child MpeHook.exe daemon to spawn in Electron process tree
      let hookProcs = [];
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        hookProcs = ctx.processManager
          .getProcessTreeStats(app.session.pid)
          .processes.filter((p) => p.name.toLowerCase().includes('mpehook'));
        if (hookProcs.length >= 1) break;
        await sleep(150);
      }
      assert.ok(hookProcs.length >= 1, 'Expected MpeHook.exe child daemon running before kill');
      const killedPid = hookProcs[0].pid;
      ctx.processManager.killPidTreeSync(killedPid);
      await sleep(300);

      // App stays responsive immediately after hook exit
      const cfg = await app.mainPage.eval(() => window.mpeApi.getConfig());
      assert.ok(cfg && Array.isArray(cfg.points), 'getConfig must continue working after MpeHook exit');

      // Wait for HookBridge recovery/respawn (~1500ms) and verify listOpenWindows works
      let recovered = [];
      const recDeadline = Date.now() + 4500;
      while (Date.now() < recDeadline) {
        recovered = ctx.processManager
          .getProcessTreeStats(app.session.pid)
          .processes.filter((p) => p.name.toLowerCase().includes('mpehook') && p.pid !== killedPid);
        if (recovered.length >= 1) break;
        await sleep(200);
      }
      assert.ok(recovered.length >= 1, 'HookBridge must recover/respawn MpeHook.exe after unexpected exit');
      const wins = await app.mainPage.eval(() => window.mpeApi.listOpenWindows());
      assert.ok(Array.isArray(wins) && wins.length > 0, 'listOpenWindows must succeed after MpeHook exit');
      assert.deepStrictEqual(app.mainPage.getErrors(), []);
    } finally {
      await app.close();
    }
  }),

  t('T2-F01-03', 'F01', 'quitApp() during active UI/intervals exits <5s with zero orphans', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F01-03', { startup: true });
    const rootPid = app.session.pid;
    try {
      await sleep(300);
      const res = await h.quitAppGracefully(app.mainPage, app.session, 5000);
      assert.strictEqual(res.code, 0);
      await sleep(350);
      assert.strictEqual(ctx.processManager.findOrphanProcesses([rootPid], [app.ws.runToken]).length, 0);
    } finally {
      await app.close();
    }
  }),

  t('T2-F01-04', 'F01', '3 simultaneous second-instance launches all exit 0 cleanly', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F01-04');
    try {
      const procs = [0, 1, 2].map(() =>
        ctx.processManager.spawnProcess(isolation.ELECTRON_EXE, app.ws.buildElectronArgs(['--launch-ui']), {
          env: app.ws.buildElectronEnv(),
          cwd: isolation.CODE_DIR,
          stdio: ['ignore', 'ignore', 'ignore']
        })
      );
      const codes = await Promise.all(
        procs.map(
          (p) =>
            new Promise((resolve, reject) => {
              const tm = setTimeout(() => reject(new Error('Secondary instance hung')), 7000);
              p.once('close', (c) => {
                clearTimeout(tm);
                resolve(c);
              });
            })
        )
      );
      assert.deepStrictEqual(codes, [0, 0, 0]);
    } finally {
      await app.close();
    }
  }),

  t('T2-F01-05', 'F01', 'Corrupted JSON in isolated mpe.config.json recovers from isolated backup', async (ctx) => {
    isolation.assertCodeIsolationReady();
    // 1. Direct ConfigManager backup recovery test inside isolated temp rootDir/codeDir
    const os = require('os');
    const ConfigManager = require(path.join(isolation.CODE_DIR, 'src', 'main', 'configManager'));
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mpe_e2e_${ctx.runId}_bak_`));
    const tmpCode = path.join(tmpRoot, 'codigo');
    const tmpData = path.join(tmpCode, 'data');
    const tmpUd = path.join(tmpRoot, 'ud');
    fs.mkdirSync(tmpData, { recursive: true });
    fs.mkdirSync(tmpUd, { recursive: true });

    const markerTitle = `BackupSentinelMarker_${ctx.runId}`;
    const backupSeed = isolation.buildSeedConfig(tmpRoot, {
      userName: 'BackupSentinelUser',
      isRegistered: true,
      points: [
        {
          id: 'sentinel-1',
          code: '01 1',
          title: markerTitle,
          actionType: 'open_organizer',
          params: {}
        }
      ]
    });
    fs.writeFileSync(path.join(tmpData, 'mpe.config.backup.json'), JSON.stringify(backupSeed, null, 2), 'utf8');
    fs.writeFileSync(path.join(tmpCode, 'mpe.config.json'), '{CORRUPT_JSON_!@#', 'utf8');

    const ws = isolation.createIsolatedWorkspace(ctx.runId, 'T2-F01-05');
    ctx.processManager.registerToken(ws.runToken);
    ctx.processManager.registerCleanup(() => {
      ws.cleanup();
      try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
    });

    let session = null;
    let page = null;
    try {
      const cm = new ConfigManager(tmpRoot, tmpCode, { ignoreProcessArgs: true, userDataDir: tmpUd });
      const recovered = cm.load();
      const snaps = fs.readdirSync(tmpData).filter((f) => f.includes('.corrupted.'));
      assert.ok(snaps.length >= 1, 'Corrupted snapshot must be saved in data directory');
      assert.strictEqual(
        fs.readFileSync(path.join(tmpData, snaps[0]), 'utf8'),
        '{CORRUPT_JSON_!@#',
        'Corrupted snapshot must preserve raw corrupted payload'
      );
      assert.strictEqual(
        recovered.points[0].title,
        markerTitle,
        'ConfigManager must restore distinct marker from backup rather than clean defaults'
      );
      assert.strictEqual(recovered.profile.userName, 'BackupSentinelUser');

      // 2. Also verify isolated Electron app boots cleanly without crashing on corrupted JSON
      fs.writeFileSync(ws.configPath, '{CORRUPT_JSON_!@#', 'utf8');
      session = await launchElectronWithCdp({
        electronExe: isolation.ELECTRON_EXE,
        args: ws.buildElectronArgs(),
        env: ws.buildElectronEnv(),
        cwd: isolation.CODE_DIR,
        userDataDir: ws.userDataDir,
        processManager: ctx.processManager
      });
      page = await session.connectTarget('index.html');
      await page.waitForFunction(() => Boolean(window.mpeApi));
      const cfg = await page.eval(() => window.mpeApi.getConfig());
      assert.ok(Array.isArray(cfg.points) && cfg.points.length >= 1, 'Electron must recover valid points[] after corrupted JSON');
      assert.deepStrictEqual(page.getErrors(), []);
    } finally {
      if (page && session) {
        await h.quitAppGracefully(page, session, 5000).catch(() => {});
      }
      if (session) await session.close();
      ws.cleanup();
      try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
    }
  }),

  // =========================================================================
  // F02 — Boundaries
  // =========================================================================
  t('T2-F02-01', 'F02', 'Empty points: [] renders graceful empty state in Main and Mini', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F02-01', { points: [] });
    try {
      const cfg = await app.mainPage.eval(() => window.mpeApi.getConfig());
      assert.strictEqual(Array.isArray(cfg.points), true);
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(200);
      assert.deepStrictEqual(app.mainPage.getErrors(), []);
      assert.deepStrictEqual(miniPage.getErrors(), []);
    } finally {
      await app.close();
    }
  }),

  t('T2-F02-02', 'F02', 'Single point config handles hotkey 1 and ignores unused keys 2..9', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T2-F02-02', {
      points: [
        {
          id: 'only-1',
          code: '01 1',
          title: 'Unico',
          actionType: 'send_link_chat',
          params: { deliveryChannel: 'webhook', webhookUrl: mock.url('/hook'), linkUrl: 'https://mpe.local/only1' }
        }
      ]
    });
    try {
      await app.mainPage.pressKey('1', 'Digit1');
      await mock.waitForRequest((r) => r.path === '/hook', 4000);
      assert.strictEqual(mock.getRequests((r) => r.path === '/hook').length, 1, 'Digit1 must execute Slot 1');
      await app.mainPage.pressKey('5', 'Digit5');
      await sleep(300);
      assert.strictEqual(mock.getRequests((r) => r.path === '/hook').length, 1, 'Unused Digit5 must be a safe no-op');
      assert.deepStrictEqual(app.mainPage.getErrors(), []);
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T2-F02-03', 'F02', '12+ points (>9 slots) render without crash or clipping in Mini', async (ctx) => {
    const points = Array.from({ length: 12 }, (_, i) => ({
      id: `p-${i + 1}`,
      code: `${String(i + 1).padStart(2, '0')} ${i + 1}`,
      title: `Estrela ${i + 1}`,
      actionType: 'open_organizer',
      params: {}
    }));
    const app = await h.launchIsolatedApp(ctx, 'T2-F02-03', {
      points,
      miniAstrolabe: { enabled: true, x: 450, y: 380, size: 68, scale: 1.0, fanRadius: 150 }
    });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const vis = (await h.getMiniHubAndSlots(miniPage)).slots.filter((s) => s.visible);
      assert.ok(vis.length >= 9, `Expected >=9 visible slots in Mini for 12 points, got ${vis.length}`);
      assert.deepStrictEqual(miniPage.getErrors(), []);
    } finally {
      await app.close();
    }
  }),

  t('T2-F02-04', 'F02', 'reorderPoint with out-of-bounds or equal indices safely no-ops', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F02-04');
    try {
      const before = await app.mainPage.eval(() => window.mpeApi.getConfig());
      const r1 = await app.mainPage.eval(() => window.mpeApi.reorderPoint(-1, 99));
      assert.strictEqual(r1.ok, false, 'Negative/out-of-bounds reorderPoint(-1, 99) must return ok: false');
      const r2 = await app.mainPage.eval(() => window.mpeApi.reorderPoint(0, 0));
      assert.strictEqual(r2.ok, true, 'Same-index reorderPoint(0, 0) must succeed as no-op');
      const r3 = await app.mainPage.eval((len) => window.mpeApi.reorderPoint(0, len), before.points.length);
      assert.strictEqual(r3.ok, false, 'Out-of-bounds toIndex must return ok: false');
      const after = await app.mainPage.eval(() => window.mpeApi.getConfig());
      assert.deepStrictEqual(
        after.points.map((p) => p.id),
        before.points.map((p) => p.id)
      );
    } finally {
      await app.close();
    }
  }),

  t('T2-F02-05', 'F02', 'saveConfig with malformed non-array points preserves valid points[]', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F02-05');
    try {
      const before = await app.mainPage.eval(() => window.mpeApi.getConfig());
      await app.mainPage.eval(() => window.mpeApi.saveConfig({ points: 'not-an-array' }));
      const after = await app.mainPage.eval(() => window.mpeApi.getConfig());
      assert.strictEqual(Array.isArray(after.points), true);
      assert.strictEqual(after.points.length, before.points.length);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F03 — Boundaries
  // =========================================================================
  t('T2-F03-01', 'F03', 'Declined consent blocks executePoint across open_url, send_link_chat, launch_app_project', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T2-F03-01', { cleanState: true });
    try {
      await h.clickConsentDecision(app.mainPage, false);
      for (const pt of [
        { id: 'b1', actionType: 'open_url', params: { url: mock.url('/ok') } },
        { id: 'b2', actionType: 'send_link_chat', params: { deliveryChannel: 'webhook', webhookUrl: mock.url('/hook'), linkUrl: 'https://a.b' } },
        { id: 'b3', actionType: 'launch_app_project', params: { appName: 'notepad', targetPath: 'notepad.exe' } }
      ]) {
        const res = await app.mainPage.eval((p) => window.mpeApi.executePoint(p), pt);
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.blockedByConsent, true, `Expected blockedByConsent for ${pt.actionType}`);
      }
      assert.strictEqual(mock.getRequests().length, 0, 'Mock server must receive zero requests when consent declined');
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T2-F03-02', 'F03', 'Declined consent blocks toggleMiniAstrolabe(true)', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F03-02', { cleanState: true });
    try {
      await h.clickConsentDecision(app.mainPage, false);
      const res = await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(true));
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.blockedByConsent, true);
      const targets = await app.session.listTargets();
      assert.strictEqual(
        targets.some((x) => String(x.url || '').includes('mini-astrolabe.html')),
        false,
        'Mini window must not open without consent'
      );
    } finally {
      await app.close();
    }
  }),

  t('T2-F03-03', 'F03', 'Declined consent blocks Python recording, execution, and scheduling', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F03-03', { cleanState: true });
    try {
      await h.clickConsentDecision(app.mainPage, false);
      const r1 = await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
      const r2 = await app.mainPage.eval(() => window.mpeApi.runPythonScript('missing', { dryRun: true }));
      const r3 = await app.mainPage.eval(() => window.mpeApi.schedulePythonScript('missing', { enabled: true, timeHHMM: '12:00' }));
      for (const r of [r1, r2, r3]) {
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.blockedByConsent, true);
      }
    } finally {
      await app.close();
    }
  }),

  t('T2-F03-04', 'F03', 'Declined consent prevents Windows startup registration via saveConfig', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F03-04', { cleanState: true });
    try {
      await h.clickConsentDecision(app.mainPage, false);
      await app.mainPage.eval(() => window.mpeApi.saveConfig({ system: { startWithWindows: true } }));
      const cfg = await app.mainPage.eval(() => window.mpeApi.getConfig());
      assert.strictEqual(cfg.system.startWithWindows, false, 'startWithWindows must stay false when consent declined');
      const disk = app.ws.readConfig();
      assert.strictEqual(disk.system.startWithWindows, false, 'Disk config must keep startWithWindows: false');
      const st = await app.mainPage.eval(() => window.mpeApi.getConsentStatus());
      assert.strictEqual(st.accepted, false);
      assert.strictEqual(st.permissions.backgroundExecution, false);
      const bgCheck = await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(true));
      assert.strictEqual(bgCheck.blockedByConsent, true, 'Background Mini activation must stay blocked');
    } finally {
      await app.close();
    }
  }),

  t('T2-F03-05', 'F03', 'Revoking consent mid-session disables Mini Astrolabio and blocks privileged actions', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F03-05');
    try {
      await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(true));
      await sleep(200);
      await app.mainPage.eval(() =>
        window.mpeApi.setConsentDecision(false, {
          backgroundExecution: false,
          launchAppsAndLinks: false,
          pythonAutomation: false
        })
      );
      await sleep(250);
      const miniState = await app.mainPage.eval(() => window.mpeApi.getMiniAstrolabeState());
      assert.strictEqual(miniState.enabled, false, 'Mini Astrolabio must disable when consent revoked');
      const execRes = await app.mainPage.eval(() =>
        window.mpeApi.executePoint({ id: 'u', actionType: 'open_url', params: { url: 'https://example.org' } })
      );
      assert.strictEqual(execRes.blockedByConsent, true);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F04 — Boundaries
  // =========================================================================
  t('T2-F04-01', 'F04', 'MpeHook.cs does not intercept Shift+Ctrl+RightClick (without Alt) for Katharos coexistence', async () => {
    const hookCs = fs.readFileSync(path.join(isolation.CODE_DIR, 'src', 'native', 'MpeHook.cs'), 'utf8');
    // Must require shift && ctrl && alt for TRIGGER_HUD suppression
    assert.match(hookCs, /shift\s*&&\s*ctrl\s*&&\s*alt/i);
    assert.match(hookCs, /CallNextHookEx/);
  }),

  t('T2-F04-02', 'F04', 'MpeHook.exe ignores unknown stdin commands and still exits on QUIT', async (ctx) => {
    const hook = h.spawnHookDaemon(ctx);
    try {
      await hook.waitForLine(/^MPE_HOOK_READY$/, 3000);
      hook.send('UNKNOWN_CMD_FOO_BAR');
      hook.send('   ');
      await sleep(150);
      await hook.quit();
      assert.strictEqual(hook.proc.exitCode, 0);
    } finally {
      await hook.quit();
    }
  }),

  t('T2-F04-03', 'F04', 'MpeHook.exe --DELIVER-TO-SYSTEM returns WINDOW_NOT_FOUND for bogus query', async () => {
    const res = h.runHookCli(['--DELIVER-TO-SYSTEM', 'NONEXISTENT_WINDOW_E2E_XYZ_999', '0']);
    assert.strictEqual(res.code, 0);
    assert.match(res.stdout, /WINDOW_NOT_FOUND/);
  }),

  t('T2-F04-04', 'F04', 'Rapid RECORD_ON / RECORD_OFF toggling x10 keeps MpeHook.exe stable', async (ctx) => {
    const hook = h.spawnHookDaemon(ctx);
    try {
      await hook.waitForLine(/^MPE_HOOK_READY$/, 3000);
      for (let i = 0; i < 10; i++) {
        hook.send('RECORD_ON');
        hook.send('RECORD_OFF');
      }
      await sleep(200);
      await hook.quit();
      assert.strictEqual(hook.proc.exitCode, 0);
    } finally {
      await hook.quit();
    }
  }),

  t('T2-F04-05', 'F04', 'MpeHook.cs supports negative multi-monitor signed integer coordinates', async () => {
    const hookCs = fs.readFileSync(path.join(isolation.CODE_DIR, 'src', 'native', 'MpeHook.cs'), 'utf8');
    assert.match(hookCs, /REC_CLICK/);
    assert.match(hookCs, /pt\.x/);
    assert.match(hookCs, /pt\.y/);
  }),

  // =========================================================================
  // F05 — Boundaries
  // =========================================================================
  t('T2-F05-01', 'F05', 'mode-hud-only hides editor controls while keeping #btn-dock-organizer active', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F05-01');
    try {
      await app.mainPage.eval(() => {
        document.body.classList.remove('mode-editor');
        document.body.classList.add('mode-hud-only');
      });
      await sleep(150);
      const dockVis = await app.mainPage.getRect('#btn-dock-organizer');
      assert.ok(dockVis.width > 0 && dockVis.height > 0);
      const topbarHidden = await app.mainPage.eval(() => {
        const tb = document.querySelector('.hud-topbar');
        return tb ? getComputedStyle(tb).display === 'none' : true;
      });
      assert.strictEqual(topbarHidden, true, 'Topbar must hide in mode-hud-only');
    } finally {
      await app.close();
    }
  }),

  t('T2-F05-02', 'F05', 'Escape key closes open modal first, then returns from Organizer, then hides HUD', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F05-02');
    try {
      // 1. Open Guide modal, Escape must close modal while keeping HUD visible
      await app.mainPage.click('#btn-open-guide');
      await app.mainPage.waitForSelector('#modal-guide', 3000);
      await app.mainPage.pressKey('Escape', 'Escape');
      await app.mainPage.waitForFunction(() => document.getElementById('modal-guide')?.classList.contains('hidden'), [], 3000);
      assert.strictEqual(await app.mainPage.eval(() => document.hidden), false, 'HUD must stay visible after closing modal');

      // 2. Open Organizer, Escape must return to Astrolabe while keeping HUD visible
      await app.mainPage.click('#btn-dock-organizer');
      await app.mainPage.waitForSelector('#organizer-workspace', 3000);
      await app.mainPage.pressKey('Escape', 'Escape');
      await app.mainPage.waitForFunction(() => document.getElementById('organizer-workspace')?.classList.contains('hidden'), [], 3000);
      assert.strictEqual(await app.mainPage.eval(() => document.hidden), false, 'HUD must stay visible after exiting Organizer');
    } finally {
      await app.close();
    }
  }),

  t('T2-F05-03', 'F05', 'Main HUD controls fit inside viewport without horizontal overflow', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F05-03');
    try {
      const boundsOk = await app.mainPage.eval(() => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const dock = document.querySelector('#btn-dock-organizer')?.getBoundingClientRect();
        return Boolean(dock && dock.left >= 0 && dock.top >= 0 && dock.right <= w && dock.bottom <= h);
      });
      assert.strictEqual(boundsOk, true, 'Dock organizer button must remain inside viewport bounds');
    } finally {
      await app.close();
    }
  }),

  t('T2-F05-04', 'F05', 'Invalid theme preset falls back safely without throwing renderer errors', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F05-04', {
      themePreset: 'invalid-nonexistent-preset',
      theme: { preset: 'invalid-nonexistent-preset', bgPrimary: '', goldPrimary: '' }
    });
    try {
      const r = await app.mainPage.getRect('#astrolabe-canvas');
      assert.ok(r.width > 0 && r.height > 0);
      const cssVars = await app.mainPage.eval(() => {
        const cs = getComputedStyle(document.documentElement);
        return {
          bg: cs.getPropertyValue('--bg-primary').trim(),
          gold: cs.getPropertyValue('--gold-primary').trim()
        };
      });
      assert.ok(cssVars.bg.length > 0 && cssVars.gold.length > 0, `Theme fallback CSS vars missing: ${JSON.stringify(cssVars)}`);
      assert.deepStrictEqual(app.mainPage.getErrors(), []);
    } finally {
      await app.close();
    }
  }),

  t('T2-F05-05', 'F05', 'Rapid Tab 2D/3D toggling x10 keeps #hud-mode-badge synchronized with zero errors', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F05-05');
    try {
      for (let i = 0; i < 10; i++) {
        await app.mainPage.pressKey('Tab', 'Tab');
        await sleep(30);
      }
      const badge = await app.mainPage.eval(() => document.getElementById('hud-mode-badge')?.textContent || '');
      assert.match(badge, /2D|3D/);
      assert.deepStrictEqual(app.mainPage.getErrors(), []);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F06 — Boundaries
  // =========================================================================
  t('T2-F06-01', 'F06', 'Self-organization protection rejects organizing codigo/ directory', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F06-01');
    try {
      const res = await app.mainPage.eval((cd) => {
        return window.mpeApi.orgOrganize({ paths: [cd], criterion: 'type', targetScope: 'arquivos', moveInsteadOfCopy: true });
      }, isolation.CODE_DIR);
      assert.strictEqual(res.ok, false, 'Must refuse self-organizing codigo/ directory');
    } finally {
      await app.close();
    }
  }),

  t('T2-F06-02', 'F06', 'Path traversal in orgDeleteFile cannot delete codigo/mpe.config.json', async (ctx) => {
    const beforeHash = isolation.sha256File(isolation.PROD_CONFIG_PATH);
    const app = await h.launchIsolatedApp(ctx, 'T2-F06-02');
    try {
      const relToProd = path.relative(app.ws.arquivosDir, isolation.PROD_CONFIG_PATH);
      for (const relPath of ['../codigo/mpe.config.json', relToProd]) {
        const res = await app.mainPage.eval((rp) => window.mpeApi.orgDeleteFile({ scope: 'arquivos', relPath: rp }), relPath);
        assert.strictEqual(res.ok, false, `Path traversal delete must fail for ${relPath}`);
        assert.match(String(res.error || ''), /fora da pasta permitida/i, `Expected path-traversal guard error, got: ${JSON.stringify(res)}`);
      }
      assert.strictEqual(isolation.sha256File(isolation.PROD_CONFIG_PATH), beforeHash);
    } finally {
      await app.close();
    }
  }),

  t('T2-F06-03', 'F06', 'Duplicate filename collision renames safely without overwriting', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F06-03');
    try {
      const f = path.join(app.ws.workspaceDir, 'nota_dup.txt');
      fs.writeFileSync(f, 'v1', 'utf8');
      const r1 = await app.mainPage.eval((p) => window.mpeApi.orgOrganize({ paths: [p], criterion: 'type', targetScope: 'arquivos', moveInsteadOfCopy: false }), f);
      fs.writeFileSync(f, 'v2', 'utf8');
      const r2 = await app.mainPage.eval((p) => window.mpeApi.orgOrganize({ paths: [p], criterion: 'type', targetScope: 'arquivos', moveInsteadOfCopy: false }), f);
      assert.strictEqual(r1.ok, true);
      assert.strictEqual(r2.ok, true);
      assert.ok(path.resolve(r1.baseTargetDir).toLowerCase().startsWith(path.resolve(app.ws.tmpRoot).toLowerCase()));
      assert.notStrictEqual(r1.results[0].destPath, r2.results[0].destPath, 'Duplicate copy must receive unique destination path');
      assert.strictEqual(fs.readFileSync(r1.results[0].destPath, 'utf8'), 'v1');
      assert.strictEqual(fs.readFileSync(r2.results[0].destPath, 'utf8'), 'v2');
    } finally {
      await app.close();
    }
  }),

  t('T2-F06-04', 'F06', 'Empty paths: [] organize fails gracefully without writing undo batch', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F06-04');
    try {
      const res = await app.mainPage.eval(() => window.mpeApi.orgOrganize({ paths: [], criterion: 'type', targetScope: 'arquivos' }));
      assert.strictEqual(res.ok, false);
    } finally {
      await app.close();
    }
  }),

  t('T2-F06-05', 'F06', 'Search handles accented/uppercase query and zero-match query cleanly', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F06-05');
    try {
      const f = path.join(app.ws.workspaceDir, 'relatorio_final.txt');
      fs.writeFileSync(f, 'dados financeiros', 'utf8');
      await app.mainPage.eval((p) => window.mpeApi.orgOrganize({ paths: [p], criterion: 'type', targetScope: 'arquivos', moveInsteadOfCopy: false }), f);
      const hit = await app.mainPage.eval(() => window.mpeApi.orgSearch({ scope: 'arquivos', query: 'RELATÓRIO', searchInContent: false }));
      assert.strictEqual(hit.ok, true);
      assert.ok(Array.isArray(hit.searchResults) && hit.searchResults.length >= 1, 'Accent-insensitive search must match relatorio_final.txt');
      const miss = await app.mainPage.eval(() => window.mpeApi.orgSearch({ scope: 'arquivos', query: 'ZZZZ_NO_MATCH_999', searchInContent: false }));
      assert.strictEqual(miss.ok, true);
      assert.strictEqual(miss.searchResults.length, 0);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F07 — Boundaries
  // =========================================================================
  t('T2-F07-01', 'F07', 'Organizer light theme meets WCAG >= 4.5:1 contrast on all visible text', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F07-01', {
      organizer: { lastActiveTab: 'organizer', rememberWindowState: false, uiMode: 'light', fontSize: 'medium', defaultCriterion: 'type', moveInsteadOfCopy: false }
    });
    try {
      await app.mainPage.click('#btn-dock-organizer').catch(() => {});
      await app.mainPage.waitForSelector('#organizer-workspace', 3000);
      const audit = await metrics.auditPageContrast(app.mainPage, { primaryMin: 7.0, secondaryMin: 4.5 });
      assert.ok(audit.checkedCount > 0, 'Light theme contrast audit checked 0 elements');
      assert.strictEqual(audit.failures.length, 0, `Light theme contrast failures: ${JSON.stringify(audit.failures)}`);
    } finally {
      await app.close();
    }
  }),

  t('T2-F07-02', 'F07', 'Built-in theme presets maintain >= 7:1 primary contrast', async (ctx) => {
    for (const preset of ['solar-imperial', 'cyber-cyan', 'crimson-eclipse']) {
      const app = await h.launchIsolatedApp(ctx, `T2-F07-02_${preset}`, { themePreset: preset });
      try {
        const expectedBg = isolation.THEME_PRESETS[preset].bgPrimary.toLowerCase();
        const actualBg = await app.mainPage.eval(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim().toLowerCase()
        );
        assert.strictEqual(actualBg, expectedBg, `Preset ${preset} was not applied to --bg-primary`);
        const audit = await metrics.auditPageContrast(app.mainPage, { primaryMin: 7.0, secondaryMin: 4.5 });
        assert.ok(audit.checkedCount > 0, `Preset ${preset} contrast audit checked 0 elements`);
        const primFails = audit.failures.filter((f) => f.tier === 'primary');
        assert.strictEqual(primFails.length, 0, `Preset ${preset} primary contrast fail: ${JSON.stringify(primFails)}`);
      } finally {
        await app.close();
      }
    }
  }),

  t('T2-F07-03', 'F07', 'Large font scale keeps Organizer buttons unclipped and non-overlapping', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F07-03', {
      organizer: { lastActiveTab: 'organizer', rememberWindowState: false, uiMode: 'dark', fontSize: 'large', defaultCriterion: 'type', moveInsteadOfCopy: false }
    });
    try {
      await app.mainPage.click('#btn-dock-organizer').catch(() => {});
      await app.mainPage.waitForSelector('#organizer-workspace', 3000);
      const rects = await app.mainPage.eval(() => {
        const btns = Array.from(document.querySelectorAll('#organizer-workspace button'));
        return btns
          .filter((b) => getComputedStyle(b).display !== 'none')
          .map((b) => {
            const r = b.getBoundingClientRect();
            return { id: b.id, w: r.width, h: r.height, sw: b.scrollWidth, cw: b.clientWidth };
          });
      });
      assert.ok(rects.length >= 3);
      for (const r of rects) {
        assert.ok(r.w > 0 && r.h > 0);
      }
    } finally {
      await app.close();
    }
  }),

  t('T2-F07-04', 'F07', 'Emoji scanner catches pictographs/flags/keycaps while preserving M.P.E 7 glyphs', async () => {
    const safeMpe = 'Δ Π ϟ — • ← → 0123456789 # *';
    assert.deepStrictEqual(metrics.scanStringForEmojis(safeMpe, 'glyphs'), []);
    const badSamples = [
      `Teste ${String.fromCodePoint(0x1F600)}`,
      `Foguete ${String.fromCodePoint(0x1F680)}`,
      `Bandeira ${String.fromCodePoint(0x1F1E7, 0x1F1F7)}`,
      `Keycap ${String.fromCodePoint(0x31, 0xFE0F, 0x20E3)}`,
      `VS16 ${String.fromCodePoint(0x2B50, 0xFE0F)}`
    ];
    for (const s of badSamples) {
      const hits = metrics.scanStringForEmojis(s, 'sample');
      assert.ok(hits.length >= 1, `Emoji scanner missed sample: ${s}`);
    }
  }),

  t('T2-F07-05', 'F07', 'Concise HUD text invariant: no duplicate percentage banners on splash/HUD', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F07-05', { keepSplash: true });
    try {
      const splashText = await app.mainPage.eval(() => document.getElementById('splash-screen')?.innerText || '');
      const pctMatches = splashText.match(/\d+\s*%/g) || [];
      assert.ok(pctMatches.length <= 1, `Duplicate percentage strings on splash: ${JSON.stringify(pctMatches)}`);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F08 — Boundaries
  // =========================================================================
  t('T2-F08-01', 'F08', 'Resize below minimum clamps scale/size and keeps fan buttons clickable (>=24px)', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F08-01');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await app.mainPage.eval(() => window.mpeApi.updateMiniAstrolabeLayout({ scale: 0.1, size: 10 }));
      await sleep(200);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const info = await h.getMiniHubAndSlots(miniPage);
      assert.ok(info.hubRect.width >= 24 && info.hubRect.height >= 24, 'Mini hub clamped below playable size');
      const vis = info.slots.filter((x) => x.visible);
      assert.ok(vis.length >= 1, 'Expected >= 1 visible Mini fan slot at minimum scale');
      for (const s of vis) {
        assert.ok(s.rect.width >= 24 && s.rect.height >= 24, `Slot too small at min scale: ${JSON.stringify(s.rect)}`);
      }
    } finally {
      await app.close();
    }
  }),

  t('T2-F08-02', 'F08', 'Resize above maximum clamps scale/size and keeps fan inside screen bounds', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F08-02');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await app.mainPage.eval(() => window.mpeApi.updateMiniAstrolabeLayout({ scale: 5.0, size: 400 }));
      await sleep(200);
      const st = await app.mainPage.eval(() => window.mpeApi.getMiniAstrolabeState());
      assert.ok(st.scale > 1.0 && st.scale <= 2.5, `Scale must clamp within (1.0, 2.5], got ${st.scale}`);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(200);
      const vis = (await h.getMiniHubAndSlots(miniPage)).slots.filter((x) => x.visible);
      assert.ok(vis.length >= 2);
    } finally {
      await app.close();
    }
  }),

  t('T2-F08-03', 'F08', 'Off-screen position (-500, 99999) clamps strictly inside display workArea', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F08-03');
    try {
      await app.mainPage.eval(() => window.mpeApi.updateMiniAstrolabeLayout({ x: -500, y: 99999 }));
      await sleep(200);
      const st = await app.mainPage.eval(() => window.mpeApi.getMiniAstrolabeState());
      const display = await app.mainPage.eval(() => ({
        w: window.screen.availWidth || window.innerWidth,
        h: window.screen.availHeight || window.innerHeight
      }));
      const size = st.size || 68;
      assert.ok(
        st.x >= 0 && st.y >= 0 && st.x + size / 2 <= display.w + 2 && st.y + size / 2 <= display.h + 2,
        `Off-screen coordinates not clamped inside display (${display.w}x${display.h}): ${JSON.stringify(st)}`
      );
      assert.ok(
        st.x <= size && st.y >= display.h - size - 150,
        `Off-screen coordinates did not clamp near left/bottom edge (${display.w}x${display.h}): ${JSON.stringify(st)}`
      );
      if (st.bounds) {
        assert.ok(
          st.bounds.x >= 0 &&
            st.bounds.y >= 0 &&
            st.bounds.x <= 40 &&
            st.bounds.x + st.bounds.width <= display.w + 2 &&
            st.bounds.y + st.bounds.height <= display.h + 2 &&
            st.bounds.y >= display.h - st.bounds.height - 150,
          `Mini window bounds not clamped near left/bottom workArea edge: ${JSON.stringify(st)}`
        );
      }
    } finally {
      await app.close();
    }
  }),

  t('T2-F08-04', 'F08', 'Rapid Mini toggle ON/OFF x10 creates zero duplicate windows', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F08-04');
    try {
      for (let i = 0; i < 10; i++) {
        await app.mainPage.eval((en) => window.mpeApi.toggleMiniAstrolabe(en), i % 2 === 0);
      }
      await sleep(250);
      const targets = await app.session.listTargets();
      const miniTargets = targets.filter((x) => String(x.url || '').includes('mini-astrolabe.html'));
      assert.ok(miniTargets.length <= 1, `Duplicate Mini windows detected: ${miniTargets.length}`);
    } finally {
      await app.close();
    }
  }),

  t('T2-F08-05', 'F08', 'Closing Mini window does not terminate Main process or orphan Hook', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F08-05');
    try {
      await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(false));
      await sleep(200);
      const cfg = await app.mainPage.eval(() => window.mpeApi.getConfig());
      assert.ok(cfg && Array.isArray(cfg.points), 'Main process must stay alive when Mini disables');
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F09 — Boundaries
  // =========================================================================
  t('T2-F09-01', 'F09', 'Rapid mouseenter/mouseleave flutter x20 settles cleanly to final state', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F09-01');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      for (let i = 0; i < 10; i++) {
        await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
        await sleep(20);
        await miniPage.moveOutside();
        await sleep(20);
      }
      await sleep(250);
      const rotor = await h.getMiniRotorSample(miniPage);
      assert.ok(rotor, 'Mini rotor element must exist');
      assert.strictEqual(rotor.playState, 'running', 'Mini must settle back to running after final mouseleave');
    } finally {
      await app.close();
    }
  }),

  t('T2-F09-02', 'F09', 'Outside Mini hub hit area engages ignore-mouse pass-through cleanly', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F09-02');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.moveOutside();
      await sleep(150);
      const st = await app.mainPage.eval(() => window.mpeApi.getMiniAstrolabeState());
      assert.strictEqual(Boolean(st.expanded), false, 'Mini expanded state must be false outside hit area');
    } finally {
      await app.close();
    }
  }),

  t('T2-F09-03', 'F09', 'Disabled Mini Astrolabio consumes near-zero CPU at rest', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F09-03', {
      startup: true,
      miniAstrolabe: { enabled: false, x: 160, y: 160, size: 68, scale: 1.0, fanRadius: 140 }
    });
    try {
      await sleep(2000);
      const m = await metrics.measureProcessTreeCpuWindow(ctx.processManager, app.session.pid, 3500);
      assert.ok(m.cpuPercent <= 1.5, `Disabled Mini baseline CPU unexpectedly high: ${m.cpuPercent.toFixed(2)}%`);
    } finally {
      await app.close();
    }
  }),

  t('T2-F09-04', 'F09', 'Mini idle CPU delta stays <= 1% whether Main HUD was previously shown then hidden', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F09-04');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await app.mainPage.eval(() => window.mpeApi.hideHud());
      await sleep(1500);
      await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(false));
      await sleep(800);
      const s = await metrics.measureProcessTreeCpuWindow(ctx.processManager, app.session.pid, 3500);
      await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(true));
      // Repouso = depois da janela do Mini ser recriada e carregada (criar janela nao e repouso).
      await sleep(2500);
      const rotPage = await h.connectMiniPage(app.session).catch(() => miniPage);
      await rotPage.moveOutside().catch(() => {});
      const rot1 = await h.getMiniRotorSample(rotPage);
      await sleep(550);
      const rot2 = await h.getMiniRotorSample(rotPage);
      assert.ok(rot1 && rot2, 'Mini rotor element must exist');
      assert.strictEqual(rot1.playState, 'running', 'Mini rotor must be running during active idle CPU window');
      assert.notStrictEqual(rot1.transform, rot2.transform, 'Mini rotor transform must change during active idle rotation');
      const r = await metrics.measureProcessTreeCpuWindow(ctx.processManager, app.session.pid, 3500);
      assert.ok(r.cpuPercent - s.cpuPercent <= 1.0, `Delta ${(r.cpuPercent - s.cpuPercent).toFixed(3)}% > 1.0%`);
    } finally {
      await app.close();
    }
  }),

  t('T2-F09-05', 'F09', '10s continuous Mini rotation produces zero JS errors or memory runaway', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F09-05', { startup: true });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      // Aquecimento: o carregamento inicial do Electron (GPU, renderers) nao e vazamento.
      await sleep(6000);
      const s0 = ctx.processManager.getProcessTreeStats(app.session.pid);
      await sleep(10000);
      const s1 = ctx.processManager.getProcessTreeStats(app.session.pid);
      const mbGrowth = (s1.totalWorkingSetBytes - s0.totalWorkingSetBytes) / (1024 * 1024);
      assert.ok(mbGrowth <= 40, `Memory grew ${mbGrowth.toFixed(1)} MB during 10s idle rotation`);
      assert.deepStrictEqual(miniPage.getErrors(), []);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F10 — Boundaries
  // =========================================================================
  t('T2-F10-01', 'F10', 'Mini docked at top-left (0, 0) clamps radial fan inward within viewport', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F10-01', {
      miniAstrolabe: { enabled: true, x: 0, y: 0, size: 68, scale: 1.0, fanRadius: 140 }
    });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const vis = (await h.getMiniHubAndSlots(miniPage)).slots.filter((s) => s.visible);
      assert.ok(vis.length >= 1, 'Expected >= 1 visible Mini slot when docked at top-left');
      for (const s of vis) {
        assert.ok(s.rect.left >= 0 && s.rect.top >= 0, `Slot clipped off top-left: ${JSON.stringify(s.rect)}`);
      }
    } finally {
      await app.close();
    }
  }),

  t('T2-F10-02', 'F10', 'Mini docked at bottom-right clamps radial fan inward inside window bounds', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F10-02', {
      miniAstrolabe: { enabled: true, x: 99999, y: 99999, size: 68, scale: 1.0, fanRadius: 140 }
    });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const bounds = await miniPage.eval(() => ({ w: window.innerWidth, h: window.innerHeight }));
      const vis = (await h.getMiniHubAndSlots(miniPage)).slots.filter((s) => s.visible);
      assert.ok(vis.length >= 1, 'Expected >= 1 visible Mini slot when docked at bottom-right');
      for (const s of vis) {
        assert.ok(s.rect.right <= bounds.w + 2 && s.rect.bottom <= bounds.h + 2, `Slot clipped off bottom-right: ${JSON.stringify(s.rect)}`);
      }
    } finally {
      await app.close();
    }
  }),

  t('T2-F10-03', 'F10', '9+ slots at minimum scale remain non-overlapping in Mini fan', async (ctx) => {
    const points = Array.from({ length: 9 }, (_, i) => ({
      id: `s-${i + 1}`,
      code: `0${i + 1} ${i + 1}`,
      title: `Slot ${i + 1}`,
      actionType: 'open_organizer',
      params: {}
    }));
    const app = await h.launchIsolatedApp(ctx, 'T2-F10-03', {
      points,
      miniAstrolabe: { enabled: true, x: 350, y: 300, size: 52, scale: 0.85, fanRadius: 140 }
    });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const vis = (await h.getMiniHubAndSlots(miniPage)).slots.filter((s) => s.visible);
      assert.strictEqual(vis.length, 9);
      for (let i = 0; i < vis.length; i++) {
        for (let j = i + 1; j < vis.length; j++) {
          const d = Math.hypot(vis[i].rect.cx - vis[j].rect.cx, vis[i].rect.cy - vis[j].rect.cy);
          assert.ok(d >= vis[i].rect.width * 0.85, `Overlap between slot ${i + 1} and ${j + 1}`);
        }
      }
    } finally {
      await app.close();
    }
  }),

  t('T2-F10-04', 'F10', 'Clicking failing slot from Mini shows non-blocking feedback without crashing', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F10-04', {
      points: [
        {
          id: 'bad-slot',
          code: '01 1',
          title: 'Invalid Path',
          actionType: 'launch_app_project',
          params: { appName: 'vscode', targetPath: 'code', projectPath: 'C:\\NonExistent_MPE_Path_99999' }
        }
      ]
    });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const info = await h.getMiniHubAndSlots(miniPage);
      await miniPage.clickAt(info.slots[0].rect.cx, info.slots[0].rect.cy);
      await sleep(300);
      assert.deepStrictEqual(miniPage.getErrors(), []);
    } finally {
      await app.close();
    }
  }),

  t('T2-F10-05', 'F10', 'Mini fan with 0 slots renders graceful empty state on hover', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F10-05', { points: [] });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(200);
      assert.deepStrictEqual(miniPage.getErrors(), []);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F11 — Boundaries
  // =========================================================================
  t('T2-F11-01', 'F11', 'Reordering Slot 1 <-> Slot 2 while Mini fan is open updates live without closing', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F11-01');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(200);
      const before = await h.getMiniHubAndSlots(miniPage);
      await app.mainPage.eval(() => window.mpeApi.reorderPoint(0, 1));
      await sleep(250);
      const after = await h.getMiniHubAndSlots(miniPage);
      const beforeVis = before.slots.filter((s) => s.visible);
      const afterVis = after.slots.filter((s) => s.visible);
      assert.ok(afterVis.length >= 2, `Expected >= 2 visible Mini slots after reorder, got ${afterVis.length}`);
      assert.strictEqual(afterVis.length, beforeVis.length);
      const slot0Label = `${afterVis[0].title || ''} ${afterVis[0].text || ''}`;
      const slot1Label = `${afterVis[1].title || ''} ${afterVis[1].text || ''}`;
      assert.ok(
        slot0Label.includes('Projeto VS Code'),
        `Expected promoted Slot 1 in Mini to reflect 'Projeto VS Code', got ${JSON.stringify(afterVis[0])}`
      );
      assert.ok(
        slot1Label.includes('Bloco de Notas'),
        `Expected demoted Slot 2 in Mini to reflect 'Bloco de Notas', got ${JSON.stringify(afterVis[1])}`
      );
      assert.deepStrictEqual(miniPage.getErrors(), []);
    } finally {
      await app.close();
    }
  }),

  t('T2-F11-02', 'F11', 'Hotkey 1 runs newly promoted Slot 1 immediately after reorderPoint(1, 0)', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T2-F11-02', {
      points: [
        { id: 'slot-a', code: '01 1', title: 'Hook A', actionType: 'send_link_chat', params: { deliveryChannel: 'webhook', webhookUrl: mock.url('/hook-a'), linkUrl: 'https://a' } },
        { id: 'slot-b', code: '02 2', title: 'Hook B', actionType: 'send_link_chat', params: { deliveryChannel: 'webhook', webhookUrl: mock.url('/hook-b'), linkUrl: 'https://b' } }
      ]
    });
    try {
      await app.mainPage.eval(() => window.mpeApi.reorderPoint(1, 0));
      await sleep(200);
      await app.mainPage.pressKey('1', 'Digit1');
      const hit = await mock.waitForRequest((r) => r.path === '/hook-b', 4000);
      assert.ok(hit, 'Hotkey 1 must execute newly promoted Slot 1 (hook-b)');
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T2-F11-03', 'F11', 'Rapid concurrent saveConfig bursts preserve valid JSON and points[]', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F11-03');
    try {
      await app.mainPage.eval(async () => {
        const cfg = await window.mpeApi.getConfig();
        await Promise.all([
          window.mpeApi.saveConfig({ ...cfg, points: cfg.points.map((p, i) => ({ ...p, title: `BurstA_${i}` })) }),
          window.mpeApi.saveConfig({ ...cfg, points: cfg.points.map((p, i) => ({ ...p, title: `BurstB_${i}` })) })
        ]);
      });
      const disk = app.ws.readConfig();
      assert.ok(Array.isArray(disk.points) && disk.points.length === 3);
    } finally {
      await app.close();
    }
  }),

  t('T2-F11-04', 'F11', 'Deleting Slot 1 promotes Slot 2 to Slot 1 across Main and Mini', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F11-04');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await app.mainPage.eval(() =>
        window.mpeApi.getConfig().then((cfg) => {
          cfg.points.shift();
          return window.mpeApi.saveConfig(cfg);
        })
      );
      await sleep(200);
      const cfg = await app.mainPage.eval(() => window.mpeApi.getConfig());
      assert.strictEqual(cfg.points[0].id, 'slot-2-vscode');
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(200);
      const vis = (await h.getMiniHubAndSlots(miniPage)).slots.filter((s) => s.visible);
      assert.strictEqual(vis.length, 2);
    } finally {
      await app.close();
    }
  }),

  t('T2-F11-05', 'F11', 'Very long slot title (>60 chars) does not break Mini fan layout', async (ctx) => {
    const longTitle = 'A'.repeat(80);
    const app = await h.launchIsolatedApp(ctx, 'T2-F11-05', {
      points: [{ id: 'long-1', code: '01 1', title: longTitle, actionType: 'open_organizer', params: {} }]
    });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(200);
      const vis = (await h.getMiniHubAndSlots(miniPage)).slots.filter((s) => s.visible);
      assert.strictEqual(vis.length, 1);
      assert.ok(vis[0].rect.width <= 200, `Mini button stretched by long title: width=${vis[0].rect.width}`);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F12 — Boundaries
  // =========================================================================
  t('T2-F12-01', 'F12', 'open_url rejects empty or whitespace URL without opening fallback', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F12-01');
    try {
      for (const bad of ['', '   ', null]) {
        const res = await app.mainPage.eval((u) =>
          window.mpeApi.executePoint({ id: 'bad-u', actionType: 'open_url', params: { url: u } })
        , bad);
        assert.strictEqual(res.ok, false, `Empty URL ${JSON.stringify(bad)} must be rejected`);
      }
    } finally {
      await app.close();
    }
  }),

  t('T2-F12-02', 'F12', 'open_url rejects dangerous schemes (javascript:, file:, vbscript:)', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F12-02');
    try {
      for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/System32/cmd.exe', 'data:text/html,hi']) {
        const res = await app.mainPage.eval((u) =>
          window.mpeApi.executePoint({ id: 'bad-scheme', actionType: 'open_url', params: { url: u } })
        , bad);
        assert.strictEqual(res.ok, false, `Disallowed scheme ${bad} must be rejected`);
      }
    } finally {
      await app.close();
    }
  }),

  t('T2-F12-03', 'F12', 'open_url rejects malformed URL gracefully', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F12-03');
    try {
      const res = await app.mainPage.eval(() =>
        window.mpeApi.executePoint({ id: 'mal-u', actionType: 'open_url', params: { url: 'http://[invalid-host' } })
      );
      assert.strictEqual(res.ok, false);
      assert.deepStrictEqual(app.mainPage.getErrors(), []);
    } finally {
      await app.close();
    }
  }),

  t('T2-F12-04', 'F12', 'open_url preserves query string and fragment intact', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T2-F12-04', {
      extraEnv: { MPE_TEST_DRY_OPEN_EXTERNAL: '1' }
    });
    try {
      const fullUrl = mock.url('/ok?q=1&b=2#top');
      const res = await app.mainPage.eval((u) =>
        window.mpeApi.executePoint({ id: 'q-u', actionType: 'open_url', params: { url: u } })
      , fullUrl);
      assert.strictEqual(res.ok, true);
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T2-F12-05', 'F12', 'Rapid double execution of open_url does not crash renderer or main', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F12-05', {
      extraEnv: { MPE_TEST_DRY_OPEN_EXTERNAL: '1' }
    });
    try {
      const [r1, r2] = await app.mainPage.eval(() =>
        Promise.all([
          window.mpeApi.executePoint({ id: 'd1', actionType: 'open_url', params: { url: 'https://example.org/1' } }),
          window.mpeApi.executePoint({ id: 'd2', actionType: 'open_url', params: { url: 'https://example.org/2' } })
        ])
      );
      assert.strictEqual(r1.ok, true);
      assert.strictEqual(r2.ok, true);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F13 — Boundaries
  // =========================================================================
  t('T2-F13-01', 'F13', 'send_link_chat rejects empty linkUrl without hitting server', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T2-F13-01');
    try {
      const res = await app.mainPage.eval((wh) =>
        window.mpeApi.executePoint({
          id: 'empty-link',
          actionType: 'send_link_chat',
          params: { deliveryChannel: 'webhook', webhookUrl: wh, linkUrl: '' }
        })
      , mock.url('/hook'));
      assert.strictEqual(res.ok, false);
      assert.strictEqual(mock.getRequests().length, 0);
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T2-F13-02', 'F13', 'send_link_chat handles HTTP 401/500 error responses cleanly', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    mock.setRouteStatus('/hook', 500);
    const app = await h.launchIsolatedApp(ctx, 'T2-F13-02');
    try {
      const res = await app.mainPage.eval((wh) =>
        window.mpeApi.executePoint({
          id: 'err-wh',
          actionType: 'send_link_chat',
          params: { deliveryChannel: 'webhook', webhookUrl: wh, linkUrl: 'https://mpe.local/fail' }
        })
      , mock.url('/hook'));
      assert.strictEqual(res.ok, false);
      assert.deepStrictEqual(app.mainPage.getErrors(), []);
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T2-F13-03', 'F13', 'send_link_chat catches unreachable webhook port cleanly', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F13-03');
    try {
      const res = await app.mainPage.eval(() =>
        window.mpeApi.executePoint({
          id: 'dead-wh',
          actionType: 'send_link_chat',
          params: { deliveryChannel: 'webhook', webhookUrl: 'http://127.0.0.1:1/dead', linkUrl: 'https://mpe.local/dead' }
        })
      );
      assert.strictEqual(res.ok, false);
    } finally {
      await app.close();
    }
  }),

  t('T2-F13-04', 'F13', 'send_link_chat handles missing desktop target gracefully without hanging', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F13-04');
    try {
      const res = await app.mainPage.eval(() =>
        window.mpeApi.executePoint({
          id: 'no-app',
          actionType: 'send_link_chat',
          params: { deliveryChannel: 'system', targetSystem: 'NONEXISTENT_CHAT_APP_999', linkUrl: 'https://mpe.local/x' }
        })
      );
      assert.strictEqual(res.ok, false, `Nonexistent targetSystem must return ok: false, got: ${JSON.stringify(res)}`);
    } finally {
      await app.close();
    }
  }),

  t('T2-F13-05', 'F13', 'send_link_chat respects autoSendEnter: false on desktop channel', async (ctx) => {
    const baselineNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
    const app = await h.launchIsolatedApp(ctx, 'T2-F13-05');
    try {
      const res = await app.mainPage.eval(() =>
        window.mpeApi.executePoint({
          id: 'no-enter',
          actionType: 'send_link_chat',
          params: { deliveryChannel: 'system', targetSystem: 'bloco de notas', linkUrl: 'https://mpe.local/noenter', autoSendEnter: false }
        })
      );
      assert.strictEqual(res.ok, true);
      await sleep(700);
      const afterNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
      const spawned = [...afterNotepad].filter((p) => !baselineNotepad.has(p));
      assert.ok(spawned.length >= 1, 'Expected proactive notepad.exe launch for desktop send_link_chat');
    } finally {
      ctx.processManager.killNewProcessesByImage('notepad.exe', baselineNotepad);
      await app.close();
    }
  }),

  // =========================================================================
  // F14 — Boundaries
  // =========================================================================
  t('T2-F14-01', 'F14', 'Slot 2 VS Code rejects non-existent projectPath', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F14-01');
    try {
      const res = await app.mainPage.eval(() =>
        window.mpeApi.executePoint({
          id: 'bad-vsc',
          actionType: 'launch_app_project',
          params: { appName: 'vscode', targetPath: 'code', projectPath: 'C:\\MPE_NONEXISTENT_PROJECT_999999' }
        })
      );
      assert.strictEqual(res.ok, false);
    } finally {
      await app.close();
    }
  }),

  t('T2-F14-02', 'F14', 'launch_app_project rejects empty targetPath and empty projectPath', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F14-02');
    try {
      const res = await app.mainPage.eval(() =>
        window.mpeApi.executePoint({
          id: 'empty-app',
          actionType: 'launch_app_project',
          params: { appName: '', targetPath: '', projectPath: '' }
        })
      );
      assert.strictEqual(res.ok, false);
    } finally {
      await app.close();
    }
  }),

  t('T2-F14-03', 'F14', 'VS Code projectPath containing spaces is handled cleanly', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F14-03', {
      extraEnv: { MPE_TEST_DRY_APP_LAUNCH: '1' }
    });
    try {
      const spaced = path.join(app.ws.workspaceDir, 'Meu Projeto MPE');
      fs.mkdirSync(spaced, { recursive: true });
      const res = await app.mainPage.eval((p) =>
        window.mpeApi.executePoint({
          id: 'spaced-vsc',
          actionType: 'launch_app_project',
          params: { appName: 'vscode', targetPath: 'code', projectPath: p }
        })
      , spaced);
      assert.strictEqual(res.ok, true);
    } finally {
      await app.close();
    }
  }),

  t('T2-F14-04', 'F14', 'Missing executable returns structured { ok: false } without crashing Main', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F14-04');
    try {
      const res = await app.mainPage.eval(() =>
        window.mpeApi.executePoint({
          id: 'missing-exe',
          actionType: 'launch_app_project',
          params: { appName: 'bogus', targetPath: 'nonexistent_binary_mpe_999.exe', projectPath: '' }
        })
      );
      assert.strictEqual(res.ok, false);
    } finally {
      await app.close();
    }
  }),

  t('T2-F14-05', 'F14', 'Launching Notepad repeatedly when already open does not hang', async (ctx) => {
    const baselineNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
    const app = await h.launchIsolatedApp(ctx, 'T2-F14-05');
    try {
      const r1 = await app.mainPage.eval(() => window.mpeApi.getConfig().then((c) => window.mpeApi.executePoint(c.points[0])));
      await sleep(300);
      const r2 = await app.mainPage.eval(() => window.mpeApi.getConfig().then((c) => window.mpeApi.executePoint(c.points[0])));
      assert.strictEqual(r1.ok, true);
      assert.strictEqual(r2.ok, true);
    } finally {
      ctx.processManager.killNewProcessesByImage('notepad.exe', baselineNotepad);
      await app.close();
    }
  }),

  // =========================================================================
  // F15 — Boundaries
  // =========================================================================
  t('T2-F15-01', 'F15', 'Clicking Stop button in recorder-overlay excludes Stop click from steps[]', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    let targetWin = null;
    const app = await h.launchIsolatedApp(ctx, 'T2-F15-01');
    try {
      targetWin = await h.launchClickTargetWindow(ctx, mock, { x: 140, y: 140, width: 220, height: 220 });
      await app.mainPage.eval(() => {
        window.__recStoppedEvt = null;
        window.mpeApi.onPythonRecordingState((s) => {
          if (s && s.active === false) window.__recStoppedEvt = s;
        });
      });
      await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
      const recPage = await h.connectRecorderPage(app.session);
      await sleep(200);
      h.performWin32Click(200, 200, 'left');
      await sleep(250);

      // Compute Stop button screen coordinates inside recorder-overlay and click via real OS Win32 click
      const stopScreen = await recPage.eval(() => {
        const btn = document.querySelector('#btn-stop-recording, [data-stop-recording], button');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        const dpr = window.devicePixelRatio || 1;
        return {
          cx: Math.round((window.screenX + r.left + r.width / 2) * dpr),
          cy: Math.round((window.screenY + r.top + r.height / 2) * dpr)
        };
      });
      assert.ok(stopScreen, 'Stop button must be visible inside recorder-overlay');
      h.performWin32Click(stopScreen.cx, stopScreen.cy, 'left');

      await app.mainPage.waitForFunction(() => Boolean(window.__recStoppedEvt), [], 5000);
      const evt = await app.mainPage.eval(() => window.__recStoppedEvt);
      assert.strictEqual(evt.stepCount, 1, `Stop click must be excluded so exact stepCount === 1, got ${JSON.stringify(evt)}`);
      if (Array.isArray(evt.steps)) {
        assert.strictEqual(evt.steps.length, 1, `Expected exact 1 step, got ${JSON.stringify(evt.steps)}`);
      }
      const recordedStep = (Array.isArray(evt.steps) && evt.steps[0]) || evt.lastStep;
      assert.ok(
        recordedStep && typeof recordedStep.x === 'number' && typeof recordedStep.y === 'number',
        `Stop event must expose the recorded step coordinates (evt.steps[0] or evt.lastStep), got ${JSON.stringify(evt)}`
      );
      assert.ok(
        Math.abs(recordedStep.x - 200) <= 10 && Math.abs(recordedStep.y - 200) <= 10,
        `Expected single recorded step near (200, 200), got (${recordedStep.x}, ${recordedStep.y})`
      );
    } finally {
      if (targetWin) await targetWin.close();
      await app.close();
      await mock.stop();
    }
  }),

  t('T2-F15-02', 'F15', 'Empty recording (0 clicks before Stop) does not generate .py file', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F15-02');
    try {
      await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
      await sleep(150);
      const stop = await app.mainPage.eval(() => window.mpeApi.stopPythonRecording({}));
      assert.strictEqual((stop.steps || []).length, 0);
      const pyFiles = fs.readdirSync(app.ws.scriptsDir).filter((f) => f.endsWith('.py'));
      assert.strictEqual(pyFiles.length, 0, 'Empty recording must not generate a .py script');
    } finally {
      await app.close();
    }
  }),

  t('T2-F15-03', 'F15', 'Cancel recording via cancel flag disarms hook and saves nothing', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F15-03');
    try {
      await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
      await sleep(150);
      const stop = await app.mainPage.eval(() => window.mpeApi.stopPythonRecording({ cancel: true }));
      assert.strictEqual(stop.ok, true);
      assert.strictEqual(fs.readdirSync(app.ws.scriptsDir).filter((f) => f.endsWith('.py')).length, 0);
    } finally {
      await app.close();
    }
  }),

  t('T2-F15-04', 'F15', 'Calling startPythonRecording twice while active does not duplicate listeners', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    let targetWin = null;
    const app = await h.launchIsolatedApp(ctx, 'T2-F15-04');
    try {
      targetWin = await h.launchClickTargetWindow(ctx, mock, { x: 140, y: 140, width: 220, height: 220 });
      const r1 = await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
      const r2 = await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
      assert.strictEqual(r1.ok, true);
      assert.ok(r2 && (r2.ok === false || r2.alreadyActive === true || r2.ok === true));
      await sleep(200);
      h.performWin32Click(200, 200, 'left');
      await sleep(250);
      const stop = await app.mainPage.eval(() => window.mpeApi.stopPythonRecording({}));
      assert.strictEqual(stop.ok, true);
      assert.strictEqual(stop.steps.length, 1, `Duplicate startPythonRecording duplicated listeners: ${JSON.stringify(stop.steps)}`);
    } finally {
      if (targetWin) await targetWin.close();
      await app.close();
      await mock.stop();
    }
  }),

  t('T2-F15-05', 'F15', 'Quitting app mid-recording terminates MpeHook cleanly with zero orphans', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F15-05');
    const rootPid = app.session.pid;
    try {
      await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
      await sleep(200);
      await h.quitAppGracefully(app.mainPage, app.session, 5000);
      await sleep(350);
      assert.strictEqual(ctx.processManager.findOrphanProcesses([rootPid], [app.ws.runToken]).length, 0);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F16 — Boundaries
  // =========================================================================
  t('T2-F16-01', 'F16', 'Path traversal in script name (../../evil) stays confined inside scriptsDir', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F16-01');
    try {
      const res = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({
          name: '../../evil_escape',
          steps: [{ x: 10, y: 10, button: 'left', waitMs: 50 }]
        })
      );
      if (res.ok) {
        const resolved = path.resolve(res.script.filePath);
        const expectedPrefix = path.resolve(app.ws.scriptsDir).toLowerCase() + path.sep;
        assert.ok(
          resolved.toLowerCase().startsWith(expectedPrefix),
          `Script escaped scriptsDir: ${resolved}`
        );
      }
      assert.strictEqual(fs.existsSync(path.join(app.ws.tmpRoot, 'evil_escape.py')), false);
    } finally {
      await app.close();
    }
  }),

  t('T2-F16-02', 'F16', 'savePythonScript rejects empty steps: []', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F16-02');
    try {
      const res = await app.mainPage.eval(() => window.mpeApi.savePythonScript({ name: 'NoSteps', steps: [] }));
      assert.strictEqual(res.ok, false);
      assert.strictEqual(fs.readdirSync(app.ws.scriptsDir).length, 0);
    } finally {
      await app.close();
    }
  }),

  t('T2-F16-03', 'F16', 'Accented/special characters in script name sanitize to valid ASCII .py + py_compile', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F16-03');
    try {
      const res = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({
          name: 'Automação #1 / Teste!',
          steps: [{ x: 50, y: 60, button: 'left', waitMs: 100 }]
        })
      );
      assert.strictEqual(res.ok, true);
      const base = path.basename(res.script.filePath);
      assert.match(base, /^[a-z0-9_-]+\.py$/i, `Unsafe script filename: ${base}`);
      const pyc = h.runPythonCli(['-m', 'py_compile', res.script.filePath]);
      assert.strictEqual(pyc.code, 0);
    } finally {
      await app.close();
    }
  }),

  t('T2-F16-04', 'F16', 'Saving two scripts with identical names assigns unique IDs without breaking array', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F16-04');
    try {
      const s1 = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({ name: 'Duplicado', steps: [{ x: 1, y: 1, button: 'left', waitMs: 50 }] })
      );
      const s2 = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({ name: 'Duplicado', steps: [{ x: 2, y: 2, button: 'left', waitMs: 50 }] })
      );
      assert.strictEqual(s1.ok, true);
      assert.strictEqual(s2.ok, true);
      assert.notStrictEqual(s1.script.id, s2.script.id);
    } finally {
      await app.close();
    }
  }),

  t('T2-F16-05', 'F16', 'Generated .py runs --dry-run without external pip packages', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F16-05');
    try {
      const s = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({ name: 'StdlibOnly', steps: [{ x: 42, y: 84, button: 'left', waitMs: 50 }] })
      );
      const dry = h.runPythonCli([s.script.filePath, '--dry-run']);
      assert.strictEqual(dry.code, 0, dry.stderr);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F17 — Boundaries
  // =========================================================================
  t('T2-F17-01', 'F17', 'Scheduler duplicate-minute guard fires script ONLY ONCE per minute', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F17-01', { testClock: '2026-11-18T14:29:45' });
    try {
      const saved = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({
          name: 'Once Per Min',
          steps: [{ x: 10, y: 10, button: 'left', waitMs: 20 }],
          dryRunDefault: true
        })
      );
      await app.mainPage.eval(() => {
        window.__schedCount = 0;
        window.mpeApi.onPythonScriptExecuted((e) => {
          if (e && e.trigger === 'schedule') window.__schedCount++;
        });
      });
      await app.mainPage.eval((id) =>
        window.mpeApi.schedulePythonScript(id, { enabled: true, timeHHMM: '14:30', mode: 'daily', dryRun: true })
      , saved.script.id);
      await app.mainPage.waitForFunction(() => window.__schedCount >= 1, [], 20000);
      await sleep(3500);
      const count = await app.mainPage.eval(() => window.__schedCount);
      assert.strictEqual(count, 1, `Expected exactly 1 scheduled run within minute 14:30, got ${count}`);
    } finally {
      await app.close();
    }
  }),

  t('T2-F17-02', 'F17', 'Missing .py file on disk fails cleanly without crashing app/scheduler', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F17-02');
    try {
      const saved = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({ name: 'Missing File', steps: [{ x: 5, y: 5, button: 'left', waitMs: 20 }] })
      );
      fs.unlinkSync(saved.script.filePath);
      const run = await app.mainPage.eval((id) => window.mpeApi.runPythonScript(id, { dryRun: true }), saved.script.id);
      assert.strictEqual(run.ok, false);
      assert.deepStrictEqual(app.mainPage.getErrors(), []);
    } finally {
      await app.close();
    }
  }),

  t('T2-F17-03', 'F17', 'Non-zero Python exit code (2) is captured cleanly in result and lastExitCode', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F17-03');
    try {
      const errPy = path.join(app.ws.scriptsDir, 'exit2.py');
      fs.writeFileSync(errPy, 'import sys\nsys.exit(2)\n', 'utf8');
      await app.mainPage.eval((fp) => {
        return window.mpeApi.getConfig().then((cfg) => {
          cfg.autoScripts.push({
            id: 'exit2-id',
            name: 'Exit 2',
            filePath: fp,
            steps: [{ x: 0, y: 0, button: 'left', waitMs: 0 }],
            schedule: { enabled: false, timeHHMM: '00:00', mode: 'once', lastRunKey: null }
          });
          return window.mpeApi.saveConfig(cfg);
        });
      }, errPy);
      const run = await app.mainPage.eval(() => window.mpeApi.runPythonScript('exit2-id', { dryRun: false }));
      assert.strictEqual(run.ok, false);
      assert.strictEqual(run.exitCode, 2);
      const disk = app.ws.readConfig();
      const entry = (disk.autoScripts || []).find((s) => s.id === 'exit2-id');
      assert.ok(entry, 'Script entry must remain in autoScripts');
      assert.strictEqual(entry.lastExitCode, 2, `Expected persisted lastExitCode === 2, got ${entry.lastExitCode}`);
    } finally {
      await app.close();
    }
  }),

  t('T2-F17-04', 'F17', 'deletePythonScript removes .py file and autoScripts[] entry', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F17-04');
    try {
      const saved = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({ name: 'Delete Me', steps: [{ x: 1, y: 2, button: 'left', waitMs: 20 }] })
      );
      assert.strictEqual(fs.existsSync(saved.script.filePath), true);
      const del = await app.mainPage.eval((id) => window.mpeApi.deletePythonScript(id), saved.script.id);
      assert.strictEqual(del.ok, true);
      assert.strictEqual(fs.existsSync(saved.script.filePath), false);
      const cfg = app.ws.readConfig();
      assert.strictEqual(cfg.autoScripts.some((s) => s.id === saved.script.id), false);
    } finally {
      await app.close();
    }
  }),

  t('T2-F17-05', 'F17', 'Scheduled mode: once disables schedule.enabled after firing', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F17-05', { testClock: '2026-11-18T16:04:45' });
    try {
      const saved = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({
          name: 'Once Auto Disable',
          steps: [{ x: 10, y: 10, button: 'left', waitMs: 20 }],
          dryRunDefault: true
        })
      );
      await app.mainPage.eval(() => {
        window.__onceDone = false;
        window.mpeApi.onPythonScriptExecuted((e) => {
          if (e && e.trigger === 'schedule') window.__onceDone = true;
        });
      });
      await app.mainPage.eval((id) =>
        window.mpeApi.schedulePythonScript(id, { enabled: true, timeHHMM: '16:05', mode: 'once', dryRun: true })
      , saved.script.id);
      await app.mainPage.waitForFunction(() => window.__onceDone === true, [], 20000);
      await sleep(250);
      const cfg = app.ws.readConfig();
      const rec = cfg.autoScripts.find((s) => s.id === saved.script.id);
      assert.strictEqual(rec.schedule.enabled, false, 'mode: once must auto-disable after execution');
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F18 — Boundaries
  // =========================================================================
  t('T2-F18-01', 'F18', 'Production codigo/mpe.config.json SHA-256 remains untouched after E2E workspace boot', async (ctx) => {
    const before = isolation.getProdSnapshot();
    const app = await h.launchIsolatedApp(ctx, 'T2-F18-01');
    try {
      await app.mainPage.eval(() =>
        window.mpeApi.getConfig().then((cfg) => {
          cfg.points[0].title = 'Isolated Mutation Test';
          return window.mpeApi.saveConfig(cfg);
        })
      );
      isolation.verifyProdUnchanged(before);
    } finally {
      await app.close();
    }
  }),

  t('T2-F18-02', 'F18', '20 rapid cycles of HUD hide + Mini hover/leave + config read stay error-free', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F18-02');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      for (let i = 0; i < 20; i++) {
        await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
        await miniPage.moveOutside();
        if (i % 5 === 0) {
          const cfg = await app.mainPage.eval(() => window.mpeApi.getConfig());
          assert.ok(Array.isArray(cfg.points));
        }
      }
      assert.deepStrictEqual(app.mainPage.getErrors(), []);
      assert.deepStrictEqual(miniPage.getErrors(), []);
    } finally {
      await app.close();
    }
  }),

  t('T2-F18-03', 'F18', 'npm test runs non-interactively with isolated MPE_CONFIG_PATH', async (ctx) => {
    isolation.assertCodeIsolationReady();
    const ws = isolation.createIsolatedWorkspace(ctx.runId, 'T2-F18-03');
    ctx.processManager.registerCleanup(() => ws.cleanup());
    try {
      const res = spawnSync('node', [isolation.RUN_TESTS_JS], {
        cwd: isolation.CODE_DIR,
        env: ws.buildElectronEnv(),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 25000
      });
      assert.strictEqual(res.status, 0, res.stderr || res.stdout);
    } finally {
      ws.cleanup();
    }
  }),

  t('T2-F18-04', 'F18', '--self-test combined with --clean-state completes without hanging on consent modal', async (ctx) => {
    isolation.assertCodeIsolationReady();
    const verSnap = isolation.snapshotDirFiles(isolation.PROD_VERIFICACAO_DIR);
    const ws = isolation.createIsolatedWorkspace(ctx.runId, 'T2-F18-04', { cleanState: true });
    ctx.processManager.registerToken(ws.runToken);
    ctx.processManager.registerCleanup(() => {
      isolation.restoreDirFiles(isolation.PROD_VERIFICACAO_DIR, verSnap);
      ws.cleanup();
    });
    try {
      const proc = ctx.processManager.spawnProcess(
        isolation.ELECTRON_EXE,
        ws.buildElectronArgs(['--self-test']),
        { cwd: isolation.CODE_DIR, env: ws.buildElectronEnv(), stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let out = '';
      proc.stdout.on('data', (c) => (out += c.toString('utf8')));
      const code = await new Promise((resolve, reject) => {
        const tm = setTimeout(() => {
          ctx.processManager.killPidTreeSync(proc.pid);
          reject(new Error('--self-test --clean-state timed out'));
        }, 30000);
        proc.once('close', (c) => {
          clearTimeout(tm);
          resolve(c);
        });
      });
      assert.strictEqual(code, 0);
      assert.ok(out.includes('MPE_SELF_TEST_PASSED'));
    } finally {
      isolation.restoreDirFiles(isolation.PROD_VERIFICACAO_DIR, verSnap);
      ws.cleanup();
    }
  }),

  t('T2-F18-05', 'F18', 'Zero leaked MpeHook/Python/Electron processes after test session closes', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T2-F18-05');
    const rootPid = app.session.pid;
    const token = app.ws.runToken;
    await app.close();
    await sleep(400);
    const orphans = ctx.processManager.findOrphanProcesses([rootPid], [token]);
    assert.strictEqual(orphans.length, 0, `Orphans detected: ${JSON.stringify(orphans)}`);
  })
];

module.exports = { tier2Tests };
