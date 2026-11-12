const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

/**
 * Ponte de Comunicação com o Daemon Nativo Win32 (MpeHook.exe).
 * Escuta o evento global `Shift + Ctrl + Alt + Botão Direito do Mouse`
 * sem overhead de CPU e sem abrir portas de rede ou localhost.
 */
class HookBridge extends EventEmitter {
  constructor(rootDir) {
    super();
    this.rootDir = rootDir;
    this.hookExePath = path.join(rootDir, 'src', 'native', 'bin', 'MpeHook.exe');
    this.proc = null;
    this.lastHwnd = '0';
    this.isStopping = false;
  }

  start() {
    if (this.proc) return;
    if (!fs.existsSync(this.hookExePath)) {
      console.warn('[M.P.E Hook] Binário MpeHook.exe não encontrado em:', this.hookExePath);
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
          this.lastHwnd = hwnd;
          this.emit('trigger', { x, y, hwnd });
        } else if (line === 'SELECTION_COPIED') {
          this.emit('selection-copied');
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

  pasteAndSendInActiveWindow() {
    return new Promise((resolve) => {
      if (!fs.existsSync(this.hookExePath)) {
        return resolve(false);
      }
      execFile(
        this.hookExePath,
        ['--PASTE-AND-SEND'],
        { windowsHide: true },
        () => {
          resolve(true);
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
