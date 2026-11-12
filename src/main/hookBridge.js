const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

/**
 * Ponte de Comunicacao com o Subsistema Nativo Win32 (MpeHook.exe).
 * Escuta o evento global Shift + Ctrl + Alt + Botao Direito do Mouse,
 * identifica o Sistema de Origem (HWND, Retangulo, Titulo) e executa
 * transferencia direta (Foco + Colagem + Disparo) para qualquer Sistema de Destino no Windows.
 */
class HookBridge extends EventEmitter {
  constructor(rootDir) {
    super();
    this.rootDir = rootDir;
    this.hookExePath = path.join(rootDir, 'src', 'native', 'bin', 'MpeHook.exe');
    this.proc = null;
    this.lastHwnd = '0';
    this.lastWindowRect = null;
    this.lastWindowTitle = '';
    this.isStopping = false;
  }

  start() {
    if (this.proc) return;
    if (!fs.existsSync(this.hookExePath)) {
      console.warn('[M.P.E Hook] Binario MpeHook.exe nao encontrado em:', this.hookExePath);
      return;
    }

    this.isStopping = false;
    this.proc = spawn(this.hookExePath, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let buffer = '';
    this.proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line === 'MPE_HOOK_READY') {
          this.emit('ready');
        } else if (line.startsWith('TRIGGER_HUD|')) {
          const parts = line.split('|');
          const x = parseInt(parts[1] || '0', 10);
          const y = parseInt(parts[2] || '0', 10);
          const hwnd = parts[3] || '0';
          const rectRaw = (parts[4] || '0,0,0,0').split(',').map((n) => parseInt(n, 10));
          const winTitle = parts.slice(5).join(' ').trim();

          this.lastHwnd = hwnd;
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

          this.emit('trigger', {
            x,
            y,
            hwnd,
            windowRect: this.lastWindowRect,
            windowTitle: this.lastWindowTitle
          });
        }
      }
    });

    this.proc.on('exit', () => {
      this.proc = null;
      if (!this.isStopping) {
        setTimeout(() => this.start(), 1500);
      }
    });
  }

  getOriginSystemInfo() {
    return {
      hwnd: this.lastHwnd,
      windowTitle: this.lastWindowTitle || 'Sistema Windows Ativo',
      windowRect: this.lastWindowRect
    };
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

  stop() {
    this.isStopping = true;
    if (this.proc) {
      try {
        this.proc.stdin.write('QUIT\n');
      } catch (_) {}
      try {
        this.proc.kill();
      } catch (_) {}
      this.proc = null;
    }
  }
}

module.exports = HookBridge;
