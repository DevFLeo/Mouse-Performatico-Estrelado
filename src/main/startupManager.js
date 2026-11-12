const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REG_VALUE_NAME = 'MPE_MousePerformaticoEstrelado';

/**
 * Gerenciador Nativo de Inicialização com o Windows ("Iniciar com o Windows").
 * Registra o executável principal MPE.exe em HKCU\Software\Microsoft\Windows\CurrentVersion\Run
 * para inicialização silenciosa em segundo plano junto ao login do usuário.
 */
class StartupManager {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.launcherExe = path.join(rootDir, 'MPE.exe');
  }

  getStartupCommand() {
    if (fs.existsSync(this.launcherExe)) {
      return `"${this.launcherExe}" --startup`;
    }
    const electronExe = process.execPath;
    return `"${electronExe}" "${this.rootDir}" --startup`;
  }

  setStartup(enable) {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') {
        return resolve({ ok: false, reason: 'Apenas suportado no Windows' });
      }

      if (enable) {
        const cmdValue = this.getStartupCommand();
        execFile(
          'reg.exe',
          ['add', REG_KEY, '/v', REG_VALUE_NAME, '/t', 'REG_SZ', '/d', cmdValue, '/f'],
          { windowsHide: true },
          (err) => {
            if (err) {
              console.error('[M.P.E Startup] Erro ao registrar inicialização:', err);
              return resolve({ ok: false, error: err.message });
            }
            resolve({ ok: true, enabled: true, command: cmdValue });
          }
        );
      } else {
        execFile(
          'reg.exe',
          ['delete', REG_KEY, '/v', REG_VALUE_NAME, '/f'],
          { windowsHide: true },
          () => {
            resolve({ ok: true, enabled: false });
          }
        );
      }
    });
  }

  checkStartup() {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') {
        return resolve(false);
      }
      execFile(
        'reg.exe',
        ['query', REG_KEY, '/v', REG_VALUE_NAME],
        { windowsHide: true },
        (err, stdout) => {
          if (err || !stdout) {
            return resolve(false);
          }
          resolve(stdout.includes(REG_VALUE_NAME));
        }
      );
    });
  }
}

module.exports = StartupManager;
