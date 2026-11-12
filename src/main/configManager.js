const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

/**
 * Gerenciador Híbrido de Configuração (Portátil + Por Máquina)
 * - Lê e grava o `mpe.config.json` na raiz do projeto (permitindo migração instantânea entre máquinas).
 * - Mantém também o cache específico da máquina em `%APPDATA%/MPE/machines/<HOSTNAME>.json` e na chave `machines[hostname]`.
 */
class ConfigManager {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.rootConfigPath = path.join(rootDir, 'mpe.config.json');
    this.machineId = os.hostname() || 'DEFAULT-MACHINE';
    this.userDataDir = app ? app.getPath('userData') : path.join(os.homedir(), '.mpe');
    this.machineConfigPath = path.join(this.userDataDir, `machine-${this.machineId}.json`);
    this.config = null;
  }

  load() {
    let rootData = {};
    if (fs.existsSync(this.rootConfigPath)) {
      try {
        const raw = fs.readFileSync(this.rootConfigPath, 'utf-8');
        rootData = JSON.parse(raw);
      } catch (err) {
        console.error('[M.P.E Config] Erro ao ler mpe.config.json da raiz:', err);
      }
    }

    let localMachineData = {};
    if (fs.existsSync(this.machineConfigPath)) {
      try {
        const rawMachine = fs.readFileSync(this.machineConfigPath, 'utf-8');
        localMachineData = JSON.parse(rawMachine);
      } catch (err) {
        console.error('[M.P.E Config] Erro ao ler config local da máquina:', err);
      }
    }

    // Garante estrutura base caso o arquivo tenha sido editado manualmente
    if (!rootData.profile) {
      rootData.profile = { userName: '', isRegistered: false, languageTone: 'amigavel' };
    }
    if (!rootData.theme) {
      rootData.theme = {
        preset: 'gold-obsidian',
        bgPrimary: '#040406',
        bgSecondary: '#171206',
        goldPrimary: '#E5B84B',
        goldSecondary: '#FFE08A',
        goldDim: '#7A5B18',
        vectorAccent: '#5C73B8',
        nexusRed: '#9E2A2B',
        glowIntensity: 0.85
      };
    }
    if (!rootData.system) {
      rootData.system = {
        startWithWindows: false,
        triggerShortcut: 'Shift + Ctrl + Alt + Botão Direito',
        fallbackKeyboardShortcut: 'CommandOrControl+Shift+Alt+M',
        sensitivity3D: 1.0,
        autoOrbit: true,
        closeOnExecute: true,
        soundEffects: true
      };
    }
    if (!rootData.telegram) {
      rootData.telegram = {
        deliveryMode: 'desktop_and_bot',
        savedChatPath: 'tg://resolve?domain=me',
        savedScreenshotsFolder: './Capturas_MPE',
        botToken: '',
        chatId: '',
        captionTemplate: '✨ [M.P.E] Captura enviada por {user} em {date}'
      };
    }
    if (!Array.isArray(rootData.points)) {
      rootData.points = [];
    }
    if (!rootData.machines) {
      rootData.machines = {};
    }

    // Sincroniza configurações específicas desta máquina (ex: startWithWindows, pasta local, último acesso)
    const machineEntry = Object.assign(
      {
        hostname: this.machineId,
        platform: process.platform,
        arch: process.arch,
        startWithWindows: rootData.system.startWithWindows || false,
        savedScreenshotsFolder: rootData.telegram.savedScreenshotsFolder || './Capturas_MPE',
        lastActive: new Date().toISOString()
      },
      rootData.machines[this.machineId] || {},
      localMachineData
    );

    rootData.machines[this.machineId] = machineEntry;
    rootData.currentMachine = machineEntry;

    this.config = rootData;
    this.save(this.config);
    return this.config;
  }

  get() {
    if (!this.config) {
      return this.load();
    }
    return this.config;
  }

  save(newConfig) {
    if (newConfig) {
      this.config = Object.assign({}, this.config, newConfig);
    }
    if (!this.config) return null;

    this.config.profile.lastUpdated = new Date().toISOString();

    if (!this.config.machines) {
      this.config.machines = {};
    }

    const machineSpecific = {
      hostname: this.machineId,
      platform: process.platform,
      arch: process.arch,
      startWithWindows: Boolean(this.config.system && this.config.system.startWithWindows),
      savedScreenshotsFolder:
        (this.config.telegram && this.config.telegram.savedScreenshotsFolder) || './Capturas_MPE',
      themePreset: this.config.theme ? this.config.theme.preset : 'gold-obsidian',
      lastActive: new Date().toISOString()
    };

    this.config.machines[this.machineId] = machineSpecific;
    this.config.currentMachine = machineSpecific;

    // 1. Salva no JSON portátil na raiz do projeto (para fácil migração entre máquinas)
    try {
      const toWriteRoot = Object.assign({}, this.config);
      delete toWriteRoot.currentMachine;
      fs.writeFileSync(this.rootConfigPath, JSON.stringify(toWriteRoot, null, 2), 'utf-8');
    } catch (err) {
      console.error('[M.P.E Config] Falha ao gravar mpe.config.json na raiz:', err);
    }

    // 2. Salva no perfil local da máquina (%APPDATA%)
    try {
      if (!fs.existsSync(this.userDataDir)) {
        fs.mkdirSync(this.userDataDir, { recursive: true });
      }
      fs.writeFileSync(
        this.machineConfigPath,
        JSON.stringify(machineSpecific, null, 2),
        'utf-8'
      );
    } catch (err) {
      console.error('[M.P.E Config] Falha ao gravar config da máquina local:', err);
    }

    return this.config;
  }

  resolvePath(relativeOrAbsPath) {
    if (!relativeOrAbsPath) {
      return path.join(this.rootDir, 'Capturas_MPE');
    }
    if (path.isAbsolute(relativeOrAbsPath)) {
      return relativeOrAbsPath;
    }
    return path.resolve(this.rootDir, relativeOrAbsPath);
  }
}

module.exports = ConfigManager;
