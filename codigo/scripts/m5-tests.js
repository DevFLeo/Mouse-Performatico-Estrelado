const assert = require('assert');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const Module = require('module');

const CODE_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(CODE_DIR, '..');

if (require.main === module) {
  const origLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          getPath: (name) => path.join(os.tmpdir(), `mpe-m5-test-${name}`),
          setAppUserModelId: () => {}
        },
        shell: {
          openExternal: async () => {},
          openPath: async () => '',
          showItemInFolder: () => {}
        },
        clipboard: { writeText: () => {}, writeImage: () => {}, readText: () => '' },
        nativeImage: { createFromDataURL: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }) },
        screen: {
          getPrimaryDisplay: () => ({
            size: { width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
            scaleFactor: 1
          })
        },
        desktopCapturer: { getSources: async () => [] }
      };
    }
    return origLoad.apply(this, arguments);
  };
}

const ConfigManager = require('../src/main/configManager');
const ConsentManager = require('../src/main/consentManager');
const PythonRecorder = require('../src/main/pythonRecorder');
const PythonScheduler = require('../src/main/pythonScheduler');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmSafe(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function snapshotDirEntries(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const entries = [];
  const walk = (cur) => {
    for (const item of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, item.name);
      const rel = path.relative(dirPath, full).replace(/\\/g, '/');
      if (item.isDirectory()) {
        entries.push(`D:${rel}`);
        walk(full);
      } else {
        const st = fs.statSync(full);
        entries.push(`F:${rel}:${st.size}:${Math.round(st.mtimeMs)}`);
      }
    }
  };
  walk(dirPath);
  entries.sort();
  return entries;
}

class MockHookBridge extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.isReady = true;
    this.isRecording = false;
    this.commands = [];
    this.stopCalled = 0;
  }

  startRecording() {
    this.isRecording = true;
    this.commands.push('RECORD_ON');
    return { ok: true, recording: true, sent: true };
  }

  stopRecording() {
    this.isRecording = false;
    this.commands.push('RECORD_OFF');
    return { ok: true, recording: false, sent: true };
  }

  stop() {
    this.stopCalled += 1;
    this.isRecording = false;
    return Promise.resolve();
  }
}

function createIsolatedEnv(tmpDir, consentAccepted = true, pythonAllowed = true) {
  const configPath = path.join(tmpDir, 'mpe.config.json');
  const dataDir = path.join(tmpDir, 'data');
  const scriptsDir = path.join(dataDir, 'scripts');
  const userDataDir = path.join(tmpDir, 'userdata');
  fs.mkdirSync(scriptsDir, { recursive: true });

  const prevEnv = {
    MPE_CONFIG_PATH: process.env.MPE_CONFIG_PATH,
    MPE_DATA_DIR: process.env.MPE_DATA_DIR,
    MPE_SCRIPTS_DIR: process.env.MPE_SCRIPTS_DIR,
    MPE_TEST_CLOCK: process.env.MPE_TEST_CLOCK
  };

  process.env.MPE_CONFIG_PATH = configPath;
  process.env.MPE_DATA_DIR = dataDir;
  process.env.MPE_SCRIPTS_DIR = scriptsDir;

  const cm = new ConfigManager(ROOT_DIR, CODE_DIR, {
    configPath,
    dataDir,
    cleanState: true,
    ignoreProcessArgs: true,
    userDataDir
  });
  cm.load();

  const consent = new ConsentManager(cm);
  if (consentAccepted) {
    consent.setConsentDecision(true, {
      backgroundExecution: true,
      launchAppsAndLinks: true,
      pythonAutomation: pythonAllowed
    });
  }

  const broadcasts = [];
  const configBroadcasts = [];
  const windowsRegistered = [];

  const ctx = {
    configManager: cm,
    consentManager: consent,
    hookBridge: new MockHookBridge(),
    registerWindow: (name, win) => windowsRegistered.push({ name, win }),
    broadcastToAllWindows: (channel, payload) => broadcasts.push({ channel, payload }),
    broadcastConfigUpdated: (saved) => configBroadcasts.push(saved),
    codeDir: CODE_DIR,
    rootDir: ROOT_DIR
  };

  const restoreEnv = () => {
    for (const [key, val] of Object.entries(prevEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  };

  return {
    configPath,
    dataDir,
    scriptsDir,
    cm,
    consent,
    ctx,
    broadcasts,
    configBroadcasts,
    windowsRegistered,
    restoreEnv
  };
}

function relativeLuminance(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const bright = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (bright + 0.05) / (dark + 0.05);
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

async function runM5Suite({ runCase, makeTempDir: extMakeTempDir, rmSafe: extRmSafe }) {
  const mkTmp = extMakeTempDir || makeTempDir;
  const rmTmp = extRmSafe || rmSafe;

  const prodConfigPath = path.join(CODE_DIR, 'mpe.config.json');
  const prodDataDir = path.join(CODE_DIR, 'data');
  const prodConfigShaBefore = sha256File(prodConfigPath);
  const prodDataBefore = snapshotDirEntries(prodDataDir);

  await runCase('M5 - Consent Gate', 'M5-01', 'PythonRecorder e PythonScheduler bloqueiam sem consentimento pythonAutomation', async () => {
    const tmpDir = mkTmp('mpe-m5-01-');
    const env = createIsolatedEnv(tmpDir, false, false);
    try {
      const rec = new PythonRecorder(env.ctx);
      const sched = new PythonScheduler(env.ctx);

      for (const res of [
        await rec.startRecording({ headless: true }),
        await rec.stopRecording(),
        await rec.saveScript({ name: 'Bloqueado', steps: [{ x: 10, y: 10, button: 'left', waitMs: 0 }] }),
        await sched.runScript({ scriptIdOrPath: 'x', dryRun: true }),
        await sched.scheduleScript('x', { enabled: true, timeHHMM: '09:00' }),
        await sched.deleteScript('x'),
        await sched.evaluateSchedules(new Date())
      ]) {
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.blockedByConsent, true);
      }

      // Consentimento aceito, mas pythonAutomation=false tambem deve bloquear
      env.consent.setConsentDecision(true, {
        backgroundExecution: true,
        launchAppsAndLinks: true,
        pythonAutomation: false
      });
      const recGranular = await rec.startRecording({ headless: true });
      const schedGranular = await sched.runScript({ scriptIdOrPath: 'x', dryRun: true });
      assert.strictEqual(recGranular.blockedByConsent, true);
      assert.strictEqual(schedGranular.blockedByConsent, true);
      assert.strictEqual(fs.readdirSync(env.scriptsDir).length, 0);
      assert.strictEqual(env.ctx.hookBridge.commands.length, 0);
      return 'Consent gate total e granular (pythonAutomation=false) validado com 0 arquivos criados';
    } finally {
      env.restoreEnv();
      rmTmp(tmpDir);
    }
  });

  await runCase('M5 - Recorder & DPI Exclusion', 'M5-02', 'Gravacao captura cliques/esperas, exclui Stop UI em DPI 150% e trata cancelamento/stop()', async () => {
    const tmpDir = mkTmp('mpe-m5-02-');
    const env = createIsolatedEnv(tmpDir, true, true);
    try {
      const registeredShortcuts = {};
      const mockGlobalShortcut = {
        register: (accel, cb) => {
          registeredShortcuts[accel] = cb;
          return true;
        },
        unregister: (accel) => {
          delete registeredShortcuts[accel];
        }
      };

      const mainWinMock = {
        _visible: true,
        isDestroyed: () => false,
        isVisible: () => mainWinMock._visible,
        getTitle: () => 'M.P.E — Mouse Performatico Estrelado',
        hide: () => { mainWinMock._visible = false; },
        show: () => { mainWinMock._visible = true; },
        focus: () => {}
      };

      class MockBrowserWindow extends EventEmitter {
        constructor(opts) {
          super();
          this.opts = opts;
          this._destroyed = false;
          this.webContents = new EventEmitter();
          this.webContents.isDestroyed = () => this._destroyed;
          this.webContents.send = () => {};
        }
        static getAllWindows() {
          return [mainWinMock];
        }
        isDestroyed() { return this._destroyed; }
        getBounds() { return { x: 900, y: 20, width: 220, height: 56 }; }
        setAlwaysOnTop() {}
        showInactive() {}
        loadFile() {
          this.webContents.emit('did-finish-load');
          return Promise.resolve();
        }
        close() {
          this._destroyed = true;
          this.emit('closed');
        }
        destroy() {
          this._destroyed = true;
        }
      }

      const mockScreen = {
        getPrimaryDisplay: () => ({
          workArea: { x: 0, y: 0, width: 1920, height: 1040 },
          scaleFactor: 1.5
        }),
        dipToScreenRect: (_win, rect) => ({
          x: Math.round(rect.x * 1.5),
          y: Math.round(rect.y * 1.5),
          width: Math.round(rect.width * 1.5),
          height: Math.round(rect.height * 1.5)
        })
      };

      const rec = new PythonRecorder(
        Object.assign({}, env.ctx, {
          BrowserWindow: MockBrowserWindow,
          screen: mockScreen,
          globalShortcut: mockGlobalShortcut
        })
      );

      const startRes = await rec.startRecording({ name: 'Gravacao Teste' });
      assert.strictEqual(startRes.ok, true);
      assert.strictEqual(startRes.active, true);
      assert.strictEqual(mainWinMock._visible, false, 'Janela principal deve ocultar ao gravar');
      assert.ok(registeredShortcuts.Escape, 'Atalho global Escape deve ser registrado');
      assert.strictEqual(env.ctx.hookBridge.commands[0], 'RECORD_ON');

      const dupRes = await rec.startRecording();
      assert.strictEqual(dupRes.ok, false);

      env.ctx.hookBridge.emit('rec-click', { button: 'left', rawButton: 'L', x: 200, y: 200, timestampMs: 1000 });
      env.ctx.hookBridge.emit('rec-click', { button: 'right', rawButton: 'R', x: 420, y: 310, timestampMs: 1450 });
      // Clique dentro do overlay em pixels fisicos (DPI 150%: x=1350..1680, y=30..114) DEVE ser ignorado!
      env.ctx.hookBridge.emit('rec-click', { button: 'left', rawButton: 'L', x: 1450, y: 60, timestampMs: 1700 });
      env.ctx.hookBridge.emit('rec-click', { button: 'left', rawButton: 'L', x: 600, y: 500, timestampMs: 2250 });

      assert.strictEqual(rec.steps.length, 3, 'Clique no botao Parar do overlay nao pode ser gravado');

      const stopRes = await rec.stopRecording();
      assert.strictEqual(stopRes.ok, true);
      assert.strictEqual(stopRes.steps.length, 3);
      assert.deepStrictEqual(stopRes.steps, [
        { x: 200, y: 200, button: 'left', waitMs: 0 },
        { x: 420, y: 310, button: 'right', waitMs: 450 },
        { x: 600, y: 500, button: 'left', waitMs: 800 }
      ]);
      assert.strictEqual(mainWinMock._visible, true, 'Janela principal deve restaurar apos parar');
      assert.strictEqual(registeredShortcuts.Escape, undefined, 'Atalho Escape deve ser desregistrado');
      assert.ok(env.ctx.hookBridge.commands.includes('RECORD_OFF'));

      // Cliques apos stop nao sao capturados
      env.ctx.hookBridge.emit('rec-click', { button: 'left', x: 100, y: 100, timestampMs: 3000 });
      assert.strictEqual(rec.steps.length, 3);

      // Cancelamento com 0 cliques nao cria arquivo .py
      await rec.startRecording({ headless: true });
      const cancelRes = await rec.stopRecording({ cancel: true, name: 'Nao Deve Salvar' });
      assert.strictEqual(cancelRes.ok, true);
      assert.strictEqual(cancelRes.cancelled, true);
      assert.strictEqual(fs.readdirSync(env.scriptsDir).length, 0);

      // stop() desarma hook sem checar consentimento
      await rec.startRecording({ headless: true });
      env.consent.setConsentDecision(false, {});
      rec.stop();
      assert.strictEqual(rec.isRecording, false);
      assert.strictEqual(env.ctx.hookBridge.isRecording, false);

      return '3 cliques capturados com waitMs preciso, clique DPI 150% no Stop excluido, cancelamento e stop() OK';
    } finally {
      env.restoreEnv();
      rmTmp(tmpDir);
    }
  });

  await runCase('M5 - Sanitization & Security', 'M5-03', 'Sanitizacao de nomes, protecao path traversal, nomes reservados Windows e colisoes', async () => {
    const tmpDir = mkTmp('mpe-m5-03-');
    const env = createIsolatedEnv(tmpDir, true, true);
    try {
      const rec = new PythonRecorder(env.ctx);
      const sampleSteps = [{ x: 150, y: 250, button: 'left', waitMs: 120 }];

      const emptyErr = await rec.saveScript({ name: 'Vazio', steps: [] });
      assert.strictEqual(emptyErr.ok, false);

      const badCoordErr = await rec.saveScript({ name: 'Invalido', steps: [{ x: 'NaN', y: 10, button: 'left', waitMs: 0 }] });
      assert.strictEqual(badCoordErr.ok, false);

      const badWaitErr = await rec.saveScript({ name: 'Negativo', steps: [{ x: 10, y: 10, button: 'left', waitMs: -5 }] });
      assert.strictEqual(badWaitErr.ok, false);

      const hostileNames = [
        '../../evil_escape',
        '..\\..\\bad_win',
        'C:\\windows\\system32\\bad',
        'Automacao #1 / Teste!',
        'CON',
        'LPT1',
        '...',
        ''
      ];

      for (const rawName of hostileNames) {
        const res = await rec.saveScript({ name: rawName, steps: sampleSteps });
        assert.strictEqual(res.ok, true, `Falha ao salvar nome sanitizado para "${rawName}"`);
        const fileName = path.basename(res.script.filePath);
        assert.match(fileName, /^[a-z0-9_-]+\.py$/i);
        assert.ok(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\.py$/i.test(fileName), `Nome reservado Windows vazou: ${fileName}`);
        assert.ok(
          PythonRecorder.isPathInsideDir(res.script.filePath, env.scriptsDir),
          `Arquivo escapou de scriptsDir: ${res.script.filePath}`
        );
      }

      assert.strictEqual(fs.existsSync(path.join(tmpDir, 'evil_escape.py')), false);

      const dup1 = await rec.saveScript({ name: 'Duplicado', steps: sampleSteps });
      const dup2 = await rec.saveScript({ name: 'Duplicado', steps: sampleSteps });
      assert.strictEqual(dup1.ok, true);
      assert.strictEqual(dup2.ok, true);
      assert.notStrictEqual(dup1.script.id, dup2.script.id);
      assert.notStrictEqual(dup1.script.filePath, dup2.script.filePath);
      assert.strictEqual(path.basename(dup1.script.filePath), 'duplicado.py');
      assert.strictEqual(path.basename(dup2.script.filePath), 'duplicado_2.py');
      assert.ok(env.configBroadcasts.length >= 2, 'broadcastConfigUpdated deve ser chamado ao salvar scripts');

      return `${hostileNames.length} nomes hostis sanitizados dentro de scriptsDir; colisoes diferenciadas`;
    } finally {
      env.restoreEnv();
      rmTmp(tmpDir);
    }
  });

  await runCase('M5 - Codegen & Zero Emojis', 'M5-04', 'Codigo Python stdlib valido (py_compile + --dry-run) e zero emojis em M5', async () => {
    const tmpDir = mkTmp('mpe-m5-04-');
    const env = createIsolatedEnv(tmpDir, true, true);
    try {
      const rec = new PythonRecorder(env.ctx);
      const steps = [
        { x: 123, y: 456, button: 'left', waitMs: 0 },
        { x: 789, y: 321, button: 'right', waitMs: 650 }
      ];
      const saved = await rec.saveScript({ name: 'Teste DryRun', steps });
      assert.strictEqual(saved.ok, true);

      const pyPath = saved.script.filePath;
      const pyContent = fs.readFileSync(pyPath, 'utf8');
      assert.ok(pyContent.includes('import argparse'));
      assert.ok(pyContent.includes('import ctypes'));
      assert.ok(pyContent.includes('import sys'));
      assert.ok(pyContent.includes('import time'));
      assert.ok(pyContent.includes('SetProcessDPIAware()'));
      assert.ok(pyContent.includes('SetCursorPos('));
      assert.ok(pyContent.includes('mouse_event('));
      assert.ok(!pyContent.includes('pyautogui') && !pyContent.includes('pynput'));

      const sched = new PythonScheduler(env.ctx);
      const py = sched.resolvePythonBinary();
      execFileSync(py.bin, [...py.prefixArgs, '-m', 'py_compile', pyPath], {
        windowsHide: true,
        encoding: 'utf8'
      });

      const dryOut = execFileSync(py.bin, [...py.prefixArgs, pyPath, '--dry-run'], {
        windowsHide: true,
        encoding: 'utf8'
      });
      assert.ok(dryOut.includes('step=1 button=left x=123 y=456 wait_ms=0'));
      assert.ok(dryOut.includes('step=2 button=right x=789 y=321 wait_ms=650'));

      const emojiRe = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u200D|\u20E3|\uFE0F/gu;
      const m5Files = [
        path.join(CODE_DIR, 'src', 'main', 'pythonRecorder.js'),
        path.join(CODE_DIR, 'src', 'main', 'pythonScheduler.js'),
        path.join(CODE_DIR, 'src', 'renderer', 'recorder-overlay.html'),
        path.join(CODE_DIR, 'src', 'renderer', 'styles', 'recorder-overlay.css'),
        path.join(CODE_DIR, 'src', 'renderer', 'js', 'recorder-overlay.js'),
        path.join(CODE_DIR, 'scripts', 'm5-tests.js'),
        pyPath
      ];
      for (const f of m5Files) {
        const content = fs.readFileSync(f, 'utf8');
        emojiRe.lastIndex = 0;
        assert.strictEqual(emojiRe.test(content), false, `Emoji encontrado em ${f}`);
      }

      return `py_compile OK, --dry-run imprimiu passos exatos, ${m5Files.length} arquivos com 0 emojis`;
    } finally {
      env.restoreEnv();
      rmTmp(tmpDir);
    }
  });

  await runCase('M5 - On-Demand Execution', 'M5-05', 'runScript (1-arg IPC e 2-arg), lastRunAt/lastExitCode, erro nao-zero e arquivo ausente', async () => {
    const tmpDir = mkTmp('mpe-m5-05-');
    const env = createIsolatedEnv(tmpDir, true, true);
    try {
      const rec = new PythonRecorder(env.ctx);
      const sched = new PythonScheduler(env.ctx);

      const saved = await rec.saveScript({
        name: 'Execucao Sob Demanda',
        steps: [{ x: 100, y: 200, button: 'left', waitMs: 50 }]
      });
      const id = saved.script.id;

      // 1-arg IPC payload
      const r1 = await sched.runScript({ scriptIdOrPath: id, dryRun: true });
      assert.strictEqual(r1.ok, true);
      assert.strictEqual(r1.exitCode, 0);
      assert.ok(r1.stdout.includes('x=100 y=200'));

      // 2-arg chamada direta
      const r2 = await sched.runScript(id, { dryRun: true, trigger: 'slot' });
      assert.strictEqual(r2.ok, true);
      assert.strictEqual(r2.trigger, 'slot');

      const updated = env.cm.get().autoScripts.find((s) => s.id === id);
      assert.ok(updated.lastRunAt, 'lastRunAt deve ser atualizado');
      assert.strictEqual(updated.lastExitCode, 0);
      assert.ok(
        env.broadcasts.some(
          (b) => b.channel === 'mpe:py-script-executed' && b.payload.scriptId === id && b.payload.trigger === 'slot'
        )
      );

      // Script com exit code 2 deve registrar lastExitCode=2 sem remover entrada
      const failPath = path.join(env.scriptsDir, 'fail_code_2.py');
      fs.writeFileSync(failPath, 'import sys\nsys.stderr.write("erro simulado\\n")\nsys.exit(2)\n', 'utf8');
      const cfg = env.cm.get();
      cfg.autoScripts.push({
        id: 'script-exit-2',
        name: 'Falha 2',
        filePath: failPath,
        steps: [{ x: 1, y: 1, button: 'left', waitMs: 0 }],
        schedule: { enabled: false, timeHHMM: '09:00', mode: 'daily', lastRunKey: null },
        lastRunAt: null,
        lastExitCode: null
      });
      env.cm.save({ autoScripts: cfg.autoScripts });

      const rFail = await sched.runScript('script-exit-2', { dryRun: false });
      assert.strictEqual(rFail.ok, false);
      assert.strictEqual(rFail.exitCode, 2);
      assert.ok(rFail.stderr.includes('erro simulado'));
      const failEntry = env.cm.get().autoScripts.find((s) => s.id === 'script-exit-2');
      assert.ok(failEntry, 'Entrada com falha deve permanecer em autoScripts');
      assert.strictEqual(failEntry.lastExitCode, 2);

      // Arquivo ausente e path traversal fora de scriptsDir
      fs.unlinkSync(failPath);
      const rMissing = await sched.runScript('script-exit-2', { dryRun: true });
      assert.strictEqual(rMissing.ok, false);

      const outsidePy = path.join(tmpDir, 'outside.py');
      fs.writeFileSync(outsidePy, 'print("fora")\n', 'utf8');
      const rTraversal = await sched.runScript(outsidePy, { dryRun: true });
      assert.strictEqual(rTraversal.ok, false);

      return 'runScript 1-arg/2-arg, exit=2 persistido, arquivo ausente e traversal bloqueado OK';
    } finally {
      env.restoreEnv();
      rmTmp(tmpDir);
    }
  });

  await runCase('M5 - Overlay UI Contract', 'M5-06', 'Overlay HTML/CSS/JS respeita CSP, acessibilidade de contraste >= 7:1 e eventos IPC', () => {
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'recorder-overlay.html'), 'utf8');
    const css = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'styles', 'recorder-overlay.css'), 'utf8');
    const js = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'js', 'recorder-overlay.js'), 'utf8');

    assert.ok(html.includes('Content-Security-Policy') && html.includes("default-src 'self'"));
    assert.ok(html.includes('<title>M.P.E - Gravacao Ativa</title>'));
    assert.ok(html.includes('id="recorder-pill"'));
    assert.ok(html.includes('class="rec-dot"'));
    assert.ok(html.includes('id="rec-status-text"'));
    assert.ok(html.includes('id="rec-step-badge"'));
    assert.ok(html.includes('id="btn-stop-recording"'));
    assert.ok(css.includes('@keyframes rec-pulse'));
    assert.ok(js.includes('onPythonRecordingState'));
    assert.ok(js.includes('stopPythonRecording'));
    assert.ok(js.includes("e.key === 'Escape'"));

    execSync(`node -c "${path.join(CODE_DIR, 'src', 'renderer', 'js', 'recorder-overlay.js')}"`, { stdio: 'pipe' });

    const cssVars = {};
    const varRe = /--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/gi;
    let varMatch;
    while ((varMatch = varRe.exec(css)) !== null) {
      cssVars[`--${varMatch[1].toLowerCase()}`] = varMatch[2].toUpperCase();
    }
    assert.ok(cssVars['--bg-obsidian'], '--bg-obsidian ausente no CSS');
    assert.ok(cssVars['--bg-obsidian-soft'], '--bg-obsidian-soft ausente no CSS');
    assert.ok(cssVars['--text-light'], '--text-light ausente no CSS');
    assert.ok(cssVars['--gold-secondary'], '--gold-secondary ausente no CSS');
    assert.ok(cssVars['--nexus-red'], '--nexus-red ausente no CSS');
    assert.ok(cssVars['--nexus-red-hover'], '--nexus-red-hover ausente no CSS');

    const btnColorMatch = css.match(/\.rec-stop-btn\s*\{[^}]*?color\s*:\s*(#[0-9a-fA-F]{6})\b/i);
    assert.ok(btnColorMatch, 'Cor de texto de .rec-stop-btn nao encontrada no CSS');
    const btnTextColor = btnColorMatch[1].toUpperCase();

    const cText = contrastRatio(cssVars['--text-light'], cssVars['--bg-obsidian']);
    const cTextSoft = contrastRatio(cssVars['--text-light'], cssVars['--bg-obsidian-soft']);
    const cBadge = contrastRatio(cssVars['--gold-secondary'], cssVars['--bg-obsidian']);
    const cBtn = contrastRatio(btnTextColor, cssVars['--nexus-red']);
    const cBtnHover = contrastRatio(btnTextColor, cssVars['--nexus-red-hover']);
    assert.ok(cText >= 7, `Contraste texto (obsidian) insuficiente: ${cText.toFixed(2)}`);
    assert.ok(cTextSoft >= 7, `Contraste texto (obsidian-soft) insuficiente: ${cTextSoft.toFixed(2)}`);
    assert.ok(cBadge >= 7, `Contraste badge insuficiente: ${cBadge.toFixed(2)}`);
    assert.ok(cBtn >= 7, `Contraste botao default insuficiente: ${cBtn.toFixed(2)}`);
    assert.ok(cBtnHover >= 7, `Contraste botao hover insuficiente: ${cBtnHover.toFixed(2)}`);

    return `CSP + IDs + contrastes ${cText.toFixed(1)}:1 / ${cBadge.toFixed(1)}:1 / ${cBtn.toFixed(1)}:1 / hover ${cBtnHover.toFixed(1)}:1 validados`;
  });

  await runCase('M5 - Scheduler Timing', 'M5-07', 'Agendamento once/daily com nowProvider, MPE_TEST_CLOCK e prevencao de disparo duplicado', async () => {
    const tmpDir = mkTmp('mpe-m5-07-');
    const env = createIsolatedEnv(tmpDir, true, true);
    try {
      const rec = new PythonRecorder(env.ctx);
      const sOnce = await rec.saveScript({ name: 'Agenda Once', steps: [{ x: 10, y: 20, button: 'left', waitMs: 0 }] });
      const sDaily = await rec.saveScript({ name: 'Agenda Daily', steps: [{ x: 30, y: 40, button: 'right', waitMs: 0 }] });

      let currentNow = new Date(2026, 10, 18, 9, 29, 59, 0);
      const sched = new PythonScheduler(
        Object.assign({}, env.ctx, {
          nowProvider: () => new Date(currentNow.getTime())
        })
      );

      const badTime = await sched.scheduleScript(sOnce.script.id, { enabled: true, timeHHMM: '25:99', mode: 'once' });
      assert.strictEqual(badTime.ok, false);

      const rSched1 = await sched.scheduleScript(sOnce.script.id, { enabled: true, timeHHMM: '9:30', mode: 'once', dryRun: true });
      const rSched2 = await sched.scheduleScript(sDaily.script.id, { enabled: true, timeHHMM: '09:30', mode: 'daily', dryRun: true });
      assert.strictEqual(rSched1.ok, true);
      assert.strictEqual(rSched1.script.schedule.timeHHMM, '09:30');
      assert.strictEqual(rSched2.ok, true);

      // 09:29:59 -> 0 disparos
      const t0 = await sched.evaluateSchedules();
      assert.strictEqual(t0.triggered.length, 0);

      // 09:30:05 -> 1 disparo de cada
      currentNow = new Date(2026, 10, 18, 9, 30, 5, 0);
      const t1 = await sched.evaluateSchedules();
      assert.strictEqual(t1.triggered.length, 2);

      // Mesmo minuto (09:30:20 e 09:30:45) -> nao duplica
      currentNow = new Date(2026, 10, 18, 9, 30, 20, 0);
      const t2 = await sched.evaluateSchedules();
      assert.strictEqual(t2.triggered.length, 0);

      currentNow = new Date(2026, 10, 18, 9, 30, 45, 0);
      const t3 = await sched.evaluateSchedules();
      assert.strictEqual(t3.triggered.length, 0);

      const afterDay1 = env.cm.get().autoScripts;
      const onceEntry = afterDay1.find((s) => s.id === sOnce.script.id);
      const dailyEntry = afterDay1.find((s) => s.id === sDaily.script.id);
      assert.strictEqual(onceEntry.schedule.enabled, false, 'Modo once deve desabilitar apos execucao');
      assert.strictEqual(onceEntry.schedule.lastRunKey, '2026-11-18 09:30');
      assert.strictEqual(dailyEntry.schedule.enabled, true, 'Modo daily deve permanecer habilitado');

      // Proximo dia 2026-11-19 09:30:05 -> apenas daily executa
      currentNow = new Date(2026, 10, 19, 9, 30, 5, 0);
      const t4 = await sched.evaluateSchedules();
      assert.strictEqual(t4.triggered.length, 1);
      assert.strictEqual(t4.triggered[0].scriptId, sDaily.script.id);

      // Revogar consentimento -> proximo dia nao executa
      env.consent.setConsentDecision(false, {});
      currentNow = new Date(2026, 10, 20, 9, 30, 5, 0);
      const t5 = await sched.evaluateSchedules();
      assert.strictEqual(t5.blockedByConsent, true);
      assert.strictEqual(t5.triggered.length, 0);

      // Validar MPE_TEST_CLOCK avancando no tempo
      process.env.MPE_TEST_CLOCK = '2026-11-18T14:15:00';
      const envSched = new PythonScheduler(env.ctx);
      const envNow = envSched.getNow();
      assert.strictEqual(envNow.getFullYear(), 2026);
      assert.strictEqual(envNow.getHours(), 14);
      assert.strictEqual(envNow.getMinutes(), 15);

      return 'once/daily + prevencao mesmo minuto + revogacao consentimento + MPE_TEST_CLOCK validados';
    } finally {
      env.restoreEnv();
      rmTmp(tmpDir);
    }
  });

  await runCase('M5 - Delete & Containment', 'M5-08', 'deleteScript remove .py interno e nunca apaga arquivo fora de scriptsDir', async () => {
    const tmpDir = mkTmp('mpe-m5-08-');
    const env = createIsolatedEnv(tmpDir, true, true);
    try {
      const rec = new PythonRecorder(env.ctx);
      const sched = new PythonScheduler(env.ctx);

      const saved = await rec.saveScript({ name: 'Para Deletar', steps: [{ x: 1, y: 2, button: 'left', waitMs: 0 }] });
      const pyFile = saved.script.filePath;
      assert.strictEqual(fs.existsSync(pyFile), true);

      const delRes = await sched.deleteScript(saved.script.id);
      assert.strictEqual(delRes.ok, true);
      assert.strictEqual(fs.existsSync(pyFile), false, 'Arquivo interno deve ser removido');
      assert.strictEqual(env.cm.get().autoScripts.length, 0);

      // Arquivo externo apontado em autoScripts nao deve ser apagado
      const externalFile = path.join(tmpDir, 'protegido_externo.py');
      fs.writeFileSync(externalFile, 'print("nao apagar")\n', 'utf8');
      env.cm.save({
        autoScripts: [
          {
            id: 'script-external',
            name: 'Externo',
            filePath: externalFile,
            steps: [{ x: 1, y: 1, button: 'left', waitMs: 0 }],
            schedule: { enabled: false, timeHHMM: '09:00', mode: 'daily', lastRunKey: null },
            lastRunAt: null,
            lastExitCode: null
          }
        ]
      });

      const delExt = await sched.deleteScript('script-external');
      assert.strictEqual(delExt.ok, true);
      assert.strictEqual(fs.existsSync(externalFile), true, 'Arquivo fora de scriptsDir nao pode ser removido');
      assert.strictEqual(env.cm.get().autoScripts.length, 0);

      return 'deleteScript remove .py interno e preserva arquivo fora de scriptsDir';
    } finally {
      env.restoreEnv();
      rmTmp(tmpDir);
    }
  });

  await runCase('M5 - Process Cleanup', 'M5-09', 'stop() encerra processos python.exe em execucao sem deixar orfaos', async () => {
    const tmpDir = mkTmp('mpe-m5-09-');
    const env = createIsolatedEnv(tmpDir, true, true);
    try {
      const sched = new PythonScheduler(env.ctx);
      const sleepScript = path.join(env.scriptsDir, 'long_sleep.py');
      fs.writeFileSync(sleepScript, 'import time\ntime.sleep(30)\n', 'utf8');

      env.cm.save({
        autoScripts: [
          {
            id: 'script-long-sleep',
            name: 'Sleep 30s',
            filePath: sleepScript,
            steps: [{ x: 1, y: 1, button: 'left', waitMs: 0 }],
            schedule: { enabled: false, timeHHMM: '09:00', mode: 'daily', lastRunKey: null },
            lastRunAt: null,
            lastExitCode: null
          }
        ]
      });

      sched.start();
      assert.ok(sched._timer, 'Timer do scheduler deve estar ativo apos start()');

      const runPromise = sched.runScript('script-long-sleep', { dryRun: false });

      let trackedPid = null;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (sched.activeChildren.size > 0) {
          const first = sched.activeChildren.values().next().value;
          trackedPid = first && first.pid;
          if (trackedPid) break;
        }
        await new Promise((r) => setTimeout(r, 40));
      }

      assert.ok(trackedPid, 'Processo Python filho deveria estar rastreado em activeChildren');
      assert.strictEqual(isPidAlive(trackedPid), true, `PID ${trackedPid} deveria estar vivo antes do stop()`);

      sched.stop();
      assert.strictEqual(sched._timer, null, 'Timer deve ser limpo em stop()');
      assert.strictEqual(sched.activeChildren.size, 0, 'activeChildren deve estar vazio apos stop()');

      const res = await runPromise;
      assert.strictEqual(res.ok, false);

      // Pequena folga para o kernel finalizar o handle do processo encerrado
      const killDeadline = Date.now() + 2000;
      while (isPidAlive(trackedPid) && Date.now() < killDeadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.strictEqual(isPidAlive(trackedPid), false, `Processo orfao PID ${trackedPid} permaneceu vivo apos stop()`);

      return `PID ${trackedPid} rastreado, encerrado por stop() com 0 orfaos`;
    } finally {
      env.restoreEnv();
      rmTmp(tmpDir);
    }
  });

  await runCase('M5 - Security Containment Regression', 'M5-11', 'SEC-02/SEC-04: scriptsDir override, autoScripts[] traversal/non-.py e junction/symlink bloqueados', async () => {
    const tmpDir = mkTmp('mpe-m5-11-');
    const env = createIsolatedEnv(tmpDir, true, true);
    try {
      const outsideDir = path.join(tmpDir, 'outside_folder');
      fs.mkdirSync(outsideDir, { recursive: true });
      const outsideMarker = path.join(outsideDir, 'pwned_marker.txt');
      const outsidePy = path.join(outsideDir, 'evil_outside.py');
      fs.writeFileSync(
        outsidePy,
        `open(${JSON.stringify(outsideMarker)}, 'w').write('PWNED')\n`,
        'utf8'
      );

      const rec = new PythonRecorder(env.ctx);
      const sched = new PythonScheduler(env.ctx);

      // SEC-02: saveScript / stopRecording ignoram opts.scriptsDir
      const savedOverride = await rec.saveScript({
        name: 'OverrideTentativa',
        steps: [{ x: 10, y: 20, button: 'left', waitMs: 0 }],
        scriptsDir: outsideDir
      });
      assert.strictEqual(savedOverride.ok, true);
      assert.strictEqual(
        PythonRecorder.isPathInsideDir(savedOverride.script.filePath, env.scriptsDir),
        true,
        'saveScript nao pode aceitar override opts.scriptsDir'
      );
      assert.strictEqual(fs.existsSync(path.join(outsideDir, 'overridetentativa.py')), false);

      await rec.startRecording({ headless: true });
      env.ctx.hookBridge.emit('rec-click', { button: 'left', x: 55, y: 66, timestampMs: 1000 });
      const stopOverride = await rec.stopRecording({
        autoSave: true,
        name: 'StopOverride',
        scriptsDir: outsideDir
      });
      assert.strictEqual(stopOverride.ok, true);
      assert.strictEqual(
        PythonRecorder.isPathInsideDir(stopOverride.script.filePath, env.scriptsDir),
        true,
        'stopRecording nao pode aceitar override opts.scriptsDir'
      );
      assert.strictEqual(fs.existsSync(path.join(outsideDir, 'stopoverride.py')), false);

      // SEC-02: runScript ignora opts.scriptsDir em chamadas 1-arg IPC e 2-arg
      const sec02OneArg = await sched.runScript({
        scriptIdOrPath: outsidePy,
        scriptsDir: outsideDir,
        dryRun: false
      });
      assert.strictEqual(sec02OneArg.ok, false);
      const sec02OneArgRel = await sched.runScript({
        scriptIdOrPath: 'evil_outside.py',
        scriptsDir: outsideDir,
        dryRun: false
      });
      assert.strictEqual(sec02OneArgRel.ok, false);
      const sec02TwoArg = await sched.runScript('evil_outside.py', {
        scriptsDir: outsideDir,
        dryRun: false
      });
      assert.strictEqual(sec02TwoArg.ok, false);
      assert.strictEqual(fs.existsSync(outsideMarker), false);

      // SEC-04: autoScripts[] fora de scriptsDir, traversal ../, ou extensao != .py sao bloqueados
      const insideTxt = path.join(env.scriptsDir, 'injected.txt');
      fs.writeFileSync(insideTxt, 'print("not py")\n', 'utf8');

      const relToProdScript = 'codigo/data/scripts/nonexistent_prod_isolation_probe.py';
      env.cm.save({
        autoScripts: [
          {
            id: 'sec04-abs-outside',
            name: 'Abs Outside',
            filePath: outsidePy,
            steps: [{ x: 1, y: 1, button: 'left', waitMs: 0 }],
            schedule: { enabled: false, timeHHMM: '09:00', mode: 'daily', lastRunKey: null }
          },
          {
            id: 'sec04-rel-traversal',
            name: 'Rel Traversal',
            filePath: '../../outside_folder/evil_outside.py',
            steps: [{ x: 1, y: 1, button: 'left', waitMs: 0 }],
            schedule: { enabled: false, timeHHMM: '09:00', mode: 'daily', lastRunKey: null }
          },
          {
            id: 'sec04-non-py',
            name: 'Non Py',
            filePath: insideTxt,
            steps: [{ x: 1, y: 1, button: 'left', waitMs: 0 }],
            schedule: { enabled: false, timeHHMM: '09:00', mode: 'daily', lastRunKey: null }
          },
          {
            id: 'sec04-isolated-rel',
            name: 'Isolated Rel',
            filePath: relToProdScript,
            steps: [{ x: 1, y: 1, button: 'left', waitMs: 0 }],
            schedule: { enabled: false, timeHHMM: '09:00', mode: 'daily', lastRunKey: null }
          }
        ]
      });

      assert.strictEqual((await sched.runScript('sec04-abs-outside', { dryRun: false })).ok, false);
      assert.strictEqual((await sched.runScript('sec04-rel-traversal', { dryRun: false })).ok, false);
      assert.strictEqual((await sched.runScript('sec04-non-py', { dryRun: false })).ok, false);
      assert.strictEqual(fs.existsSync(outsideMarker), false);

      // Isolamento: entrada relativa com nome existente em scriptsDir isolado resolve para scriptsDir
      const isolatedTarget = path.join(env.scriptsDir, 'nonexistent_prod_isolation_probe.py');
      fs.writeFileSync(isolatedTarget, 'print("ISOLATED_OK")\n', 'utf8');
      const rIso = await sched.runScript('sec04-isolated-rel', { dryRun: false });
      assert.strictEqual(rIso.ok, true);
      assert.ok(rIso.stdout.includes('ISOLATED_OK'));

      // deleteScript usa basename fallback em scriptsDir isolado
      const delIso = await sched.deleteScript('sec04-isolated-rel');
      assert.strictEqual(delIso.ok, true);
      assert.strictEqual(fs.existsSync(isolatedTarget), false);

      // Junction/symlink realpath containment dentro de scriptsDir
      const junctionPath = path.join(env.scriptsDir, 'evil_junction');
      let junctionCreated = false;
      try {
        fs.symlinkSync(outsideDir, junctionPath, process.platform === 'win32' ? 'junction' : 'dir');
        junctionCreated = true;
      } catch (_) {}

      if (junctionCreated) {
        const escapedViaLink = path.join(junctionPath, 'evil_outside.py');
        assert.strictEqual(PythonScheduler.isPathInsideDir(escapedViaLink, env.scriptsDir), false);
        assert.strictEqual(PythonRecorder.isPathInsideDir(escapedViaLink, env.scriptsDir), false);
        const rJunc = await sched.runScript(escapedViaLink, { dryRun: false });
        assert.strictEqual(rJunc.ok, false);
        assert.strictEqual(fs.existsSync(outsideMarker), false);
      }

      return `SEC-02/SEC-04 bloqueados; junction=${junctionCreated ? 'testada' : 'nao suportada'}`;
    } finally {
      env.restoreEnv();
      rmTmp(tmpDir);
    }
  });

  await runCase('M5 - Step Coercion Regression', 'M5-12', 'BUG-SANITIZE-STEPS-COERCION: rejeita null, boolean, string vazia e guarda timestampMs', async () => {
    const tmpDir = mkTmp('mpe-m5-12-');
    const env = createIsolatedEnv(tmpDir, true, true);
    try {
      const rec = new PythonRecorder(env.ctx);
      const invalidPayloads = [
        [{ x: null, y: 10, button: 'left', waitMs: 0 }],
        [{ x: 10, y: null, button: 'left', waitMs: 0 }],
        [{ x: '', y: 10, button: 'left', waitMs: 0 }],
        [{ x: 10, y: '   ', button: 'left', waitMs: 0 }],
        [{ x: true, y: false, button: 'left', waitMs: 0 }],
        [{ x: {}, y: 10, button: 'left', waitMs: 0 }],
        [{ x: [10], y: 10, button: 'left', waitMs: 0 }],
        [{ x: 10, y: 20, button: 'left', waitMs: null }],
        [{ x: 10, y: 20, button: 'left', waitMs: false }],
        [{ x: 10, y: 20, button: 'left', waitMs: '' }],
        [{ x: 10, y: 20, button: 'left', waitMs: '   ' }],
        [{ x: 10, y: 20, button: 'left', waitMs: NaN }],
        [{ x: 10, y: 20, button: 'left', waitMs: Infinity }]
      ];

      for (const steps of invalidPayloads) {
        const res = await rec.saveScript({ name: 'CoercaoInvalida', steps });
        assert.strictEqual(res.ok, false, `Passo invalido foi aceito: ${JSON.stringify(steps)}`);
      }
      assert.strictEqual(fs.readdirSync(env.scriptsDir).length, 0);

      // waitMs undefined deve assumir default 0
      const validDefaultWait = await rec.saveScript({
        name: 'WaitDefaultZero',
        steps: [{ x: ' 120 ', y: -45, button: 'right' }]
      });
      assert.strictEqual(validDefaultWait.ok, true);
      assert.deepStrictEqual(validDefaultWait.script.steps, [
        { x: 120, y: -45, button: 'right', waitMs: 0 }
      ]);

      // _handleRecClick rejeita x/y null/""/boolean e faz fallback de timestampMs invalido para Date.now()
      await rec.startRecording({ headless: true });
      env.ctx.hookBridge.emit('rec-click', { button: 'left', x: null, y: '', timestampMs: 1000 });
      env.ctx.hookBridge.emit('rec-click', { button: 'left', x: false, y: 10, timestampMs: 1000 });
      assert.strictEqual(rec.steps.length, 0, 'Cliques com coordenadas null/vazias/boolean devem ser ignorados');

      env.ctx.hookBridge.emit('rec-click', { button: 'left', x: 100, y: 100, timestampMs: null });
      env.ctx.hookBridge.emit('rec-click', { button: 'left', x: 120, y: 120, timestampMs: '' });
      env.ctx.hookBridge.emit('rec-click', { button: 'left', x: 140, y: 140, timestampMs: false });
      assert.strictEqual(rec.steps.length, 3);
      assert.ok(rec.steps[1].waitMs < 5000 && rec.steps[2].waitMs < 5000, 'timestampMs invalido nao pode gerar delta de epoca 1970');
      await rec.stopRecording({ cancel: true });

      return `${invalidPayloads.length} payloads de coercao rejeitados e fallback de timestampMs validado`;
    } finally {
      env.restoreEnv();
      rmTmp(tmpDir);
    }
  });

  await runCase('M5 - Start/Stop Race Regression', 'M5-13', 'BUG-START-STOP-RACE: stopRecording durante _waitForHookReady cancela startRecording corretamente', async () => {
    const tmpDir = mkTmp('mpe-m5-13-');
    const env = createIsolatedEnv(tmpDir, true, true);
    try {
      const slowHook = new MockHookBridge();
      slowHook.proc = null;
      slowHook.isReady = false;
      slowHook.startRecording = () => {
        slowHook.isRecording = true;
        slowHook.commands.push('RECORD_ON');
        return { ok: true, recording: true, sent: false };
      };

      const rec = new PythonRecorder(
        Object.assign({}, env.ctx, {
          hookBridge: slowHook,
          waitForHookReadyMs: 1500
        })
      );

      const startPromise = rec.startRecording({ headless: true });
      assert.strictEqual(rec.isRecording, true);

      const stopRes = await rec.stopRecording({ cancel: true });
      assert.strictEqual(stopRes.ok, true);
      assert.strictEqual(rec.isRecording, false);
      assert.strictEqual(slowHook.isRecording, false);

      slowHook.isReady = true;
      slowHook.emit('ready');

      const startRes = await startPromise;
      assert.strictEqual(startRes.ok, false);
      assert.strictEqual(startRes.active, false);
      assert.strictEqual(startRes.cancelled, true);
      assert.strictEqual(rec.isRecording, false);

      const lastBroadcast = env.broadcasts[env.broadcasts.length - 1];
      assert.ok(lastBroadcast && lastBroadcast.payload.active === false, 'Ultimo broadcast deve manter active=false');

      return 'Race startRecording/stopRecording resolvido com { ok: false, active: false, cancelled: true }';
    } finally {
      env.restoreEnv();
      rmTmp(tmpDir);
    }
  });

  await runCase('M5 - Emoji & Control Char Sanitization', 'M5-14', 'BUG-EMOJI-STRIP-DISPLAYNAME & NULLBYTE: remove flags, keycaps, ZWJ, control chars com fallback Auto Script', async () => {
    const tmpDir = mkTmp('mpe-m5-14-');
    const env = createIsolatedEnv(tmpDir, true, true);
    try {
      const rec = new PythonRecorder(env.ctx);
      const step = [{ x: 10, y: 20, button: 'left', waitMs: 0 }];

      const cases = [
        { input: '\u{1F1E7}\u{1F1F7}', expected: 'Auto Script' },
        { input: '1\uFE0F\u20E3', expected: '1' },
        { input: '\u{1F468}\u200D\u{1F4BB}', expected: 'Auto Script' },
        { input: 'Script \u{1F680} \u{1F1E7}\u{1F1F7} Teste', expected: 'Script Teste' },
        { input: 'bad\0evil', expected: 'badevil' },
        { input: 'CON\0\x1F\x7F', expected: 'CON' }
      ];

      const forbiddenRe = /[\x00-\x1F\x7F]|\p{Extended_Pictographic}|\p{Regional_Indicator}|\u200D|\u20E3|\uFE0E|\uFE0F/gu;
      for (const c of cases) {
        const res = await rec.saveScript({ name: c.input, steps: step });
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.script.name, c.expected);
        forbiddenRe.lastIndex = 0;
        assert.strictEqual(forbiddenRe.test(res.script.name), false, `Caractere proibido permaneceu em: ${res.script.name}`);
      }

      return `${cases.length} nomes sanitizados com 0 emojis/combiners/control-chars`;
    } finally {
      env.restoreEnv();
      rmTmp(tmpDir);
    }
  });

  await runCase('M5 - Schedule DryRun Precedence & CLI Clock', 'M5-15', 'schedule.dryRun=false sobrescreve dryRunDefault=true e --test-clock <ISO> separado por espaco', async () => {
    const tmpDir = mkTmp('mpe-m5-15-');
    const env = createIsolatedEnv(tmpDir, true, true);
    try {
      const rec = new PythonRecorder(env.ctx);
      const saved = await rec.saveScript({
        name: 'Precedencia DryRun',
        steps: [{ x: 15, y: 25, button: 'left', waitMs: 0 }],
        dryRunDefault: true
      });
      assert.strictEqual(saved.ok, true);

      // Substitui .py gerado por marcador para distinguir dryRun=true vs dryRun=false
      const markerPath = path.join(env.scriptsDir, 'dryrun_marker.txt');
      fs.writeFileSync(
        saved.script.filePath,
        `import sys\nif "--dry-run" in sys.argv:\n    print("DRY_MODE")\nelse:\n    open(${JSON.stringify(markerPath)}, "w").write("REAL_RUN")\n    print("REAL_MODE")\n`,
        'utf8'
      );

      let now = new Date(2026, 10, 19, 10, 15, 0, 0);
      const sched = new PythonScheduler(
        Object.assign({}, env.ctx, { nowProvider: () => new Date(now.getTime()) })
      );

      // 1) schedule sem dryRun explicito deve herdar dryRunDefault=true
      await sched.scheduleScript(saved.script.id, { enabled: true, timeHHMM: '10:15', mode: 'daily' });
      const rDefault = await sched.evaluateSchedules();
      assert.strictEqual(rDefault.triggered.length, 1);
      assert.ok(rDefault.triggered[0].stdout.includes('DRY_MODE'));
      assert.strictEqual(fs.existsSync(markerPath), false);

      // 2) schedule com dryRun=false explicito deve sobrescrever dryRunDefault=true
      await sched.scheduleScript(saved.script.id, { enabled: true, timeHHMM: '10:16', mode: 'daily', dryRun: false });
      now = new Date(2026, 10, 19, 10, 16, 0, 0);
      const rOverride = await sched.evaluateSchedules();
      assert.strictEqual(rOverride.triggered.length, 1);
      assert.ok(rOverride.triggered[0].stdout.includes('REAL_MODE'));
      assert.strictEqual(fs.existsSync(markerPath), true);

      // SCH-05: --test-clock <ISO> separado por espaco e --test-clock=<ISO>
      const spaceClock = PythonScheduler.resolveClockFromArgsAndEnv(
        ['node', 'main.js', '--test-clock', '2026-11-19T15:10:00'],
        {}
      )();
      assert.strictEqual(spaceClock.getFullYear(), 2026);
      assert.strictEqual(spaceClock.getHours(), 15);
      assert.strictEqual(spaceClock.getMinutes(), 10);

      const eqClock = PythonScheduler.resolveClockFromArgsAndEnv(
        ['node', 'main.js', '--test-clock=2026-11-19T16:45:00'],
        {}
      )();
      assert.strictEqual(eqClock.getHours(), 16);
      assert.strictEqual(eqClock.getMinutes(), 45);

      return 'Precedencia schedule.dryRun=false e --test-clock <ISO> validados';
    } finally {
      env.restoreEnv();
      rmTmp(tmpDir);
    }
  });

  await runCase('M5 - Production Isolation', 'M5-10', 'Arquivos de producao mpe.config.json e codigo/data/ permanecem intactos', () => {
    const prodConfigShaAfter = sha256File(prodConfigPath);
    const prodDataAfter = snapshotDirEntries(prodDataDir);

    assert.strictEqual(prodConfigShaAfter, prodConfigShaBefore, 'codigo/mpe.config.json foi modificado pelos testes!');
    assert.deepStrictEqual(prodDataAfter, prodDataBefore, 'codigo/data/ foi modificado pelos testes!');
    return `SHA-256 mpe.config.json inalterado (${prodConfigShaAfter.slice(0, 12)}...), codigo/data/ intacto`;
  });
}

async function main() {
  const results = [];
  async function runCase(suite, id, name, fn) {
    const start = Date.now();
    try {
      const detail = await fn();
      const durationMs = Date.now() - start;
      results.push({ suite, id, name, status: 'PASS', durationMs, detail: detail || 'OK' });
      console.log(`[PASS] ${id} (${durationMs}ms) - ${name}: ${detail || 'OK'}`);
    } catch (err) {
      const durationMs = Date.now() - start;
      results.push({ suite, id, name, status: 'FAIL', durationMs, detail: err && err.message ? err.message : String(err) });
      console.error(`[FAIL] ${id} (${durationMs}ms) - ${name}:`, err && err.stack ? err.stack : err);
    }
  }

  await runM5Suite({ runCase, makeTempDir, rmSafe, CODE_DIR, ROOT_DIR });

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log('\n=== RESUMO BATERIA M5 (PYTHON RECORDER & SCHEDULER) ===');
  console.log(`Total: ${results.length} | PASS: ${passed} | FAIL: ${failed}`);
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runM5Suite };
