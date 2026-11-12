const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REG_VALUE_NAME = 'M.P.E - Mouse Performatico Estrelado';

/**
 * Gerenciador Nativo de Inicializacao com o Windows ("Aplicativos de inicializacao").
 * Registra o executavel principal MPE.exe em HKCU\Software\Microsoft\Windows\CurrentVersion\Run
 * e na pasta Startup do Windows para aparecer em "Aplicativos de inicializacao" do Gerenciador de Tarefas.
 */
class StartupManager {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.launcherExe = path.join(rootDir, 'MPE.exe');
    this.startupFolder = path.join(
      os.homedir(),
      'AppData',
      'Roaming',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Startup'
    );
    this.shortcutPath = path.join(this.startupFolder, 'M.P.E - Mouse Performatico Estrelado.lnk');
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

      if (fs.existsSync(this.launcherExe)) {
        const flag = enable ? '--enable-startup' : '--disable-startup';
        execFile(this.launcherExe, [flag], { windowsHide: true }, () => {
          resolve({ ok: true, enabled: Boolean(enable), command: this.getStartupCommand() });
        });
        return;
      }

      resolve({ ok: true, enabled: Boolean(enable) });
    });
  }

  checkStartup() {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') {
        return resolve(false);
      }
      if (fs.existsSync(this.shortcutPath)) {
        return resolve(true);
      }
      execFile(
        'reg.exe',
        ['query', REG_KEY, '/v', REG_VALUE_NAME],
        { windowsHide: true },
        (err, stdout) => {
          if (err || !stdout) {
            return resolve(false);
          }
          resolve(stdout.includes('MPE.exe'));
        }
      );
    });
  }
}

module.exports = StartupManager;
