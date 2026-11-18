const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ConfigManager = require('../src/main/configManager');
const ConsentManager = require('../src/main/consentManager');
const StartupManager = require('../src/main/startupManager');
const HookBridge = require('../src/main/hookBridge');

function getProjectHookPids(codeDir) {
  if (process.platform !== 'win32') return [];
  try {
    const targetPrefix = path.resolve(codeDir).toLowerCase();
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-Process MpeHook -ErrorAction SilentlyContinue | Select-Object Id, Path | ConvertTo-Json -Compress"
      ],
      { encoding: 'utf8', windowsHide: true }
    ).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter((p) => p && p.Path && String(p.Path).toLowerCase().startsWith(targetPrefix))
      .map((p) => p.Id);
  } catch (_) {
    return [];
  }
}

async function runM1Suite({ runCase, makeTempDir, rmSafe, CODE_DIR, ROOT_DIR }) {
  await runCase('M1 - Lifecycle & Lock', 'M1-01', 'Single-instance lock guard e hooks de encerramento em main.js', () => {
    const mainJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'main', 'main.js'), 'utf8');
    const lockIdx = mainJs.indexOf('app.requestSingleInstanceLock()');
    const readyIdx = mainJs.indexOf('app.whenReady()');
    assert.ok(lockIdx > 0 && readyIdx > lockIdx, 'requestSingleInstanceLock deve vir antes de app.whenReady()');

    const lockBlock = mainJs.slice(lockIdx, readyIdx);
    assert.ok(lockBlock.includes('if (!gotTheLock)'), 'Guarda if (!gotTheLock) obrigatoria');
    assert.ok(lockBlock.includes('app.exit(0)') && lockBlock.includes('return;'), 'Ramo !gotTheLock deve executar app.exit(0) e return antes de whenReady');

    assert.ok(mainJs.includes("process.on('SIGINT'"), 'Handler SIGINT obrigatorio');
    assert.ok(mainJs.includes("process.on('SIGTERM'"), 'Handler SIGTERM obrigatorio');
    assert.ok(mainJs.includes("app.on('before-quit'"), 'Handler before-quit obrigatorio');
    assert.ok(mainJs.includes("app.on('will-quit'"), 'Handler will-quit obrigatorio');
    assert.ok(mainJs.includes('cleanupSubsystems(') && mainJs.includes('hookBridge.stop()'), 'cleanupSubsystems deve chamar hookBridge.stop()');
    assert.ok(mainJs.includes("!isQuitting && consentManager.isActionAllowed('backgroundExecution')"), 'Close/window-all-closed devem respeitar consentimento granular backgroundExecution');
    return 'Lock guard antes de whenReady + SIGINT/SIGTERM/before-quit/will-quit + close gate verificados';
  });

  await runCase('M1 - Config & Slots', 'M1-02', 'Config isolada, defaults clean-state, reorderPoint e preservacao de producao', () => {
    const tmpDir = makeTempDir('mpe-m1-cfg-');
    const isolatedPath = path.join(tmpDir, 'isolated.config.json');
    const prevEnv = process.env.MPE_CONFIG_PATH;
    try {
      process.env.MPE_CONFIG_PATH = isolatedPath;
      const cm = new ConfigManager(ROOT_DIR, CODE_DIR, {
        cleanState: true,
        userDataDir: path.join(tmpDir, 'userdata')
      });
      assert.strictEqual(cm.isIsolated, true, 'ConfigManager deveria estar em modo isolado');
      assert.strictEqual(cm.rootConfigPath, path.resolve(isolatedPath));

      const cfg = cm.load();
      assert.strictEqual(cfg.consent.accepted, false);
      assert.strictEqual(cfg.consent.decidedAt, null);
      assert.strictEqual(cfg.consent.permissions.backgroundExecution, false);
      assert.strictEqual(cfg.consent.permissions.launchAppsAndLinks, false);
      assert.strictEqual(cfg.consent.permissions.pythonAutomation, false);
      assert.strictEqual(cfg.miniAstrolabe.enabled, true);
      assert.strictEqual(cfg.miniAstrolabe.size, 48); // Mini 30% menor (v2)
      assert.ok(Array.isArray(cfg.autoScripts), 'autoScripts deve ser array');

      assert.ok(cfg.points.length >= 3, 'Clean-state deve semear Slot 1, Slot 2 e open_organizer');
      assert.strictEqual(cfg.points[0].code, '01 1');
      assert.strictEqual(cfg.points[0].actionType, 'launch_app_project');
      assert.strictEqual(cfg.points[0].params.targetPath, 'notepad.exe');
      assert.strictEqual(cfg.points[1].code, '02 2');
      assert.strictEqual(cfg.points[1].actionType, 'launch_app_project');
      assert.strictEqual(cfg.points[1].params.targetPath, 'code');
      assert.strictEqual(cfg.points[1].params.projectPath, 'c:\\Projetos\\MousePerformaticoEstrelado');

      const bad1 = cm.reorderPoint(-1, 0);
      const bad2 = cm.reorderPoint(0, 99);
      const bad3 = cm.reorderPoint('abc', 1);
      assert.strictEqual(bad1.ok, false);
      assert.strictEqual(bad2.ok, false);
      assert.strictEqual(bad3.ok, false);

      const reordered = cm.reorderPoint(0, 1);
      assert.strictEqual(reordered.ok, true);
      assert.strictEqual(reordered.points[0].code, '02 2');
      assert.strictEqual(reordered.points[0].slotIndex, 0);
      assert.strictEqual(reordered.points[0].slotNumber, 1);
      assert.strictEqual(reordered.points[1].code, '01 1');
      assert.strictEqual(reordered.points[1].slotIndex, 1);
      assert.strictEqual(reordered.points[1].slotNumber, 2);

      const reloaded = new ConfigManager(ROOT_DIR, CODE_DIR, {
        configPath: isolatedPath,
        ignoreProcessArgs: true,
        userDataDir: path.join(tmpDir, 'userdata')
      }).load();
      assert.strictEqual(reloaded.points[0].code, '02 2');
      assert.strictEqual(reloaded.points[1].code, '01 1');

      const prodRaw = JSON.parse(fs.readFileSync(path.join(CODE_DIR, 'mpe.config.json'), 'utf8'));
      assert.ok(Array.isArray(prodRaw.points) && prodRaw.points.length >= 14, 'Config de producao preservada');
      return `Isolado OK, Slot1/2 OK, reorderPoint(0,1) persistido, producao (${prodRaw.points.length} pontos) intacta`;
    } finally {
      if (prevEnv === undefined) delete process.env.MPE_CONFIG_PATH;
      else process.env.MPE_CONFIG_PATH = prevEnv;
      rmSafe(tmpDir);
    }
  });

  await runCase('M1 - Consent Gate', 'M1-03', 'ConsentManager e StartupManager bloqueiam antes do aceite e persistem decisao', async () => {
    const tmpDir = makeTempDir('mpe-m1-consent-');
    const cfgPath = path.join(tmpDir, 'consent.config.json');
    try {
      const cm = new ConfigManager(ROOT_DIR, CODE_DIR, {
        configPath: cfgPath,
        cleanState: true,
        ignoreProcessArgs: true,
        userDataDir: path.join(tmpDir, 'userdata')
      });
      cm.load();

      const consent = new ConsentManager(cm);
      const execCalls = [];
      const mockExecFile = (file, args, _opts, cb) => {
        execCalls.push({ file, args });
        if (typeof cb === 'function') cb(null, '', '');
      };
      const sm = new StartupManager(ROOT_DIR, CODE_DIR, {
        consentManager: consent,
        configManager: cm,
        execFile: mockExecFile
      });

      assert.strictEqual(consent.isAccepted(), false);
      assert.strictEqual(consent.isActionAllowed('backgroundExecution'), false);
      assert.deepStrictEqual(consent.gateResult(), {
        ok: false,
        blockedByConsent: true,
        message: 'Aceite de primeiro acesso necessario.'
      });

      const blockedStartup = await sm.setStartup(true);
      assert.strictEqual(blockedStartup.ok, false);
      assert.strictEqual(blockedStartup.blockedByConsent, true);
      assert.strictEqual(execCalls.length, 0, 'MPE.exe --enable-startup nao deve ser chamado sem aceite');

      const disableRes = await sm.setStartup(false);
      assert.strictEqual(disableRes.ok, true);
      assert.strictEqual(disableRes.enabled, false);

      const acceptedRes = consent.setConsentDecision(true, {
        backgroundExecution: true,
        launchAppsAndLinks: true,
        pythonAutomation: false
      });
      assert.strictEqual(acceptedRes.ok, true);
      assert.strictEqual(acceptedRes.consent.accepted, true);
      assert.strictEqual(consent.isActionAllowed('backgroundExecution'), true);
      assert.strictEqual(consent.isActionAllowed('pythonAutomation'), false);

      const cmReloaded = new ConfigManager(ROOT_DIR, CODE_DIR, {
        configPath: cfgPath,
        ignoreProcessArgs: true,
        userDataDir: path.join(tmpDir, 'userdata')
      });
      cmReloaded.load();
      const consentReloaded = new ConsentManager(cmReloaded);
      assert.strictEqual(consentReloaded.isAccepted(), true);
      assert.strictEqual(consentReloaded.isActionAllowed('backgroundExecution'), true);
      assert.strictEqual(consentReloaded.isActionAllowed('pythonAutomation'), false);

      execCalls.length = 0;
      const enabledStartup = await sm.setStartup(true);
      assert.strictEqual(enabledStartup.ok, true);
      assert.strictEqual(enabledStartup.enabled, true);
      if (fs.existsSync(sm.launcherExe)) {
        assert.strictEqual(execCalls.length, 1);
        assert.deepStrictEqual(execCalls[0].args, ['--enable-startup']);
      }

      const declinedRes = consent.setConsentDecision(false);
      assert.strictEqual(declinedRes.consent.accepted, false);
      assert.strictEqual(declinedRes.consent.permissions.backgroundExecution, false);
      assert.strictEqual(declinedRes.consent.permissions.launchAppsAndLinks, false);
      assert.strictEqual(declinedRes.consent.permissions.pythonAutomation, false);
      return 'Bloqueio sem aceite, persistencia apos reload e revogacao validados';
    } finally {
      rmSafe(tmpDir);
    }
  });

  await runCase('M1 - Hook & Bridge', 'M1-04', 'MpeHook.cs, HookBridge (trigger-hud/rec-click) e spawn/stop sem orfaos', async () => {
    const hookCs = fs.readFileSync(path.join(CODE_DIR, 'src', 'native', 'MpeHook.cs'), 'utf8');
    assert.ok(!hookCs.includes('TRIGGER_MINI'), 'MpeHook.cs nunca pode conter TRIGGER_MINI');
    assert.ok(hookCs.includes('RECORD_ON') && hookCs.includes('RECORD_OFF'), 'Comandos RECORD_ON/RECORD_OFF obrigatorios');
    assert.ok(hookCs.includes('REC_CLICK|'), 'Evento REC_CLICK| obrigatorio');
    assert.ok(hookCs.includes('WM_LBUTTONDOWN'), 'WM_LBUTTONDOWN obrigatorio');
    assert.ok(hookCs.includes('isVsCodeQuery') && hookCs.includes('isWhatsAppQuery') && hookCs.includes('isDiscordQuery'), 'Matchers Code/WhatsApp/Discord obrigatorios');
    assert.ok(hookCs.includes('CallNextHookEx('), 'CallNextHookEx obrigatorio para nao bloquear Shift+Ctrl+RightClick');

    const unitBridge = new HookBridge(CODE_DIR);
    let triggerCount = 0;
    let triggerHudCount = 0;
    const recClicks = [];
    unitBridge.on('trigger', (p) => {
      triggerCount++;
      assert.strictEqual(p.x, 100);
      assert.strictEqual(p.y, 200);
      assert.strictEqual(p.hwnd, '12345');
    });
    unitBridge.on('trigger-hud', (p) => {
      triggerHudCount++;
      assert.strictEqual(p.windowTitle, 'Janela Teste');
    });
    unitBridge.on('rec-click', (p) => recClicks.push(p));

    unitBridge._handleStdoutLine('TRIGGER_HUD|100|200|12345|10,20,510,420|full.png|win.png|Janela Teste');
    unitBridge._handleStdoutLine('REC_CLICK|L|320|480|1700000000123');
    unitBridge._handleStdoutLine('REC_CLICK|R|640|360|1700000000500');

    assert.strictEqual(triggerCount, 1);
    assert.strictEqual(triggerHudCount, 1);
    assert.strictEqual(recClicks.length, 2);
    assert.deepStrictEqual(recClicks[0], { button: 'left', rawButton: 'L', x: 320, y: 480, timestampMs: 1700000000123 });
    assert.deepStrictEqual(recClicks[1], { button: 'right', rawButton: 'R', x: 640, y: 360, timestampMs: 1700000000500 });

    const beforePids = getProjectHookPids(CODE_DIR);
    const liveBridge = new HookBridge(CODE_DIR);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout aguardando MPE_HOOK_READY')), 4500);
      liveBridge.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
      liveBridge.start();
    });

    const rOn = liveBridge.startRecording();
    const rOff = liveBridge.stopRecording();
    assert.strictEqual(rOn.ok, true);
    assert.strictEqual(rOn.sent, true);
    assert.strictEqual(rOff.ok, true);
    assert.strictEqual(rOff.sent, true);

    const stopStart = Date.now();
    await liveBridge.stop();
    const stopElapsed = Date.now() - stopStart;
    assert.ok(stopElapsed <= 1500, `stop() demorou ${stopElapsed}ms`);

    const afterPids = getProjectHookPids(CODE_DIR);
    assert.deepStrictEqual(afterPids, beforePids, 'Nenhum processo orfao MpeHook.exe pode restar apos stop()');
    return `Parser OK, MpeHook.exe ready + RECORD_ON/OFF + stop(${stopElapsed}ms) sem orfaos`;
  });

  await runCase('M1 - Launcher', 'M1-05', 'MpeLauncher.cs fail-closed consent check e binarios nativos compilados', () => {
    const launcherCsPath = path.join(CODE_DIR, 'src', 'native', 'MpeLauncher.cs');
    const hookCsPath = path.join(CODE_DIR, 'src', 'native', 'MpeHook.cs');
    const launcherExePath = path.join(ROOT_DIR, 'MPE.exe');
    const hookExePath = path.join(CODE_DIR, 'src', 'native', 'bin', 'MpeHook.exe');

    const launcherCs = fs.readFileSync(launcherCsPath, 'utf8');
    assert.ok(launcherCs.includes('ShouldAutoEnableStartup(baseDir, args)'), 'Main deve passar args para ShouldAutoEnableStartup');
    assert.ok(launcherCs.includes('MiniJsonParser.ParseObject(raw)'), 'MpeLauncher.cs deve validar JSON estritamente via MiniJsonParser');
    assert.ok(launcherCs.includes('"consent"') && launcherCs.includes('"accepted"') && launcherCs.includes('"backgroundExecution"'), 'MpeLauncher.cs deve exigir consent.accepted == true e verificar backgroundExecution');
    assert.ok(launcherCs.includes('FormatCommandLineArgs(args)') && launcherCs.includes('QuoteWindowsArg'), 'MpeLauncher.cs deve escapar argumentos com espacos');
    assert.ok(launcherCs.includes('MPE_CONFIG_PATH') && launcherCs.includes('--config-path'), 'MpeLauncher.cs deve suportar MPE_CONFIG_PATH e --config-path');
    assert.ok(launcherCs.includes('if (string.IsNullOrEmpty(cfgPath) || !File.Exists(cfgPath)) return false;'), 'MpeLauncher.cs deve falhar fechado quando config ausente');

    assert.ok(fs.existsSync(launcherExePath), 'MPE.exe ausente');
    assert.ok(fs.existsSync(hookExePath), 'MpeHook.exe ausente');
    const launcherExeStat = fs.statSync(launcherExePath);
    const launcherCsStat = fs.statSync(launcherCsPath);
    const hookExeStat = fs.statSync(hookExePath);
    const hookCsStat = fs.statSync(hookCsPath);

    assert.ok(launcherExeStat.mtimeMs + 1000 >= launcherCsStat.mtimeMs, 'MPE.exe deve estar recompilado apos MpeLauncher.cs');
    assert.ok(hookExeStat.mtimeMs + 1000 >= hookCsStat.mtimeMs, 'MpeHook.exe deve estar recompilado apos MpeHook.cs');
    return 'MpeLauncher.cs fail-closed + MPE.exe e MpeHook.exe atualizados';
  });

  await runCase('M1 - IPC & Zero Emojis', 'M1-06', 'Preload M1 APIs, broadcast multi-janela e zero emojis em .cs e scripts', () => {
    const preloadPath = path.join(CODE_DIR, 'src', 'preload', 'preload.js');
    const preloadCode = fs.readFileSync(preloadPath, 'utf8');

    const invoked = [];
    const sent = [];
    let exposedApi = null;
    const mockElectron = {
      contextBridge: {
        exposeInMainWorld: (name, api) => {
          if (name === 'mpeApi') exposedApi = api;
        }
      },
      ipcRenderer: {
        invoke: (ch, payload) => {
          invoked.push({ ch, payload });
          return Promise.resolve({ ok: true });
        },
        send: (ch, payload) => {
          sent.push({ ch, payload });
        },
        on: () => {},
        removeListener: () => {}
      },
      webUtils: {
        getPathForFile: (f) => (f && f.path) || ''
      }
    };

    const sandbox = {
      require: (req) => (req === 'electron' ? mockElectron : require(req)),
      module: { exports: {} },
      exports: {},
      __filename: preloadPath,
      __dirname: path.dirname(preloadPath)
    };
    vm.runInNewContext(preloadCode, sandbox);

    assert.ok(exposedApi, 'mpeApi deveria ser exposto pelo preload.js');
    const requiredMethods = [
      'getConfig',
      'saveConfig',
      'reorderPoint',
      'onConfigUpdated',
      'getConsentStatus',
      'setConsentDecision',
      'onConsentUpdated',
      'toggleMiniAstrolabe',
      'getMiniAstrolabeState',
      'updateMiniAstrolabeLayout',
      'setMiniIgnoreMouse',
      'setMiniExpandedBounds',
      'onMiniStateChanged',
      'startPythonRecording',
      'stopPythonRecording',
      'savePythonScript',
      'runPythonScript',
      'schedulePythonScript',
      'deletePythonScript',
      'onPythonRecordingState',
      'onPythonScriptExecuted'
    ];
    for (const m of requiredMethods) {
      assert.strictEqual(typeof exposedApi[m], 'function', `Metodo mpeApi.${m} ausente`);
    }

    exposedApi.reorderPoint(0, 1);
    exposedApi.setConsentDecision(true, { backgroundExecution: true });
    exposedApi.setMiniIgnoreMouse(true, false);
    assert.strictEqual(invoked[0].ch, 'mpe:reorder-point');
    assert.strictEqual(invoked[0].payload.fromIndex, 0);
    assert.strictEqual(invoked[0].payload.toIndex, 1);
    assert.strictEqual(invoked[1].ch, 'mpe:set-consent');
    assert.strictEqual(invoked[1].payload.accepted, true);
    assert.strictEqual(sent[0].ch, 'mpe:mini-ignore-mouse');
    assert.strictEqual(sent[0].payload.ignore, true);
    assert.strictEqual(sent[0].payload.forward, false);

    const mainJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'main', 'main.js'), 'utf8');
    assert.ok(mainJs.includes('BrowserWindow.getAllWindows()'), 'Broadcast multi-janela obrigatorio');
    assert.ok(mainJs.includes('mpe:consent-updated'), 'Canal mpe:consent-updated obrigatorio');
    assert.ok(mainJs.includes('tryRequireOptional'), 'Modulos M4/M5 opcionais devem ser protegidos');

    const extraFiles = [
      path.join(CODE_DIR, 'src', 'native', 'MpeHook.cs'),
      path.join(CODE_DIR, 'src', 'native', 'MpeLauncher.cs'),
      path.join(CODE_DIR, 'scripts', 'm1-tests.js'),
      path.join(CODE_DIR, 'scripts', 'run-tests.js')
    ];
    const emojiRe = /\p{Extended_Pictographic}/gu;
    let emojiHits = 0;
    for (const f of extraFiles) {
      if (emojiRe.test(fs.readFileSync(f, 'utf8'))) emojiHits++;
    }
    assert.strictEqual(emojiHits, 0, 'Zero emojis obrigatorio em .cs e scripts');
    return `${requiredMethods.length} APIs preload verificadas, multi-window broadcast OK, 0 emojis em .cs/scripts`;
  });

  await runCase('M1 - Hook Race', 'M1-07', 'HookBridge stop()+start() concorrente nao gera processo orfao nem zera proc ativo', async () => {
    const beforePids = getProjectHookPids(CODE_DIR);
    const bridge = new HookBridge(CODE_DIR);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout aguardando MPE_HOOK_READY (M1-07)')), 4500);
      bridge.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
      bridge.start();
    });

    const firstProc = bridge.proc;
    assert.ok(firstProc && firstProc.pid, 'Primeiro MpeHook.exe deve ter PID');

    const stopPromise = bridge.stop();
    bridge.start();
    const secondProc = bridge.proc;
    assert.ok(secondProc && secondProc.pid && secondProc !== firstProc, 'Segundo start() deve rastrear novo ChildProcess');

    await new Promise((resolve, reject) => {
      if (bridge.isReady) return resolve();
      const timer = setTimeout(() => reject(new Error('Timeout aguardando segundo MPE_HOOK_READY')), 4500);
      bridge.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    await stopPromise;
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(bridge.proc, secondProc, 'Saida do processo antigo nao pode zerar this.proc ativo');
    assert.strictEqual(bridge.isReady, true, 'Saida do processo antigo nao pode derrubar isReady do processo ativo');

    await bridge.stop();
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(bridge.proc, null);
    assert.strictEqual(bridge._stoppingProcs.size, 0);

    const afterPids = getProjectHookPids(CODE_DIR);
    assert.deepStrictEqual(afterPids, beforePids, 'Zero processos orfaos MpeHook.exe apos rapid stop()+start()+stop()');
    return `Race stop()->start()->stop() OK (pid1=${firstProc.pid}, pid2=${secondProc.pid}, 0 orfaos)`;
  });

  await runCase('M1 - Config & Backup', 'M1-08', 'reorderPoint estrito, writeAtomic finally cleanup, ConsentManager sem load(), e backup isolado', () => {
    const tmpDir = makeTempDir('mpe-m1-reg-');
    const prodDataDir = path.join(CODE_DIR, 'data');
    const prodDataBefore = fs.existsSync(prodDataDir) ? fs.readdirSync(prodDataDir) : [];
    try {
      const cfgPath = path.join(tmpDir, 'populated.config.json');
      const cm = new ConfigManager(ROOT_DIR, CODE_DIR, {
        configPath: cfgPath,
        cleanState: true,
        ignoreProcessArgs: true,
        userDataDir: path.join(tmpDir, 'userdata')
      });
      const initialCfg = cm.load();
      const initialIds = initialCfg.points.map((p) => p.id);

      const badInputs = [null, '', false, true, '0', '1', NaN, Infinity, 1.5, -1, 999, undefined, {}];
      for (const bad of badInputs) {
        const res1 = cm.reorderPoint(bad, 0);
        const res2 = cm.reorderPoint(0, bad);
        assert.strictEqual(res1.ok, false, `reorderPoint(${String(bad)}, 0) deveria falhar`);
        assert.strictEqual(res2.ok, false, `reorderPoint(0, ${String(bad)}) deveria falhar`);
      }
      assert.deepStrictEqual(cm.get().points.map((p) => p.id), initialIds, 'Entradas invalidas nao podem mutar points[]');

      const origWriteFileSync = fs.writeFileSync;
      const origRenameSync = fs.renameSync;
      const atomicTarget = path.join(tmpDir, 'atomic-fail.json');
      const expectedTmp = `${atomicTarget}.${process.pid}.tmp`;
      let writeCalls = 0;
      fs.renameSync = () => {
        const err = new Error('EBUSY simulated');
        err.code = 'EBUSY';
        throw err;
      };
      fs.writeFileSync = (...args) => {
        writeCalls++;
        if (writeCalls === 2) {
          const err = new Error('EBUSY fallback simulated');
          err.code = 'EBUSY';
          throw err;
        }
        return origWriteFileSync.apply(fs, args);
      };
      let threw = false;
      try {
        cm.writeAtomic(atomicTarget, '{"ok":true}');
      } catch (_) {
        threw = true;
      } finally {
        fs.writeFileSync = origWriteFileSync;
        fs.renameSync = origRenameSync;
      }
      assert.strictEqual(threw, true, 'writeAtomic deve propagar erro quando fallback falha');
      assert.strictEqual(fs.existsSync(expectedTmp), false, 'writeAtomic finally deve remover arquivo .tmp mesmo em EBUSY');

      const cmBeforeLoad = new ConfigManager(ROOT_DIR, CODE_DIR, {
        configPath: cfgPath,
        ignoreProcessArgs: true,
        userDataDir: path.join(tmpDir, 'userdata')
      });
      const consentUnloaded = new ConsentManager(cmBeforeLoad);
      const consentRes = consentUnloaded.setConsentDecision(true, {
        backgroundExecution: true,
        launchAppsAndLinks: true,
        pythonAutomation: false
      });
      assert.strictEqual(consentRes.consent.accepted, true);
      const afterConsentRaw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      assert.deepStrictEqual(
        afterConsentRaw.points.map((p) => p.id),
        initialIds,
        'setConsentDecision() antes de load() deve preservar points[]'
      );

      const isoCfgPath = path.join(tmpDir, 'iso-backup', 'mpe.config.json');
      const isoDataDir = path.join(tmpDir, 'iso-data');
      const prevEnvCfg = process.env.MPE_CONFIG_PATH;
      const prevEnvBackup = process.env.MPE_ENABLE_ISOLATED_BACKUP;
      const prevEnvData = process.env.MPE_DATA_DIR;
      try {
        process.env.MPE_CONFIG_PATH = isoCfgPath;
        process.env.MPE_ENABLE_ISOLATED_BACKUP = '1';
        process.env.MPE_DATA_DIR = isoDataDir;

        const isoCm1 = new ConfigManager(ROOT_DIR, CODE_DIR, {
          ignoreProcessArgs: false,
          userDataDir: path.join(tmpDir, 'userdata2')
        });
        assert.strictEqual(isoCm1.isIsolated, true);
        assert.strictEqual(isoCm1.dataDir, path.resolve(isoDataDir));
        assert.strictEqual(isoCm1.backupConfigPath, path.join(path.resolve(isoDataDir), 'mpe.config.backup.json'));
        assert.strictEqual(isoCm1.machineConfigPath, null);
        isoCm1.load();
        isoCm1.save({
          profile: { userName: 'Tester', isRegistered: true, languageTone: 'amigavel' },
          points: [{ id: 'custom-bak-1', code: '01 1', title: 'Custom Bak', actionType: 'open_url', params: { url: 'https://example.com' } }]
        });
        assert.ok(fs.existsSync(isoCm1.backupConfigPath), 'Backup isolado deve ser gravado em MPE_DATA_DIR');

        fs.writeFileSync(isoCfgPath, '{CORRUPTED_JSON', 'utf8');
        const isoCm2 = new ConfigManager(ROOT_DIR, CODE_DIR, {
          ignoreProcessArgs: false,
          userDataDir: path.join(tmpDir, 'userdata2')
        });
        const recovered = isoCm2.load();
        assert.ok(recovered.points.some((p) => p.id === 'custom-bak-1'), 'Backup isolado deve recuperar pontos corrompidos');
        const isoFiles = fs.readdirSync(isoDataDir);
        assert.ok(isoFiles.some((f) => f.startsWith('mpe.config.corrupted.')), 'Snapshot corrompido deve ir para MPE_DATA_DIR');
      } finally {
        if (prevEnvCfg === undefined) delete process.env.MPE_CONFIG_PATH;
        else process.env.MPE_CONFIG_PATH = prevEnvCfg;
        if (prevEnvBackup === undefined) delete process.env.MPE_ENABLE_ISOLATED_BACKUP;
        else process.env.MPE_ENABLE_ISOLATED_BACKUP = prevEnvBackup;
        if (prevEnvData === undefined) delete process.env.MPE_DATA_DIR;
        else process.env.MPE_DATA_DIR = prevEnvData;
      }

      const prodDataAfter = fs.existsSync(prodDataDir) ? fs.readdirSync(prodDataDir) : [];
      const newCorruptedInProd = prodDataAfter.filter(
        (f) => f.startsWith('mpe.config.corrupted.') && !prodDataBefore.includes(f)
      );
      assert.strictEqual(newCorruptedInProd.length, 0, 'Backup isolado nunca pode gravar em codigo/data/');

      return 'reorderPoint estrito, writeAtomic finally, setConsentDecision pre-load e backup isolado OK';
    } finally {
      rmSafe(tmpDir);
    }
  });

  await runCase('M1 - Main Granular & Clean Consent', 'M1-09', 'main.js separa MPE_FORCE_CLEAN_CONSENT=1 e aplica escopos granulares de consentimento', () => {
    const tmpDir = makeTempDir('mpe-m1-main-');
    try {
      const cfgPath = path.join(tmpDir, 'populated.json');
      fs.writeFileSync(
        cfgPath,
        JSON.stringify(
          {
            profile: { userName: 'User', isRegistered: true },
            consent: {
              accepted: true,
              decidedAt: '2026-01-01T00:00:00.000Z',
              version: '1.0',
              permissions: { backgroundExecution: true, launchAppsAndLinks: true, pythonAutomation: true }
            },
            points: [
              { id: 'custom-slot-1', code: '01 1', title: 'Custom 1', actionType: 'open_url', params: { url: 'https://example.com' } },
              { id: 'star-02-7', code: '02 7', title: 'Organizar', actionType: 'open_organizer', params: { targetScope: 'arquivos' } }
            ]
          },
          null,
          2
        ),
        'utf8'
      );

      const harnessPath = path.join(tmpDir, 'harness.js');
      const mainJsPath = path.join(CODE_DIR, 'src', 'main', 'main.js');
      const harnessCode = `
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ipcHandlers = {};
let whenReadyCb = null;
let trayCount = 0;
let hookStartCount = 0;
let execPointCalls = 0;

class FakeBrowserWindow {
  constructor() {
    this.destroyed = false;
    this.webContents = { id: 1, isDestroyed: () => false, send: () => {}, once: () => {}, on: () => {} };
  }
  loadFile() {}
  on() {}
  isDestroyed() { return this.destroyed; }
  isVisible() { return false; }
  setBounds() {}
  setAppDetails() {}
  show() {}
  focus() {}
  hide() {}
  setAlwaysOnTop() {}
  static getAllWindows() { return []; }
}

const mockElectron = {
  app: {
    name: '',
    setAppUserModelId: () => {},
    commandLine: { appendSwitch: () => {} },
    requestSingleInstanceLock: () => true,
    exit: () => {},
    quit: () => {},
    getPath: () => ${JSON.stringify(path.join(tmpDir, 'ud'))},
    on: () => {},
    whenReady: () => ({ then: (cb) => { whenReadyCb = cb; return Promise.resolve(); } })
  },
  BrowserWindow: FakeBrowserWindow,
  Tray: class FakeTray { constructor() { trayCount++; } setToolTip() {} setContextMenu() {} on() {} isDestroyed() { return false; } destroy() {} },
  Menu: { buildFromTemplate: () => ({}) },
  ipcMain: { handle: (ch, fn) => { ipcHandlers[ch] = fn; }, on: () => {} },
  globalShortcut: { register: () => {}, unregisterAll: () => {} },
  screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1280, height: 720 }, size: { width: 1280, height: 720 }, scaleFactor: 1 }), getCursorScreenPoint: () => ({ x: 100, y: 100 }), getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1280, height: 720 } }) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  clipboard: { writeText: () => {} },
  shell: { openPath: async () => '' },
  nativeImage: { createFromPath: () => ({ resize: () => ({}) }), createEmpty: () => ({}) }
};

const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'electron') return mockElectron;
  if (request === './hookBridge') {
    return class FakeHookBridge {
      on() {}
      start() { hookStartCount++; }
      async stop() {}
      getOriginSystemInfo() { return { hwnd: '0' }; }
    };
  }
  if (request === './actionExecutor') {
    return class FakeActionExecutor {
      async executePoint() { execPointCalls++; return { ok: true }; }
      async completeAreaCrop() { return { ok: true }; }
      async dispatchToTelegram() { return { ok: true }; }
      async dispatchToTargetSystem() { return { ok: true }; }
    };
  }
  return origLoad.apply(this, arguments);
};

require(${JSON.stringify(mainJsPath)});

(async () => {
  await whenReadyCb();
  const cfgAfterBoot = await ipcHandlers['mpe:get-config']();
  assert.strictEqual(cfgAfterBoot.consent.accepted, false, 'MPE_FORCE_CLEAN_CONSENT=1 deve resetar consentimento');
  assert.ok(cfgAfterBoot.points.some((p) => p.id === 'custom-slot-1'), 'MPE_FORCE_CLEAN_CONSENT=1 nao pode apagar points[]');

  await ipcHandlers['mpe:set-consent']({}, {
    accepted: true,
    permissions: { backgroundExecution: false, launchAppsAndLinks: false, pythonAutomation: false }
  });
  assert.strictEqual(trayCount, 0, 'Tray nao deve ser criado com backgroundExecution=false');
  assert.strictEqual(hookStartCount, 0, 'HookBridge nao deve iniciar com backgroundExecution=false');

  const miniState = await ipcHandlers['mpe:mini-get-state']();
  assert.strictEqual(miniState.blockedByConsent, true);
  assert.strictEqual((await ipcHandlers['mpe:mini-toggle']({}, { enabled: true })).blockedByConsent, true);
  assert.strictEqual((await ipcHandlers['mpe:mini-update-layout']({}, { size: 80 })).blockedByConsent, true);
  assert.strictEqual((await ipcHandlers['mpe:mini-set-expanded']({}, { expanded: true })).blockedByConsent, true);

  assert.strictEqual((await ipcHandlers['mpe:execute-point']({}, {})).blockedByConsent, true);
  assert.strictEqual((await ipcHandlers['mpe:complete-area-crop']({}, {})).blockedByConsent, true);
  assert.strictEqual((await ipcHandlers['mpe:send-text-telegram']({}, {})).blockedByConsent, true);
  assert.strictEqual((await ipcHandlers['mpe:send-to-system']({}, {})).blockedByConsent, true);
  assert.strictEqual((await ipcHandlers['mpe:open-path']({}, 'downloads')).blockedByConsent, true);
  assert.strictEqual(execPointCalls, 0);

  for (const ch of ['mpe:py-record-start','mpe:py-record-stop','mpe:py-save-script','mpe:py-run-script','mpe:py-schedule-script','mpe:py-delete-script']) {
    const r = await ipcHandlers[ch]({}, {});
    assert.strictEqual(r.blockedByConsent, true, ch + ' deve checar pythonAutomation antes de unavailable');
  }

  const savedCfg = await ipcHandlers['mpe:save-config']({}, { system: { startWithWindows: true } });
  assert.strictEqual(savedCfg.system.startWithWindows, false, 'startWithWindows deve permanecer false quando backgroundExecution=false');
  console.log('M1_MAIN_GRANULAR_OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;
      fs.writeFileSync(harnessPath, harnessCode, 'utf8');
      const out = execFileSync(
        process.execPath,
        [harnessPath, `--config-path=${cfgPath}`],
        {
          env: Object.assign({}, process.env, { MPE_FORCE_CLEAN_CONSENT: '1' }),
          encoding: 'utf8',
          windowsHide: true
        }
      );
      assert.ok(out.includes('M1_MAIN_GRANULAR_OK'), 'Harness main.js nao confirmou M1_MAIN_GRANULAR_OK');
      return 'MPE_FORCE_CLEAN_CONSENT=1 preserva points[], escopos granulares e startWithWindows validados';
    } finally {
      rmSafe(tmpDir);
    }
  });

  await runCase('M1 - Native Reflection', 'M1-10', 'Binarios compilados MpeLauncher.exe e MpeHook.exe validam JSON/backgroundExecution e query code', () => {
    const tmpDir = makeTempDir('mpe-m1-native-');
    try {
      const launcherExe = path.join(ROOT_DIR, 'MPE.exe');
      const hookExe = path.join(CODE_DIR, 'src', 'native', 'bin', 'MpeHook.exe');
      const psPath = path.join(tmpDir, 'probe.ps1');
      const cfgGood = path.join(tmpDir, 'good.json');
      const cfgBgFalse = path.join(tmpDir, 'bg_false.json');
      const cfgGarbage = path.join(tmpDir, 'garbage.json');
      const cfgNested = path.join(tmpDir, 'nested.json');
      const cfgMachines = path.join(tmpDir, 'machines.json');

      fs.writeFileSync(cfgGood, '{"consent":{"accepted":true,"permissions":{"backgroundExecution":true}},"system":{"startWithWindows":true}}', 'utf8');
      fs.writeFileSync(cfgBgFalse, '{"consent":{"accepted":true,"permissions":{"backgroundExecution":false}},"system":{"startWithWindows":true}}', 'utf8');
      fs.writeFileSync(cfgGarbage, '{"consent":{"accepted":true} GARBAGE', 'utf8');
      fs.writeFileSync(cfgNested, '{"points":[{"params":{"consent":{"accepted":true}}}],"consent":{"accepted":false},"system":{"startWithWindows":true}}', 'utf8');
      fs.writeFileSync(cfgMachines, '{"consent":{"accepted":true},"machines":{"OTHER":{"startWithWindows":false}}}', 'utf8');

      const psCode = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$launcherAsm = [System.Reflection.Assembly]::LoadFrom('${launcherExe.replace(/'/g, "''")}')
$launcherType = $launcherAsm.GetType('MpeNative.MpeLauncher')
$flags = [System.Reflection.BindingFlags]'Static,NonPublic,Public'
$mStartup = $launcherType.GetMethod('ShouldAutoEnableStartup', $flags)
$mFmt = $launcherType.GetMethod('FormatCommandLineArgs', $flags)

$rGood = $mStartup.Invoke($null, @('${tmpDir.replace(/'/g, "''")}', [string[]]@('--config-path=${cfgGood.replace(/'/g, "''")}')))
$rBgFalse = $mStartup.Invoke($null, @('${tmpDir.replace(/'/g, "''")}', [string[]]@('--config-path=${cfgBgFalse.replace(/'/g, "''")}')))
$rGarbage = $mStartup.Invoke($null, @('${tmpDir.replace(/'/g, "''")}', [string[]]@('--config-path=${cfgGarbage.replace(/'/g, "''")}')))
$rNested = $mStartup.Invoke($null, @('${tmpDir.replace(/'/g, "''")}', [string[]]@('--config-path=${cfgNested.replace(/'/g, "''")}')))
$rMachines = $mStartup.Invoke($null, @('${tmpDir.replace(/'/g, "''")}', [string[]]@('--config-path=${cfgMachines.replace(/'/g, "''")}')))
$fmt = $mFmt.Invoke($null, @(,[string[]]@('--config-path=C:\\My Path\\cfg.json', '--launch-ui')))

$hookAsm = [System.Reflection.Assembly]::LoadFrom('${hookExe.replace(/'/g, "''")}')
$hookType = $hookAsm.GetType('MpeNative.MpeHook')
$mFind = $hookType.GetMethod('FindSystemWindow', $flags)

$f = New-Object System.Windows.Forms.Form
$f.Text = 'Barcode Scanner App'
$f.ShowInTaskbar = $false
$f.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$f.Location = New-Object System.Drawing.Point(-32000, -32000)
$f.Size = New-Object System.Drawing.Size(120, 40)
$f.Show()
[System.Windows.Forms.Application]::DoEvents()
try {
  $hBarcode = ([IntPtr]$mFind.Invoke($null, @('barcode'))).ToInt64()
  $hCode = ([IntPtr]$mFind.Invoke($null, @('code'))).ToInt64()
  $hForm = $f.Handle.ToInt64()
} finally {
  $f.Close()
  $f.Dispose()
}

Write-Output (@{
  good = $rGood
  bgFalse = $rBgFalse
  garbage = $rGarbage
  nested = $rNested
  machines = $rMachines
  fmt = $fmt
  hForm = $hForm
  hBarcode = $hBarcode
  hCode = $hCode
} | ConvertTo-Json -Compress)
`;
      fs.writeFileSync(psPath, psCode, 'utf8');
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath],
        { encoding: 'utf8', windowsHide: true }
      ).trim();
      const res = JSON.parse(out);
      assert.strictEqual(res.good, true, 'Config valido deve habilitar auto-startup');
      assert.strictEqual(res.bgFalse, false, 'backgroundExecution=false deve bloquear auto-startup');
      assert.strictEqual(res.garbage, false, 'JSON com lixo apos objeto deve falhar fechado');
      assert.strictEqual(res.nested, false, 'consent aninhado nao pode burlar consent.accepted=false raiz');
      assert.strictEqual(res.machines, true, 'machines.*.startWithWindows=false nao deve ser lido como system.startWithWindows');
      assert.ok(String(res.fmt).includes('"--config-path=C:\\My Path\\cfg.json"'), 'FormatCommandLineArgs deve citar argumentos com espaco');
      assert.strictEqual(res.hBarcode, res.hForm, 'FindSystemWindow("barcode") deve localizar Barcode Scanner App');
      assert.notStrictEqual(res.hCode, res.hForm, 'FindSystemWindow("code") NAO pode dar falso positivo em Barcode Scanner App');
      return 'MPE.exe MiniJsonParser/backgroundExecution/quoting + MpeHook.exe FindSystemWindow("code") OK';
    } finally {
      rmSafe(tmpDir);
    }
  });
}

module.exports = { runM1Suite };
