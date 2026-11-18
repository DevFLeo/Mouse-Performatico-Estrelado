const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

/**
 * Ponte de Comunicacao com o Subsistema Nativo Win32 (MpeHook.exe).
 * Escuta o evento global Shift + Ctrl + Alt + Botao Direito do Mouse,
 * recebe os snapshots pre-capturados do Sistema de Origem (Zero Flicker)
 * e executa transferencia direta para qualquer Sistema de Destino no Windows.
 */
class HookBridge extends EventEmitter {
  constructor(codeDir) {
    super();
    this.codeDir = codeDir;
    this.hookExePath = path.join(codeDir, 'src', 'native', 'bin', 'MpeHook.exe');
    this.proc = null;
    this.lastHwnd = '0';
    this.lastWindowRect = null;
    this.lastFullSnapPath = '';
    this.lastWinSnapPath = '';
    this.lastWindowTitle = '';
    this.isStopping = false;
    this.isRecording = false;
    this.isReady = false;
    this._restartTimer = null;
    this._stoppingProcs = new Set();
  }

  _sendCommand(cmd) {
    if (
      this.proc &&
      this.proc.stdin &&
      !this.proc.stdin.destroyed &&
      this.proc.stdin.writable
    ) {
      try {
        this.proc.stdin.write(`${cmd}\n`);
        return true;
      } catch (_) {
        return false;
      }
    }
    return false;
  }

  _handleStdoutLine(rawLine) {
    const line = String(rawLine || '').trim();
    if (!line) return;

    if (line === 'MPE_HOOK_READY') {
      this.isReady = true;
      if (this.isRecording) {
        this._sendCommand('RECORD_ON');
      }
      this.emit('ready');
      return;
    }

    if (line.startsWith('TRIGGER_HUD|')) {
      const parts = line.split('|');
      const x = parseInt(parts[1] || '0', 10);
      const y = parseInt(parts[2] || '0', 10);
      const hwnd = parts[3] || '0';
      const rectRaw = (parts[4] || '0,0,0,0').split(',').map((n) => parseInt(n, 10));
      const fullSnap = parts[5] || '';
      const winSnap = parts[6] || '';
      const winTitle = parts.slice(7).join(' ').trim();

      this.lastHwnd = hwnd;
      this.lastFullSnapPath = fullSnap;
      this.lastWinSnapPath = winSnap;
      this.lastWindowTitle = winTitle;

      if (rectRaw.length === 4 && rectRaw[2] > rectRaw[0] && rectRaw[3] > rectRaw[1]) {
        this.lastWindowRect = {
          left: rectRaw[0],
          top: rectRaw[1],
          right: rectRaw[2],
          bottom: rectRaw[3],
          width: rectRaw[2] - rectRaw[0],
          height: rectRaw[3] - rectRaw[1]
        };
      } else {
        this.lastWindowRect = null;
      }

      const payload = {
        x,
        y,
        hwnd,
        windowRect: this.lastWindowRect,
        fullSnapPath: this.lastFullSnapPath,
        winSnapPath: this.lastWinSnapPath,
        windowTitle: this.lastWindowTitle
      };

      this.emit('trigger', payload);
      this.emit('trigger-hud', payload);
      return;
    }

    if (line.startsWith('REC_CLICK|')) {
      const parts = line.split('|');
      const rawButton = (parts[1] || 'L').trim().toUpperCase();
      const button = rawButton === 'R' || rawButton === 'RIGHT' ? 'right' : 'left';
      const x = parseInt(parts[2] || '0', 10);
      const y = parseInt(parts[3] || '0', 10);
      const parsedTs = parseInt(parts[4] || '', 10);
      const timestampMs = Number.isNaN(parsedTs) ? Date.now() : parsedTs;

      if (!Number.isNaN(x) && !Number.isNaN(y)) {
        this.emit('rec-click', {
          button,
          rawButton,
          x,
          y,
          timestampMs
        });
      }
    }
  }

  start() {
    if (this.proc) return;
    if (!fs.existsSync(this.hookExePath)) {
      console.warn('[M.P.E Hook] Binario MpeHook.exe nao encontrado em:', this.hookExePath);
      return;
    }

    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }

    this.isStopping = false;
    this.isReady = false;
    const child = spawn(this.hookExePath, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.proc = child;

    child.on('error', () => {
      if (this.proc !== child) return;
    });
    if (child.stdin) {
      child.stdin.on('error', () => {});
    }

    let buffer = '';
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        if (this.proc !== child) return;
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          this._handleStdoutLine(rawLine);
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', () => {
        if (this.proc !== child) return;
      });
    }

    child.on('exit', () => {
      this._stoppingProcs.delete(child);
      if (this.proc !== child) return;
      this.proc = null;
      this.isReady = false;
      if (!this.isStopping) {
        this._restartTimer = setTimeout(() => {
          this._restartTimer = null;
          if (!this.isStopping && !this.proc) {
            this.start();
          }
        }, 1500);
        if (this._restartTimer.unref) {
          this._restartTimer.unref();
        }
      }
    });
  }

  startRecording() {
    this.isRecording = true;
    if (!this.proc) {
      this.start();
    }
    const sent = this._sendCommand('RECORD_ON');
    return { ok: true, recording: true, sent };
  }

  stopRecording() {
    this.isRecording = false;
    const sent = this._sendCommand('RECORD_OFF');
    return { ok: true, recording: false, sent };
  }

  onTrigger(callback) {
    this.on('trigger-hud', callback);
    return () => this.off('trigger-hud', callback);
  }

  getForegroundWindow() {
    return this.refreshForegroundWindow();
  }

  captureNow(outPath) {
    return this.captureScreenFast(outPath);
  }

  copySelection(hwndOverride) {
    return this.copySelectionFromLastWindow(hwndOverride);
  }

  pasteAndSend(autoSendEnter = true) {
    return this.pasteAndSendInActiveWindow(autoSendEnter);
  }

  getOriginSystemInfo() {
    return {
      hwnd: this.lastHwnd,
      windowTitle: this.lastWindowTitle || 'Sistema Windows Ativo',
      windowRect: this.lastWindowRect,
      fullSnapPath: this.lastFullSnapPath,
      winSnapPath: this.lastWinSnapPath
    };
  }

  refreshForegroundWindow() {
    return new Promise((resolve) => {
      if (!fs.existsSync(this.hookExePath)) return resolve(null);
      execFile(
        this.hookExePath,
        ['--GET-FOREGROUND'],
        { windowsHide: true, encoding: 'utf8' },
        (err, stdout) => {
          if (!err && stdout && stdout.startsWith('FOREGROUND|')) {
            const parts = stdout.trim().split('|');
            const hwnd = parts[1] || '0';
            const rectRaw = (parts[2] || '0,0,0,0').split(',').map((n) => parseInt(n, 10));
            const winTitle = parts.slice(3).join(' ').trim();
            if (hwnd !== '0') {
              this.lastHwnd = hwnd;
              if (winTitle) this.lastWindowTitle = winTitle;
              if (rectRaw.length === 4 && rectRaw[2] > rectRaw[0] && rectRaw[3] > rectRaw[1]) {
                this.lastWindowRect = {
                  left: rectRaw[0],
                  top: rectRaw[1],
                  right: rectRaw[2],
                  bottom: rectRaw[3],
                  width: rectRaw[2] - rectRaw[0],
                  height: rectRaw[3] - rectRaw[1]
                };
              }
            }
            return resolve(this.getOriginSystemInfo());
          }
          resolve(null);
        }
      );
    });
  }

  captureScreenFast(outPath) {
    return new Promise((resolve) => {
      if (!fs.existsSync(this.hookExePath)) {
        return resolve(false);
      }
      execFile(
        this.hookExePath,
        ['--CAPTURE-NOW', outPath],
        { windowsHide: true, encoding: 'utf8' },
        (err, stdout) => {
          if (err || !stdout) return resolve(false);
          resolve(stdout.includes('CAPTURED_OK') && fs.existsSync(outPath));
        }
      );
    });
  }

  listOpenWindows() {
    return new Promise((resolve) => {
      if (!fs.existsSync(this.hookExePath)) {
        return resolve([]);
      }
      execFile(
        this.hookExePath,
        ['--LIST-WINDOWS'],
        { windowsHide: true, encoding: 'utf8' },
        (err, stdout) => {
          if (err || !stdout) return resolve([]);
          try {
            const parsed = JSON.parse(stdout.trim());
            resolve(Array.isArray(parsed) ? parsed : []);
          } catch (_) {
            resolve([]);
          }
        }
      );
    });
  }

  copySelectionFromLastWindow(hwndOverride) {
    return new Promise((resolve) => {
      const targetHwnd = hwndOverride || this.lastHwnd || '0';
      if (!fs.existsSync(this.hookExePath)) {
        return resolve(false);
      }
      execFile(
        this.hookExePath,
        ['--COPY-SELECTION', String(targetHwnd)],
        { windowsHide: true },
        () => {
          resolve(true);
        }
      );
    });
  }

  pasteAndSendInActiveWindow(autoSendEnter = true) {
    return new Promise((resolve) => {
      if (!fs.existsSync(this.hookExePath)) {
        return resolve(false);
      }
      execFile(
        this.hookExePath,
        ['--PASTE-AND-SEND', autoSendEnter ? '1' : '0'],
        { windowsHide: true },
        () => {
          resolve(true);
        }
      );
    });
  }

  deliverToSystem(targetQuery, autoSendEnter = true) {
    return new Promise((resolve) => {
      if (!fs.existsSync(this.hookExePath) || !targetQuery) {
        return resolve({ ok: false });
      }
      execFile(
        this.hookExePath,
        ['--DELIVER-TO-SYSTEM', String(targetQuery), autoSendEnter ? '1' : '0'],
        { windowsHide: true, encoding: 'utf8' },
        (err, stdout) => {
          const out = (stdout || '').trim();
          if (!err && out.startsWith('DELIVERED_TO_WINDOW|')) {
            return resolve({
              ok: true,
              matchedTitle: out.split('|')[1] || targetQuery
            });
          }
          resolve({ ok: false });
        }
      );
    });
  }

  _stopChild(proc) {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
      this._stoppingProcs.delete(proc);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        this._stoppingProcs.delete(proc);
        resolve();
      };

      const killTimer = setTimeout(() => {
        try {
          if (proc.exitCode === null && proc.signalCode === null) {
            proc.kill();
          }
        } catch (_) {}
        done();
      }, 450);
      if (killTimer.unref) {
        killTimer.unref();
      }

      proc.once('exit', done);

      try {
        if (
          proc.stdin &&
          !proc.stdin.destroyed &&
          proc.stdin.writable &&
          !proc.stdin.writableEnded
        ) {
          proc.stdin.write('EXIT\n');
          proc.stdin.end();
        }
      } catch (_) {}
    });
  }

  stop() {
    this.isStopping = true;
    this.isRecording = false;
    this.isReady = false;
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }

    const targets = new Set(this._stoppingProcs);
    if (this.proc) {
      this._stoppingProcs.add(this.proc);
      targets.add(this.proc);
      this.proc = null;
    }

    if (targets.size === 0) {
      return Promise.resolve();
    }

    return Promise.all(Array.from(targets, (proc) => this._stopChild(proc))).then(() => undefined);
  }
}

module.exports = HookBridge;
