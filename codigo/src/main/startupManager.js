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
  constructor(rootDir, codeDir, options = {}) {
    this.rootDir = rootDir;
    this.codeDir = codeDir || path.join(rootDir, 'codigo');
    this.consentManager = options.consentManager || null;
    this.configManager = options.configManager || null;
    this.execFile = typeof options.execFile === 'function' ? options.execFile : execFile;
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

  setConsentManager(consentManager) {
    this.consentManager = consentManager || null;
  }

  setConfigManager(configManager) {
    this.configManager = configManager || null;
  }

  hasBackgroundConsent() {
    if (this.consentManager && typeof this.consentManager.isActionAllowed === 'function') {
      return this.consentManager.isActionAllowed('backgroundExecution');
    }
    if (this.configManager && typeof this.configManager.get === 'function') {
      const cfg = this.configManager.get();
      const c = cfg && cfg.consent;
      return Boolean(
        c &&
          c.accepted === true &&
          (!c.permissions || c.permissions.backgroundExecution !== false)
      );
    }
    return false;
  }

  getConsentBlockedResponse() {
    if (this.consentManager && typeof this.consentManager.gateResult === 'function') {
      return this.consentManager.gateResult();
    }
    return {
      ok: false,
      blockedByConsent: true,
      message: 'Aceite de primeiro acesso necessario.'
    };
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
      const shouldEnable = Boolean(enable);

      if (shouldEnable && !this.hasBackgroundConsent()) {
        return resolve(this.getConsentBlockedResponse());
      }

      if (process.platform !== 'win32') {
        return resolve({ ok: false, reason: 'Apenas suportado no Windows' });
      }

      if (fs.existsSync(this.launcherExe)) {
        const flag = shouldEnable ? '--enable-startup' : '--disable-startup';
        this.execFile(this.launcherExe, [flag], { windowsHide: true }, (err) => {
          if (err) {
            return resolve({
              ok: false,
              enabled: !shouldEnable,
              error: err.message
            });
          }
          resolve({ ok: true, enabled: shouldEnable, command: this.getStartupCommand() });
        });
        return;
      }

      resolve({ ok: true, enabled: shouldEnable });
    });
  }

  checkStartup() {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') {
        return resolve(false);
      }
      // Limpa atalho redundante da pasta Startup se existir
      if (fs.existsSync(this.shortcutPath)) {
        try { fs.unlinkSync(this.shortcutPath); } catch (_) {}
      }
      this.execFile(
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

  createAppShortcuts() {
    if (process.platform !== 'win32') return Promise.resolve({ ok: false });
    return new Promise((resolve) => {
      try {
        if (fs.existsSync(this.launcherExe)) {
          this.execFile(this.launcherExe, ['--ensure-shortcuts'], { windowsHide: true }, (err) => {
            resolve({ ok: !err });
          });
          return;
        }

        const programsFolder = path.join(
          os.homedir(),
          'AppData',
          'Roaming',
          'Microsoft',
          'Windows',
          'Start Menu',
          'Programs'
        );
        const startMenuLnk = path.join(programsFolder, 'M.P.E - Mouse Performatico Estrelado.lnk');
        const icoPath = fs.existsSync(path.join(this.codeDir, 'assets', 'icon.ico'))
          ? path.join(this.codeDir, 'assets', 'icon.ico')
          : path.join(this.rootDir, 'assets', 'icon.ico');

        const psScript = `
          $ws = New-Object -ComObject WScript.Shell
          $sc = $ws.CreateShortcut('${startMenuLnk.replace(/'/g, "''")}')
          $sc.TargetPath = '${process.execPath.replace(/'/g, "''")}'
          $sc.Arguments = '"${this.codeDir.replace(/'/g, "''")}" --launch-ui'
          $sc.WorkingDirectory = '${this.codeDir.replace(/'/g, "''")}'
          $sc.IconLocation = '${icoPath.replace(/'/g, "''")}'
          $sc.Description = 'M.P.E - Mouse Performatico Estrelado'
          $sc.Save()
        `;
        this.execFile('powershell.exe', ['-NoProfile', '-Command', psScript], { windowsHide: true }, (err) => {
          resolve({ ok: !err });
        });
      } catch (_) {
        resolve({ ok: false });
      }
    });
  }
}

module.exports = StartupManager;
