'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const isolation = require('../lib/isolation');
const { launchElectronWithCdp, sleep } = require('../lib/cdpClient');
const { MockServer } = require('../lib/mockServer');
const metrics = require('../lib/metrics');
const h = require('../lib/helpers');

function t(id, features, name, fn) {
  return { id, tier: 4, feature: features, name, fn };
}

const tier4Tests = [
  // =========================================================================
  // Scenario 1: Clean-Install Onboarding -> Consent -> Slots 1-4 Execution (Main & Mini)
  // =========================================================================
  t(
    'T4-01',
    'F02,F03,F05,F10,F12,F13,F14',
    'Scenario 1: Clean onboarding -> Consent gate -> Slot 1 Notepad + Slot 2 VS Code + Link + Chat/Bot (Main & Mini)',
    async (ctx) => {
      const baselineNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
      const mock = new MockServer();
      await mock.start();
      isolation.assertCodeIsolationReady();

      const ws = isolation.createIsolatedWorkspace(ctx.runId, 'T4-01', { cleanState: true });
      ctx.processManager.registerToken(ws.runToken);
      ctx.processManager.registerCleanup(() => ws.cleanup());

      let s1 = null;
      let s2 = null;
      try {
        s1 = await launchElectronWithCdp({
          electronExe: isolation.ELECTRON_EXE,
          args: ws.buildElectronArgs(),
          env: ws.buildElectronEnv({ MPE_TEST_DRY_APP_LAUNCH: '1', MPE_TEST_OPEN_URL_HTTP: '1' }),
          cwd: isolation.CODE_DIR,
          userDataDir: ws.userDataDir,
          processManager: ctx.processManager
        });
        const p1 = await s1.connectTarget('index.html');
        await p1.waitForFunction(() => Boolean(window.mpeApi));

        // 1. Clean state: consent must be unaccepted and block privileged actions
        const initialConsent = await p1.eval(() => window.mpeApi.getConsentStatus());
        assert.strictEqual(initialConsent.accepted, false, 'Clean install must start unaccepted');
        const blockedMini = await p1.eval(() => window.mpeApi.toggleMiniAstrolabe(true));
        assert.strictEqual(blockedMini.blockedByConsent, true);

        // 2. Accept consent and verify persistence across restart
        await h.clickConsentDecision(p1, true);
        await sleep(200);
        await p1.eval(() => window.mpeApi.quitApp()).catch(() => {});
        await s1.waitForExit(5000);
        await s1.close();

        s2 = await launchElectronWithCdp({
          electronExe: isolation.ELECTRON_EXE,
          args: [
            isolation.CODE_DIR,
            `--user-data-dir=${ws.userDataDir}`,
            `--config-path=${ws.configPath}`,
            '--remote-debugging-port=0',
            `--mpe-e2e-token=${ws.runToken}`
          ],
          env: {
            ...ws.buildElectronEnv(),
            MPE_FORCE_CLEAN_CONSENT: '0',
            MPE_TEST_DRY_APP_LAUNCH: '1',
            MPE_TEST_OPEN_URL_HTTP: '1'
          },
          cwd: isolation.CODE_DIR,
          userDataDir: ws.userDataDir,
          processManager: ctx.processManager
        });
        const p2 = await s2.connectTarget('index.html');
        await p2.waitForFunction(() => Boolean(window.mpeApi));
        const persisted = await p2.eval(() => window.mpeApi.getConsentStatus());
        assert.strictEqual(persisted.accepted, true);

        // 3. Configure Slot 3 (open_url) & Slot 4 (send_link_chat) while preserving Slot 1 Notepad & Slot 2 VS Code
        await p2.eval((okUrl, whUrl, projDir) => {
          return window.mpeApi.getConfig().then((cfg) => {
            cfg.points[1].params.projectPath = projDir;
            cfg.points.push(
              {
                id: 't4-url',
                code: '03 3',
                title: 'Abrir Link Mock',
                actionType: 'open_url',
                params: { url: okUrl }
              },
              {
                id: 't4-chat',
                code: '04 4',
                title: 'Enviar Link Chat',
                actionType: 'send_link_chat',
                params: {
                  deliveryChannel: 'webhook',
                  webhookUrl: whUrl,
                  linkUrl: 'https://mpe.local/scenario1'
                }
              }
            );
            return window.mpeApi.saveConfig(cfg);
          });
        }, mock.url('/ok?t4=1'), mock.url('/hook'), ws.workspaceDir);

        // 4. Enable Mini Astrolabio and trigger Slot 1 (Notepad), Slot 2 (VS Code), Slot 3 (URL), Slot 4 (Chat)
        await p2.eval(() => window.mpeApi.toggleMiniAstrolabe(true));
        const mini = await h.connectMiniPage(s2);
        await mini.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
        await sleep(300);
        const info = await h.getMiniHubAndSlots(mini);
        const vis = info.slots.filter((s) => s.visible);
        assert.ok(vis.length >= 4, `Expected >=4 Mini slots, got ${vis.length}`);

        // Execute Slot 1 Notepad & verify process
        await mini.clickAt(vis[0].rect.cx, vis[0].rect.cy);
        await sleep(700);
        const afterNotepad = ctx.processManager.snapshotPidsByImage('notepad.exe');
        assert.ok([...afterNotepad].some((pid) => !baselineNotepad.has(pid)), 'Notepad must launch from Mini Slot 1');

        // Execute Slot 2 VS Code & verify Mini execution feedback, then Slot 3 Link & Slot 4 Chat Webhook
        await mini.eval(() => {
          const root = document.getElementById('mini-root');
          if (root) {
            delete root.dataset.lastExecOk;
            delete root.dataset.lastExecType;
            delete root.dataset.lastExecId;
          }
          const st = document.getElementById('mini-status');
          if (st) st.classList.add('hidden');
        });
        await mini.clickAt(vis[1].rect.cx, vis[1].rect.cy);
        await mini.waitForFunction(() => {
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
        const slot2Exec = await mini.eval(() => {
          const root = document.getElementById('mini-root');
          const st = document.getElementById('mini-status');
          return {
            lastExecOk: root ? root.dataset.lastExecOk : undefined,
            lastExecType: root ? root.dataset.lastExecType : undefined,
            statusText: st ? (st.textContent || '').trim() : '',
            statusIsError: st ? st.classList.contains('is-error') : false
          };
        });
        assert.strictEqual(slot2Exec.lastExecOk, 'true', `Mini Slot 2 VS Code failed: ${JSON.stringify(slot2Exec)}`);
        assert.strictEqual(slot2Exec.lastExecType, 'launch_app_project', `Unexpected Mini Slot 2 type: ${JSON.stringify(slot2Exec)}`);
        assert.strictEqual(slot2Exec.statusIsError, false, `Mini Slot 2 showed error status: ${JSON.stringify(slot2Exec)}`);

        await mini.clickAt(vis[2].rect.cx, vis[2].rect.cy);
        const urlHit = await mock.waitForRequest((r) => r.path === '/ok' && r.query.t4 === '1', 5000);
        assert.strictEqual(urlHit.method, 'GET');
        await mini.clickAt(vis[3].rect.cx, vis[3].rect.cy);
        const chatHit = await mock.waitForRequest((r) => r.path === '/hook', 5000);
        assert.ok(chatHit.bodyRaw.includes('https://mpe.local/scenario1'));
        assert.deepStrictEqual(p2.getErrors(), []);
        assert.deepStrictEqual(mini.getErrors(), []);
      } finally {
        ctx.processManager.killNewProcessesByImage('notepad.exe', baselineNotepad);
        if (s1) await s1.close();
        if (s2) await s2.close();
        ws.cleanup();
        await mock.stop();
      }
    }
  ),

  // =========================================================================
  // Scenario 2: Daily Production Workflow (1-Click Organizer + Mini A-B-A CPU <= 1% + Hover Pause + Live Sync)
  // =========================================================================
  t(
    'T4-02',
    'F02,F06,F08,F09,F10,F11',
    'Scenario 2: 1-Click Organizer -> Mini Toggle/Resize -> A-B-A 8s Idle CPU <= 1% -> Hover Pause/Leave -> Live Sync',
    async (ctx) => {
      const app = await h.launchIsolatedApp(ctx, 'T4-02');
      try {
        // 1. 1-click File Organization from Main HUD
        const f1 = path.join(app.ws.workspaceDir, 'fatura_prod.pdf');
        fs.writeFileSync(f1, '%PDF-1.4 test', 'utf8');
        await app.mainPage.click('#btn-dock-organizer');
        await app.mainPage.waitForSelector('#organizer-workspace', 3000);
        const orgRes = await app.mainPage.eval((p) =>
          window.mpeApi.orgOrganize({ paths: [p], criterion: 'type', targetScope: 'arquivos', moveInsteadOfCopy: false })
        , f1);
        assert.strictEqual(orgRes.ok, true);
        assert.ok(path.resolve(orgRes.baseTargetDir).toLowerCase().startsWith(path.resolve(app.ws.tmpRoot).toLowerCase()));
        await app.mainPage.click('#btn-org-back-astrolabe');

        // 2. Hide Main HUD (pauses Astrolabe3D) and prove Mini rotation + hover pause + leave resume
        const mini = await h.connectMiniPage(app.session);
        await app.mainPage.eval(() => window.mpeApi.hideHud());
        await sleep(1500);

        await mini.moveOutside();
        await sleep(200);
        const r0 = await h.getMiniRotorSample(mini);
        await sleep(600);
        const r1 = await h.getMiniRotorSample(mini);
        assert.ok(r0 && r1, 'Mini rotor element must exist');
        assert.strictEqual(r0.playState, 'running');
        assert.notStrictEqual(r0.transform, r1.transform, 'Mini must rotate at rest');

        await mini.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
        await sleep(200);
        const paused = await h.getMiniRotorSample(mini);
        assert.ok(paused, 'Mini rotor element must exist');
        assert.strictEqual(paused.playState, 'paused', 'Mini must pause on hover');
        await mini.moveOutside();
        await sleep(200);

        // 3. A-B-A 8s paired CPU measurement (Static1 -> IdleRotating -> Static2) with flake retry
        let deltaCpu = Infinity;
        for (let attempt = 0; attempt < 2; attempt++) {
          await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(false));
          await sleep(1500);
          const s1 = await metrics.measureProcessTreeCpuWindow(ctx.processManager, app.session.pid, 8000);

          await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(true));
          await sleep(1500);
          const rotPage = await h.connectMiniPage(app.session).catch(() => mini);
          await rotPage.moveOutside().catch(() => {});
          const act0 = await h.getMiniRotorSample(rotPage);
          await sleep(500);
          const act1 = await h.getMiniRotorSample(rotPage);
          assert.ok(act0 && act1 && act0.playState === 'running' && act0.transform !== act1.transform, 'Mini rotor must be actively rotating during idle CPU window');
          const b = await metrics.measureProcessTreeCpuWindow(ctx.processManager, app.session.pid, 8000);

          await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(false));
          await sleep(1500);
          const s2 = await metrics.measureProcessTreeCpuWindow(ctx.processManager, app.session.pid, 8000);

          const drift = Math.abs(s1.cpuPercent - s2.cpuPercent);
          const staticAvg = (s1.cpuPercent + s2.cpuPercent) / 2;
          deltaCpu = b.cpuPercent - staticAvg;
          if (drift <= 1.5 || attempt === 1) break;
        }
        assert.ok(deltaCpu <= 1.0, `Mini idle CPU delta ${deltaCpu.toFixed(3)}% exceeded 1.0% budget`);

        // 4. Re-enable Mini, resize, and verify live slot reorder sync
        await app.mainPage.eval(() => window.mpeApi.toggleMiniAstrolabe(true));
        await app.mainPage.eval(() => window.mpeApi.updateMiniAstrolabeLayout({ scale: 1.25 }));
        await app.mainPage.eval(() => window.mpeApi.reorderPoint(0, 1));
        await sleep(250);
        const cfg = app.ws.readConfig();
        assert.strictEqual(cfg.points[0].id, 'slot-2-vscode');
        assert.strictEqual(cfg.miniAstrolabe.scale, 1.25);
      } finally {
        await app.close();
      }
    }
  ),

  // =========================================================================
  // Scenario 3: Older-User Accessibility (WCAG >=7:1 / >=4.5:1 + Font Legibility) & Zero-Emoji Audit
  // =========================================================================
  t(
    'T4-03',
    'F05,F07,F18',
    'Scenario 3: WCAG 2.1 Contrast (>=7:1 primary, >=4.5:1 secondary) across Dark/Light & Mini + Font Size + Full Zero-Emoji Audit',
    async (ctx) => {
      // 1. Full static zero-emoji scan across codebase
      const staticScan = metrics.scanDirectoriesForEmojis(
        [
          path.join(isolation.CODE_DIR, 'src'),
          path.join(isolation.CODE_DIR, 'scripts'),
          path.join(isolation.CODE_DIR, 'tests')
        ],
        [
          isolation.PROD_CONFIG_PATH,
          path.join(isolation.CODE_DIR, 'package.json'),
          path.join(isolation.ROOT_DIR, 'AGENTS.md'),
          isolation.TESTES_MD
        ]
      );
      assert.strictEqual(
        staticScan.violations.length,
        0,
        `Static zero-emoji audit failed: ${JSON.stringify(staticScan.violations.slice(0, 10))}`
      );

      // 2. Live DOM contrast + font size audit (Dark Main + Organizer Dark + Organizer Light + Mini Astrolabio)
      const app = await h.launchIsolatedApp(ctx, 'T4-03');
      try {
        const darkMainAudit = await metrics.auditPageContrast(app.mainPage, { primaryMin: 7.0, secondaryMin: 4.5 });
        assert.ok(darkMainAudit.checkedCount > 0, 'Dark Main HUD contrast audit checked 0 elements');
        assert.strictEqual(
          darkMainAudit.failures.length,
          0,
          `Dark Main HUD contrast failures: ${JSON.stringify(darkMainAudit.failures)}`
        );

        await app.mainPage.click('#btn-dock-organizer');
        await app.mainPage.waitForSelector('#organizer-workspace', 3000);
        const darkOrgAudit = await metrics.auditPageContrast(app.mainPage, { primaryMin: 7.0, secondaryMin: 4.5 });
        assert.ok(darkOrgAudit.checkedCount > 0, 'Dark Organizer contrast audit checked 0 elements');
        assert.strictEqual(
          darkOrgAudit.failures.length,
          0,
          `Dark Organizer contrast failures: ${JSON.stringify(darkOrgAudit.failures)}`
        );

        await app.mainPage.eval(() => document.body.classList.add('theme-light'));
        await sleep(150);
        const lightOrgAudit = await metrics.auditPageContrast(app.mainPage, { primaryMin: 7.0, secondaryMin: 4.5 });
        assert.ok(lightOrgAudit.checkedCount > 0, 'Light Organizer contrast audit checked 0 elements');
        assert.strictEqual(
          lightOrgAudit.failures.length,
          0,
          `Light Organizer contrast failures: ${JSON.stringify(lightOrgAudit.failures)}`
        );

        const mini = await h.connectMiniPage(app.session);
        await mini.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
        await sleep(250);
        const miniAudit = await metrics.auditPageContrast(mini, { primaryMin: 7.0, secondaryMin: 4.5 });
        assert.ok(miniAudit.checkedCount > 0, 'Mini contrast audit checked 0 elements');
        assert.strictEqual(
          miniAudit.failures.length,
          0,
          `Mini Astrolabio contrast failures: ${JSON.stringify(miniAudit.failures)}`
        );

        const miniInfo = await h.getMiniHubAndSlots(mini);
        const visSlots = miniInfo.slots.filter((s) => s.visible);
        assert.ok(visSlots.length >= 2);
        for (const s of visSlots) {
          assert.ok(s.fontSize >= 14, `Mini slot font size ${s.fontSize}px < 14px`);
          assert.ok(s.fontWeight >= 700, `Mini slot font weight ${s.fontWeight} < 700`);
          assert.ok(s.rect.width >= 28 && s.rect.height >= 28, `Mini slot hitbox too small: ${JSON.stringify(s.rect)}`);
        }

        // Runtime DOM & stdio zero-emoji check
        const domTxt =
          (await app.mainPage.eval(() => document.body.innerText || '')) +
          '\n' +
          (await mini.eval(() => document.body.innerText || ''));
        assert.deepStrictEqual(metrics.scanStringForEmojis(domTxt, 'live-dom'), []);
        assert.deepStrictEqual(metrics.scanStringForEmojis(app.session.stdout + app.session.stderr, 'live-stdio'), []);
      } finally {
        await app.close();
      }
    }
  ),

  // =========================================================================
  // Scenario 4: Python Auto-Script End-to-End (Record -> Generate -> Dry-Run + Click Target -> Schedule)
  // =========================================================================
  t(
    'T4-04',
    'F04,F15,F16,F17',
    'Scenario 4: Python Auto-Script E2E: Record with visual indicator -> Pure-stdlib ctypes .py -> Dry-Run + Real Replay -> Background Schedule',
    async (ctx) => {
      const mock = new MockServer();
      await mock.start();
      let targetWin = null;
      const app = await h.launchIsolatedApp(ctx, 'T4-04', { testClock: '2026-11-18T17:59:35' });
      try {
        targetWin = await h.launchClickTargetWindow(ctx, mock, { x: 120, y: 120, width: 260, height: 260 });

        // 1. Start manual recording and verify active indicator
        const start = await app.mainPage.eval(() => window.mpeApi.startPythonRecording({}));
        assert.strictEqual(start.ok, true);
        const recPage = await h.connectRecorderPage(app.session);
        const recText = await recPage.eval(() => (document.body.innerText || '').trim());
        assert.ok(recText.length > 0, 'Recorder visual indicator must show text');
        assert.deepStrictEqual(metrics.scanStringForEmojis(recText, 'recorder-overlay'), []);

        // 2. Perform 2 real clicks inside isolated Click Target Window separated by ~450ms
        await sleep(250);
        h.performWin32Click(180, 180, 'left');
        await sleep(450);
        h.performWin32Click(260, 240, 'left');
        await sleep(250);

        const stop = await app.mainPage.eval(() => window.mpeApi.stopPythonRecording({}));
        assert.strictEqual(stop.ok, true);
        assert.strictEqual(stop.steps.length, 2, `Expected 2 recorded clicks, got ${JSON.stringify(stop.steps)}`);
        assert.ok(Math.abs(stop.steps[0].x - 180) <= 5 && Math.abs(stop.steps[0].y - 180) <= 5);
        assert.ok(Math.abs(stop.steps[1].x - 260) <= 5 && Math.abs(stop.steps[1].y - 240) <= 5);
        assert.ok(stop.steps[1].waitMs >= 250 && stop.steps[1].waitMs <= 1500);

        // 3. Save .py script & validate stdlib + py_compile + --dry-run
        const saved = await app.mainPage.eval((steps) =>
          window.mpeApi.savePythonScript({ name: 'Scenario 4 Auto', steps })
        , stop.steps);
        assert.strictEqual(saved.ok, true);
        const src = fs.readFileSync(saved.script.filePath, 'utf8');
        assert.match(src, /SetProcessDPIAware/);
        assert.doesNotMatch(src, /pyautogui|pynput/i);
        assert.deepStrictEqual(metrics.scanStringForEmojis(src, saved.script.filePath), []);
        assert.strictEqual(h.runPythonCli(['-m', 'py_compile', saved.script.filePath]).code, 0);

        mock.clear();
        const dry = h.runPythonCli([saved.script.filePath, '--dry-run']);
        assert.strictEqual(dry.code, 0, dry.stderr);
        assert.ok(
          dry.stdout.includes(String(stop.steps[0].x)) && dry.stdout.includes(String(stop.steps[0].y)),
          `--dry-run stdout missing step 0 coords (${stop.steps[0].x}, ${stop.steps[0].y}): ${dry.stdout}`
        );
        assert.ok(
          dry.stdout.includes(String(stop.steps[1].x)) && dry.stdout.includes(String(stop.steps[1].y)),
          `--dry-run stdout missing step 1 coords (${stop.steps[1].x}, ${stop.steps[1].y}): ${dry.stdout}`
        );
        assert.strictEqual(mock.getClickEvents().length, 0, '--dry-run must not send real OS clicks');

        // 4. Real on-demand execution hits isolated Click Target Window
        const realRun = await app.mainPage.eval((id) => window.mpeApi.runPythonScript(id, { dryRun: false }), saved.script.id);
        assert.strictEqual(realRun.exitCode, 0);
        const replayClicks = await mock.waitForClickCount(2, 6000);
        assert.ok(Math.abs(replayClicks[0].x - 180) <= 5 && Math.abs(replayClicks[1].x - 260) <= 5);

        // 5. Schedule execution in background (--test-clock 17:59:35 -> 18:00:00)
        mock.clear();
        await app.mainPage.eval(() => {
          window.__t4SchedExec = null;
          window.mpeApi.onPythonScriptExecuted((e) => {
            if (e && e.trigger === 'schedule') window.__t4SchedExec = e;
          });
        });
        await app.mainPage.eval(() => window.mpeApi.hideHud());
        await app.mainPage.eval((id) =>
          window.mpeApi.schedulePythonScript(id, { enabled: true, timeHHMM: '18:00', mode: 'daily', dryRun: false })
        , saved.script.id);
        await app.mainPage.waitForFunction(() => Boolean(window.__t4SchedExec), [], 28000);
        const schedClicks = await mock.waitForClickCount(2, 6000);
        assert.strictEqual(schedClicks.length >= 2, true);
      } finally {
        if (targetWin) await targetWin.close();
        await app.close();
        await mock.stop();
      }
    }
  ),

  // =========================================================================
  // Scenario 5: 25-Cycle Stability Stress & Zero-Orphan Verification
  // =========================================================================
  t(
    'T4-05',
    'F01,F04,F08,F09,F17,F18',
    'Scenario 5: 25-Cycle HUD/Mini/2D-3D/Slot Stress Test (0 errors, <=60MB growth, constant MpeHook PID, 0 orphans)',
    async (ctx) => {
      const mock = new MockServer();
      await mock.start();
      const app = await h.launchIsolatedApp(ctx, 'T4-05', {
        points: [
          {
            id: 'stress-hook',
            code: '01 1',
            title: 'Stress Hook',
            actionType: 'send_link_chat',
            params: { deliveryChannel: 'webhook', webhookUrl: mock.url('/hook'), linkUrl: 'https://mpe.local/stress' }
          },
          { id: 'stress-org', code: '02 2', title: 'Stress Org', actionType: 'open_organizer', params: {} }
        ]
      });
      const rootPid = app.session.pid;
      const token = app.ws.runToken;
      try {
        const mini = await h.connectMiniPage(app.session);
        const initialHooks = ctx.processManager.getProcessTreeStats(rootPid).processes.filter((p) =>
          p.name.toLowerCase().includes('mpehook')
        );
        assert.strictEqual(
          initialHooks.length,
          1,
          `Expected exactly 1 initial MpeHook.exe daemon, found ${initialHooks.length}`
        );
        const initialHookPid = initialHooks[0].pid;

        let memCycle5 = 0;
        let memCycle25 = 0;
        const durations = [];

        for (let cycle = 1; cycle <= 25; cycle++) {
          const cStart = Date.now();
          await app.mainPage.click('#btn-dock-organizer');
          await app.mainPage.waitForSelector('#organizer-workspace', 2500);
          await app.mainPage.click('#btn-org-back-astrolabe');
          await app.mainPage.pressKey('Tab', 'Tab');

          await mini.hover('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot');
          await sleep(60);
          if (cycle % 5 === 0) {
            const info = await h.getMiniHubAndSlots(mini);
            assert.ok(info.slots[0] && info.slots[0].visible, `Mini slot 1 must be visible on cycle ${cycle}`);
            await mini.clickAt(info.slots[0].rect.cx, info.slots[0].rect.cy);
            await mock.waitForRequest((r) => r.path === '/hook', 4000);
          }
          await mini.moveOutside();
          await app.mainPage.eval(() => window.mpeApi.hideHud());
          await sleep(40);
          await app.mainPage.eval(() => window.mpeApi.executePoint({ id: 'wake', actionType: 'open_organizer', params: {} }));

          durations.push(Date.now() - cStart);

          if (cycle === 5) {
            memCycle5 = ctx.processManager.getProcessTreeStats(rootPid).totalWorkingSetBytes;
          }
          if (cycle === 25) {
            memCycle25 = ctx.processManager.getProcessTreeStats(rootPid).totalWorkingSetBytes;
          }
        }

        assert.deepStrictEqual(app.mainPage.getErrors(), [], 'Uncaught errors on Main HUD during 25-cycle stress');
        assert.deepStrictEqual(mini.getErrors(), [], 'Uncaught errors on Mini Astrolabio during 25-cycle stress');

        const endHooks = ctx.processManager.getProcessTreeStats(rootPid).processes.filter((p) =>
          p.name.toLowerCase().includes('mpehook')
        );
        assert.strictEqual(endHooks.length, 1, `Expected 1 MpeHook.exe daemon, found ${endHooks.length}`);
        assert.strictEqual(endHooks[0].pid, initialHookPid, 'MpeHook.exe PID changed (unexpected respawn/leak)');

        const growthMb = (memCycle25 - memCycle5) / (1024 * 1024);
        assert.ok(growthMb <= 60, `Post-warmup memory growth ${growthMb.toFixed(1)} MB exceeded 60 MB limit`);

        durations.sort((a, b) => a - b);
        const p95 = durations[Math.floor(durations.length * 0.95)];
        assert.ok(p95 <= 3500, `Cycle p95 latency too high: ${p95}ms`);

        const exit = await h.quitAppGracefully(app.mainPage, app.session, 5000);
        assert.strictEqual(exit.code, 0);
        await sleep(500);

        const orphans = ctx.processManager.findOrphanProcesses([rootPid], [token]);
        assert.strictEqual(orphans.length, 0, `Orphan processes remained after stress run: ${JSON.stringify(orphans)}`);
      } finally {
        await app.close();
        await mock.stop();
      }
    }
  )
];

module.exports = { tier4Tests };
