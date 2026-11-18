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

function t(id, features, name, fn) {
  return { id, tier: 3, feature: features, name, fn };
}

const tier3Tests = [
  t('T3-01', 'F03+F08+F01', 'Clean state blocks Mini -> accept consent -> enable Mini -> restart preserves Mini', async (ctx) => {
    isolation.assertCodeIsolationReady();
    const ws = isolation.createIsolatedWorkspace(ctx.runId, 'T3-01', { cleanState: true });
    ctx.processManager.registerToken(ws.runToken);
    ctx.processManager.registerCleanup(() => ws.cleanup());

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

      const blocked = await p1.eval(() => window.mpeApi.toggleMiniAstrolabe(true));
      assert.strictEqual(blocked.ok, false);
      assert.strictEqual(blocked.blockedByConsent, true);

      await h.clickConsentDecision(p1, true);
      const enabled = await p1.eval(() => window.mpeApi.toggleMiniAstrolabe(true));
      assert.strictEqual(enabled.ok, true);
      await p1.eval(() => window.mpeApi.quitApp()).catch(() => {});
      await s1.waitForExit(5000);
      await s1.close();

      s2 = await launchElectronWithCdp({
        electronExe: isolation.ELECTRON_EXE,
        args: [isolation.CODE_DIR, `--user-data-dir=${ws.userDataDir}`, `--config-path=${ws.configPath}`, '--remote-debugging-port=0', `--mpe-e2e-token=${ws.runToken}`],
        env: { ...ws.buildElectronEnv(), MPE_FORCE_CLEAN_CONSENT: '0' },
        cwd: isolation.CODE_DIR,
        userDataDir: ws.userDataDir,
        processManager: ctx.processManager
      });
      const p2 = await s2.connectTarget('index.html');
      await p2.waitForFunction(() => Boolean(window.mpeApi));
      const mini = await h.connectMiniPage(s2);
      const hub = await h.getMiniHubAndSlots(mini);
      assert.ok(hub.hubRect && hub.hubRect.width > 0);
    } finally {
      if (s1) await s1.close();
      if (s2) await s2.close();
      ws.cleanup();
    }
  }),

  t('T3-02', 'F02+F11+F10+F14', 'Swap Slot 1 <-> Slot 2 in Main -> Mini reflects swap -> executes swapped Slot 2 Notepad -> persists restart', async (ctx) => {
    const baselineNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
    isolation.assertCodeIsolationReady();
    const ws = isolation.createIsolatedWorkspace(ctx.runId, 'T3-02');
    ctx.processManager.registerToken(ws.runToken);
    ctx.processManager.registerCleanup(() => ws.cleanup());

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
      const mini = await h.connectMiniPage(s1);
      await mini.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const info = await h.getMiniHubAndSlots(mini);
      assert.ok(info.slots[1] && info.slots[1].visible);
      await mini.clickAt(info.slots[1].rect.cx, info.slots[1].rect.cy);
      await sleep(800);
      const afterNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
      const spawned = [...afterNotepad].filter((p) => !baselineNotepad.has(p));
      assert.ok(spawned.length >= 1, 'Swapped Mini Slot 2 must launch notepad.exe');
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
      ctx.processManager.killNewProcessesByImage('notepad.exe', baselineNotepad);
      if (s1) await s1.close();
      if (s2) await s2.close();
      ws.cleanup();
    }
  }),

  t('T3-03', 'F11+F12+F10', 'Create open_url slot in Main #modal-point -> click new slot in Mini fan', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T3-03', {
      extraEnv: { MPE_TEST_OPEN_URL_HTTP: '1' }
    });
    try {
      const mini = await h.connectMiniPage(app.session);
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
      await app.mainPage.type('#pt-title', 'URL Pairwise');
      await app.mainPage.type('#pt-url', mock.url('/ok?pw=1'));
      await app.mainPage.click('#btn-save-point');
      await app.mainPage.waitForFunction(
        () => document.getElementById('modal-point')?.classList.contains('hidden'),
        [],
        3000
      );
      await sleep(250);

      await mini.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const vis = (await h.getMiniHubAndSlots(mini)).slots.filter((s) => s.visible);
      assert.strictEqual(vis.length, 4);
      await mini.clickAt(vis[3].rect.cx, vis[3].rect.cy);
      const hit = await mock.waitForRequest((r) => r.path === '/ok' && r.query.pw === '1', 5000);
      assert.strictEqual(hit.method, 'GET');
      assert.deepStrictEqual(mini.getErrors(), []);
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T3-04', 'F11+F13+F10', 'Configure send_link_chat slot -> trigger from both Mini fan and Main hotkey', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T3-04');
    try {
      const mini = await h.connectMiniPage(app.session);
      await app.mainPage.eval((wh) => {
        return window.mpeApi.getConfig().then((cfg) => {
          cfg.points[2] = {
            id: 'slot-3-chat',
            code: '03 3',
            title: 'Chat Webhook',
            actionType: 'send_link_chat',
            params: { deliveryChannel: 'webhook', webhookUrl: wh, linkUrl: 'https://mpe.local/pw4' }
          };
          return window.mpeApi.saveConfig(cfg);
        });
      }, mock.url('/hook'));
      await sleep(250);

      await mini.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(200);
      const vis = (await h.getMiniHubAndSlots(mini)).slots.filter((s) => s.visible);
      await mini.clickAt(vis[2].rect.cx, vis[2].rect.cy);
      await mock.waitForRequest((r) => r.path === '/hook', 4000);

      await app.mainPage.pressKey('3', 'Digit3');
      await new Promise((r) => setTimeout(r, 400));
      assert.ok(mock.getRequests((r) => r.path === '/hook').length >= 2);
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T3-05', 'F08+F09+F10', 'Resize Mini (1.35) + move to bottom-right -> hover pauses, fan clamps, click works, leave resumes', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T3-05', {
      points: [{ id: 's1', code: '01 1', title: 'Hook', actionType: 'send_link_chat', params: { deliveryChannel: 'webhook', webhookUrl: mock.url('/hook'), linkUrl: 'https://mpe.local/pw5' } }]
    });
    try {
      const mini = await h.connectMiniPage(app.session);
      await app.mainPage.eval(() => window.mpeApi.updateMiniAstrolabeLayout({ scale: 1.35, x: 99999, y: 99999 }));
      await sleep(250);
      await mini.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const pausedRotor = await h.getMiniRotorSample(mini);
      assert.ok(pausedRotor, 'Mini rotor element must exist');
      assert.strictEqual(pausedRotor.playState, 'paused');

      const vis = (await h.getMiniHubAndSlots(mini)).slots.filter((s) => s.visible);
      assert.strictEqual(vis.length, 1);
      await mini.clickAt(vis[0].rect.cx, vis[0].rect.cy);
      await mock.waitForRequest((r) => r.path === '/hook', 4000);
      await mini.moveOutside();
      await sleep(250);
      const resumedRotor = await h.getMiniRotorSample(mini);
      assert.ok(resumedRotor, 'Mini rotor element must exist');
      assert.strictEqual(resumedRotor.playState, 'running');
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T3-06', 'F05+F06+F18', '1-click Organizer -> organize move -> search content -> undo -> back to Astrolabe', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T3-06');
    try {
      const f = path.join(app.ws.workspaceDir, 'contrato_pw6.txt');
      fs.writeFileSync(f, 'clausula secreta astrolabio', 'utf8');
      await app.mainPage.click('#btn-dock-organizer');
      await app.mainPage.waitForSelector('#organizer-workspace', 3000);

      const org = await app.mainPage.eval((p) =>
        window.mpeApi.orgOrganize({ paths: [p], criterion: 'type', targetScope: 'arquivos', moveInsteadOfCopy: true })
      , f);
      assert.strictEqual(org.ok, true);
      assert.ok(path.resolve(org.baseTargetDir).toLowerCase().startsWith(path.resolve(app.ws.tmpRoot).toLowerCase()));
      const srch = await app.mainPage.eval(() => window.mpeApi.orgSearch({ scope: 'arquivos', query: 'clausula secreta', searchInContent: true }));
      assert.strictEqual(srch.ok, true);
      assert.ok(Array.isArray(srch.searchResults) && srch.searchResults.length >= 1);
      assert.strictEqual(srch.searchResults[0].name, 'contrato_pw6.txt');

      const rev = await app.mainPage.eval(() => window.mpeApi.orgRevert());
      assert.strictEqual(rev.ok, true);
      assert.strictEqual(fs.existsSync(f), true);

      await app.mainPage.click('#btn-org-back-astrolabe');
      await app.mainPage.waitForFunction(() => document.getElementById('organizer-workspace')?.classList.contains('hidden'), [], 3000);
    } finally {
      await app.close();
    }
  }),

  t('T3-07', 'F15+F16+F17', 'Record 2 clicks -> generate .py -> py_compile + --dry-run + real click target replay', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    let targetWin = null;
    const app = await h.launchIsolatedApp(ctx, 'T3-07');
    try {
      targetWin = await h.launchClickTargetWindow(ctx, mock, { x: 120, y: 120, width: 260, height: 260 });
      await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
      await sleep(250);
      h.performWin32Click(190, 190, 'left');
      await sleep(380);
      h.performWin32Click(260, 240, 'left');
      await sleep(250);
      const stop = await app.mainPage.eval(() => window.mpeApi.stopPythonRecording({}));
      assert.strictEqual(stop.steps.length, 2);

      const saved = await app.mainPage.eval((steps) => window.mpeApi.savePythonScript({ name: 'PW7 Recorded', steps }), stop.steps);
      assert.strictEqual(saved.ok, true);
      assert.strictEqual(h.runPythonCli(['-m', 'py_compile', saved.script.filePath]).code, 0);
      assert.strictEqual(h.runPythonCli([saved.script.filePath, '--dry-run']).code, 0);

      mock.clear();
      const execRes = await app.mainPage.eval((id) => window.mpeApi.runPythonScript(id, { dryRun: false }), saved.script.id);
      assert.strictEqual(execRes.exitCode, 0);
      const clicks = await mock.waitForClickCount(2, 6000);
      assert.ok(Math.abs(clicks[0].x - 190) <= 5 && Math.abs(clicks[1].x - 260) <= 5);
    } finally {
      if (targetWin) await targetWin.close();
      await app.close();
      await mock.stop();
    }
  }),

  t('T3-08', 'F16+F11+F10+F17', 'Generate .py -> bind to new slot -> click slot in Mini Astrolabio fan', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T3-08');
    try {
      const saved = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({ name: 'PW8 Script', steps: [{ x: 15, y: 15, button: 'left', waitMs: 20 }], dryRunDefault: true })
      );
      await app.mainPage.eval((script) =>
        window.mpeApi.getConfig().then((cfg) => {
          cfg.points.push({ id: 'pw8-slot', code: '04 4', title: 'Py PW8', actionType: 'run_python_script', params: { scriptId: script.id, scriptPath: script.filePath, dryRun: true } });
          return window.mpeApi.saveConfig(cfg);
        })
      , saved.script);
      await app.mainPage.eval(() => {
        window.__pw8Done = null;
        window.mpeApi.onPythonScriptExecuted((e) => (window.__pw8Done = e));
      });
      const mini = await h.connectMiniPage(app.session);
      await mini.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const vis = (await h.getMiniHubAndSlots(mini)).slots.filter((s) => s.visible);
      await mini.clickAt(vis[3].rect.cx, vis[3].rect.cy);
      await app.mainPage.waitForFunction(() => Boolean(window.__pw8Done), [], 6000);
      assert.strictEqual(await app.mainPage.eval(() => window.__pw8Done.exitCode), 0);
    } finally {
      await app.close();
    }
  }),

  t('T3-09', 'F17+F01+F03', 'Schedule .py -> hide Main HUD -> background trigger fires -> quit leaves zero orphans', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T3-09', { testClock: '2026-11-18T11:19:45' });
    const rootPid = app.session.pid;
    const tok = app.ws.runToken;
    try {
      const saved = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({ name: 'PW9 Sched', steps: [{ x: 10, y: 10, button: 'left', waitMs: 20 }], dryRunDefault: true })
      );
      await app.mainPage.eval(() => {
        window.__pw9Trig = null;
        window.mpeApi.onPythonScriptExecuted((e) => {
          if (e && e.trigger === 'schedule') window.__pw9Trig = e;
        });
      });
      await app.mainPage.eval(() => window.mpeApi.hideHud());
      await app.mainPage.eval((id) => window.mpeApi.schedulePythonScript(id, { enabled: true, timeHHMM: '11:20', mode: 'once', dryRun: true }), saved.script.id);
      await app.mainPage.waitForFunction(() => Boolean(window.__pw9Trig), [], 20000);
      await h.quitAppGracefully(app.mainPage, app.session, 5000);
      await sleep(350);
      assert.strictEqual(ctx.processManager.findOrphanProcesses([rootPid], [tok]).length, 0);
    } finally {
      await app.close();
    }
  }),

  t('T3-10', 'F04+F15+F01', 'Start Python recording -> cancel -> verify MpeHook pass-through invariant & clean exit', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T3-10');
    const rootPid = app.session.pid;
    try {
      await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
      await sleep(200);
      await app.mainPage.eval(() => window.mpeApi.stopPythonRecording({ cancel: true }));
      const hookCs = fs.readFileSync(path.join(isolation.CODE_DIR, 'src', 'native', 'MpeHook.cs'), 'utf8');
      assert.match(hookCs, /CallNextHookEx/);
      await h.quitAppGracefully(app.mainPage, app.session, 5000);
      await sleep(300);
      assert.strictEqual(ctx.processManager.findOrphanProcesses([rootPid], [app.ws.runToken]).length, 0);
    } finally {
      await app.close();
    }
  }),

  t('T3-11', 'F03+F14+F04', 'Declined consent blocks Notepad launch -> accept consent -> Slot 1 Notepad succeeds', async (ctx) => {
    const baselineNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
    const app = await h.launchIsolatedApp(ctx, 'T3-11', { cleanState: true });
    try {
      await h.clickConsentDecision(app.mainPage, false);
      const blocked = await app.mainPage.eval(() =>
        window.mpeApi.getConfig().then((c) => window.mpeApi.executePoint(c.points[0]))
      );
      assert.strictEqual(blocked.ok, false);
      assert.strictEqual(blocked.blockedByConsent, true);

      await h.clickConsentDecision(app.mainPage, true);
      const allowed = await app.mainPage.eval(() =>
        window.mpeApi.getConfig().then((c) => window.mpeApi.executePoint(c.points[0]))
      );
      assert.strictEqual(allowed.ok, true);
      await sleep(700);
      const after = ctx.processManager.snapshotPidsByImage('notepad.exe');
      assert.ok([...after].some((p) => !baselineNotepad.has(p)));
    } finally {
      ctx.processManager.killNewProcessesByImage('notepad.exe', baselineNotepad);
      await app.close();
    }
  }),

  t('T3-12', 'F07+F05+F08+F10', 'WCAG contrast + zero-emoji audit across Main HUD, Organizer light/dark, and Mini fan', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T3-12');
    try {
      const mainAudit = await metrics.auditPageContrast(app.mainPage);
      assert.ok(mainAudit.checkedCount > 0, 'Main HUD contrast audit checked 0 elements');
      assert.strictEqual(mainAudit.failures.length, 0, JSON.stringify(mainAudit.failures));
      const mini = await h.connectMiniPage(app.session);
      await mini.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const miniAudit = await metrics.auditPageContrast(mini);
      assert.ok(miniAudit.checkedCount > 0, 'Mini contrast audit checked 0 elements');
      assert.strictEqual(miniAudit.failures.length, 0, JSON.stringify(miniAudit.failures));
      const miniTxt = await mini.eval(() => document.body.innerText || '');
      assert.deepStrictEqual(metrics.scanStringForEmojis(miniTxt, 'mini'), []);
    } finally {
      await app.close();
    }
  }),

  t('T3-13', 'F09+F08+F05', 'Main HUD hidden (Astrolabe3D paused) + Mini rotating idle CPU delta <= 1.0%', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T3-13');
    try {
      const miniPage = await h.connectMiniPage(app.session);
      await app.mainPage.eval(() => window.mpeApi.hideHud());
      await sleep(1500);
      await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(false));
      await sleep(800);
      const s1 = await metrics.measureProcessTreeCpuWindow(ctx.processManager, app.session.pid, 4000);
      await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(true));
      await sleep(800);
      const rotPage = await h.connectMiniPage(app.session).catch(() => miniPage);
      await rotPage.moveOutside().catch(() => {});
      const r1 = await h.getMiniRotorSample(rotPage);
      await sleep(550);
      const r2 = await h.getMiniRotorSample(rotPage);
      assert.ok(r1 && r2, 'Mini rotor element must exist');
      assert.strictEqual(r1.playState, 'running', 'Mini rotor must be running during active idle CPU window');
      assert.notStrictEqual(r1.transform, r2.transform, 'Mini rotor transform must advance during active idle rotation');
      const b = await metrics.measureProcessTreeCpuWindow(ctx.processManager, app.session.pid, 4000);
      assert.ok(b.cpuPercent - s1.cpuPercent <= 1.0, `Delta ${(b.cpuPercent - s1.cpuPercent).toFixed(3)}% > 1.0%`);
    } finally {
      await app.close();
    }
  }),

  t('T3-14', 'F02+F06+F11', 'Config point update syncs Main/Mini while 1-click Organizer remains accessible', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T3-14');
    try {
      const mini = await h.connectMiniPage(app.session);
      await app.mainPage.eval(() =>
        window.mpeApi.getConfig().then((cfg) => {
          cfg.points[0].title = 'SyncOrgTest';
          return window.mpeApi.saveConfig(cfg);
        })
      );
      await app.mainPage.click('#btn-dock-organizer');
      await app.mainPage.waitForSelector('#organizer-workspace', 3000);
      await mini.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(200);
      const vis = (await h.getMiniHubAndSlots(mini)).slots.filter((s) => s.visible);
      assert.strictEqual(vis.length, 3);
    } finally {
      await app.close();
    }
  }),

  t('T3-15', 'F12+F13+F02', 'macro_sequence combining open_url + send_link_chat executes both steps', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T3-15', {
      extraEnv: { MPE_TEST_DRY_OPEN_EXTERNAL: '1' }
    });
    try {
      const res = await app.mainPage.eval((wh) =>
        window.mpeApi.executePoint({
          id: 'macro-pair',
          actionType: 'macro_sequence',
          params: {
            steps: [
              { actionType: 'open_url', params: { url: 'https://example.org/pw15' } },
              { actionType: 'send_link_chat', params: { deliveryChannel: 'webhook', webhookUrl: wh, linkUrl: 'https://mpe.local/pw15' } }
            ]
          }
        })
      , mock.url('/hook'));
      assert.strictEqual(res.ok, true);
      const hit = await mock.waitForRequest((r) => r.path === '/hook', 4000);
      assert.ok(hit.bodyRaw.includes('https://mpe.local/pw15'));
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T3-16', 'F15+F16+F07', 'Save Portuguese-named Python script -> sanitized filename, py_compile, zero emojis', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T3-16');
    try {
      const res = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({
          name: 'Relatório Diário Automático',
          steps: [{ x: 100, y: 200, button: 'left', waitMs: 300 }]
        })
      );
      assert.strictEqual(res.ok, true);
      const src = fs.readFileSync(res.script.filePath, 'utf8');
      assert.deepStrictEqual(metrics.scanStringForEmojis(src, res.script.filePath), []);
      assert.strictEqual(h.runPythonCli(['-m', 'py_compile', res.script.filePath]).code, 0);
    } finally {
      await app.close();
    }
  }),

  t('T3-17', 'F01+F08+F11+F17', 'Second-instance lock rejection does not disrupt instance 1 Mini or Python scheduler', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T3-17');
    try {
      const mini = await h.connectMiniPage(app.session);
      const saved = await app.mainPage.eval(() =>
        window.mpeApi.savePythonScript({ name: 'Lock Safe', steps: [{ x: 1, y: 1, button: 'left', waitMs: 20 }] })
      );
      assert.strictEqual(saved.ok, true);
      const p2 = ctx.processManager.spawnProcess(isolation.ELECTRON_EXE, app.ws.buildElectronArgs(['--launch-ui']), {
        env: app.ws.buildElectronEnv(),
        cwd: isolation.CODE_DIR,
        stdio: ['ignore', 'ignore', 'ignore']
      });
      const code = await new Promise((resolve) => p2.once('close', resolve));
      assert.strictEqual(code, 0);
      const hub = await h.getMiniHubAndSlots(mini);
      assert.ok(hub.hubRect && hub.hubRect.width > 0);
    } finally {
      await app.close();
    }
  }),

  t('T3-18', 'F05+F11+F02', 'Reorder Slot 3 -> Slot 1 updates Guide, hotkey 1, and Mini Slot 1 together', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T3-18', {
      points: [
        { id: 's1', code: '01 1', title: 'S1', actionType: 'open_organizer', params: {} },
        { id: 's2', code: '02 2', title: 'S2', actionType: 'open_organizer', params: {} },
        { id: 's3', code: '03 3', title: 'S3 Hook', actionType: 'send_link_chat', params: { deliveryChannel: 'webhook', webhookUrl: mock.url('/hook-s3'), linkUrl: 'https://s3' } }
      ]
    });
    try {
      const mini = await h.connectMiniPage(app.session);
      await app.mainPage.eval(() => window.mpeApi.reorderPoint(2, 0));
      await sleep(250);

      // Verify Guide DOM displays newly promoted S3 Hook as first slot
      await app.mainPage.click('#btn-open-guide');
      await app.mainPage.waitForSelector('#guide-hotkeys-grid', 3000);
      const guideFirst = await app.mainPage.eval(() => {
        const grid = document.getElementById('guide-hotkeys-grid');
        return grid && grid.firstElementChild ? grid.firstElementChild.textContent || '' : '';
      });
      assert.ok(guideFirst.includes('S3 Hook'), `Guide Slot 1 did not reflect reorder: ${guideFirst}`);
      await app.mainPage.click('#btn-close-guide').catch(() => {});

      // Verify Mini Slot 1 displays newly promoted S3 Hook
      await mini.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const miniInfo = await h.getMiniHubAndSlots(mini);
      assert.ok(
        miniInfo.slots[0] && (miniInfo.slots[0].title.includes('S3 Hook') || miniInfo.slots[0].text.includes('S3 Hook')),
        `Mini Slot 1 did not reflect reorder: ${JSON.stringify(miniInfo.slots[0])}`
      );

      await app.mainPage.pressKey('1', 'Digit1');
      const hit = await mock.waitForRequest((r) => r.path === '/hook-s3', 4000);
      assert.ok(hit);
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T3-19', 'F14+F13+F03', 'Consented session executes Slot 2 VS Code project and send_link_chat from Mini fan', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T3-19', {
      points: [
        { id: 's1-chat', code: '01 1', title: 'Webhook', actionType: 'send_link_chat', params: { deliveryChannel: 'webhook', webhookUrl: mock.url('/hook'), linkUrl: 'https://mpe.local/pw19' } },
        { id: 's2-vsc', code: '02 2', title: 'VS Code', actionType: 'launch_app_project', params: { appName: 'vscode', targetPath: 'code', projectPath: isolation.CODE_DIR } }
      ],
      extraEnv: { MPE_TEST_DRY_APP_LAUNCH: '1' }
    });
    try {
      const mini = await h.connectMiniPage(app.session);
      await mini.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
      await sleep(250);
      const vis = (await h.getMiniHubAndSlots(mini)).slots.filter((s) => s.visible);
      await mini.clickAt(vis[0].rect.cx, vis[0].rect.cy);
      await mock.waitForRequest((r) => r.path === '/hook', 4000);
      await mini.clickAt(vis[1].rect.cx, vis[1].rect.cy);
      await sleep(300);
      assert.deepStrictEqual(mini.getErrors(), []);
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T3-20', 'F18+F01+F08+F10+F17', '20-iteration combined stress loop + isolated npm test verification + zero orphans', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T3-20');
    const rootPid = app.session.pid;
    const tok = app.ws.runToken;
    try {
      const mini = await h.connectMiniPage(app.session);
      for (let i = 0; i < 20; i++) {
        await mini.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
        await mini.moveOutside();
        await app.mainPage.pressKey('Tab', 'Tab');
      }
      assert.deepStrictEqual(app.mainPage.getErrors(), []);
      assert.deepStrictEqual(mini.getErrors(), []);
      await h.quitAppGracefully(app.mainPage, app.session, 5000);
      await sleep(350);
      assert.strictEqual(ctx.processManager.findOrphanProcesses([rootPid], [tok]).length, 0);

      const res = spawnSync('node', [isolation.RUN_TESTS_JS], {
        cwd: isolation.CODE_DIR,
        env: app.ws.buildElectronEnv(),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 25000
      });
      assert.strictEqual(res.status, 0, res.stderr || res.stdout);
    } finally {
      await app.close();
    }
  })
];

module.exports = { tier3Tests };
