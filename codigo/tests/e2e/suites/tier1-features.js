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
  return { id, tier: 1, feature, name, fn };
}

const tier1Tests = [
  // =========================================================================
  // F01 — Core Stability, Lock Guard & Clean Shutdown
  // =========================================================================
  t('T1-F01-01', 'F01', 'Primary launch and CDP mainWindow ready', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F01-01');
    try {
      const apiOk = await app.mainPage.eval(() => Boolean(window.mpeApi && typeof window.mpeApi.getConfig === 'function'));
      assert.strictEqual(apiOk, true, 'window.mpeApi must expose getConfig');
      assert.deepStrictEqual(app.mainPage.getErrors(), [], 'Expected zero page/console errors on startup');
    } finally {
      await app.close();
    }
  }),

  t('T1-F01-02', 'F01', 'Single-instance lock guard exits 2nd instance cleanly', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F01-02');
    try {
      const beforeHooks = ctx.processManager.snapshotPidsByImage('MpeHook.exe');
      const args2 = app.ws.buildElectronArgs(['--launch-ui']);
      const env2 = app.ws.buildElectronEnv();
      const proc2 = ctx.processManager.spawnProcess(isolation.ELECTRON_EXE, args2, {
        env: env2,
        cwd: isolation.CODE_DIR,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const exitCode = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Second instance did not exit within 6s')), 6000);
        proc2.once('close', (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });
      assert.strictEqual(exitCode, 0, 'Second instance must exit with code 0');
      const afterHooks = ctx.processManager.snapshotPidsByImage('MpeHook.exe');
      const newHooks = [...afterHooks].filter((p) => !beforeHooks.has(p));
      assert.strictEqual(newHooks.length, 0, 'Second instance must not spawn duplicate MpeHook.exe');
    } finally {
      await app.close();
    }
  }),

  t('T1-F01-03', 'F01', 'Silent --startup mode hides mainWindow and pauses Astrolabe3D', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F01-03', { startup: true });
    try {
      await sleep(500);
      const state = await app.mainPage.eval(() => ({
        hidden: document.hidden || document.visibilityState === 'hidden',
        hasAstrolabe: Boolean(window.astrolabe),
        astrolabePaused: window.astrolabe ? Boolean(window.astrolabe.isPaused) : null,
        rafId: window.astrolabe ? window.astrolabe.rafId : 'MISSING_ASTROLABE'
      }));
      assert.strictEqual(state.hidden, true, 'Main window must stay hidden under --startup');
      assert.strictEqual(state.hasAstrolabe, true, 'window.astrolabe must be initialized');
      assert.strictEqual(state.astrolabePaused, true, 'Astrolabe3D must be paused under --startup');
      assert.strictEqual(state.rafId, null, 'Astrolabe3D rafId must be null when paused');
    } finally {
      await app.close();
    }
  }),

  t('T1-F01-04', 'F01', 'Clean quit via quitApp() terminates process tree', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F01-04');
    const rootPid = app.session.pid;
    try {
      const exit = await h.quitAppGracefully(app.mainPage, app.session, 6000);
      assert.strictEqual(exit.code, 0, 'quitApp() must terminate Electron with exit code 0');
      await sleep(400);
      const orphans = ctx.processManager.findOrphanProcesses([rootPid], [app.ws.runToken]);
      assert.strictEqual(orphans.length, 0, `Orphan processes remained: ${JSON.stringify(orphans)}`);
    } finally {
      await app.close();
    }
  }),

  t('T1-F01-05', 'F01', 'Repeated listOpenWindows() and getConfig() stay fast without leaking hooks', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F01-05');
    try {
      const beforeHooks = ctx.processManager.snapshotPidsByImage('MpeHook.exe');
      const beforeTreeHooks = ctx.processManager
        .getProcessTreeStats(app.session.pid)
        .processes.filter((p) => p.name.toLowerCase().includes('mpehook'))
        .map((p) => p.pid);
      const t0 = Date.now();
      for (let i = 0; i < 5; i++) {
        const cfg = await app.mainPage.eval(() => window.mpeApi.getConfig());
        assert.ok(cfg && Array.isArray(cfg.points), 'getConfig must return valid config');
        const wins = await app.mainPage.eval(() => window.mpeApi.listOpenWindows());
        assert.ok(Array.isArray(wins), 'listOpenWindows must return array');
      }
      const elapsed = Date.now() - t0;
      assert.ok(elapsed < 6000, `Repeated IPC calls too slow: ${elapsed}ms`);
      const afterHooks = ctx.processManager.snapshotPidsByImage('MpeHook.exe');
      const newHooks = [...afterHooks].filter((p) => !beforeHooks.has(p));
      assert.strictEqual(newHooks.length, 0, `Repeated IPC calls leaked MpeHook.exe processes: ${JSON.stringify(newHooks)}`);
      const afterTreeHooks = ctx.processManager
        .getProcessTreeStats(app.session.pid)
        .processes.filter((p) => p.name.toLowerCase().includes('mpehook'))
        .map((p) => p.pid);
      assert.deepStrictEqual(afterTreeHooks, beforeTreeHooks, 'MpeHook.exe daemon PID must remain constant');
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F02 — Unified Shared Config Schema & Slot Numbering
  // =========================================================================
  t('T1-F02-01', 'F02', 'Clean-state initializes full unified schema', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F02-01', { cleanState: true });
    try {
      const cfg = await app.mainPage.eval(() => window.mpeApi.getConfig());
      assert.ok(cfg && typeof cfg === 'object', 'Config must be an object');
      for (const key of ['consent', 'miniAstrolabe', 'points', 'autoScripts', 'organizer', 'system', 'profile']) {
        assert.ok(key in cfg, `Config missing required key: ${key}`);
      }
      assert.ok(fs.existsSync(app.ws.configPath), 'Isolated mpe.config.json must be written on disk');
    } finally {
      await app.close();
    }
  }),

  t('T1-F02-02', 'F02', 'Clean-state defaults Slot 1 Notepad and Slot 2 VS Code project', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F02-02', { cleanState: true });
    try {
      const cfg = await app.mainPage.eval(() => window.mpeApi.getConfig());
      assert.ok(Array.isArray(cfg.points) && cfg.points.length >= 2, 'Clean config must have >= 2 default points');
      assert.strictEqual(cfg.points[0].actionType, 'launch_app_project');
      assert.match(String(cfg.points[0].params && cfg.points[0].params.appName), /notepad/i);
      assert.strictEqual(cfg.points[1].actionType, 'launch_app_project');
      assert.match(String(cfg.points[1].params && cfg.points[1].params.appName), /vscode|code/i);
    } finally {
      await app.close();
    }
  }),

  t('T1-F02-03', 'F02', 'Atomic saveConfig persists to isolated config and backup without .tmp files', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F02-03');
    try {
      const updatedTitle = 'Slot E2E Atualizado';
      await app.mainPage.eval((title) => {
        return window.mpeApi.getConfig().then((cfg) => {
          cfg.points[0].title = title;
          return window.mpeApi.saveConfig(cfg);
        });
      }, updatedTitle);
      const diskCfg = app.ws.readConfig();
      assert.strictEqual(diskCfg.points[0].title, updatedTitle, 'Isolated config file must contain new title');
      const leftTmp = fs.readdirSync(app.ws.tmpRoot).filter((f) => f.endsWith('.tmp'));
      assert.strictEqual(leftTmp.length, 0, 'No .tmp files should remain after atomic save');
    } finally {
      await app.close();
    }
  }),

  t('T1-F02-04', 'F02', 'Legacy folder path migration and open_organizer auto-ensure', async (ctx) => {
    const legacySeed = {
      profile: { userName: 'Legacy User', isRegistered: true },
      consent: { accepted: true, decidedAt: new Date().toISOString(), version: '1.0', permissions: { backgroundExecution: true, launchAppsAndLinks: true, pythonAutomation: true } },
      telegram: { savedScreenshotsFolder: './Capturas_MPE' },
      captures: { documentsFolder: './documentos' },
      points: [{ id: 'p1', code: '01 1', title: 'Print', actionType: 'print', params: {} }]
    };
    const app = await h.launchIsolatedApp(ctx, 'T1-F02-04', { seedConfig: legacySeed });
    try {
      const cfg = await app.mainPage.eval(() => window.mpeApi.getConfig());
      assert.strictEqual(cfg.telegram.savedScreenshotsFolder, './prints');
      assert.strictEqual(cfg.captures.documentsFolder, './arquivos');
      assert.ok(cfg.points.some((p) => p.actionType === 'open_organizer' || p.actionType === 'organize_files_quick'));
    } finally {
      await app.close();
    }
  }),

  t('T1-F02-05', 'F02', 'Multi-window config broadcast updates both Main and Mini listeners', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F02-05');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await app.mainPage.eval(() => {
        window.__cfgEventMain = null;
        window.mpeApi.onConfigUpdated((payload) => {
          window.__cfgEventMain = payload;
        });
      });
      await miniPage.eval(() => {
        window.__cfgEventMini = null;
        window.mpeApi.onConfigUpdated((payload) => {
          window.__cfgEventMini = payload;
        });
      });

      const marker = `Broadcast_${Date.now()}`;
      await app.mainPage.eval((m) => {
        return window.mpeApi.getConfig().then((cfg) => {
          cfg.points[0].title = m;
          return window.mpeApi.saveConfig(cfg);
        });
      }, marker);

      await app.mainPage.waitForFunction(() => Boolean(window.__cfgEventMain), [], 4000);
      await miniPage.waitForFunction(() => Boolean(window.__cfgEventMini), [], 4000);

      const mainTitle = await app.mainPage.eval(() => {
        const c = window.__cfgEventMain.config || window.__cfgEventMain;
        return c.points[0].title;
      });
      const miniTitle = await miniPage.eval(() => {
        const c = window.__cfgEventMini.config || window.__cfgEventMini;
        return c.points[0].title;
      });
      assert.strictEqual(mainTitle, marker);
      assert.strictEqual(miniTitle, marker);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F03 — First-Access Consent Gate & Persistence
  // =========================================================================
  t('T1-F03-01', 'F03', 'Clean state displays first-access consent prompt on Main HUD', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F03-01', { cleanState: true });
    try {
      const modalVisible = await app.mainPage.waitForFunction(() => {
        const el = document.querySelector('#modal-consent, [data-consent-modal], .consent-modal');
        if (!el) return false;
        const cs = getComputedStyle(el);
        return !el.classList.contains('hidden') && cs.display !== 'none' && cs.visibility !== 'hidden';
      }, [], 5000);
      assert.strictEqual(modalVisible, true, 'Consent modal must be visible on clean state');
    } finally {
      await app.close();
    }
  }),

  t('T1-F03-02', 'F03', 'getConsentStatus() returns unaccepted clean-state structure', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F03-02', { cleanState: true });
    try {
      const st = await app.mainPage.eval(() => window.mpeApi.getConsentStatus());
      assert.strictEqual(st.accepted, false);
      assert.strictEqual(st.decidedAt, null);
      assert.deepStrictEqual(st.permissions, {
        backgroundExecution: false,
        launchAppsAndLinks: false,
        pythonAutomation: false
      });
    } finally {
      await app.close();
    }
  }),

  t('T1-F03-03', 'F03', 'Accepting consent persists decision and closes modal', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F03-03', { cleanState: true });
    try {
      await h.clickConsentDecision(app.mainPage, true);
      await sleep(250);
      const modalVisible = await app.mainPage.eval(() => {
        const el = document.querySelector('#modal-consent, [data-consent-modal], .consent-modal');
        return Boolean(el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none');
      });
      assert.strictEqual(modalVisible, false, 'Consent modal must be hidden after accepting');
      const st = await app.mainPage.eval(() => window.mpeApi.getConsentStatus());
      assert.strictEqual(st.accepted, true);
      assert.ok(st.decidedAt, 'decidedAt timestamp must be populated');
      const disk = app.ws.readConfig();
      assert.strictEqual(disk.consent.accepted, true);
    } finally {
      await app.close();
    }
  }),

  t('T1-F03-04', 'F03', 'Accepted consent persists across app restart', async (ctx) => {
    const ws = isolation.createIsolatedWorkspace(ctx.runId, 'T1-F03-04', { cleanState: true });
    ctx.processManager.registerToken(ws.runToken);
    ctx.processManager.registerCleanup(() => ws.cleanup());
    isolation.assertCodeIsolationReady();

    let session1 = null;
    let session2 = null;
    try {
      session1 = await launchElectronWithCdp({
        electronExe: isolation.ELECTRON_EXE,
        args: ws.buildElectronArgs(),
        env: ws.buildElectronEnv(),
        cwd: isolation.CODE_DIR,
        userDataDir: ws.userDataDir,
        processManager: ctx.processManager
      });
      const p1 = await session1.connectTarget('index.html');
      await p1.waitForFunction(() => Boolean(window.mpeApi));
      await h.clickConsentDecision(p1, true);
      await sleep(250);
      await p1.eval(() => window.mpeApi.quitApp()).catch(() => {});
      await session1.waitForExit(5000);
      await session1.close();

      // Second boot WITHOUT --clean-state pointing to same configPath
      session2 = await launchElectronWithCdp({
        electronExe: isolation.ELECTRON_EXE,
        args: [
          isolation.CODE_DIR,
          `--user-data-dir=${ws.userDataDir}`,
          `--config-path=${ws.configPath}`,
          '--remote-debugging-port=0',
          `--mpe-e2e-token=${ws.runToken}`
        ],
        env: { ...ws.buildElectronEnv(), MPE_FORCE_CLEAN_CONSENT: '0' },
        cwd: isolation.CODE_DIR,
        userDataDir: ws.userDataDir,
        processManager: ctx.processManager
      });
      const p2 = await session2.connectTarget('index.html');
      await p2.waitForFunction(() => Boolean(window.mpeApi));
      const st = await p2.eval(() => window.mpeApi.getConsentStatus());
      assert.strictEqual(st.accepted, true, 'Consent must persist after restart');
      const modalVisible = await p2.eval(() => {
        const el = document.querySelector('#modal-consent, [data-consent-modal], .consent-modal');
        return Boolean(el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none');
      });
      assert.strictEqual(modalVisible, false, 'Consent modal must NOT reappear after acceptance');
    } finally {
      if (session1) await session1.close();
      if (session2) await session2.close();
      ws.cleanup();
    }
  }),

  t('T1-F03-05', 'F03', 'onConsentUpdated emits immediately on consent decision', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F03-05', { cleanState: true });
    try {
      await app.mainPage.eval(() => {
        window.__consentEvent = null;
        window.mpeApi.onConsentUpdated((payload) => {
          window.__consentEvent = payload;
        });
      });
      await app.mainPage.eval(() =>
        window.mpeApi.setConsentDecision(true, {
          backgroundExecution: true,
          launchAppsAndLinks: true,
          pythonAutomation: true
        })
      );
      await app.mainPage.waitForFunction(() => Boolean(window.__consentEvent), [], 4000);
      const evt = await app.mainPage.eval(() => window.__consentEvent);
      assert.strictEqual(evt.accepted, true);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F04 — Native Hook Click Recording & App Matching
  // =========================================================================
  t('T1-F04-01', 'F04', 'MpeHook.exe emits MPE_HOOK_READY and exits cleanly on QUIT', async (ctx) => {
    const hook = h.spawnHookDaemon(ctx);
    try {
      const readyLine = await hook.waitForLine(/^MPE_HOOK_READY$/, 3000);
      assert.strictEqual(readyLine, 'MPE_HOOK_READY');
      await hook.quit();
      assert.strictEqual(hook.proc.exitCode, 0, 'MpeHook.exe must exit cleanly with code 0 on QUIT');
    } finally {
      await hook.quit();
    }
  }),

  t('T1-F04-02', 'F04', 'MpeHook.exe RECORD_ON emits REC_CLICK| and RECORD_OFF stops emission', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    let targetWin = null;
    const hook = h.spawnHookDaemon(ctx);
    try {
      await hook.waitForLine(/^MPE_HOOK_READY$/, 3000);
      targetWin = await h.launchClickTargetWindow(ctx, mock, { x: 140, y: 140, width: 220, height: 220 });

      hook.send('RECORD_ON');
      await sleep(150);
      h.performWin32Click(250, 250, 'left');
      const recLine = await hook.waitForLine(/^REC_CLICK\|(L|R|left|right)\|-?\d+\|-?\d+\|\d+$/i, 3000);
      assert.ok(
        recLine.startsWith('REC_CLICK|L|') || recLine.toLowerCase().startsWith('rec_click|left|'),
        `Unexpected REC_CLICK line: ${recLine}`
      );

      hook.send('RECORD_OFF');
      await sleep(150);
      const countAtOff = hook.lines.filter((l) => l.startsWith('REC_CLICK|')).length;
      h.performWin32Click(255, 255, 'left');
      await sleep(250);
      const countAfterOff = hook.lines.filter((l) => l.startsWith('REC_CLICK|')).length;
      assert.strictEqual(countAfterOff, countAtOff, 'Zero REC_CLICK lines may emit after RECORD_OFF');
    } finally {
      await hook.quit();
      if (targetWin) await targetWin.close();
      await mock.stop();
    }
  }),

  t('T1-F04-03', 'F04', 'MpeHook.exe --LIST-WINDOWS and --GET-FOREGROUND return structured output', async () => {
    const lw = h.runHookCli(['--LIST-WINDOWS']);
    assert.strictEqual(lw.code, 0, `--LIST-WINDOWS failed: ${lw.stderr}`);
    const list = JSON.parse(lw.stdout);
    assert.ok(Array.isArray(list) && list.length > 0, '--LIST-WINDOWS must output a non-empty JSON array');
    assert.ok('hwnd' in list[0] && 'process' in list[0] && 'title' in list[0], 'Window item missing hwnd/process/title');

    const fg = h.runHookCli(['--GET-FOREGROUND']);
    assert.strictEqual(fg.code, 0, `--GET-FOREGROUND failed: ${fg.stderr}`);
    assert.match(fg.stdout, /^FOREGROUND\|-?\d+\|-?\d+,-?\d+,-?\d+,-?\d+\|/);
  }),

  t('T1-F04-04', 'F04', 'MpeHook.cs FindSystemWindow includes Code, WhatsApp, Discord matchers', async () => {
    const hookCsPath = path.join(isolation.CODE_DIR, 'src', 'native', 'MpeHook.cs');
    const src = fs.readFileSync(hookCsPath, 'utf8');
    assert.match(src, /whatsapp/i, 'MpeHook.cs must include WhatsApp matcher');
    assert.match(src, /discord/i, 'MpeHook.cs must include Discord matcher');
    assert.match(src, /visual studio code|"code"|code\.exe/i, 'MpeHook.cs must include VS Code matcher');
    const lw = h.runHookCli(['--LIST-WINDOWS']);
    assert.strictEqual(lw.code, 0);
  }),

  t('T1-F04-05', 'F04', 'MpeLauncher.cs respects consent.accepted before auto-enabling startup', async () => {
    const launcherCsPath = path.join(isolation.CODE_DIR, 'src', 'native', 'MpeLauncher.cs');
    const src = fs.readFileSync(launcherCsPath, 'utf8');
    assert.match(src, /consent/i, 'MpeLauncher.cs must inspect consent state before enabling Windows startup');
    assert.strictEqual(fs.existsSync(isolation.MPE_LAUNCHER_EXE), true, 'MPE.exe must exist');
  }),

  // =========================================================================
  // F05 — Centralized Black-Dot Main Interface
  // =========================================================================
  t('T1-F05-01', 'F05', 'Main HUD renders centralized black-dot Astrolabe canvas', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F05-01');
    try {
      const rect = await app.mainPage.getRect('#astrolabe-canvas');
      assert.ok(rect.width >= 300 && rect.height >= 300, 'Astrolabe canvas must fill screen');
      const tokens = await app.mainPage.eval(() => {
        const cs = getComputedStyle(document.documentElement);
        return {
          bgPrimary: cs.getPropertyValue('--bg-primary').trim(),
          goldPrimary: cs.getPropertyValue('--gold-primary').trim()
        };
      });
      assert.ok(tokens.bgPrimary.length > 0 && tokens.goldPrimary.length > 0);
    } finally {
      await app.close();
    }
  }),

  t('T1-F05-02', 'F05', 'Core controls are directly visible and clickable on Main HUD', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F05-02');
    try {
      for (const sel of ['#btn-dock-organizer', '#btn-mode-2d', '#btn-mode-3d']) {
        const r = await app.mainPage.getRect(sel);
        assert.ok(r.width > 0 && r.height > 0, `Control ${sel} must be visible with non-zero size`);
      }
    } finally {
      await app.close();
    }
  }),

  t('T1-F05-03', 'F05', '2D / 3D mode toggle via button click and Tab key', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F05-03');
    try {
      await app.mainPage.click('#btn-mode-2d');
      await app.mainPage.waitForFunction(() => document.getElementById('hud-mode-badge')?.textContent.includes('2D'), [], 3000);
      await app.mainPage.pressKey('Tab', 'Tab');
      await app.mainPage.waitForFunction(() => document.getElementById('hud-mode-badge')?.textContent.includes('3D'), [], 3000);
    } finally {
      await app.close();
    }
  }),

  t('T1-F05-04', 'F05', 'Splash screen unlocks cleanly on click or timeout', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F05-04', { keepSplash: true });
    try {
      await app.mainPage.eval(() => {
        const sp = document.getElementById('splash-screen');
        if (sp) sp.click();
      });
      await app.mainPage.waitForFunction(() => {
        const sp = document.getElementById('splash-screen');
        return !sp || sp.classList.contains('hidden');
      }, [], 4000);
    } finally {
      await app.close();
    }
  }),

  t('T1-F05-05', 'F05', 'Dead Katharos overlay absent and zero page errors', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F05-05');
    try {
      const hasKatharos = await app.mainPage.eval(() => Boolean(document.querySelector('#mini-assistant-overlay, .mini-assistant-overlay')));
      assert.strictEqual(hasKatharos, false, 'Legacy Katharos overlay must not exist in DOM');
      assert.deepStrictEqual(app.mainPage.getErrors(), []);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F06 — 1-Click File Organization Access
  // =========================================================================
  t('T1-F06-01', 'F06', '1-click dock button opens File Organizer workspace', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F06-01');
    try {
      await app.mainPage.click('#btn-dock-organizer');
      await app.mainPage.waitForSelector('#organizer-workspace', 3000);
    } finally {
      await app.close();
    }
  }),

  t('T1-F06-02', 'F06', '1-click back button returns from Organizer to Astrolabe', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F06-02');
    try {
      await app.mainPage.click('#btn-dock-organizer');
      await app.mainPage.waitForSelector('#organizer-workspace', 3000);
      await app.mainPage.click('#btn-org-back-astrolabe');
      await app.mainPage.waitForFunction(() => document.getElementById('organizer-workspace')?.classList.contains('hidden'), [], 3000);
    } finally {
      await app.close();
    }
  }),

  t('T1-F06-03', 'F06', 'orgOrganize categorizes files by type inside isolated scope', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F06-03');
    try {
      const srcDir = path.join(app.ws.workspaceDir, 'inbox');
      fs.mkdirSync(srcDir, { recursive: true });
      const files = ['doc.pdf', 'pic.png', 'note.txt'].map((name) => {
        const p = path.join(srcDir, name);
        fs.writeFileSync(p, `sample ${name}`, 'utf8');
        return p;
      });
      const res = await app.mainPage.eval((paths) => {
        return window.mpeApi.orgOrganize({
          paths,
          criterion: 'type',
          targetScope: 'arquivos',
          moveInsteadOfCopy: false
        });
      }, files);
      assert.strictEqual(res.ok, true, `orgOrganize failed: ${JSON.stringify(res)}`);
      assert.ok(
        path.resolve(res.baseTargetDir).toLowerCase().startsWith(path.resolve(app.ws.tmpRoot).toLowerCase()),
        `FileOrganizer wrote outside isolated tmpRoot: ${res.baseTargetDir}`
      );
      assert.strictEqual(res.results.length, 3);
      for (const item of res.results) {
        assert.ok(fs.existsSync(item.destPath), `Organized destination missing: ${item.destPath}`);
      }
    } finally {
      await app.close();
    }
  }),

  t('T1-F06-04', 'F06', 'orgRevert undoes last move organization batch', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F06-04');
    try {
      const srcFile = path.join(app.ws.workspaceDir, 'revert_me.txt');
      fs.writeFileSync(srcFile, 'undo content', 'utf8');
      const orgRes = await app.mainPage.eval((p) => {
        return window.mpeApi.orgOrganize({
          paths: [p],
          criterion: 'type',
          targetScope: 'arquivos',
          moveInsteadOfCopy: true
        });
      }, srcFile);
      assert.strictEqual(orgRes.ok, true);
      assert.strictEqual(fs.existsSync(srcFile), false, 'Source file should have been moved');

      const revRes = await app.mainPage.eval(() => window.mpeApi.orgRevert());
      assert.strictEqual(revRes.ok, true, `orgRevert failed: ${JSON.stringify(revRes)}`);
      assert.strictEqual(fs.existsSync(srcFile), true, 'Source file must be restored after orgRevert');
    } finally {
      await app.close();
    }
  }),

  t('T1-F06-05', 'F06', 'Organizer search filters organized files by name and content', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F06-05');
    try {
      const hitFile = path.join(app.ws.workspaceDir, 'relatorio_anual.txt');
      const otherFile = path.join(app.ws.workspaceDir, 'outro_documento.txt');
      fs.writeFileSync(hitFile, 'conteudo exclusivo estrela dourada', 'utf8');
      fs.writeFileSync(otherFile, 'apenas texto comum sem correspondencia', 'utf8');
      const org = await app.mainPage.eval((paths) =>
        window.mpeApi.orgOrganize({ paths, criterion: 'type', targetScope: 'arquivos', moveInsteadOfCopy: false })
      , [hitFile, otherFile]);
      assert.strictEqual(org.ok, true);

      await app.mainPage.click('#btn-dock-organizer');
      await app.mainPage.waitForSelector('#organizer-workspace', 3000);

      // 1. Name search filters matching file and excludes non-matching file
      await app.mainPage.type('#org-search-input', 'relatorio_anual');
      await app.mainPage.waitForFunction(() => {
        const list = document.getElementById('org-tree-list');
        if (!list) return false;
        const txt = list.textContent || '';
        return txt.includes('relatorio_anual') && !txt.includes('outro_documento');
      }, [], 4000);

      // 2. Content search ('estrela dourada') matches hitFile and filters out otherFile
      await app.mainPage.type('#org-search-input', 'estrela dourada');
      await app.mainPage.waitForFunction(() => {
        const list = document.getElementById('org-tree-list');
        if (!list) return false;
        const txt = list.textContent || '';
        return (
          Boolean(list.querySelector('.match-content')) &&
          txt.includes('relatorio_anual') &&
          txt.includes('estrela dourada') &&
          !txt.includes('outro_documento')
        );
      }, [], 4000);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F07 — High-Contrast Accessibility & Zero Emojis
  // =========================================================================
  t('T1-F07-01', 'F07', 'Primary slot numbers and labels meet WCAG >= 7.0:1 contrast', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F07-01');
    try {
      const mainAudit = await metrics.auditPageContrast(app.mainPage);
      assert.ok(mainAudit.checkedCount > 0, 'Main HUD contrast audit checked 0 elements');
      const primaryFailures = mainAudit.failures.filter((f) => f.tier === 'primary');
      assert.strictEqual(
        primaryFailures.length,
        0,
        `Primary WCAG >=7:1 failures in Main HUD: ${JSON.stringify(primaryFailures)}`
      );

      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const miniAudit = await metrics.auditPageContrast(miniPage);
      assert.ok(miniAudit.checkedCount > 0, 'Mini contrast audit checked 0 elements');
      const miniPrimaryFailures = miniAudit.failures.filter((f) => f.tier === 'primary');
      assert.strictEqual(
        miniPrimaryFailures.length,
        0,
        `Primary WCAG >=7:1 failures in Mini Astrolabio: ${JSON.stringify(miniPrimaryFailures)}`
      );
    } finally {
      await app.close();
    }
  }),

  t('T1-F07-02', 'F07', 'Secondary labels meet WCAG >= 4.5:1 contrast across Main, Mini, Organizer', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F07-02');
    try {
      const mainAudit = await metrics.auditPageContrast(app.mainPage);
      assert.ok(mainAudit.checkedCount > 0, 'Main HUD contrast audit checked 0 elements');
      assert.strictEqual(
        mainAudit.failures.length,
        0,
        `Contrast failures on Main HUD: ${JSON.stringify(mainAudit.failures)}`
      );

      await app.mainPage.click('#btn-dock-organizer');
      await app.mainPage.waitForSelector('#organizer-workspace', 3000);
      const orgAudit = await metrics.auditPageContrast(app.mainPage);
      assert.ok(orgAudit.checkedCount > 0, 'Organizer contrast audit checked 0 elements');
      assert.strictEqual(
        orgAudit.failures.length,
        0,
        `Contrast failures in Organizer: ${JSON.stringify(orgAudit.failures)}`
      );
    } finally {
      await app.close();
    }
  }),

  t('T1-F07-03', 'F07', 'Slot numbers and primary controls meet older-user font size legibility', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F07-03');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const info = await h.getMiniHubAndSlots(miniPage);
      const visibleSlots = info.slots.filter((s) => s.visible);
      assert.ok(visibleSlots.length >= 2, 'Mini Astrolabio must expose visible slot buttons');
      for (const slot of visibleSlots) {
        assert.ok(slot.fontSize >= 14, `Mini slot fontSize too small for older users: ${slot.fontSize}px`);
        assert.ok(slot.fontWeight >= 600, `Mini slot fontWeight too light: ${slot.fontWeight}`);
      }
    } finally {
      await app.close();
    }
  }),

  t('T1-F07-04', 'F07', 'Static zero-emoji audit across codigo/src, scripts, tests, and config', async () => {
    const scan = metrics.scanDirectoriesForEmojis(
      [
        path.join(isolation.CODE_DIR, 'src'),
        path.join(isolation.CODE_DIR, 'scripts'),
        path.join(isolation.CODE_DIR, 'tests')
      ],
      [isolation.PROD_CONFIG_PATH, path.join(isolation.CODE_DIR, 'package.json')]
    );
    assert.ok(scan.scannedCount >= 10, 'Expected >= 10 files scanned');
    assert.strictEqual(
      scan.violations.length,
      0,
      `Emojis found: ${JSON.stringify(scan.violations.slice(0, 10))}`
    );
  }),

  t('T1-F07-05', 'F07', 'Runtime DOM and log output contain zero emojis', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F07-05');
    try {
      const mainText = await app.mainPage.eval(() => document.body.innerText || '');
      assert.deepStrictEqual(metrics.scanStringForEmojis(mainText, 'mainWindow'), []);

      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(200);
      const miniText = await miniPage.eval(() => document.body.innerText || '');
      assert.deepStrictEqual(metrics.scanStringForEmojis(miniText, 'miniAstrolabeWindow'), []);
      assert.deepStrictEqual(metrics.scanStringForEmojis(app.session.stdout + app.session.stderr, 'stdio'), []);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F08 — Persistent Mini Astrolabio Window, Toggle & Resize
  // =========================================================================
  t('T1-F08-01', 'F08', 'toggleMiniAstrolabe(true) opens persistent Mini window', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F08-01', {
      miniAstrolabe: { enabled: false, x: 160, y: 160, size: 68, scale: 1.0, fanRadius: 140 }
    });
    try {
      const res = await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(true));
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.enabled, true);
      const miniPage = await h.connectMiniPage(app.session);
      const hubInfo = await h.getMiniHubAndSlots(miniPage);
      assert.ok(hubInfo.hubRect && hubInfo.hubRect.width > 0, 'Mini hub must render');
    } finally {
      await app.close();
    }
  }),

  t('T1-F08-02', 'F08', 'toggleMiniAstrolabe(false) hides/disables Mini and emits state change', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F08-02');
    try {
      await app.mainPage.eval(() => {
        window.__miniEvt = null;
        window.mpeApi.onMiniStateChanged((s) => {
          window.__miniEvt = s;
        });
      });
      const res = await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(false));
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.enabled, false);
      await app.mainPage.waitForFunction(() => Boolean(window.__miniEvt), [], 4000);
      const evt = await app.mainPage.eval(() => window.__miniEvt);
      assert.strictEqual(evt.enabled, false, 'onMiniStateChanged must emit enabled: false');
      const st = await app.mainPage.eval(() => window.mpeApi.getMiniAstrolabeState());
      assert.strictEqual(st.enabled, false);
      assert.strictEqual(app.ws.readConfig().miniAstrolabe.enabled, false);
    } finally {
      await app.close();
    }
  }),

  t('T1-F08-03', 'F08', 'Mini Astrolabio stays active when Main HUD hides', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F08-03');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await app.mainPage.eval(() => window.mpeApi.hideHud());
      await sleep(250);
      const miniVisible = await miniPage.eval(() => !document.hidden && document.visibilityState === 'visible');
      assert.strictEqual(miniVisible, true, 'Mini Astrolabio must remain visible when Main HUD hides');
    } finally {
      await app.close();
    }
  }),

  t('T1-F08-04', 'F08', 'Resize Mini Astrolabio up (1.4) and down (0.85) scales hub and persists', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F08-04');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      const base = await h.getMiniHubAndSlots(miniPage);

      await app.mainPage.eval(() => window.mpeApi.updateMiniAstrolabeLayout({ scale: 1.4 }));
      await sleep(200);
      const larger = await h.getMiniHubAndSlots(miniPage);
      assert.ok(larger.hubRect.width > base.hubRect.width, 'Hub width must grow when scale=1.4');

      await app.mainPage.eval(() => window.mpeApi.updateMiniAstrolabeLayout({ scale: 0.85 }));
      await sleep(200);
      const smaller = await h.getMiniHubAndSlots(miniPage);
      assert.ok(smaller.hubRect.width < larger.hubRect.width, 'Hub width must shrink when scale=0.85');
      assert.strictEqual(app.ws.readConfig().miniAstrolabe.scale, 0.85);
    } finally {
      await app.close();
    }
  }),

  t('T1-F08-05', 'F08', 'Reposition Mini Astrolabio persists across restart', async (ctx) => {
    const ws = isolation.createIsolatedWorkspace(ctx.runId, 'T1-F08-05');
    ctx.processManager.registerToken(ws.runToken);
    ctx.processManager.registerCleanup(() => ws.cleanup());
    isolation.assertCodeIsolationReady();

    let s1 = null;
    let s2 = null;
    try {
      s1 = await launchElectronWithCdp({
        electronExe: isolation.ELECTRON_EXE,
        args: ws.buildElectronArgs(),
        env: ws.buildElectronEnv(),
        cwd: isolation.CODE_DIR,
        userDataDir: ws.userDataDir,
        processManager: ctx.processManager
      });
      const p1 = await s1.connectTarget('index.html');
      await p1.waitForFunction(() => Boolean(window.mpeApi));
      await p1.eval(() => window.mpeApi.updateMiniAstrolabeLayout({ x: 310, y: 260 }));
      await sleep(200);
      await p1.eval(() => window.mpeApi.quitApp()).catch(() => {});
      await s1.waitForExit(5000);
      await s1.close();

      s2 = await launchElectronWithCdp({
        electronExe: isolation.ELECTRON_EXE,
        args: ws.buildElectronArgs(),
        env: ws.buildElectronEnv(),
        cwd: isolation.CODE_DIR,
        userDataDir: ws.userDataDir,
        processManager: ctx.processManager
      });
      const p2 = await s2.connectTarget('index.html');
      await p2.waitForFunction(() => Boolean(window.mpeApi));
      const st = await p2.eval(() => window.mpeApi.getMiniAstrolabeState());
      assert.ok(Math.abs(st.x - 310) <= 20 && Math.abs(st.y - 260) <= 20, `Unexpected restored coords: ${JSON.stringify(st)}`);
    } finally {
      if (s1) await s1.close();
      if (s2) await s2.close();
      ws.cleanup();
    }
  }),

  // =========================================================================
  // F09 — Mini Astrolabio Low-CPU Idle Rotation & Hover Pause
  // =========================================================================
  t('T1-F09-01', 'F09', 'Mini Astrolabio rotates continuously at rest', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F09-01');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.moveOutside();
      await sleep(200);
      const sample1 = await h.getMiniRotorSample(miniPage);
      await sleep(600);
      const sample2 = await h.getMiniRotorSample(miniPage);
      assert.ok(sample1 && sample2, 'Mini rotor element must exist');
      assert.strictEqual(sample1.playState, 'running', 'Idle animation must be running');
      assert.notStrictEqual(sample1.transform, sample2.transform, 'Rotor transform must advance over 600ms');
    } finally {
      await app.close();
    }
  }),

  t('T1-F09-02', 'F09', 'Mini Astrolabio pauses rotation immediately on mouseenter', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F09-02');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(150);
      const s1 = await h.getMiniRotorSample(miniPage);
      await sleep(450);
      const s2 = await h.getMiniRotorSample(miniPage);
      assert.ok(s1 && s2, 'Mini rotor element must exist');
      assert.strictEqual(s1.playState, 'paused', 'Rotation must pause immediately on hover');
      assert.strictEqual(s1.transform, s2.transform, 'Rotor transform must remain frozen while hovered');
    } finally {
      await app.close();
    }
  }),

  t('T1-F09-03', 'F09', 'Mini Astrolabio remains paused while cursor moves onto fan slot button', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F09-03');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(200);
      const info = await h.getMiniHubAndSlots(miniPage);
      const firstSlot = info.slots.find((s) => s.visible);
      assert.ok(firstSlot, 'Fan slot must be visible on hover');
      await miniPage.hoverAt(firstSlot.rect.cx, firstSlot.rect.cy);
      await sleep(250);
      const sample = await h.getMiniRotorSample(miniPage);
      assert.ok(sample, 'Mini rotor element must exist');
      assert.strictEqual(sample.playState, 'paused', 'Rotation must stay paused when hovering fan slot');
    } finally {
      await app.close();
    }
  }),

  t('T1-F09-04', 'F09', 'Mini Astrolabio resumes rotation on mouseleave', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F09-04');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(200);
      await miniPage.moveOutside();
      await sleep(250);
      const s1 = await h.getMiniRotorSample(miniPage);
      await sleep(550);
      const s2 = await h.getMiniRotorSample(miniPage);
      assert.ok(s1 && s2, 'Mini rotor element must exist');
      assert.strictEqual(s1.playState, 'running', 'Rotation must resume on mouseleave');
      assert.notStrictEqual(s1.transform, s2.transform, 'Transform must advance after resuming');
    } finally {
      await app.close();
    }
  }),

  t('T1-F09-05', 'F09', 'Mini Astrolabio idle rotation CPU delta <= 1.0% vs static baseline', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F09-05', { startup: true });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await sleep(2500);
      await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(false));
      await sleep(1000);
      const static1 = await metrics.measureProcessTreeCpuWindow(ctx.processManager, app.session.pid, 4000);

      await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(true));
      await sleep(1000);
      const rotPage = await h.connectMiniPage(app.session).catch(() => miniPage);
      await rotPage.moveOutside().catch(() => {});
      const r1 = await h.getMiniRotorSample(rotPage);
      await sleep(550);
      const r2 = await h.getMiniRotorSample(rotPage);
      assert.ok(r1 && r2, 'Mini rotor element must exist during idle CPU test');
      assert.strictEqual(r1.playState, 'running', 'Mini rotor must be actively running during CPU test');
      assert.notStrictEqual(r1.transform, r2.transform, 'Mini rotor transform must change during active idle rotation');

      const idleRot = await metrics.measureProcessTreeCpuWindow(ctx.processManager, app.session.pid, 4000);

      const delta = idleRot.cpuPercent - static1.cpuPercent;
      assert.ok(delta <= 1.0, `Idle rotating CPU delta ${delta.toFixed(3)}% exceeded 1.0% limit`);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F10 — Mini Astrolabio Radial Fan & Slot Execution
  // =========================================================================
  t('T1-F10-01', 'F10', 'Hovering Mini central dot opens radial fan with numbered slots', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F10-01');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const info = await h.getMiniHubAndSlots(miniPage);
      const visible = info.slots.filter((s) => s.visible);
      assert.ok(visible.length >= 3, `Expected >=3 fan buttons on hover, got ${visible.length}`);
    } finally {
      await app.close();
    }
  }),

  t('T1-F10-02', 'F10', 'Mouseleave collapses radial fan back to black dot', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F10-02');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      await miniPage.moveOutside();
      await sleep(300);
      const info = await h.getMiniHubAndSlots(miniPage);
      const visible = info.slots.filter((s) => s.visible);
      assert.strictEqual(visible.length, 0, 'Fan buttons must collapse on mouseleave');
    } finally {
      await app.close();
    }
  }),

  t('T1-F10-03', 'F10', 'Mini fan slot numbers match points[] 1:1 in exact order', async (ctx) => {
    const points = [1, 2, 3, 4].map((n) => ({
      id: `p-${n}`,
      code: `0${n} ${n}`,
      title: `Slot Custom ${n}`,
      actionType: 'open_organizer',
      params: { scope: 'arquivos', criterion: 'type' }
    }));
    const app = await h.launchIsolatedApp(ctx, 'T1-F10-03', { points });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const info = await h.getMiniHubAndSlots(miniPage);
      const visible = info.slots.filter((s) => s.visible);
      assert.strictEqual(visible.length, 4, 'Mini must display exact 4 configured slots');
      for (let i = 0; i < 4; i++) {
        assert.ok(visible[i].text.includes(String(i + 1)), `Slot ${i + 1} missing number in "${visible[i].text}"`);
      }
    } finally {
      await app.close();
    }
  }),

  t('T1-F10-04', 'F10', '1-click slot execution from Mini fan runs configured automation', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const points = [
      {
        id: 'mini-hook-1',
        code: '01 1',
        title: 'Webhook Mini',
        actionType: 'send_link_chat',
        params: { deliveryChannel: 'webhook', webhookUrl: mock.url('/hook'), linkUrl: 'https://mpe.test/mini' }
      }
    ];
    const app = await h.launchIsolatedApp(ctx, 'T1-F10-04', { points });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const info = await h.getMiniHubAndSlots(miniPage);
      const slot1 = info.slots.find((s) => s.visible);
      assert.ok(slot1, 'Slot 1 must be visible in Mini fan');
      await miniPage.clickAt(slot1.rect.cx, slot1.rect.cy);
      const req = await mock.waitForRequest((r) => r.path === '/hook', 5000);
      assert.ok(req.bodyRaw.includes('https://mpe.test/mini'));
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T1-F10-05', 'F10', 'Mini radial fan buttons do not overlap with 7+ slots', async (ctx) => {
    const points = Array.from({ length: 7 }, (_, i) => ({
      id: `p-${i + 1}`,
      code: `0${i + 1} ${i + 1}`,
      title: `Acao ${i + 1}`,
      actionType: 'open_organizer',
      params: { scope: 'arquivos', criterion: 'type' }
    }));
    const app = await h.launchIsolatedApp(ctx, 'T1-F10-05', {
      points,
      miniAstrolabe: { enabled: true, x: 400, y: 350, size: 68, scale: 1.0, fanRadius: 140 }
    });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(300);
      const info = await h.getMiniHubAndSlots(miniPage);
      const vis = info.slots.filter((s) => s.visible);
      assert.strictEqual(vis.length, 7);
      for (let i = 0; i < vis.length; i++) {
        for (let j = i + 1; j < vis.length; j++) {
          const a = vis[i].rect;
          const b = vis[j].rect;
          const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
          const minAllowed = Math.min(a.width, b.width) * 0.9;
          assert.ok(dist >= minAllowed, `Fan buttons ${i + 1} and ${j + 1} overlap (dist=${dist.toFixed(1)})`);
        }
      }
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F11 — Bidirectional Real-Time Slot Sync & Reorder
  // =========================================================================
  t('T1-F11-01', 'F11', 'Creating slot in Main updates Mini fan immediately', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F11-01');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      const newTitle = `NovaEstrela_${Date.now()}`;
      await app.mainPage.eval((title) => {
        return window.mpeApi.getConfig().then((cfg) => {
          cfg.points.push({
            id: 'slot-new-sync',
            code: '04 4',
            title,
            actionType: 'open_organizer',
            params: { scope: 'arquivos', criterion: 'type' }
          });
          return window.mpeApi.saveConfig(cfg);
        });
      }, newTitle);
      await sleep(250);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const info = await h.getMiniHubAndSlots(miniPage);
      const vis = info.slots.filter((s) => s.visible);
      assert.strictEqual(vis.length, 4, 'Mini fan must immediately display 4th slot');
    } finally {
      await app.close();
    }
  }),

  t('T1-F11-02', 'F11', 'Editing slot title in Main updates Mini and Guide immediately', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F11-02');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      const edited = 'TituloEditadoSync';
      await app.mainPage.eval((title) => {
        return window.mpeApi.getConfig().then((cfg) => {
          cfg.points[0].title = title;
          return window.mpeApi.saveConfig(cfg);
        });
      }, edited);
      await sleep(250);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const info = await h.getMiniHubAndSlots(miniPage);
      assert.ok(
        info.slots[0] && (info.slots[0].title.includes(edited) || info.slots[0].text.includes(edited)),
        `Mini Slot 1 did not sync edited title: ${JSON.stringify(info.slots[0])}`
      );

      await app.mainPage.click('#btn-open-guide');
      await app.mainPage.waitForSelector('#guide-hotkeys-grid', 3000);
      const guideText = await app.mainPage.eval(() => {
        const grid = document.getElementById('guide-hotkeys-grid');
        return grid ? grid.textContent || '' : '';
      });
      assert.ok(guideText.includes(edited), `Guide hotkeys grid missing edited title "${edited}": ${guideText}`);
      await app.mainPage.click('#btn-close-guide').catch(() => {});
    } finally {
      await app.close();
    }
  }),

  t('T1-F11-03', 'F11', 'reorderPoint(0, 1) swaps Slot 1 and Slot 2 across Main and Mini', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F11-03');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      const before = await app.mainPage.eval(() => window.mpeApi.getConfig());
      const firstId = before.points[0].id;
      const secondId = before.points[1].id;

      const res = await app.mainPage.eval(() => window.mpeApi.reorderPoint(0, 1));
      assert.strictEqual(res.ok, true);
      const after = await app.mainPage.eval(() => window.mpeApi.getConfig());
      assert.strictEqual(after.points[0].id, secondId);
      assert.strictEqual(after.points[1].id, firstId);

      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(200);
      const miniInfo = await h.getMiniHubAndSlots(miniPage);
      assert.ok(
        miniInfo.slots[0] &&
          (miniInfo.slots[0].title.includes(after.points[0].title) || miniInfo.slots[0].text.includes(after.points[0].title)),
        `Mini Slot 1 did not sync swapped title "${after.points[0].title}": ${JSON.stringify(miniInfo.slots[0])}`
      );
    } finally {
      await app.close();
    }
  }),

  t('T1-F11-04', 'F11', 'Deleting Slot 2 renumbers former Slot 3 to Slot 2 across Main and Mini', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F11-04');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await app.mainPage.eval(() => {
        return window.mpeApi.getConfig().then((cfg) => {
          cfg.points.splice(1, 1);
          return window.mpeApi.saveConfig(cfg);
        });
      });
      await sleep(250);
      const cfg = await app.mainPage.eval(() => window.mpeApi.getConfig());
      assert.strictEqual(cfg.points.length, 2);
      assert.strictEqual(cfg.points[1].id, 'slot-3-organizer');
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(200);
      const vis = (await h.getMiniHubAndSlots(miniPage)).slots.filter((s) => s.visible);
      assert.strictEqual(vis.length, 2);
    } finally {
      await app.close();
    }
  }),

  t('T1-F11-05', 'F11', 'Reordered slot numbering persists across full restart', async (ctx) => {
    const ws = isolation.createIsolatedWorkspace(ctx.runId, 'T1-F11-05');
    ctx.processManager.registerToken(ws.runToken);
    ctx.processManager.registerCleanup(() => ws.cleanup());
    isolation.assertCodeIsolationReady();

    let s1 = null;
    let s2 = null;
    try {
      s1 = await launchElectronWithCdp({
        electronExe: isolation.ELECTRON_EXE,
        args: ws.buildElectronArgs(),
        env: ws.buildElectronEnv(),
        cwd: isolation.CODE_DIR,
        userDataDir: ws.userDataDir,
        processManager: ctx.processManager
      });
      const p1 = await s1.connectTarget('index.html');
      await p1.waitForFunction(() => Boolean(window.mpeApi));
      await p1.eval(() => window.mpeApi.reorderPoint(0, 1));
      await p1.eval(() => window.mpeApi.quitApp()).catch(() => {});
      await s1.waitForExit(5000);
      await s1.close();

      s2 = await launchElectronWithCdp({
        electronExe: isolation.ELECTRON_EXE,
        args: ws.buildElectronArgs(),
        env: ws.buildElectronEnv(),
        cwd: isolation.CODE_DIR,
        userDataDir: ws.userDataDir,
        processManager: ctx.processManager
      });
      const p2 = await s2.connectTarget('index.html');
      await p2.waitForFunction(() => Boolean(window.mpeApi));
      const cfg2 = await p2.eval(() => window.mpeApi.getConfig());
      assert.strictEqual(cfg2.points[0].id, 'slot-2-vscode');
      assert.strictEqual(cfg2.points[1].id, 'slot-1-notepad');
    } finally {
      if (s1) await s1.close();
      if (s2) await s2.close();
      ws.cleanup();
    }
  }),

  // =========================================================================
  // F12 — Automation: Open Configured Link (open_url)
  // =========================================================================
  t('T1-F12-01', 'F12', 'Execute open_url from Main IPC', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T1-F12-01', {
      extraEnv: { MPE_TEST_OPEN_URL_HTTP: '1' }
    });
    try {
      const url = mock.url('/ok?src=main');
      const res = await app.mainPage.eval((u) => {
        return window.mpeApi.executePoint({ id: 'u1', title: 'Link', actionType: 'open_url', params: { url: u } });
      }, url);
      assert.strictEqual(res.ok, true, `open_url failed: ${JSON.stringify(res)}`);
      const hit = await mock.waitForRequest((r) => r.path === '/ok' && r.query.src === 'main', 5000);
      assert.strictEqual(hit.method, 'GET');
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T1-F12-02', 'F12', 'Execute open_url slot from Mini Astrolabio fan', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const url = mock.url('/ok?src=mini');
    const app = await h.launchIsolatedApp(ctx, 'T1-F12-02', {
      points: [{ id: 'u-mini', code: '01 1', title: 'Link Mini', actionType: 'open_url', params: { url } }],
      extraEnv: { MPE_TEST_OPEN_URL_HTTP: '1' }
    });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const info = await h.getMiniHubAndSlots(miniPage);
      assert.ok(info.slots[0] && info.slots[0].visible);
      await miniPage.clickAt(info.slots[0].rect.cx, info.slots[0].rect.cy);
      const hit = await mock.waitForRequest((r) => r.path === '/ok' && r.query.src === 'mini', 5000);
      assert.strictEqual(hit.method, 'GET');
      assert.deepStrictEqual(miniPage.getErrors(), []);
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T1-F12-03', 'F12', 'open_url auto-prepends https:// when scheme omitted', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F12-03', {
      extraEnv: { MPE_TEST_DRY_OPEN_EXTERNAL: '1' }
    });
    try {
      const res = await app.mainPage.eval(() => {
        return window.mpeApi.executePoint({
          id: 'u-noscheme',
          title: 'NoScheme',
          actionType: 'open_url',
          params: { url: 'example.com/path' }
        });
      });
      assert.strictEqual(res.ok, true, `Expected ok:true for schemeless URL: ${JSON.stringify(res)}`);
    } finally {
      await app.close();
    }
  }),

  t('T1-F12-04', 'F12', 'Create open_url slot via #modal-point UI and persist', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F12-04');
    try {
      await app.mainPage.click('#btn-add-star');
      await sleep(150);
      const cv = await app.mainPage.getRect('#astrolabe-canvas');
      await app.mainPage.clickAt(cv.cx + 180, cv.cy - 120);
      await app.mainPage.waitForSelector('#modal-point', 3000);
      await app.mainPage.click('.wiz-goal-card[data-goal="open_thing"]');
      await app.mainPage.waitForSelector('#pt-title', 3000);
      await app.mainPage.eval(() => {
        const det = document.querySelector('.wiz-advanced');
        if (det) det.open = true;
        const sel = document.getElementById('pt-action-type');
        sel.value = 'open_url';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await app.mainPage.waitForSelector('#pt-url', 3000);
      await app.mainPage.type('#pt-title', 'Meu Link UI');
      await app.mainPage.type('#pt-url', 'https://example.org/e2e');
      await app.mainPage.click('#btn-save-point');
      await app.mainPage.waitForFunction(
        () => document.getElementById('modal-point')?.classList.contains('hidden'),
        [],
        3000
      );
      const cfg = app.ws.readConfig();
      const saved = cfg.points.find((p) => p.title === 'Meu Link UI');
      assert.ok(saved, 'New open_url point must be saved in mpe.config.json');
      assert.strictEqual(saved.actionType, 'open_url');
      assert.strictEqual(saved.params.url, 'https://example.org/e2e');
    } finally {
      await app.close();
    }
  }),

  t('T1-F12-05', 'F12', 'open_url inside macro_sequence executes cleanly', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F12-05', {
      extraEnv: { MPE_TEST_DRY_OPEN_EXTERNAL: '1' }
    });
    try {
      const res = await app.mainPage.eval(() => {
        return window.mpeApi.executePoint({
          id: 'macro-url',
          title: 'Macro URL',
          actionType: 'macro_sequence',
          params: {
            steps: [{ actionType: 'open_url', params: { url: 'https://example.org/macro' } }]
          }
        });
      });
      assert.strictEqual(res.ok, true, `macro_sequence open_url failed: ${JSON.stringify(res)}`);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F13 — Automation: Send Link to Chat / Bot (send_link_chat)
  // =========================================================================
  t('T1-F13-01', 'F13', 'send_link_chat webhook delivers JSON payload to local HTTP mock', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T1-F13-01');
    try {
      const res = await app.mainPage.eval((wh) => {
        return window.mpeApi.executePoint({
          id: 'chat-wh',
          title: 'Chat Webhook',
          actionType: 'send_link_chat',
          params: {
            deliveryChannel: 'webhook',
            webhookUrl: wh,
            linkUrl: 'https://mpe.local/doc'
          }
        });
      }, mock.url('/hook'));
      assert.strictEqual(res.ok, true, `send_link_chat webhook failed: ${JSON.stringify(res)}`);
      const hit = await mock.waitForRequest((r) => r.path === '/hook', 4000);
      assert.strictEqual(hit.method, 'POST');
      assert.ok(hit.bodyRaw.includes('https://mpe.local/doc'));
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T1-F13-02', 'F13', 'send_link_chat telegram_bot posts sendMessage payload', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T1-F13-02', {
      extraEnv: { MPE_TELEGRAM_API_BASE: mock.url('/') }
    });
    try {
      const res = await app.mainPage.eval(() => {
        return window.mpeApi.executePoint({
          id: 'chat-tg',
          title: 'Bot TG',
          actionType: 'send_link_chat',
          params: {
            deliveryChannel: 'telegram_bot',
            botToken: '12345:TESTTOKEN',
            chatId: '987654321',
            linkUrl: 'https://mpe.local/tg'
          }
        });
      });
      assert.strictEqual(res.ok, true, `telegram_bot send_link_chat failed: ${JSON.stringify(res)}`);
      const hit = await mock.waitForRequest((r) => r.path.includes('/sendMessage'), 4000);
      assert.ok(hit.bodyRaw.includes('987654321') && hit.bodyRaw.includes('https://mpe.local/tg'));
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T1-F13-03', 'F13', 'Trigger send_link_chat from Mini Astrolabio fan', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T1-F13-03', {
      points: [
        {
          id: 'mini-chat-1',
          code: '01 1',
          title: 'Enviar Link',
          actionType: 'send_link_chat',
          params: {
            deliveryChannel: 'webhook',
            webhookUrl: mock.url('/hook'),
            linkUrl: 'https://mpe.local/from-mini'
          }
        }
      ]
    });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const info = await h.getMiniHubAndSlots(miniPage);
      await miniPage.clickAt(info.slots[0].rect.cx, info.slots[0].rect.cy);
      const hit = await mock.waitForRequest((r) => r.path === '/hook', 4000);
      assert.ok(hit.bodyRaw.includes('https://mpe.local/from-mini'));
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T1-F13-04', 'F13', 'send_link_chat applies custom messageTemplate {url} substitution', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T1-F13-04');
    try {
      const res = await app.mainPage.eval((wh) => {
        return window.mpeApi.executePoint({
          id: 'chat-tpl',
          title: 'Template',
          actionType: 'send_link_chat',
          params: {
            deliveryChannel: 'webhook',
            webhookUrl: wh,
            linkUrl: 'https://a.test/item',
            messageTemplate: 'Link compartilhado: {url}'
          }
        });
      }, mock.url('/hook'));
      assert.strictEqual(res.ok, true);
      const hit = await mock.waitForRequest((r) => r.path === '/hook', 4000);
      assert.ok(hit.bodyRaw.includes('Link compartilhado: https://a.test/item'));
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T1-F13-05', 'F13', 'send_link_chat desktop channel copies formatted link cleanly', async (ctx) => {
    const baselineNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
    const app = await h.launchIsolatedApp(ctx, 'T1-F13-05');
    try {
      const res = await app.mainPage.eval(() => {
        return window.mpeApi.executePoint({
          id: 'chat-desk',
          title: 'Desktop Chat',
          actionType: 'send_link_chat',
          params: {
            deliveryChannel: 'system',
            targetSystem: 'bloco de notas',
            linkUrl: 'https://mpe.local/notepad-chat',
            autoSendEnter: false
          }
        });
      });
      assert.strictEqual(res.ok, true, `Desktop send_link_chat failed: ${JSON.stringify(res)}`);
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
  // F14 — Automation: Launch App / VS Code Project (launch_app_project)
  // =========================================================================
  t('T1-F14-01', 'F14', 'Slot 1 opens Notepad from Main HUD', async (ctx) => {
    const baselineNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
    const app = await h.launchIsolatedApp(ctx, 'T1-F14-01');
    try {
      const res = await app.mainPage.eval(() => {
        return window.mpeApi.getConfig().then((cfg) => window.mpeApi.executePoint(cfg.points[0]));
      });
      assert.strictEqual(res.ok, true, `Slot 1 Notepad failed: ${JSON.stringify(res)}`);
      await sleep(800);
      const afterNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
      const spawned = [...afterNotepad].filter((p) => !baselineNotepad.has(p));
      assert.ok(spawned.length >= 1, 'Expected new notepad.exe process after Slot 1 execution');
    } finally {
      ctx.processManager.killNewProcessesByImage('notepad.exe', baselineNotepad);
      await app.close();
    }
  }),

  t('T1-F14-02', 'F14', 'Slot 1 opens Notepad when clicked from Mini Astrolabio', async (ctx) => {
    const baselineNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
    const app = await h.launchIsolatedApp(ctx, 'T1-F14-02');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const info = await h.getMiniHubAndSlots(miniPage);
      await miniPage.clickAt(info.slots[0].rect.cx, info.slots[0].rect.cy);
      await sleep(900);
      const afterNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
      const spawned = [...afterNotepad].filter((p) => !baselineNotepad.has(p));
      assert.ok(spawned.length >= 1, 'Expected notepad.exe launched from Mini Slot 1');
    } finally {
      ctx.processManager.killNewProcessesByImage('notepad.exe', baselineNotepad);
      await app.close();
    }
  }),

  t('T1-F14-03', 'F14', 'Slot 2 launches configured VS Code project path from Main', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F14-03', {
      extraEnv: { MPE_TEST_DRY_APP_LAUNCH: '1' }
    });
    try {
      const res = await app.mainPage.eval(() => {
        return window.mpeApi.getConfig().then((cfg) => window.mpeApi.executePoint(cfg.points[1]));
      });
      assert.strictEqual(res.ok, true, `Slot 2 VS Code failed: ${JSON.stringify(res)}`);
    } finally {
      await app.close();
    }
  }),

  t('T1-F14-04', 'F14', 'Slot 2 launches configured VS Code project from Mini Astrolabio', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F14-04', {
      extraEnv: { MPE_TEST_DRY_APP_LAUNCH: '1' }
    });
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const info = await h.getMiniHubAndSlots(miniPage);
      assert.ok(info.slots[1] && info.slots[1].visible, 'Slot 2 must be visible in Mini fan');
      assert.ok(
        info.slots[1].title.includes('VS Code') || info.slots[1].text.includes('2'),
        `Slot 2 metadata mismatch: ${JSON.stringify(info.slots[1])}`
      );
      await miniPage.eval(() => {
        const root = document.getElementById('mini-root');
        if (root) {
          delete root.dataset.lastExecOk;
          delete root.dataset.lastExecType;
          delete root.dataset.lastExecId;
        }
        const st = document.getElementById('mini-status');
        if (st) st.classList.add('hidden');
      });
      await miniPage.clickAt(info.slots[1].rect.cx, info.slots[1].rect.cy);
      await miniPage.waitForFunction(() => {
        const root = document.getElementById('mini-root');
        const st = document.getElementById('mini-status');
        return Boolean(
          root &&
            root.dataset.lastExecOk !== undefined &&
            st &&
            !st.classList.contains('hidden') &&
            (st.textContent || '').trim().length > 0
        );
      }, [], 5000);
      const miniExec = await miniPage.eval(() => {
        const root = document.getElementById('mini-root');
        const st = document.getElementById('mini-status');
        return {
          lastExecOk: root ? root.dataset.lastExecOk : undefined,
          lastExecType: root ? root.dataset.lastExecType : undefined,
          lastExecId: root ? root.dataset.lastExecId : undefined,
          statusText: st ? (st.textContent || '').trim() : '',
          statusIsError: st ? st.classList.contains('is-error') : false
        };
      });
      assert.strictEqual(miniExec.lastExecOk, 'true', `Mini Slot 2 execution failed: ${JSON.stringify(miniExec)}`);
      assert.strictEqual(miniExec.lastExecType, 'launch_app_project', `Unexpected Mini Slot 2 type: ${JSON.stringify(miniExec)}`);
      assert.strictEqual(miniExec.statusIsError, false, `Mini Slot 2 showed error toast: ${JSON.stringify(miniExec)}`);
      assert.ok(miniExec.statusText.length > 0, 'Mini Slot 2 must display execution status feedback');
      assert.deepStrictEqual(miniPage.getErrors(), []);
    } finally {
      await app.close();
    }
  }),

  t('T1-F14-05', 'F14', 'launch_app_project supports generic executable with arguments', async (ctx) => {
    const baselineNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
    const app = await h.launchIsolatedApp(ctx, 'T1-F14-05');
    try {
      const noteFile = path.join(app.ws.workspaceDir, 'launch_arg.txt');
      fs.writeFileSync(noteFile, 'MPE generic launch test', 'utf8');
      const res = await app.mainPage.eval((nf) => {
        return window.mpeApi.executePoint({
          id: 'gen-app',
          title: 'Notepad File',
          actionType: 'launch_app_project',
          params: { appName: 'notepad', targetPath: 'notepad.exe', args: [nf] }
        });
      }, noteFile);
      assert.strictEqual(res.ok, true);
      await sleep(800);
      const afterNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
      const spawned = [...afterNotepad].filter((p) => !baselineNotepad.has(p));
      assert.ok(spawned.length >= 1, 'Expected new notepad.exe process after generic launch_app_project');
    } finally {
      ctx.processManager.killNewProcessesByImage('notepad.exe', baselineNotepad);
      await app.close();
    }
  }),

  // =========================================================================
  // F15 — Python Auto-Script Manual Recorder & Visual Indicator
  // =========================================================================
  t('T1-F15-01', 'F15', 'startPythonRecording emits active state and displays visual indicator', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F15-01');
    try {
      await app.mainPage.eval(() => {
        window.__recStates = [];
        window.mpeApi.onPythonRecordingState((s) => window.__recStates.push(s));
      });
      const res = await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
      assert.strictEqual(res.ok, true, `startPythonRecording failed: ${JSON.stringify(res)}`);
      await app.mainPage.waitForFunction(
        () => Array.isArray(window.__recStates) && window.__recStates.some((s) => s && s.active === true),
        [],
        4000
      );
      const recStates = await app.mainPage.eval(() => window.__recStates);
      assert.ok(recStates.some((s) => s && s.active === true), 'onPythonRecordingState must emit active: true');
      const recPage = await h.connectRecorderPage(app.session);
      const vis = await recPage.eval(() => {
        const text = (document.body.innerText || '').trim();
        return text.length > 0 && document.visibilityState === 'visible';
      });
      assert.strictEqual(vis, true, 'Recorder overlay must display active recording indicator');
      await app.mainPage.eval(() => window.mpeApi.stopPythonRecording({ cancel: true }));
    } finally {
      await app.close();
    }
  }),

  t('T1-F15-02', 'F15', 'Python recorder captures global (x, y) clicks and stepCount', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    let targetWin = null;
    const app = await h.launchIsolatedApp(ctx, 'T1-F15-02');
    try {
      targetWin = await h.launchClickTargetWindow(ctx, mock, { x: 140, y: 140, width: 240, height: 240 });
      await app.mainPage.eval(() => {
        window.__recStates = [];
        window.mpeApi.onPythonRecordingState((s) => window.__recStates.push(s));
      });
      await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
      await sleep(250);
      h.performWin32Click(200, 200, 'left');
      await sleep(300);
      h.performWin32Click(260, 240, 'left');
      await sleep(250);
      const stop = await app.mainPage.eval(() => window.mpeApi.stopPythonRecording({}));
      assert.strictEqual(stop.ok, true);
      assert.ok(Array.isArray(stop.steps) && stop.steps.length === 2, `Expected 2 steps, got ${JSON.stringify(stop.steps)}`);
      const recStates = await app.mainPage.eval(() => window.__recStates);
      assert.ok(
        recStates.some((s) => s && s.stepCount >= 2),
        `Expected onPythonRecordingState stepCount >= 2, got ${JSON.stringify(recStates)}`
      );
    } finally {
      if (targetWin) await targetWin.close();
      await app.close();
      await mock.stop();
    }
  }),

  t('T1-F15-03', 'F15', 'stopPythonRecording hides indicator and returns exact step list', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    let targetWin = null;
    const app = await h.launchIsolatedApp(ctx, 'T1-F15-03');
    try {
      targetWin = await h.launchClickTargetWindow(ctx, mock, { x: 140, y: 140, width: 240, height: 240 });
      await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
      const recPage = await h.connectRecorderPage(app.session);
      await sleep(250);
      h.performWin32Click(210, 210, 'left');
      await sleep(200);
      const stop = await app.mainPage.eval(() => window.mpeApi.stopPythonRecording({}));
      assert.strictEqual(stop.ok, true);
      assert.strictEqual(stop.steps.length, 1);
      assert.ok(Math.abs(stop.steps[0].x - 210) <= 5 && Math.abs(stop.steps[0].y - 210) <= 5);
      await sleep(250);
      const targets = await app.session.listTargets();
      const recTarget = targets.find((x) => String(x.url || '').includes('recorder-overlay.html'));
      if (recTarget) {
        let stillVisible;
        try {
          stillVisible = await recPage.eval(() => document.visibilityState === 'visible' && !document.hidden);
        } catch (evalErr) {
          const refreshed = await app.session.listTargets();
          const stillListed = refreshed.find((x) => String(x.url || '').includes('recorder-overlay.html'));
          if (stillListed) {
            throw evalErr;
          }
          stillVisible = false;
        }
        assert.strictEqual(stillVisible, false, 'Recorder indicator overlay must hide/close after stopPythonRecording');
      }
    } finally {
      if (targetWin) await targetWin.close();
      await app.close();
      await mock.stop();
    }
  }),

  t('T1-F15-04', 'F15', 'Recorded waitMs accurately reflects elapsed time between clicks', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    let targetWin = null;
    const app = await h.launchIsolatedApp(ctx, 'T1-F15-04');
    try {
      targetWin = await h.launchClickTargetWindow(ctx, mock, { x: 140, y: 140, width: 240, height: 240 });
      await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
      await sleep(250);
      h.performWin32Click(190, 190, 'left');
      await sleep(450);
      h.performWin32Click(250, 220, 'left');
      await sleep(200);
      const stop = await app.mainPage.eval(() => window.mpeApi.stopPythonRecording({}));
      assert.strictEqual(stop.steps.length, 2);
      assert.ok(stop.steps[1].waitMs >= 250 && stop.steps[1].waitMs <= 1500, `Unexpected waitMs=${stop.steps[1].waitMs}`);
    } finally {
      if (targetWin) await targetWin.close();
      await app.close();
      await mock.stop();
    }
  }),

  t('T1-F15-05', 'F15', 'Hook disarms cleanly after stopPythonRecording', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    let targetWin = null;
    const app = await h.launchIsolatedApp(ctx, 'T1-F15-05');
    try {
      targetWin = await h.launchClickTargetWindow(ctx, mock, { x: 140, y: 140, width: 240, height: 240 });
      await app.mainPage.eval(() => {
        window.__activeCount = 0;
        window.mpeApi.onPythonRecordingState((s) => {
          if (s && s.active) window.__activeCount++;
        });
      });
      await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
      await sleep(200);
      await app.mainPage.eval(() => window.mpeApi.stopPythonRecording({ cancel: true }));
      const countAtStop = await app.mainPage.eval(() => window.__activeCount);
      h.performWin32Click(200, 200, 'left');
      await sleep(250);
      const countAfter = await app.mainPage.eval(() => window.__activeCount);
      assert.strictEqual(countAfter, countAtStop, 'No recording events should fire after stop');
    } finally {
      if (targetWin) await targetWin.close();
      await app.close();
      await mock.stop();
    }
  }),

  // =========================================================================
  // F16 — Python Stdlib .py Script Generator
  // =========================================================================
  t('T1-F16-01', 'F16', 'savePythonScript writes .py file and appends autoScripts[]', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F16-01');
    try {
      const res = await app.mainPage.eval(() => {
        return window.mpeApi.savePythonScript({
          name: 'Teste Auto Script',
          steps: [
            { x: 120, y: 240, button: 'left', waitMs: 0 },
            { x: 360, y: 480, button: 'left', waitMs: 400 }
          ]
        });
      });
      assert.strictEqual(res.ok, true, `savePythonScript failed: ${JSON.stringify(res)}`);
      assert.ok(res.script && res.script.filePath && fs.existsSync(res.script.filePath));
      const cfg = app.ws.readConfig();
      assert.ok(cfg.autoScripts.some((s) => s.id === res.script.id));
    } finally {
      await app.close();
    }
  }),

  t('T1-F16-02', 'F16', 'Generated .py script passes python -m py_compile', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F16-02');
    try {
      const res = await app.mainPage.eval(() => {
        return window.mpeApi.savePythonScript({
          name: 'Compile Check',
          steps: [{ x: 100, y: 100, button: 'left', waitMs: 100 }]
        });
      });
      const pyc = h.runPythonCli(['-m', 'py_compile', res.script.filePath]);
      assert.strictEqual(pyc.code, 0, `py_compile failed: ${pyc.stderr}`);
    } finally {
      await app.close();
    }
  }),

  t('T1-F16-03', 'F16', 'Generated .py uses pure stdlib ctypes with SetProcessDPIAware', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F16-03');
    try {
      const res = await app.mainPage.eval(() => {
        return window.mpeApi.savePythonScript({
          name: 'Stdlib Check',
          steps: [{ x: 150, y: 250, button: 'left', waitMs: 200 }]
        });
      });
      const src = fs.readFileSync(res.script.filePath, 'utf8');
      assert.match(src, /ctypes/);
      assert.match(src, /SetProcessDPIAware/);
      assert.match(src, /SetCursorPos/);
      assert.match(src, /mouse_event/);
      assert.match(src, /time\.sleep/);
      assert.doesNotMatch(src, /pyautogui|pynput/i);
      assert.deepStrictEqual(metrics.scanStringForEmojis(src, res.script.filePath), []);
    } finally {
      await app.close();
    }
  }),

  t('T1-F16-04', 'F16', 'Generated .py embeds exact coordinates and waitMs and supports --dry-run', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F16-04');
    try {
      const res = await app.mainPage.eval(() => {
        return window.mpeApi.savePythonScript({
          name: 'Coords Check',
          steps: [
            { x: 123, y: 456, button: 'left', waitMs: 0 },
            { x: 789, y: 321, button: 'right', waitMs: 650 }
          ]
        });
      });
      const dry = h.runPythonCli([res.script.filePath, '--dry-run']);
      assert.strictEqual(dry.code, 0, `--dry-run failed: ${dry.stderr}`);
      assert.ok(dry.stdout.includes('123') && dry.stdout.includes('456'));
      assert.ok(dry.stdout.includes('789') && dry.stdout.includes('321') && dry.stdout.includes('650'));
    } finally {
      await app.close();
    }
  }),

  t('T1-F16-05', 'F16', 'Generated script binds to run_python_script slot across Main and Mini', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F16-05');
    try {
      const saved = await app.mainPage.eval(() => {
        return window.mpeApi.savePythonScript({
          name: 'Slot Bind',
          steps: [{ x: 10, y: 10, button: 'left', waitMs: 50 }]
        });
      });
      await app.mainPage.eval((script) => {
        return window.mpeApi.getConfig().then((cfg) => {
          cfg.points.push({
            id: 'slot-py-bind',
            code: '04 4',
            title: 'Meu Script Py',
            actionType: 'run_python_script',
            params: { scriptId: script.id, scriptPath: script.filePath }
          });
          return window.mpeApi.saveConfig(cfg);
        });
      }, saved.script);

      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(200);
      const vis = (await h.getMiniHubAndSlots(miniPage)).slots.filter((s) => s.visible);
      assert.strictEqual(vis.length, 4, 'Bound Python script slot must appear in Mini fan');
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F17 — Python Auto-Script On-Demand & Background Scheduler
  // =========================================================================
  t('T1-F17-01', 'F17', 'runPythonScript --dry-run executes cleanly on demand', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F17-01');
    try {
      const saved = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({
          name: 'Dry Run Exec',
          steps: [{ x: 333, y: 444, button: 'left', waitMs: 100 }]
        })
      );
      const run = await app.mainPage.eval((id) => window.mpeApi.runPythonScript(id, { dryRun: true }), saved.script.id);
      assert.strictEqual(run.ok, true);
      assert.strictEqual(run.exitCode, 0);
      assert.ok(run.stdout.includes('333') && run.stdout.includes('444'));
    } finally {
      await app.close();
    }
  }),

  t('T1-F17-02', 'F17', 'Real-mode Python replay clicks isolated Always-On-Top Click Target Window', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    let targetWin = null;
    const app = await h.launchIsolatedApp(ctx, 'T1-F17-02');
    try {
      targetWin = await h.launchClickTargetWindow(ctx, mock, { x: 120, y: 120, width: 260, height: 260 });
      const saved = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({
          name: 'Real Click Replay',
          steps: [
            { x: 200, y: 200, button: 'left', waitMs: 50 },
            { x: 280, y: 250, button: 'left', waitMs: 200 }
          ]
        })
      );
      const run = await app.mainPage.eval((id) => window.mpeApi.runPythonScript(id, { dryRun: false }), saved.script.id);
      assert.strictEqual(run.ok, true, `Real replay failed: ${JSON.stringify(run)}`);
      assert.strictEqual(run.exitCode, 0);
      const clicks = await mock.waitForClickCount(2, 6000);
      assert.ok(Math.abs(clicks[0].x - 200) <= 5 && Math.abs(clicks[0].y - 200) <= 5);
      assert.ok(Math.abs(clicks[1].x - 280) <= 5 && Math.abs(clicks[1].y - 250) <= 5);
    } finally {
      if (targetWin) await targetWin.close();
      await app.close();
      await mock.stop();
    }
  }),

  t('T1-F17-03', 'F17', 'Execute bound run_python_script slot from Mini Astrolabio', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F17-03');
    try {
      const saved = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({
          name: 'Mini Slot Script',
          steps: [{ x: 10, y: 10, button: 'left', waitMs: 50 }],
          dryRunDefault: true
        })
      );
      await app.mainPage.eval((script) => {
        return window.mpeApi.getConfig().then((cfg) => {
          cfg.points = [
            {
              id: 'mini-py-1',
              code: '01 1',
              title: 'Py Mini',
              actionType: 'run_python_script',
              params: { scriptId: script.id, scriptPath: script.filePath, dryRun: true }
            }
          ];
          return window.mpeApi.saveConfig(cfg);
        });
      }, saved.script);

      await app.mainPage.eval(() => {
        window.__pyExecuted = null;
        window.mpeApi.onPythonScriptExecuted((e) => {
          window.__pyExecuted = e;
        });
      });

      const miniPage = await h.connectMiniPage(app.session);
      await miniPage.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const info = await h.getMiniHubAndSlots(miniPage);
      await miniPage.clickAt(info.slots[0].rect.cx, info.slots[0].rect.cy);
      await app.mainPage.waitForFunction(() => Boolean(window.__pyExecuted), [], 6000);
      const evt = await app.mainPage.eval(() => window.__pyExecuted);
      assert.strictEqual(evt.exitCode, 0);
    } finally {
      await app.close();
    }
  }),

  t('T1-F17-04', 'F17', 'Background scheduler fires script automatically at --test-clock boundary', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F17-04', {
      testClock: '2026-11-18T09:59:45'
    });
    try {
      const saved = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({
          name: 'Scheduled Script',
          steps: [{ x: 20, y: 20, button: 'left', waitMs: 20 }],
          dryRunDefault: true
        })
      );
      await app.mainPage.eval(() => {
        window.__schedExec = null;
        window.mpeApi.onPythonScriptExecuted((e) => {
          if (e && e.trigger === 'schedule') window.__schedExec = e;
        });
      });
      await app.mainPage.eval(() => window.mpeApi.hideHud());
      await app.mainPage.eval((id) => {
        return window.mpeApi.schedulePythonScript(id, {
          enabled: true,
          timeHHMM: '10:00',
          mode: 'once',
          dryRun: true
        });
      }, saved.script.id);

      await app.mainPage.waitForFunction(() => Boolean(window.__schedExec), [], 20000);
      const evt = await app.mainPage.eval(() => window.__schedExec);
      assert.strictEqual(evt.exitCode, 0);
      assert.strictEqual(evt.trigger, 'schedule');
    } finally {
      await app.close();
    }
  }),

  t('T1-F17-05', 'F17', 'Clean shutdown kills active child python.exe without orphans', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F17-05');
    try {
      const longPy = path.join(app.ws.scriptsDir, 'long_sleep.py');
      fs.writeFileSync(longPy, 'import time\ntime.sleep(30)\n', 'utf8');
      const saved = await app.mainPage.eval((fp) => {
        return window.mpeApi.getConfig().then((cfg) => {
          cfg.autoScripts.push({
            id: 'long-sleep-id',
            name: 'Long Sleep',
            filePath: fp,
            steps: [{ x: 0, y: 0, button: 'left', waitMs: 30000 }],
            schedule: { enabled: false, timeHHMM: '00:00', mode: 'once', lastRunKey: null }
          });
          return window.mpeApi.saveConfig(cfg);
        });
      }, longPy);
      assert.ok(saved !== undefined);
      app.mainPage.eval(() => window.mpeApi.runPythonScript('long-sleep-id', { dryRun: false })).catch(() => {});
      await sleep(500);
      await h.quitAppGracefully(app.mainPage, app.session, 5000);
      await sleep(400);
      const orphans = ctx.processManager.findOrphanProcesses([app.session.pid], [app.ws.runToken, longPy]);
      assert.strictEqual(orphans.length, 0, `Orphan python.exe found: ${JSON.stringify(orphans)}`);
    } finally {
      await app.close();
    }
  }),

  // =========================================================================
  // F18 — Regression & Self-Test
  // =========================================================================
  t('T1-F18-01', 'F18', 'Baseline npm test (run-tests.js) passes 100% in isolation', async (ctx) => {
    isolation.assertCodeIsolationReady();
    const ws = isolation.createIsolatedWorkspace(ctx.runId, 'T1-F18-01');
    ctx.processManager.registerCleanup(() => ws.cleanup());
    try {
      const res = spawnSync('node', [isolation.RUN_TESTS_JS], {
        cwd: isolation.CODE_DIR,
        env: ws.buildElectronEnv(),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 25000
      });
      assert.strictEqual(res.status, 0, `run-tests.js failed (exit=${res.status}):\n${res.stdout}\n${res.stderr}`);
      assert.ok(res.stdout.includes('FAIL: 0') || res.stdout.includes('"failed":0'), 'Expected 0 failures in run-tests.js');
    } finally {
      ws.cleanup();
    }
  }),

  t('T1-F18-02', 'F18', 'Isolated --self-test prints MPE_SELF_TEST_PASSED and exits 0', async (ctx) => {
    isolation.assertCodeIsolationReady();
    const verSnap = isolation.snapshotDirFiles(isolation.PROD_VERIFICACAO_DIR);
    const ws = isolation.createIsolatedWorkspace(ctx.runId, 'T1-F18-02');
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
      let err = '';
      proc.stdout.on('data', (c) => (out += c.toString('utf8')));
      proc.stderr.on('data', (c) => (err += c.toString('utf8')));
      const code = await new Promise((resolve, reject) => {
        const tm = setTimeout(() => {
          ctx.processManager.killPidTreeSync(proc.pid);
          reject(new Error('--self-test timed out after 30s'));
        }, 30000);
        proc.once('close', (c) => {
          clearTimeout(tm);
          resolve(c);
        });
      });
      assert.strictEqual(code, 0, `--self-test exited ${code}. stderr=${err}`);
      assert.ok(out.includes('MPE_SELF_TEST_PASSED'), `Missing MPE_SELF_TEST_PASSED in stdout: ${out}`);
    } finally {
      isolation.restoreDirFiles(isolation.PROD_VERIFICACAO_DIR, verSnap);
      ws.cleanup();
    }
  }),

  t('T1-F18-03', 'F18', 'FileOrganizer categorizes across all 4 criteria (type, date, name, size)', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F18-03');
    try {
      const sample = path.join(app.ws.workspaceDir, 'alpha_sample.txt');
      fs.writeFileSync(sample, 'criterion matrix test', 'utf8');
      for (const criterion of ['type', 'date', 'name', 'size']) {
        const res = await app.mainPage.eval((p, crit) => {
          return window.mpeApi.orgOrganize({ paths: [p], criterion: crit, targetScope: 'arquivos', moveInsteadOfCopy: false });
        }, sample, criterion);
        assert.strictEqual(res.ok, true, `Criterion ${criterion} failed: ${JSON.stringify(res)}`);
      }
    } finally {
      await app.close();
    }
  }),

  t('T1-F18-04', 'F18', 'ActionExecutor handles existing open_organizer, organize_files_quick, macro_sequence', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T1-F18-04');
    try {
      const r1 = await app.mainPage.eval(() =>
        window.mpeApi.executePoint({ id: 'o1', title: 'Org', actionType: 'open_organizer', params: { scope: 'arquivos', criterion: 'type' } })
      );
      assert.strictEqual(r1.ok, true);
      const r2 = await app.mainPage.eval(() =>
        window.mpeApi.executePoint({ id: 'o2', title: 'Macro', actionType: 'macro_sequence', params: { steps: [{ actionType: 'open_organizer', params: { scope: 'prints' } }] } })
      );
      assert.strictEqual(r2.ok, true);
    } finally {
      await app.close();
    }
  }),

  t('T1-F18-05', 'F18', 'Native binaries, icon.ico, and Testes.md are present and valid', async () => {
    assert.strictEqual(fs.existsSync(isolation.MPE_HOOK_EXE), true, 'Missing MpeHook.exe');
    assert.strictEqual(fs.existsSync(isolation.MPE_LAUNCHER_EXE), true, 'Missing MPE.exe');
    assert.strictEqual(
      fs.existsSync(path.join(isolation.CODE_DIR, 'assets', 'icon.ico')),
      true,
      'Missing assets/icon.ico'
    );
    assert.strictEqual(fs.existsSync(isolation.TESTES_MD), true, 'Missing Testes.md');
    const mainJs = fs.readFileSync(path.join(isolation.CODE_DIR, 'src', 'main', 'main.js'), 'utf8');
    assert.ok(mainJs.includes('DevFLeo.MousePerformaticoEstrelado'), 'Missing AUMID in main.js');
  })
];

module.exports = { tier1Tests };
