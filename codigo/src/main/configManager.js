const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

/**
 * Gerenciador Hibrido de Configuracao (Portatil + Por Maquina)
 * - Le e grava o `mpe.config.json` na raiz do projeto (permitindo migracao instantanea entre maquinas).
 * - Mantem backup automatico em `data/mpe.config.backup.json` e protege contra perda de pontos por JSON corrompido.
 * - Mantem tambem o cache especifico da maquina em `%APPDATA%/MPE/machine-<HOSTNAME>.json` e na chave `machines[hostname]`.
 */
class ConfigManager {
  constructor(rootDir, codeDir) {
    this.rootDir = rootDir;
    this.codeDir = codeDir || rootDir;
    this.rootConfigPath = path.join(this.codeDir, 'mpe.config.json');
    this.legacyRootConfigPath = path.join(this.rootDir, 'mpe.config.json');
    this.dataDir = path.join(this.codeDir, 'data');
    this.backupConfigPath = path.join(this.dataDir, 'mpe.config.backup.json');
    this.machineId = os.hostname() || 'DEFAULT-MACHINE';
    this.userDataDir = app ? app.getPath('userData') : path.join(os.homedir(), '.mpe');
    this.machineConfigPath = path.join(this.userDataDir, `machine-${this.machineId}.json`);
    this.config = null;
    this.lastLoadedMtimeMs = 0;
  }

  readJsonSafe(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  }

  saveCorruptedSnapshot(rawContent) {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      const snapName = `mpe.config.corrupted.${Date.now()}.json`;
      fs.writeFileSync(path.join(this.dataDir, snapName), rawContent, 'utf-8');
    } catch (_) {}
  }

  load() {
    let rootData = {};
    let parseFailed = false;

    if (!fs.existsSync(this.rootConfigPath) && this.legacyRootConfigPath !== this.rootConfigPath && fs.existsSync(this.legacyRootConfigPath)) {
      try {
        fs.mkdirSync(path.dirname(this.rootConfigPath), { recursive: true });
        fs.renameSync(this.legacyRootConfigPath, this.rootConfigPath);
      } catch (_) {}
    }

    if (fs.existsSync(this.rootConfigPath)) {
      let raw = '';
      try {
        raw = fs.readFileSync(this.rootConfigPath, 'utf-8');
        rootData = JSON.parse(raw);
      } catch (err) {
        parseFailed = true;
        console.error('[M.P.E Config] Erro ao ler mpe.config.json da raiz:', err);
        if (raw) this.saveCorruptedSnapshot(raw);
      }
    }

    // Recupera automaticamente do backup se o arquivo da raiz falhou no parse
    // ou foi zerado (sem perfil registrado e zero pontos) enquanto ha backup valido
    const looksReset =
      parseFailed ||
      (Array.isArray(rootData.points) &&
        rootData.points.length === 0 &&
        !(rootData.profile && rootData.profile.isRegistered));

    if (looksReset && fs.existsSync(this.backupConfigPath)) {
      try {
        const backupData = this.readJsonSafe(this.backupConfigPath);
        if (backupData && Array.isArray(backupData.points) && backupData.points.length > 0) {
          console.warn('[M.P.E Config] Restaurando configuracao e pontos a partir do backup seguro.');
          rootData = backupData;
        }
      } catch (bakErr) {
        console.error('[M.P.E Config] Falha ao ler backup:', bakErr);
      }
    }

    let localMachineData = {};
    if (fs.existsSync(this.machineConfigPath)) {
      try {
        const rawMachine = fs.readFileSync(this.machineConfigPath, 'utf-8');
        localMachineData = JSON.parse(rawMachine);
      } catch (err) {
        console.error('[M.P.E Config] Erro ao ler config local da maquina:', err);
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
        startWithWindows: true,
        triggerShortcut: 'Shift + Ctrl + Alt + Botao Direito',
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
        savedChatPath: 'Eu | Você | Leonardo',
        savedScreenshotsFolder: './prints',
        botToken: '',
        chatId: '',
        captionTemplate: '[M.P.E] Captura enviada por {user} em {date}'
      };
    }
    if (!Array.isArray(rootData.points)) {
      rootData.points = [];
    }
    if (!rootData.machines) {
      rootData.machines = {};
    }
    if (!rootData.obsidian) {
      rootData.obsidian = { vaultPath: './arquivos/Obsidian_Vault', defaultFolder: 'Notas' };
    }
    if (!rootData.captures) {
      rootData.captures = {
        organizationMode: 'system_date',
        namingPattern: '{prefix}_{system}_{date}_{time}',
        defaultPrefix: 'MPE',
        defaultCategory: 'Geral',
        documentsFolder: './arquivos',
        autoIndexNamedPrints: true
      };
    } else {
      rootData.captures = Object.assign(
        {
          organizationMode: 'system_date',
          namingPattern: '{prefix}_{system}_{date}_{time}',
          defaultPrefix: 'MPE',
          defaultCategory: 'Geral',
          documentsFolder: './arquivos',
          autoIndexNamedPrints: true
        },
        rootData.captures
      );
    }
    if (!rootData.organizer) {
      rootData.organizer = {
        criterion: 'type',
        defaultTarget: 'arquivos',
        moveInsteadOfCopy: false,
        searchInContent: true,
        fontSize: 'medium',
        uiMode: 'dark',
        rememberWindowState: false,
        lastActiveTab: 'astrolabe'
      };
    } else {
      rootData.organizer = Object.assign(
        {
          criterion: 'type',
          defaultTarget: 'arquivos',
          moveInsteadOfCopy: false,
          searchInContent: true,
          fontSize: 'medium',
          uiMode: 'dark',
          rememberWindowState: false,
          lastActiveTab: 'astrolabe'
        },
        rootData.organizer
      );
    }
    if (!rootData.ai) {
      rootData.ai = { provider: 'auto', port: 18080, modelsDir: './codigo/models', contextSize: 4096, boostMode: 'balanced' };
    } else {
      if (!rootData.ai.provider || rootData.ai.provider === 'builtin') {
        rootData.ai.provider = 'auto';
      }
      if (!rootData.ai.port || parseInt(rootData.ai.port, 10) === 8080) {
        rootData.ai.port = 18080;
      }
      if (!rootData.ai.modelsDir || rootData.ai.modelsDir === './models' || rootData.ai.modelsDir === 'models') {
        rootData.ai.modelsDir = './codigo/models';
      }
      if (!rootData.ai.contextSize) {
        rootData.ai.contextSize = 4096;
      }
      if (!['eco', 'balanced', 'turbo'].includes(rootData.ai.boostMode)) {
        rootData.ai.boostMode = 'balanced';
      }
    }

    // Garante ponto do Organizador de Arquivos visivel no Astrolabio
    const hasOrganizerPoint = rootData.points.some(
      (pt) => pt && (pt.actionType === 'open_organizer' || pt.actionType === 'organize_files_quick')
    );
    if (!hasOrganizerPoint && rootData.points.length > 0) {
      rootData.points.push({
        id: 'star-02-7',
        code: '02 7',
        title: 'Organizar Arquivos',
        description: 'Abre o Organizador Inteligente de Arquivos e Prints direto pelo Astrolabio.',
        actionType: 'open_organizer',
        orbit: 3,
        angle: 72,
        elevation: 10,
        vectorStyle: 'gold',
        glyph: 'Δ',
        hasArrow: true,
        params: {
          targetScope: 'arquivos'
        }
      });
    }

    // Migra caminhos antigos ./Capturas_MPE e ./imagens/Capturas_MPE para ./prints, e ./documentos para ./arquivos
    const migrateCap = (p) =>
      p === './Capturas_MPE' || p === 'Capturas_MPE' || p === './imagens/Capturas_MPE' || p === 'imagens/Capturas_MPE'
        ? './prints'
        : p;
    const migrateDocs = (p) => (p === './documentos' || p === 'documentos' ? './arquivos' : p);

    if (rootData.telegram && rootData.telegram.savedScreenshotsFolder) {
      rootData.telegram.savedScreenshotsFolder = migrateCap(rootData.telegram.savedScreenshotsFolder);
    }
    if (rootData.captures && rootData.captures.documentsFolder) {
      rootData.captures.documentsFolder = migrateDocs(rootData.captures.documentsFolder);
    }
    if (rootData.obsidian && rootData.obsidian.vaultPath === './Obsidian_Vault') {
      rootData.obsidian.vaultPath = './arquivos/Obsidian_Vault';
    }
    rootData.points.forEach((pt) => {
      if (pt && pt.params) {
        if (pt.params.saveDir) pt.params.saveDir = migrateCap(pt.params.saveDir);
        if (pt.params.targetPath) pt.params.targetPath = migrateCap(pt.params.targetPath);
      }
    });
    if (localMachineData && localMachineData.savedScreenshotsFolder) {
      localMachineData.savedScreenshotsFolder = migrateCap(localMachineData.savedScreenshotsFolder);
    }

    // Sincroniza configuracoes especificas desta maquina
    const machineEntry = Object.assign(
      {
        hostname: this.machineId,
        platform: process.platform,
        arch: process.arch,
        startWithWindows: rootData.system.startWithWindows || false,
        savedScreenshotsFolder: rootData.telegram.savedScreenshotsFolder || './prints',
        lastActive: new Date().toISOString()
      },
      rootData.machines[this.machineId] || {},
      localMachineData
    );
    machineEntry.savedScreenshotsFolder = migrateCap(machineEntry.savedScreenshotsFolder);

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
    try {
      if (fs.existsSync(this.rootConfigPath)) {
        const mtimeMs = fs.statSync(this.rootConfigPath).mtimeMs;
        if (mtimeMs > this.lastLoadedMtimeMs + 5) {
          this.readJsonSafe(this.rootConfigPath);
          return this.load();
        }
      }
    } catch (_) {}
    return this.config;
  }

  writeAtomic(filePath, content) {
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, content, 'utf-8');
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (_) {
      fs.writeFileSync(filePath, content, 'utf-8');
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch (_) {}
    }
  }

  save(newConfig) {
    if (newConfig) {
      const safePatch = Object.assign({}, newConfig);
      if ('points' in safePatch && !Array.isArray(safePatch.points)) {
        delete safePatch.points;
      }
      this.config = Object.assign({}, this.config, safePatch);
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
        (this.config.telegram && this.config.telegram.savedScreenshotsFolder) || './prints',
      themePreset: this.config.theme ? this.config.theme.preset : 'gold-obsidian',
      lastActive: new Date().toISOString()
    };

    this.config.machines[this.machineId] = machineSpecific;
    this.config.currentMachine = machineSpecific;

    const toWriteRoot = Object.assign({}, this.config);
    delete toWriteRoot.currentMachine;
    const serialized = JSON.stringify(toWriteRoot, null, 2);

    // 1. Salva no JSON portatil na raiz do projeto com escrita atomica
    try {
      this.writeAtomic(this.rootConfigPath, serialized);
      this.lastLoadedMtimeMs = fs.statSync(this.rootConfigPath).mtimeMs;
    } catch (err) {
      console.error('[M.P.E Config] Falha ao gravar mpe.config.json na raiz:', err);
    }

    // 2. Atualiza backup seguro sempre que houver pontos salvos ou perfil registrado
    try {
      if (
        (Array.isArray(toWriteRoot.points) && toWriteRoot.points.length > 0) ||
        (toWriteRoot.profile && toWriteRoot.profile.isRegistered)
      ) {
        if (!fs.existsSync(this.dataDir)) {
          fs.mkdirSync(this.dataDir, { recursive: true });
        }
        this.writeAtomic(this.backupConfigPath, serialized);
      }
    } catch (err) {
      console.warn('[M.P.E Config] Falha ao atualizar backup:', err.message);
    }

    // 3. Salva no perfil local da maquina (%APPDATA%)
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
      console.error('[M.P.E Config] Falha ao gravar config da maquina local:', err);
    }

    return this.config;
  }

  resolvePath(relativeOrAbsPath) {
    if (!relativeOrAbsPath) {
      return path.join(this.rootDir, 'prints');
    }
    if (path.isAbsolute(relativeOrAbsPath)) {
      return relativeOrAbsPath;
    }
    return path.resolve(this.rootDir, relativeOrAbsPath);
  }
}

module.exports = ConfigManager;
