const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_OUTPUT_BYTES = 512 * 1024;
const TIME_HHMM_RE = /^(\d{1,2}):(\d{2})$/;

function resolveRealPath(targetPath) {
  if (typeof targetPath !== 'string' || !targetPath || targetPath.includes('\0')) {
    return null;
  }
  const resolved = path.resolve(targetPath);
  const pendingSegments = [];
  let cursor = resolved;
  while (cursor) {
    let lstat = null;
    try {
      lstat = fs.lstatSync(cursor);
    } catch (_) {
      lstat = null;
    }
    if (lstat) {
      try {
        const real =
          typeof fs.realpathSync.native === 'function'
            ? fs.realpathSync.native(cursor)
            : fs.realpathSync(cursor);
        return pendingSegments.length > 0
          ? path.join(real, ...pendingSegments.reverse())
          : real;
      } catch (_) {
        return null;
      }
    }
    const parent = path.dirname(cursor);
    if (!parent || parent === cursor) break;
    pendingSegments.push(path.basename(cursor));
    cursor = parent;
  }
  return resolved;
}

function isPathInsideDir(targetPath, baseDir) {
  if (
    typeof targetPath !== 'string' ||
    typeof baseDir !== 'string' ||
    !targetPath ||
    !baseDir ||
    targetPath.includes('\0') ||
    baseDir.includes('\0')
  ) {
    return false;
  }
  const resolvedTarget = resolveRealPath(targetPath);
  const resolvedBase = resolveRealPath(baseDir);
  if (!resolvedTarget || !resolvedBase) {
    return false;
  }
  if (process.platform === 'win32') {
    const t = resolvedTarget.toLowerCase();
    const b = resolvedBase.toLowerCase();
    return t.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
  }
  return resolvedTarget.startsWith(resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep);
}

function normalizeTimeHHMM(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = trimmed.match(TIME_HHMM_RE);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatLocalHHMM(date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatLocalRunKey(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${formatLocalHHMM(date)}`;
}

function resolveClockFromArgsAndEnv(argv = process.argv, env = process.env) {
  let rawClock = null;
  if (Array.isArray(argv)) {
    for (let i = 0; i < argv.length; i += 1) {
      const a = argv[i];
      if (typeof a !== 'string') continue;
      if (a.startsWith('--test-clock=')) {
        const val = a.slice('--test-clock='.length).trim();
        if (val) {
          rawClock = val;
          break;
        }
      } else if (a === '--test-clock' && i + 1 < argv.length && typeof argv[i + 1] === 'string') {
        const nextVal = argv[i + 1].trim();
        if (nextVal && !nextVal.startsWith('--')) {
          rawClock = nextVal;
          break;
        }
      }
    }
  }
  if (!rawClock && env && typeof env.MPE_TEST_CLOCK === 'string' && env.MPE_TEST_CLOCK.trim()) {
    rawClock = env.MPE_TEST_CLOCK.trim();
  }
  if (rawClock) {
    const baseMs = Date.parse(rawClock);
    if (Number.isFinite(baseMs)) {
      const initWallMs = Date.now();
      return () => new Date(baseMs + (Date.now() - initWallMs));
    }
  }
  if (env && env.MPE_TEST_CLOCK_OFFSET_MS !== undefined && env.MPE_TEST_CLOCK_OFFSET_MS !== '') {
    const offsetMs = Number(env.MPE_TEST_CLOCK_OFFSET_MS);
    if (Number.isFinite(offsetMs)) {
      return () => new Date(Date.now() + offsetMs);
    }
  }
  return () => new Date();
}

function killProcessTreeSync(proc, pid) {
  if (proc) {
    try {
      proc.kill();
    } catch (_) {}
  }
  if (process.platform === 'win32' && pid) {
    try {
      execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], {
        windowsHide: true,
        stdio: 'ignore'
      });
    } catch (_) {}
  }
}

class PythonScheduler {
  constructor(ctx = {}) {
    // Execucao real: esconde o HUD antes (senao o script clica no proprio M.P.E) e restaura depois.
    this.onBeforeRealReplay =
      typeof ctx.onBeforeRealReplay === 'function' ? ctx.onBeforeRealReplay : null;
    this.configManager = ctx.configManager || null;
    this.consentManager = ctx.consentManager || null;
    this.broadcastToAllWindows =
      typeof ctx.broadcastToAllWindows === 'function' ? ctx.broadcastToAllWindows : null;
    this.broadcastConfigUpdated =
      typeof ctx.broadcastConfigUpdated === 'function' ? ctx.broadcastConfigUpdated : null;

    this.codeDir = ctx.codeDir ? path.resolve(ctx.codeDir) : path.resolve(__dirname, '..', '..');
    this.rootDir = ctx.rootDir ? path.resolve(ctx.rootDir) : path.resolve(this.codeDir, '..');
    this.explicitScriptsDir = ctx.scriptsDir ? path.resolve(ctx.scriptsDir) : null;
    this._explicitPythonBin =
      ctx.pythonBin || ctx.pythonExecutable || process.env.MPE_PYTHON_BIN || process.env.MPE_PYTHON_PATH || null;

    this._nowProvider =
      typeof ctx.nowProvider === 'function' ? ctx.nowProvider : resolveClockFromArgsAndEnv();
    this._tickIntervalMs =
      Number.isFinite(Number(ctx.tickIntervalMs)) && Number(ctx.tickIntervalMs) > 0
        ? Number(ctx.tickIntervalMs)
        : 1000;

    this.activeChildren = new Map();
    this._timer = null;
    this._runningScheduledIds = new Set();
    this._pythonCmd = null;
  }

  getNow() {
    try {
      const val = this._nowProvider();
      return val instanceof Date && Number.isFinite(val.getTime()) ? val : new Date();
    } catch (_) {
      return new Date();
    }
  }

  getScriptsDir() {
    if (this.explicitScriptsDir) {
      return this.explicitScriptsDir;
    }
    if (process.env.MPE_SCRIPTS_DIR && String(process.env.MPE_SCRIPTS_DIR).trim()) {
      return path.resolve(String(process.env.MPE_SCRIPTS_DIR).trim());
    }
    if (process.env.MPE_DATA_DIR && String(process.env.MPE_DATA_DIR).trim()) {
      return path.join(path.resolve(String(process.env.MPE_DATA_DIR).trim()), 'scripts');
    }
    if (this.configManager && this.configManager.dataDir) {
      return path.join(path.resolve(this.configManager.dataDir), 'scripts');
    }
    return path.join(this.codeDir, 'data', 'scripts');
  }

  _isIsolatedScriptsDir() {
    return Boolean(
      this.explicitScriptsDir ||
      (process.env.MPE_SCRIPTS_DIR && String(process.env.MPE_SCRIPTS_DIR).trim()) ||
      (process.env.MPE_DATA_DIR && String(process.env.MPE_DATA_DIR).trim()) ||
      (this.configManager && this.configManager.dataDir)
    );
  }

  _resolveEntryFilePath(rawPath, scriptsDir) {
    if (typeof rawPath !== 'string' || !rawPath.trim() || rawPath.includes('\0')) {
      return null;
    }
    const trimmed = rawPath.trim();
    if (path.isAbsolute(trimmed)) {
      return path.resolve(trimmed);
    }
    const fromScripts = path.resolve(scriptsDir, trimmed);
    if (isPathInsideDir(fromScripts, scriptsDir) && fs.existsSync(fromScripts)) {
      return fromScripts;
    }
    const fromRoot = path.resolve(this.rootDir, trimmed);
    if (!this._isIsolatedScriptsDir()) {
      if (isPathInsideDir(fromRoot, scriptsDir)) {
        return fromRoot;
      }
    } else if (isPathInsideDir(fromRoot, scriptsDir) && fs.existsSync(fromRoot)) {
      return fromRoot;
    }
    const hasTraversalSegment = trimmed.split(/[\\/]+/).some((seg) => seg === '..');
    if (!hasTraversalSegment) {
      const baseCandidate = path.resolve(scriptsDir, path.basename(trimmed));
      if (isPathInsideDir(baseCandidate, scriptsDir)) {
        return baseCandidate;
      }
    }
    return fromScripts;
  }

  _gateResult() {
    if (this.consentManager && typeof this.consentManager.gateResult === 'function') {
      return this.consentManager.gateResult();
    }
    return {
      ok: false,
      blockedByConsent: true,
      message: 'Aceite de primeiro acesso necessario.'
    };
  }

  _checkConsent() {
    if (!this.consentManager || typeof this.consentManager.isActionAllowed !== 'function') {
      return null;
    }
    if (!this.consentManager.isActionAllowed('pythonAutomation')) {
      return this._gateResult();
    }
    return null;
  }

  resolvePythonBinary() {
    if (this._pythonCmd) {
      return this._pythonCmd;
    }

    const candidates = [];
    if (this._explicitPythonBin) {
      candidates.push({ bin: this._explicitPythonBin, probeArgs: ['-c', 'import sys; print(sys.executable)'] });
    } else {
      candidates.push({ bin: 'python', probeArgs: ['-c', 'import sys; print(sys.executable)'] });
      candidates.push({ bin: 'py', probeArgs: ['-3', '-c', 'import sys; print(sys.executable)'] });
      candidates.push({ bin: 'python3', probeArgs: ['-c', 'import sys; print(sys.executable)'] });
    }

    for (const candidate of candidates) {
      try {
        const stdout = execFileSync(candidate.bin, candidate.probeArgs, {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 4000
        }).trim();
        const exePath = stdout.split(/\r?\n/).pop().trim();
        if (exePath && fs.existsSync(exePath)) {
          this._pythonCmd = { bin: exePath, prefixArgs: [] };
          return this._pythonCmd;
        }
      } catch (_) {}
    }

    this._pythonCmd = {
      bin: this._explicitPythonBin || 'python',
      prefixArgs: []
    };
    return this._pythonCmd;
  }

  _resolveScriptTarget(target, scriptsDir) {
    const cfg = this.configManager && typeof this.configManager.get === 'function'
      ? this.configManager.get()
      : null;
    const autoScripts = Array.isArray(cfg && cfg.autoScripts) ? cfg.autoScripts : [];
    const targetStr = target ? String(target).trim() : '';
    if (!targetStr) {
      return { ok: false, error: 'Script nao especificado.' };
    }

    let entry = autoScripts.find((s) => s && s.id === targetStr);
    if (!entry) {
      const normTarget = targetStr.replace(/\\/g, '/').toLowerCase();
      entry = autoScripts.find(
        (s) => s && typeof s.filePath === 'string' && s.filePath.replace(/\\/g, '/').toLowerCase() === normTarget
      );
    }

    if (entry) {
      const rawPath = typeof entry.filePath === 'string' ? entry.filePath.trim() : '';
      if (!rawPath || rawPath.includes('\0')) {
        return { ok: false, error: 'Caminho do script invalido.' };
      }
      const resolvedPath = this._resolveEntryFilePath(rawPath, scriptsDir);
      if (!resolvedPath || !isPathInsideDir(resolvedPath, scriptsDir)) {
        return { ok: false, error: 'Caminho do script fora da pasta permitida.' };
      }
      if (!resolvedPath.toLowerCase().endsWith('.py')) {
        return { ok: false, error: 'Extensao do script invalida.' };
      }
      return { ok: true, entry, scriptPath: resolvedPath };
    }

    if (targetStr.includes('\0') || !targetStr.toLowerCase().endsWith('.py')) {
      return { ok: false, error: 'Script nao encontrado.' };
    }

    const candidate = path.isAbsolute(targetStr)
      ? path.resolve(targetStr)
      : path.resolve(scriptsDir, targetStr);

    if (!isPathInsideDir(candidate, scriptsDir)) {
      return { ok: false, error: 'Caminho do script fora da pasta permitida.' };
    }

    return { ok: true, entry: null, scriptPath: candidate };
  }

  _recordExecutionMetadata(scriptId, timestamp, exitCode) {
    if (!scriptId || !this.configManager || typeof this.configManager.get !== 'function') return;
    const cfg = this.configManager.get();
    const list = Array.isArray(cfg && cfg.autoScripts) ? cfg.autoScripts : [];
    const idx = list.findIndex((s) => s && s.id === scriptId);
    if (idx < 0) return;

    const updatedList = list.map((item, i) =>
      i === idx
        ? Object.assign({}, item, {
            lastRunAt: timestamp,
            lastExitCode: exitCode
          })
        : item
    );
    const saved = this.configManager.save({ autoScripts: updatedList });
    if (this.broadcastConfigUpdated) {
      try {
        this.broadcastConfigUpdated(saved);
      } catch (_) {}
    }
  }

  async _withReplayGuard(dryRun, runFn) {
    let restore = null;
    if (!dryRun && this.onBeforeRealReplay) {
      try {
        restore = await this.onBeforeRealReplay();
      } catch (_) {
        restore = null;
      }
    }
    try {
      return await runFn();
    } finally {
      if (typeof restore === 'function') {
        try {
          restore();
        } catch (_) {}
      }
    }
  }

  async runScript(scriptIdOrPathOrPayload, options = {}) {
    const gate = this._checkConsent();
    if (gate) return gate;

    let target = '';
    let opts = {};
    if (scriptIdOrPathOrPayload && typeof scriptIdOrPathOrPayload === 'object') {
      const p = scriptIdOrPathOrPayload;
      target = p.scriptIdOrPath || p.scriptId || p.id || p.scriptPath || p.filePath || '';
      opts = Object.assign({}, p, options || {});
    } else {
      target = scriptIdOrPathOrPayload ? String(scriptIdOrPathOrPayload) : '';
      opts = options && typeof options === 'object' ? Object.assign({}, options) : {};
    }

    const scriptsDir = this.getScriptsDir();
    const resolved = this._resolveScriptTarget(target, scriptsDir);
    if (!resolved.ok) {
      return {
        ok: false,
        scriptId: null,
        exitCode: null,
        stdout: '',
        stderr: '',
        error: resolved.error
      };
    }

    const { entry, scriptPath } = resolved;
    const scriptId = entry ? entry.id : null;

    let existsFile = false;
    try {
      existsFile = fs.existsSync(scriptPath) && fs.statSync(scriptPath).isFile();
    } catch (_) {
      existsFile = false;
    }
    if (!existsFile) {
      return {
        ok: false,
        scriptId,
        filePath: scriptPath,
        exitCode: null,
        stdout: '',
        stderr: '',
        error: 'Arquivo do script nao encontrado.'
      };
    }

    const dryRun = Boolean(
      opts.dryRun !== undefined ? opts.dryRun : entry && entry.dryRunDefault
    );
    const trigger = opts.trigger || 'manual';
    const timeoutMs =
      Number.isFinite(Number(opts.timeoutMs)) && Number(opts.timeoutMs) > 0
        ? Number(opts.timeoutMs)
        : 0;

    const py = this.resolvePythonBinary();
    const args = [...py.prefixArgs, scriptPath, ...(dryRun ? ['--dry-run'] : [])];

    return await this._withReplayGuard(dryRun, () => new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      let spawnError = null;
      let timeoutTimer = null;

      let child = null;
      try {
        child = spawn(py.bin, args, {
          windowsHide: true,
          shell: false,
          cwd: path.dirname(scriptPath),
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (err) {
        return resolve({
          ok: false,
          scriptId,
          filePath: scriptPath,
          trigger,
          exitCode: null,
          stdout: '',
          stderr: err && err.message ? err.message : String(err),
          error: 'Falha ao iniciar processo Python.'
        });
      }

      const childKey = child.pid || Symbol('py-child');
      this.activeChildren.set(childKey, {
        proc: child,
        pid: child.pid || null,
        scriptId: scriptId || scriptPath
      });

      const finish = (code, signal) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        this.activeChildren.delete(childKey);

        const exitCode = typeof code === 'number' ? code : signal ? 1 : null;
        const ok = exitCode === 0 && !signal && !timedOut && !spawnError;
        const timestamp = this.getNow().toISOString();

        if (scriptId) {
          try {
            this._recordExecutionMetadata(scriptId, timestamp, exitCode);
          } catch (_) {}
        }

        if (this.broadcastToAllWindows) {
          try {
            this.broadcastToAllWindows('mpe:py-script-executed', {
              scriptId: scriptId || scriptPath,
              trigger,
              exitCode,
              ok,
              timestamp,
              filePath: scriptPath
            });
          } catch (_) {}
        }

        resolve({
          ok,
          scriptId,
          filePath: scriptPath,
          trigger,
          exitCode,
          stdout,
          stderr,
          timedOut: timedOut || undefined,
          error: spawnError ? spawnError.message : undefined
        });
      };

      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          killProcessTreeSync(child, child.pid);
        }, timeoutMs);
        if (timeoutTimer.unref) timeoutTimer.unref();
      }

      if (child.stdout) {
        child.stdout.on('data', (chunk) => {
          if (stdout.length < MAX_OUTPUT_BYTES) {
            stdout += chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - stdout.length);
          }
        });
      }
      if (child.stderr) {
        child.stderr.on('data', (chunk) => {
          if (stderr.length < MAX_OUTPUT_BYTES) {
            stderr += chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - stderr.length);
          }
        });
      }

      child.on('error', (err) => {
        spawnError = err;
        if (!stderr && err && err.message) {
          stderr = err.message;
        }
        finish(null, null);
      });

      child.on('close', (code, signal) => {
        finish(code, signal);
      });
    }));
  }

  async scheduleScript(scriptId, schedule = {}) {
    const gate = this._checkConsent();
    if (gate) return gate;

    if (!scriptId) {
      return { ok: false, error: 'Script nao especificado.' };
    }
    const cfg = this.configManager && typeof this.configManager.get === 'function'
      ? this.configManager.get()
      : null;
    const list = Array.isArray(cfg && cfg.autoScripts) ? cfg.autoScripts : [];
    const idx = list.findIndex((s) => s && s.id === scriptId);
    if (idx < 0) {
      return { ok: false, error: 'Script nao encontrado.' };
    }

    const schedInput = schedule && typeof schedule === 'object' ? schedule : {};
    const enabled = Boolean(schedInput.enabled);
    const existingSched = list[idx].schedule || {};

    let timeHHMM = existingSched.timeHHMM || '09:00';
    if (schedInput.timeHHMM !== undefined && schedInput.timeHHMM !== null) {
      const normalized = normalizeTimeHHMM(String(schedInput.timeHHMM));
      if (!normalized) {
        return { ok: false, error: 'Horario invalido. Use formato HH:MM.' };
      }
      timeHHMM = normalized;
    } else if (enabled && !normalizeTimeHHMM(timeHHMM)) {
      return { ok: false, error: 'Horario invalido. Use formato HH:MM.' };
    }

    const nextSchedule = {
      enabled,
      timeHHMM,
      mode: schedInput.mode === 'once' ? 'once' : 'daily',
      lastRunKey: null
    };
    if (schedInput.dryRun !== undefined) {
      nextSchedule.dryRun = Boolean(schedInput.dryRun);
    } else if (existingSched.dryRun !== undefined) {
      nextSchedule.dryRun = Boolean(existingSched.dryRun);
    }

    const updatedEntry = Object.assign({}, list[idx], { schedule: nextSchedule });
    const updatedList = list.map((item, i) => (i === idx ? updatedEntry : item));

    const saved = this.configManager.save({ autoScripts: updatedList });
    if (this.broadcastConfigUpdated) {
      try {
        this.broadcastConfigUpdated(saved);
      } catch (_) {}
    }

    return {
      ok: true,
      script: updatedEntry
    };
  }

  async deleteScript(scriptId) {
    const gate = this._checkConsent();
    if (gate) return gate;

    if (!scriptId) {
      return { ok: false, error: 'Script nao especificado.' };
    }

    const cfg = this.configManager && typeof this.configManager.get === 'function'
      ? this.configManager.get()
      : null;
    const list = Array.isArray(cfg && cfg.autoScripts) ? cfg.autoScripts : [];
    const entry = list.find((s) => s && s.id === scriptId);
    if (!entry) {
      return { ok: false, error: 'Script nao encontrado.' };
    }

    const scriptsDir = this.getScriptsDir();
    if (entry.filePath) {
      const resolvedFile = this._resolveEntryFilePath(String(entry.filePath), scriptsDir);
      if (
        resolvedFile &&
        isPathInsideDir(resolvedFile, scriptsDir) &&
        resolvedFile.toLowerCase().endsWith('.py') &&
        fs.existsSync(resolvedFile)
      ) {
        try {
          if (fs.statSync(resolvedFile).isFile()) {
            fs.unlinkSync(resolvedFile);
          }
        } catch (_) {}
      }
    }

    const remaining = list.filter((s) => s && s.id !== scriptId);
    const saved = this.configManager.save({ autoScripts: remaining });
    if (this.broadcastConfigUpdated) {
      try {
        this.broadcastConfigUpdated(saved);
      } catch (_) {}
    }

    return {
      ok: true,
      deletedId: scriptId,
      autoScripts: remaining
    };
  }

  async evaluateSchedules(nowDate = null) {
    const gate = this._checkConsent();
    if (gate) {
      return { ok: false, blockedByConsent: true, triggered: [] };
    }

    const now = nowDate instanceof Date ? nowDate : this.getNow();
    const hhmm = formatLocalHHMM(now);
    const runKey = formatLocalRunKey(now);

    const cfg = this.configManager && typeof this.configManager.get === 'function'
      ? this.configManager.get()
      : null;
    const list = Array.isArray(cfg && cfg.autoScripts) ? cfg.autoScripts : [];

    const dueScripts = list.filter(
      (s) =>
        s &&
        s.id &&
        s.schedule &&
        s.schedule.enabled === true &&
        s.schedule.timeHHMM === hhmm &&
        s.schedule.lastRunKey !== runKey &&
        !this._runningScheduledIds.has(s.id)
    );

    if (dueScripts.length === 0) {
      return { ok: true, triggered: [] };
    }

    const dueIds = new Set(dueScripts.map((s) => s.id));
    const nextList = list.map((item) => {
      if (!item || !dueIds.has(item.id)) return item;
      const nextSched = Object.assign({}, item.schedule, {
        lastRunKey: runKey,
        enabled: item.schedule.mode === 'once' ? false : item.schedule.enabled
      });
      return Object.assign({}, item, { schedule: nextSched });
    });

    const saved = this.configManager.save({ autoScripts: nextList });
    if (this.broadcastConfigUpdated) {
      try {
        this.broadcastConfigUpdated(saved);
      } catch (_) {}
    }

    const runs = dueScripts.map((script) => {
      this._runningScheduledIds.add(script.id);
      const dryRun =
        script.schedule && script.schedule.dryRun !== undefined
          ? Boolean(script.schedule.dryRun)
          : Boolean(script.dryRunDefault);
      return this.runScript(script.id, { dryRun, trigger: 'schedule' }).finally(() => {
        this._runningScheduledIds.delete(script.id);
      });
    });

    const results = await Promise.all(runs);
    return {
      ok: true,
      triggered: results
    };
  }

  start() {
    if (this._timer) {
      return { ok: true, running: true };
    }
    this._timer = setInterval(() => {
      this.evaluateSchedules().catch(() => {});
    }, this._tickIntervalMs);
    if (this._timer.unref) {
      this._timer.unref();
    }
    return { ok: true, running: true };
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    for (const item of this.activeChildren.values()) {
      killProcessTreeSync(item.proc, item.pid);
    }
    this.activeChildren.clear();
    this._runningScheduledIds.clear();
  }
}

PythonScheduler.normalizeTimeHHMM = normalizeTimeHHMM;
PythonScheduler.formatLocalHHMM = formatLocalHHMM;
PythonScheduler.formatLocalRunKey = formatLocalRunKey;
PythonScheduler.isPathInsideDir = isPathInsideDir;
PythonScheduler.resolveRealPath = resolveRealPath;
PythonScheduler.resolveClockFromArgsAndEnv = resolveClockFromArgsAndEnv;

module.exports = PythonScheduler;
