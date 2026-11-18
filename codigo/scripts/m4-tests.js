const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const CODE_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(CODE_DIR, '..');
const PROD_CONFIG_PATH = path.join(CODE_DIR, 'mpe.config.json');

const M4_FILES = [
  path.join(CODE_DIR, 'src', 'main', 'miniAstrolabeManager.js'),
  path.join(CODE_DIR, 'src', 'renderer', 'mini-astrolabe.html'),
  path.join(CODE_DIR, 'src', 'renderer', 'styles', 'mini-astrolabe.css'),
  path.join(CODE_DIR, 'src', 'renderer', 'js', 'mini-astrolabe.js'),
  path.join(CODE_DIR, 'scripts', 'm4-tests.js')
];

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return 'MISSING';
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs = 10000, intervalMs = 80, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const val = await fn();
      if (val) return val;
    } catch (err) {
      lastErr = err;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timeout aguardando ${label}${lastErr ? `: ${lastErr.message}` : ''}`);
}

function getTreeCpuTicks(rootPid) {
  const psScript = [
    `$root = ${Number(rootPid)};`,
    `$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, KernelModeTime, UserModeTime;`,
    `$set = New-Object 'System.Collections.Generic.HashSet[int]';`,
    `[void]$set.Add($root);`,
    `$added = $true;`,
    `while ($added) {`,
    `  $added = $false;`,
    `  foreach ($p in $all) {`,
    `    if ($set.Contains([int]$p.ParentProcessId) -and -not $set.Contains([int]$p.ProcessId)) {`,
    `      [void]$set.Add([int]$p.ProcessId);`,
    `      $added = $true;`,
    `    }`,
    `  }`,
    `}`,
    `$ticks = 0L;`,
    `$count = 0;`,
    `foreach ($p in $all) {`,
    `  if ($set.Contains([int]$p.ProcessId)) {`,
    `    $ticks += [int64]$p.KernelModeTime + [int64]$p.UserModeTime;`,
    `    $count++;`,
    `  }`,
    `}`,
    `Write-Output "$ticks|$count"`
  ].join(' ');

  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    { encoding: 'utf8', windowsHide: true }
  ).trim();
  const [ticksStr, countStr] = out.split('|');
  return {
    ticks: Number(ticksStr || 0),
    procCount: Number(countStr || 0)
  };
}

function listDescendantsAndMpeHook(rootPid) {
  const psScript = [
    `$root = ${Number(rootPid)};`,
    `$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine;`,
    `$set = New-Object 'System.Collections.Generic.HashSet[int]';`,
    `[void]$set.Add($root);`,
    `$added = $true;`,
    `while ($added) {`,
    `  $added = $false;`,
    `  foreach ($p in $all) {`,
    `    if ($set.Contains([int]$p.ParentProcessId) -and -not $set.Contains([int]$p.ProcessId)) {`,
    `      [void]$set.Add([int]$p.ProcessId);`,
    `      $added = $true;`,
    `    }`,
    `  }`,
    `}`,
    `$alive = @();`,
    `foreach ($p in $all) {`,
    `  if ($set.Contains([int]$p.ProcessId)) {`,
    `    $alive += "$($p.ProcessId):$($p.Name)";`,
    `  }`,
    `}`,
    `Write-Output ($alive -join ',')`
  ].join(' ');
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    { encoding: 'utf8', windowsHide: true }
  ).trim();
  return out ? out.split(',').filter(Boolean) : [];
}

function taskkillTree(pid) {
  if (!pid) return;
  try {
    execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], {
      stdio: 'ignore',
      windowsHide: true
    });
  } catch (_) {}
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error(`CDP connect timeout: ${this.wsUrl}`)), 8000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`CDP error: ${err.message || err.type || 'unknown'}`));
      });
      ws.addEventListener('message', (ev) => {
        let msg;
        try {
          msg = JSON.parse(String(ev.data));
        } catch (_) {
          return;
        }
        if (msg && typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej, timer: t } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          clearTimeout(t);
          if (msg.error) {
            rej(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
          } else {
            res(msg.result);
          }
        }
      });
      ws.addEventListener('close', () => {
        for (const [, entry] of this.pending.entries()) {
          clearTimeout(entry.timer);
          entry.reject(new Error('CDP connection closed'));
        }
        this.pending.clear();
      });
    });
  }

  send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP socket not open for ${method}`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout on ${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res && res.exceptionDetails) {
      const ex = res.exceptionDetails;
      const desc =
        (ex.exception && (ex.exception.description || ex.exception.value)) ||
        ex.text ||
        'JS evaluation error';
      throw new Error(desc);
    }
    return res && res.result ? res.result.value : undefined;
  }

  async moveMouse(x, y) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(x),
      y: Math.round(y),
      button: 'none',
      pointerType: 'mouse'
    });
  }

  async clickMouse(x, y) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: rx,
      y: ry,
      button: 'none',
      pointerType: 'mouse'
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: rx,
      y: ry,
      button: 'left',
      clickCount: 1,
      pointerType: 'mouse'
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: rx,
      y: ry,
      button: 'left',
      clickCount: 1,
      pointerType: 'mouse'
    });
  }

  close() {
    try {
      if (this.ws) this.ws.close();
    } catch (_) {}
  }
}

async function launchElectron({ userDataDir, configPath, dataDir, cleanState = false, forceCleanConsent = false }) {
  const electronExe = require('electron');
  const args = [
    CODE_DIR,
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    `--config-path=${configPath}`
  ];
  if (cleanState) args.push('--clean-state');

  const env = Object.assign({}, process.env, {
    MPE_CONFIG_PATH: configPath,
    MPE_DATA_DIR: dataDir,
    MPE_ENABLE_ISOLATED_BACKUP: '1',
    MPE_TEST_OPEN_URL_HTTP: '1'
  });
  if (forceCleanConsent) {
    env.MPE_FORCE_CLEAN_CONSENT = '1';
  } else {
    delete env.MPE_FORCE_CLEAN_CONSENT;
  }

  const proc = spawn(electronExe, args, {
    cwd: CODE_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false
  });

  let stderrBuf = '';
  let stdoutBuf = '';
  let exitCode = null;
  let exited = false;
  const exitPromise = new Promise((resolve) => {
    proc.on('exit', (code) => {
      exitCode = code;
      exited = true;
      resolve(code);
    });
  });

  proc.stdout.on('data', (d) => { stdoutBuf += d.toString(); });
  proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });

  const cdpPort = await waitFor(() => {
    if (exited) {
      throw new Error(`Electron encerrou prematuramente (code=${exitCode}): ${stderrBuf}`);
    }
    const m = stderrBuf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    return m ? Number(m[1]) : null;
  }, 15000, 60, 'DevTools listening port');

  async function listTargets() {
    const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    return await res.json();
  }

  async function connectTarget(fileSuffix, timeoutMs = 10000) {
    const target = await waitFor(async () => {
      const list = await listTargets();
      return list.find((t) => t.type === 'page' && t.url && t.url.includes(fileSuffix) && t.webSocketDebuggerUrl);
    }, timeoutMs, 80, `target ${fileSuffix}`);

    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.enable');
    await waitFor(
      () => client.eval(`document.readyState === 'complete' && Boolean(window.mpeApi)`),
      8000,
      60,
      `${fileSuffix} mpeApi ready`
    );
    return client;
  }

  return {
    proc,
    pid: proc.pid,
    cdpPort,
    listTargets,
    connectTarget,
    waitExit: (ms = 5000) =>
      Promise.race([
        exitPromise,
        sleep(ms).then(() => {
          throw new Error(`Timeout aguardando encerramento do Electron (pid=${proc.pid})`);
        })
      ]),
    isExited: () => exited,
    getLogs: () => ({ stdout: stdoutBuf, stderr: stderrBuf })
  };
}

function makeSamplePoints(count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    pts.push({
      id: `m4-pt-${i + 1}`,
      code: `${String(i + 1).padStart(2, '0')} ${i + 1}`,
      title: `Slot ${i + 1}`,
      description: `Atalho teste ${i + 1}`,
      actionType: 'open_organizer',
      orbit: 2,
      angle: (i * 30) % 360,
      elevation: 12,
      vectorStyle: i % 2 === 0 ? 'gold' : 'blue',
      glyph: '*',
      hasArrow: true,
      slotIndex: i,
      slotNumber: i + 1,
      params: { targetScope: 'arquivos' }
    });
  }
  return pts;
}

function parseRgba(str) {
  const m = String(str || '').match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!m) return null;
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] !== undefined ? Number(m[4]) : 1
  };
}

function compositeOver(fg, bg) {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1
  };
}

function relLuminance(c) {
  const toLinear = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

function contrastRatio(fgStr, bgStr) {
  const backdrop = { r: 4, g: 4, b: 6, a: 1 };
  const bgRaw = parseRgba(bgStr) || backdrop;
  const bg = compositeOver(bgRaw, backdrop);
  const fgRaw = parseRgba(fgStr) || { r: 255, g: 255, b: 255, a: 1 };
  const fg = compositeOver(fgRaw, bg);
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

async function main() {
  const prodShaBefore = sha256File(PROD_CONFIG_PATH);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpe-m4-'));
  const userDataDir = path.join(tmpDir, 'userdata');
  const configPath = path.join(tmpDir, 'mpe.config.json');
  const dataDir = path.join(tmpDir, 'data');

  const results = [];
  let activeInstance = null;
  let mainCdp = null;
  let miniCdp = null;
  let httpServer = null;

  async function runTest(id, name, fn) {
    const start = Date.now();
    try {
      const detail = await fn();
      const ms = Date.now() - start;
      results.push({ id, name, status: 'PASS', ms, detail });
      console.log(`[PASS] ${id} (${ms}ms) - ${name}: ${detail}`);
    } catch (err) {
      const ms = Date.now() - start;
      results.push({ id, name, status: 'FAIL', ms, detail: err.message });
      console.error(`[FAIL] ${id} (${ms}ms) - ${name}: ${err.message}`);
    }
  }

  try {
    // -----------------------------------------------------------------------
    // M4-01: Consent Gate, Toggle & Layout Persistence Across Restart
    // -----------------------------------------------------------------------
    await runTest('M4-01', 'Consent gate, toggle e persistencia de layout apos reinicio', async () => {
      activeInstance = await launchElectron({
        userDataDir,
        configPath,
        dataDir,
        cleanState: true,
        forceCleanConsent: true
      });
      mainCdp = await activeInstance.connectTarget('index.html');

      const stateBefore = await mainCdp.eval(`window.mpeApi.getMiniAstrolabeState()`);
      assert.strictEqual(stateBefore.blockedByConsent, true, 'Deveria estar bloqueado antes do aceite');
      assert.strictEqual(stateBefore.windowOpen, false, 'Janela Mini nao pode abrir sem aceite');

      const toggleBlocked = await mainCdp.eval(`window.mpeApi.toggleMiniAstrolabe(true)`);
      assert.strictEqual(toggleBlocked.blockedByConsent, true, 'toggleMiniAstrolabe deve ser bloqueado antes do aceite');

      const targetsBefore = await activeInstance.listTargets();
      assert.ok(
        !targetsBefore.some((t) => t.url && t.url.includes('mini-astrolabe.html')),
        'mini-astrolabe.html nao deve existir antes do aceite'
      );

      const consentRes = await mainCdp.eval(`
        window.mpeApi.setConsentDecision(true, {
          backgroundExecution: true,
          launchAppsAndLinks: true,
          pythonAutomation: true
        })
      `);
      assert.strictEqual(consentRes.ok, true);
      assert.strictEqual(consentRes.consent.accepted, true);

      miniCdp = await activeInstance.connectTarget('mini-astrolabe.html');
      const stateAfterAccept = await mainCdp.eval(`window.mpeApi.getMiniAstrolabeState()`);
      assert.strictEqual(stateAfterAccept.blockedByConsent, false);
      assert.strictEqual(stateAfterAccept.windowOpen, true);

      const toggleOff = await mainCdp.eval(`window.mpeApi.toggleMiniAstrolabe(false)`);
      assert.strictEqual(toggleOff.ok, true);
      assert.strictEqual(toggleOff.enabled, false);
      assert.strictEqual(toggleOff.windowOpen, false);
      miniCdp.close();
      miniCdp = null;

      await waitFor(async () => {
        const list = await activeInstance.listTargets();
        return !list.some((t) => t.url && t.url.includes('mini-astrolabe.html'));
      }, 5000, 60, 'fechamento do mini-astrolabe');

      const toggleOn = await mainCdp.eval(`window.mpeApi.toggleMiniAstrolabe(true)`);
      assert.strictEqual(toggleOn.ok, true);
      assert.strictEqual(toggleOn.enabled, true);
      assert.strictEqual(toggleOn.windowOpen, true);
      miniCdp = await activeInstance.connectTarget('mini-astrolabe.html');

      const updatedLayout = await mainCdp.eval(
        `window.mpeApi.updateMiniAstrolabeLayout({ x: 540, y: 340, size: 76, scale: 1.15 })`
      );
      assert.strictEqual(updatedLayout.ok, true);
      assert.strictEqual(updatedLayout.miniAstrolabe.size, 76);
      assert.strictEqual(updatedLayout.miniAstrolabe.scale, 1.15);

      // Reinicia Electron na mesma pasta isolada para provar persistencia
      miniCdp.close();
      miniCdp = null;
      await mainCdp.eval(`window.mpeApi.quitApp()`).catch(() => {});
      await activeInstance.waitExit(6000);
      mainCdp.close();
      mainCdp = null;

      activeInstance = await launchElectron({
        userDataDir,
        configPath,
        dataDir,
        cleanState: false,
        forceCleanConsent: false
      });
      mainCdp = await activeInstance.connectTarget('index.html');
      miniCdp = await activeInstance.connectTarget('mini-astrolabe.html');

      const persistedConsent = await mainCdp.eval(`window.mpeApi.getConsentStatus()`);
      assert.strictEqual(persistedConsent.accepted, true, 'Consentimento deve persistir apos reinicio');

      const persistedMini = await mainCdp.eval(`window.mpeApi.getMiniAstrolabeState()`);
      assert.strictEqual(persistedMini.windowOpen, true, 'Mini Astrolabio deve reabrir automaticamente');
      assert.strictEqual(persistedMini.enabled, true);
      assert.strictEqual(persistedMini.x, 540);
      assert.strictEqual(persistedMini.y, 340);
      assert.strictEqual(persistedMini.size, 76);
      assert.strictEqual(persistedMini.scale, 1.15);

      return 'Consent gate bloqueou pre-aceite; toggle e layout (540,340,size=76,scale=1.15) persistiram apos reinicio';
    });

    // -----------------------------------------------------------------------
    // M4-02: Live Electron A-B-A OS CPU Delta <= 1.0%
    // -----------------------------------------------------------------------
    await runTest('M4-02', 'Medicao A-B-A de CPU em repouso (rotacao CSS vs estatico <= 1.0%)', async () => {
      // Simula o usuario ocultando o HUD principal com ESC (pausando o Astrolabe3D em segundo plano)
      await mainCdp.eval(`
        (() => {
          const splash = document.getElementById('splash-screen');
          if (splash) splash.classList.add('hidden');
          document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.add('hidden'));
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        })()
      `);
      await mainCdp.eval(`window.mpeApi.updateMiniAstrolabeLayout({ size: 68, scale: 1.0 })`);
      await sleep(1800);

      const cpuCount = Math.max(1, os.cpus().length);
      async function measureWindow(paused) {
        await miniCdp.eval(`
          (() => {
            const rot = document.getElementById('mini-rotator');
            rot.style.animationPlayState = ${paused ? "'paused'" : "''"};
            return getComputedStyle(rot).animationPlayState;
          })()
        `);
        await sleep(350);
        const s0 = getTreeCpuTicks(activeInstance.pid);
        const t0 = performance.now();
        await sleep(4500);
        const s1 = getTreeCpuTicks(activeInstance.pid);
        const t1 = performance.now();
        const dtSec = Math.max(0.5, (t1 - t0) / 1000);
        const dCpuSec = Math.max(0, (s1.ticks - s0.ticks) * 1e-7);
        const pct = (dCpuSec / (dtSec * cpuCount)) * 100;
        return { pct, procs: s1.procCount };
      }

      const a1 = await measureWindow(true);
      const b = await measureWindow(false);
      const a2 = await measureWindow(true);
      await miniCdp.eval(`document.getElementById('mini-rotator').style.animationPlayState = '';`);

      const staticAvg = (a1.pct + a2.pct) / 2;
      const deltaPct = b.pct - staticAvg;
      assert.ok(
        deltaPct <= 1.0,
        `Delta de CPU acima de 1.0%: staticA1=${a1.pct.toFixed(3)}% rotatingB=${b.pct.toFixed(3)}% staticA2=${a2.pct.toFixed(3)}% delta=${deltaPct.toFixed(3)}%`
      );
      return `A1=${a1.pct.toFixed(3)}% B=${b.pct.toFixed(3)}% A2=${a2.pct.toFixed(3)}% | delta=${deltaPct.toFixed(3)}% (<= 1.0%, procs=${b.procs})`;
    });

    // -----------------------------------------------------------------------
    // M4-03: Hover Pause & Resume
    // -----------------------------------------------------------------------
    await runTest('M4-03', 'Pausa imediata ao passar o mouse e retomada ao sair', async () => {
      await mainCdp.eval(`window.mpeApi.updateMiniAstrolabeLayout({ x: 540, y: 340, size: 68, scale: 1.0 })`);
      await sleep(200);

      const runningState = await miniCdp.eval(`getComputedStyle(document.getElementById('mini-rotator')).animationPlayState`);
      assert.strictEqual(runningState, 'running', 'Rotacao deve estar ativa em repouso');

      const t1 = await miniCdp.eval(`getComputedStyle(document.getElementById('mini-rotator')).transform`);
      await sleep(280);
      const t2 = await miniCdp.eval(`getComputedStyle(document.getElementById('mini-rotator')).transform`);
      assert.notStrictEqual(t1, t2, 'Matriz transform deve mudar continuamente em repouso');

      const hubCenter = await miniCdp.eval(`
        (() => {
          const r = document.getElementById('mini-hub').getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()
      `);
      await miniCdp.moveMouse(hubCenter.x, hubCenter.y);

      await waitFor(
        () =>
          miniCdp.eval(`
            document.getElementById('mini-root').dataset.expanded === 'true' &&
              !document.getElementById('mini-root').classList.contains('is-blooming') &&
            getComputedStyle(document.getElementById('mini-rotator')).animationPlayState === 'paused'
          `),
        4000,
        50,
        'pausa e abertura do leque no hover'
      );

      const p1 = await miniCdp.eval(`getComputedStyle(document.getElementById('mini-rotator')).transform`);
      await sleep(280);
      const p2 = await miniCdp.eval(`getComputedStyle(document.getElementById('mini-rotator')).transform`);
      assert.strictEqual(p1, p2, 'Matriz transform deve permanecer congelada durante o hover');

      // Move cursor para fora do hitplate para recolher e retomar rotacao
      await miniCdp.moveMouse(2, 2);
      await miniCdp.eval(`document.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))`);

      await waitFor(
        () =>
          miniCdp.eval(`
            document.getElementById('mini-root').dataset.expanded === 'false' &&
            getComputedStyle(document.getElementById('mini-rotator')).animationPlayState === 'running'
          `),
        4000,
        50,
        'colapso e retomada da rotacao apos saida do mouse'
      );

      return 'Rotacao ativa em repouso, pausada instantaneamente no hover (transform congelado) e retomada ao sair';
    });

    // -----------------------------------------------------------------------
    // M4-04: Resize, Multi-Slot (3 e 12+) Zero Overlap & Real 1-Click open_url
    // -----------------------------------------------------------------------
    await runTest('M4-04', 'Redimensionamento, geometria sem sobreposicao (3 e 12 slots) e execucao 1-clique', async () => {
      const combos = [
        { count: 3, size: 48, scale: 0.8 },
        { count: 3, size: 68, scale: 1.0 },
        { count: 3, size: 96, scale: 1.35 },
        { count: 12, size: 48, scale: 0.8 },
        { count: 12, size: 68, scale: 1.0 },
        { count: 12, size: 96, scale: 1.35 }
      ];

      for (const c of combos) {
        const pts = makeSamplePoints(c.count);
        await mainCdp.eval(`
          (async () => {
            const cfg = await window.mpeApi.getConfig();
            cfg.points = ${JSON.stringify(pts)};
            await window.mpeApi.saveConfig(cfg);
          })()
        `);
        const miniSt = await mainCdp.eval(`window.mpeApi.getMiniAstrolabeState()`);
        const wa = miniSt.workArea;
        const cx = Math.round(wa.x + wa.width / 2);
        const cy = Math.round(wa.y + wa.height / 2);
        await mainCdp.eval(
          `window.mpeApi.updateMiniAstrolabeLayout({ x: ${cx}, y: ${cy}, size: ${c.size}, scale: ${c.scale} })`
        );
        await sleep(150);

        await mainCdp.eval(`window.mpeApi.setMiniExpandedBounds(true)`);
        await waitFor(
          () =>
            miniCdp.eval(`
              document.getElementById('mini-root').dataset.expanded === 'true' &&
              !document.getElementById('mini-root').classList.contains('is-blooming') &&
              document.querySelectorAll('.fan-slot-btn').length === ${c.count}
            `),
          4000,
          50,
          `expand com count=${c.count} size=${c.size} scale=${c.scale}`
        );
        await sleep(120);

        const geom = await miniCdp.eval(`
          (async () => {
            const st = await window.mpeApi.getMiniAstrolabeState();
            const btns = Array.from(document.querySelectorAll('.fan-slot-btn')).map((el) => {
              const r = el.getBoundingClientRect();
              const cs = getComputedStyle(el);
              return {
                slot: el.dataset.slotNumber,
                left: r.left,
                top: r.top,
                right: r.right,
                bottom: r.bottom,
                width: r.width,
                height: r.height,
                visible: cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0
              };
            });
            const hubR = document.getElementById('mini-hub').getBoundingClientRect();
            const ctrlR = document.getElementById('mini-controls').getBoundingClientRect();
            return {
              innerW: window.innerWidth,
              innerH: window.innerHeight,
              bounds: st.bounds,
              workArea: st.workArea,
              btns,
              hub: { left: hubR.left, top: hubR.top, right: hubR.right, bottom: hubR.bottom },
              ctrl: { left: ctrlR.left, top: ctrlR.top, right: ctrlR.right, bottom: ctrlR.bottom }
            };
          })()
        `);

        assert.strictEqual(geom.btns.length, c.count, `Esperado ${c.count} botoes`);
        const overlaps = (a, b) => !(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1);

        for (const b of geom.btns) {
          assert.ok(b.visible, `Slot ${b.slot} invisivel`);
          assert.ok(b.width >= 39.5 && b.height >= 39.5, `Slot ${b.slot} menor que 40px (${b.width}x${b.height})`);
          assert.ok(
            b.left >= -1 && b.top >= -1 && b.right <= geom.innerW + 1 && b.bottom <= geom.innerH + 1,
            `Slot ${b.slot} fora da janela (${JSON.stringify(b)} vs ${geom.innerW}x${geom.innerH})`
          );
          const sLeft = geom.bounds.x + b.left;
          const sTop = geom.bounds.y + b.top;
          const sRight = geom.bounds.x + b.right;
          const sBottom = geom.bounds.y + b.bottom;
          assert.ok(
            sLeft >= geom.workArea.x - 1 &&
              sTop >= geom.workArea.y - 1 &&
              sRight <= geom.workArea.x + geom.workArea.width + 1 &&
              sBottom <= geom.workArea.y + geom.workArea.height + 1,
            `Slot ${b.slot} fora do workArea`
          );
          assert.ok(!overlaps(b, geom.hub), `Slot ${b.slot} sobrepoe o hub central`);
          assert.ok(!overlaps(b, geom.ctrl), `Slot ${b.slot} sobrepoe controles de escala`);
        }

        for (let i = 0; i < geom.btns.length; i++) {
          for (let j = i + 1; j < geom.btns.length; j++) {
            assert.ok(
              !overlaps(geom.btns[i], geom.btns[j]),
              `Sobreposicao entre slot ${geom.btns[i].slot} e ${geom.btns[j].slot} em count=${c.count} scale=${c.scale}`
            );
          }
        }
      }

      // Testa clique no botao '+' de resize dentro de .mini-controls
      const scaleBeforeCtrl = await miniCdp.eval(`document.getElementById('mini-scale-badge').textContent`);
      const plusPos = await miniCdp.eval(`
        (() => {
          const r = document.getElementById('btn-mini-scale-up').getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()
      `);
      await miniCdp.clickMouse(plusPos.x, plusPos.y);
      await waitFor(
        async () => (await miniCdp.eval(`document.getElementById('mini-scale-badge').textContent`)) !== scaleBeforeCtrl,
        3000,
        50,
        'atualizacao de escala via controle +'
      );

      // Execucao 1-clique real de open_url em servidor HTTP local efemero
      let httpHit = false;
      httpServer = http.createServer((req, res) => {
        if (req.url && req.url.includes('/m4-click-test')) {
          httpHit = true;
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('M4_OK');
      });
      await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
      const port = httpServer.address().port;

      const urlPts = makeSamplePoints(3);
      urlPts[0] = Object.assign({}, urlPts[0], {
        id: 'm4-open-url-1',
        title: 'Link M4 Teste',
        actionType: 'open_url',
        params: { url: `http://127.0.0.1:${port}/m4-click-test` }
      });
      await mainCdp.eval(`
        (async () => {
          const cfg = await window.mpeApi.getConfig();
          cfg.points = ${JSON.stringify(urlPts)};
          await window.mpeApi.saveConfig(cfg);
          await window.mpeApi.updateMiniAstrolabeLayout({ size: 68, scale: 1.0 });
        })()
      `);
      await sleep(200);
      await mainCdp.eval(`window.mpeApi.setMiniExpandedBounds(true)`);
      await waitFor(
        () => miniCdp.eval(`Boolean(document.querySelector('.fan-slot-btn[data-point-id="m4-open-url-1"]'))`),
        4000,
        50,
        'slot open_url sincronizado'
      );

      const btnPos = await miniCdp.eval(`
        (() => {
          const r = document.querySelector('.fan-slot-btn[data-point-id="m4-open-url-1"]').getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()
      `);
      await miniCdp.clickMouse(btnPos.x, btnPos.y);

      await waitFor(
        () => miniCdp.eval(`document.getElementById('mini-root').dataset.lastExecOk === 'true'`),
        5000,
        60,
        'confirmacao executePoint no Mini Astrolabio'
      );
      const execType = await miniCdp.eval(`document.getElementById('mini-root').dataset.lastExecType`);
      assert.strictEqual(execType, 'open_url');

      await waitFor(() => httpHit, 4000, 60, 'hit HTTP 127.0.0.1 de open_url');
      await mainCdp.eval(`window.mpeApi.setMiniExpandedBounds(false)`);
      httpServer.close();
      httpServer = null;

      return `6 combinacoes (3/12 slots x 0.8/1.0/1.35x) com 0 sobreposicoes; controle + e 1-clique open_url (127.0.0.1:${port}) validados`;
    });

    // -----------------------------------------------------------------------
    // M4-05: 4-Corner Screen-Edge Clamping & Flipping
    // -----------------------------------------------------------------------
    await runTest('M4-05', 'Clamping e inversao do leque nos 4 cantos da workArea', async () => {
      const pts12 = makeSamplePoints(12);
      await mainCdp.eval(`
        (async () => {
          const cfg = await window.mpeApi.getConfig();
          cfg.points = ${JSON.stringify(pts12)};
          await window.mpeApi.saveConfig(cfg);
        })()
      `);

      const baseSt = await mainCdp.eval(`window.mpeApi.getMiniAstrolabeState()`);
      const wa = baseSt.workArea;
      const corners = [
        { name: 'top-left', x: wa.x + 10, y: wa.y + 10 },
        { name: 'top-right', x: wa.x + wa.width - 10, y: wa.y + 10 },
        { name: 'bottom-left', x: wa.x + 10, y: wa.y + wa.height - 10 },
        { name: 'bottom-right', x: wa.x + wa.width - 10, y: wa.y + wa.height - 10 }
      ];

      for (const corner of corners) {
        await mainCdp.eval(
          `window.mpeApi.updateMiniAstrolabeLayout({ x: ${corner.x}, y: ${corner.y}, size: 68, scale: 1.0 })`
        );
        await sleep(120);
        await mainCdp.eval(`window.mpeApi.setMiniExpandedBounds(true)`);
        await waitFor(
          () =>
            miniCdp.eval(`
              document.getElementById('mini-root').dataset.expanded === 'true' &&
              !document.getElementById('mini-root').classList.contains('is-blooming') &&
              document.querySelectorAll('.fan-slot-btn').length === 12
            `),
          4000,
          50,
          `canto ${corner.name}`
        );
        // Espera o redesenho apos mudar o tamanho da janela (100 ms as vezes media o layout anterior)
        await sleep(350);

        const g = await miniCdp.eval(`
          (async () => {
            const st = await window.mpeApi.getMiniAstrolabeState();
            const btns = Array.from(document.querySelectorAll('.fan-slot-btn')).map((el) => {
              const r = el.getBoundingClientRect();
              return {
                slot: el.dataset.slotNumber,
                left: r.left,
                top: r.top,
                right: r.right,
                bottom: r.bottom
              };
            });
            return { bounds: st.bounds, workArea: st.workArea, btns };
          })()
        `);

        for (const b of g.btns) {
          const sx1 = g.bounds.x + b.left;
          const sy1 = g.bounds.y + b.top;
          const sx2 = g.bounds.x + b.right;
          const sy2 = g.bounds.y + b.bottom;
          assert.ok(
            sx1 >= g.workArea.x - 1 &&
              sy1 >= g.workArea.y - 1 &&
              sx2 <= g.workArea.x + g.workArea.width + 1 &&
              sy2 <= g.workArea.y + g.workArea.height + 1,
            `Canto ${corner.name} slot ${b.slot} escapou da workArea`
          );
        }

        for (let i = 0; i < g.btns.length; i++) {
          for (let j = i + 1; j < g.btns.length; j++) {
            const a = g.btns[i];
            const b = g.btns[j];
            const ov = !(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1);
            assert.ok(!ov, `Canto ${corner.name} sobreposicao entre slots ${a.slot} e ${b.slot}`);
          }
        }
      }

      await mainCdp.eval(`window.mpeApi.setMiniExpandedBounds(false)`);
      return '4 cantos (top-left, top-right, bottom-left, bottom-right) com 12 slots 100% dentro da workArea e 0 sobreposicoes';
    });

    // -----------------------------------------------------------------------
    // M4-06: Bidirectional Real-Time points[] Sync & Reorder
    // -----------------------------------------------------------------------
    await runTest('M4-06', 'Sincronizacao em tempo real de criacao, edicao, reordenacao e exclusao de slots', async () => {
      const basePts = makeSamplePoints(3);
      await mainCdp.eval(`
        (async () => {
          const cfg = await window.mpeApi.getConfig();
          cfg.points = ${JSON.stringify(basePts)};
          await window.mpeApi.saveConfig(cfg);
        })()
      `);
      await waitFor(
        () => miniCdp.eval(`document.querySelectorAll('.fan-slot-btn').length === 3`),
        4000,
        50,
        'sync inicial 3 pontos'
      );

      // Criar 4o ponto
      await mainCdp.eval(`
        (async () => {
          const cfg = await window.mpeApi.getConfig();
          cfg.points.push({
            id: 'm4-added-4',
            code: '04 4',
            title: 'Novo Slot 4',
            actionType: 'open_organizer',
            orbit: 2,
            angle: 90,
            elevation: 12,
            vectorStyle: 'gold',
            params: { targetScope: 'arquivos' }
          });
          await window.mpeApi.saveConfig(cfg);
        })()
      `);
      await waitFor(
        () =>
          miniCdp.eval(`
            document.querySelectorAll('.fan-slot-btn').length === 4 &&
            document.querySelector('.fan-slot-btn[data-slot-number="4"] .fan-slot-label')?.textContent === 'Novo Slot 4'
          `),
        4000,
        50,
        'criacao de ponto refletida ao vivo'
      );

      // Editar titulo do slot 1
      await mainCdp.eval(`
        (async () => {
          const cfg = await window.mpeApi.getConfig();
          cfg.points[0].title = 'Editado Um';
          await window.mpeApi.saveConfig(cfg);
        })()
      `);
      await waitFor(
        () =>
          miniCdp.eval(
            `document.querySelector('.fan-slot-btn[data-slot-number="1"] .fan-slot-label')?.textContent === 'Editado Um'`
          ),
        4000,
        50,
        'edicao de titulo refletida ao vivo'
      );

      // Reordenar 0 <-> 1 via reorderPoint
      const reordRes = await mainCdp.eval(`window.mpeApi.reorderPoint(0, 1)`);
      assert.strictEqual(reordRes.ok, true);
      await waitFor(
        () =>
          miniCdp.eval(`
            document.querySelector('.fan-slot-btn[data-slot-number="1"] .fan-slot-label')?.textContent === 'Slot 2' &&
            document.querySelector('.fan-slot-btn[data-slot-number="2"] .fan-slot-label')?.textContent === 'Editado Um'
          `),
        4000,
        50,
        'reordenacao refletida ao vivo'
      );

      // Excluir ponto adicionado
      await mainCdp.eval(`
        (async () => {
          const cfg = await window.mpeApi.getConfig();
          cfg.points = cfg.points.filter((p) => p.id !== 'm4-added-4');
          await window.mpeApi.saveConfig(cfg);
        })()
      `);
      await waitFor(
        () => miniCdp.eval(`document.querySelectorAll('.fan-slot-btn').length === 3`),
        4000,
        50,
        'exclusao de ponto refletida ao vivo'
      );

      return 'Criacao (+1), edicao, reorderPoint(0,1) e exclusao refletidas ao vivo sem reload';
    });

    // -----------------------------------------------------------------------
    // M4-07: Computed WCAG 2.1 Contrast & Zero-Emoji Scan
    // -----------------------------------------------------------------------
    await runTest('M4-07', 'Contraste WCAG 2.1 (>= 7:1 numeros, >= 4.5:1 rotulos) e 0 emojis nos arquivos M4', async () => {
      await mainCdp.eval(`window.mpeApi.setMiniExpandedBounds(true)`);
      await waitFor(
        () => miniCdp.eval(`document.getElementById('mini-root').dataset.expanded === 'true' && !document.getElementById('mini-root').classList.contains('is-blooming')`),
        3000,
        50,
        'expand para leitura de contraste'
      );

      const samples = await miniCdp.eval(`
        Array.from(document.querySelectorAll('.fan-slot-btn')).map((btn) => {
          const numEl = btn.querySelector('.fan-slot-num');
          const lblEl = btn.querySelector('.fan-slot-label');
          const btnCs = getComputedStyle(btn);
          const numCs = getComputedStyle(numEl);
          const lblCs = getComputedStyle(lblEl);
          return {
            slot: btn.dataset.slotNumber,
            numFg: numCs.color,
            numBg: btnCs.backgroundColor,
            lblFg: lblCs.color,
            lblBg: lblCs.backgroundColor
          };
        })
      `);
      assert.ok(samples.length > 0, 'Nenhum slot encontrado para auditoria de contraste');

      let minNumRatio = Infinity;
      let minLblRatio = Infinity;
      for (const s of samples) {
        const numRatio = contrastRatio(s.numFg, s.numBg);
        const lblRatio = contrastRatio(s.lblFg, s.lblBg);
        if (numRatio < minNumRatio) minNumRatio = numRatio;
        if (lblRatio < minLblRatio) minLblRatio = lblRatio;
        assert.ok(numRatio >= 7.0, `Contraste numero slot ${s.slot} abaixo de 7:1: ${numRatio.toFixed(2)}`);
        assert.ok(lblRatio >= 4.5, `Contraste rotulo slot ${s.slot} abaixo de 4.5:1: ${lblRatio.toFixed(2)}`);
      }

      const emojiRe = /\p{Extended_Pictographic}/gu;
      let emojiHits = 0;
      for (const filePath of M4_FILES) {
        const content = fs.readFileSync(filePath, 'utf8');
        if (emojiRe.test(content)) emojiHits++;
      }
      assert.strictEqual(emojiHits, 0, `Encontrados ${emojiHits} arquivos M4 com emojis`);

      await mainCdp.eval(`window.mpeApi.setMiniExpandedBounds(false)`);
      return `Min num contrast=${minNumRatio.toFixed(2)}:1 (>=7:1), min label contrast=${minLblRatio.toFixed(2)}:1 (>=4.5:1), 0 emojis em ${M4_FILES.length} arquivos`;
    });

    // -----------------------------------------------------------------------
    // M4-08: Clean Shutdown & Zero Orphan Processes
    // -----------------------------------------------------------------------
    await runTest('M4-08', 'Encerramento limpo (exit 0) sem processos orfaos', async () => {
      const trackedPid = activeInstance.pid;
      miniCdp.close();
      miniCdp = null;
      await Promise.race([
        mainCdp.eval(`window.mpeApi.quitApp()`).catch(() => {}),
        sleep(1200)
      ]);
      const code = await activeInstance.waitExit(10000);
      mainCdp.close();
      mainCdp = null;
      assert.strictEqual(code, 0, `Electron encerrou com codigo ${code} (esperado 0)`);

      await sleep(350);
      const remaining = listDescendantsAndMpeHook(trackedPid);
      assert.strictEqual(remaining.length, 0, `Processos restantes apos quit: ${remaining.join(', ')}`);

      return `Electron (pid=${trackedPid}) encerrou com exitCode=0 e 0 processos filhos restantes`;
    });
  } finally {
    if (httpServer) {
      try { httpServer.close(); } catch (_) {}
    }
    if (miniCdp) miniCdp.close();
    if (mainCdp) mainCdp.close();
    if (activeInstance && !activeInstance.isExited()) {
      taskkillTree(activeInstance.pid);
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}

    const prodShaAfter = sha256File(PROD_CONFIG_PATH);
    if (prodShaBefore !== prodShaAfter) {
      console.error(`[FAIL] INTEGRITY: codigo/mpe.config.json SHA-256 alterado! before=${prodShaBefore} after=${prodShaAfter}`);
      process.exitCode = 1;
    } else {
      console.log(`[PASS] INTEGRITY - codigo/mpe.config.json SHA-256 intacto (${prodShaAfter.slice(0, 12)}...)`);
    }
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n=== RESUMO M4 TESTS ===\nTotal: ${results.length} | PASS: ${passed} | FAIL: ${failed}`);
  console.log('M4_TEST_REPORT_JSON=' + JSON.stringify({ total: results.length, passed, failed, results }));

  if (failed > 0 || process.exitCode === 1) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[M4-TESTS FATAL]', err);
  process.exit(1);
});
