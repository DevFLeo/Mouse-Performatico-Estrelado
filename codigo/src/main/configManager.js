const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

function parseCliFlagValue(argv, flagName) {
  if (!Array.isArray(argv)) return '';
  const prefix = `${flagName}=`;
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || '');
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length).replace(/^["']|["']$/g, '').trim();
    }
    if (arg === flagName && i + 1 < argv.length) {
      return String(argv[i + 1] || '').replace(/^["']|["']$/g, '').trim();
    }
  }
  return '';
}

/**
 * Numero (posicao + 1) e letra de atalho opcional (A-Z, sem repeticao: a primeira vence).
 */
function normalizeHotkeyLetter(raw) {
  const letter = String(raw || '').trim().toUpperCase();
  return /^[A-Z]$/.test(letter) ? letter : '';
}

function normalizeSlotPoints(points) {
  const usedLetters = new Set();
  return points.map((pt, idx) => {
    if (!pt || typeof pt !== 'object') return pt;
    const next = Object.assign({}, pt, { slotIndex: idx, slotNumber: idx + 1 });
    const letter = normalizeHotkeyLetter(pt.hotkeyLetter);
    if (letter && !usedLetters.has(letter)) {
      usedLetters.add(letter);
      next.hotkeyLetter = letter;
    } else {
      delete next.hotkeyLetter;
    }
    return next;
  });
}

function createDefaultConsent() {
  return {
    accepted: false,
    decidedAt: null,
    version: '1.0',
    permissions: {
      backgroundExecution: false,
      launchAppsAndLinks: false,
      pythonAutomation: false
    }
  };
}

function normalizeConsent(rawConsent) {
  const src = rawConsent && typeof rawConsent === 'object' ? rawConsent : {};
  const accepted = src.accepted === true;
  const perms = src.permissions && typeof src.permissions === 'object' ? src.permissions : {};
  return {
    accepted,
    decidedAt: src.decidedAt || null,
    version: typeof src.version === 'string' && src.version ? src.version : '1.0',
    permissions: accepted
      ? {
          backgroundExecution: perms.backgroundExecution !== false,
          launchAppsAndLinks: perms.launchAppsAndLinks !== false,
          pythonAutomation: perms.pythonAutomation !== false
        }
      : {
          backgroundExecution: false,
          launchAppsAndLinks: false,
          pythonAutomation: false
        }
  };
}

function createDefaultMiniAstrolabe() {
  return {
    enabled: true,
    x: null,
    y: null,
    size: 48,
    scale: 1.0,
    fanRadius: 98,
    layoutVersion: 2
  };
}

function createCleanDefaultPoints() {
  return [
    {
      id: 'star-01-1',
      code: '01 1',
      title: 'Bloco de Notas',
      hotkeyLetter: 'N',
      description: 'Abre o Bloco de Notas do Windows.',
      actionType: 'launch_app_project',
      orbit: 2,
      angle: 330,
      elevation: 12,
      vectorStyle: 'gold',
      glyph: 'Δ',
      hasArrow: true,
      slotIndex: 0,
      slotNumber: 1,
      params: {
        appName: 'notepad',
        targetPath: 'notepad.exe',
        projectPath: ''
      }
    },
    {
      id: 'star-02-2',
      code: '02 2',
      title: 'Projeto VS Code',
      hotkeyLetter: 'V',
      description: 'Abre o projeto configurado no Visual Studio Code.',
      actionType: 'launch_app_project',
      orbit: 2,
      angle: 30,
      elevation: 12,
      vectorStyle: 'blue',
      glyph: 'C',
      hasArrow: true,
      slotIndex: 1,
      slotNumber: 2,
      params: {
        appName: 'vscode',
        targetPath: 'code',
        projectPath: 'c:\\Projetos\\MousePerformaticoEstrelado'
      }
    }
  ];
}

/**
 * Gerenciador Hibrido de Configuracao (Portatil + Por Maquina)
 * - Le e grava o `mpe.config.json` na raiz do projeto (permitindo migracao instantanea entre maquinas).
 * - Mantem backup automatico em `data/mpe.config.backup.json` e protege contra perda de pontos por JSON corrompido.
 * - Mantem tambem o cache especifico da maquina em `%APPDATA%/MPE/machine-<HOSTNAME>.json` e na chave `machines[hostname]`.
 */
class ConfigManager {
  constructor(rootDir, codeDir, options = {}) {
    this.rootDir = rootDir;
    this.codeDir = codeDir || rootDir;

    const ignoreArgs = Boolean(options.ignoreProcessArgs);
    const cliConfigPath = ignoreArgs ? '' : parseCliFlagValue(process.argv, '--config-path');
    const envConfigPath = ignoreArgs ? '' : String(process.env.MPE_CONFIG_PATH || '').trim();
    const explicitConfigPath =
      options.configPath !== undefined
        ? String(options.configPath || '').trim()
        : cliConfigPath || envConfigPath;

    this.cleanState = Boolean(
      options.cleanState ||
        (!ignoreArgs && Array.isArray(process.argv) && process.argv.includes('--clean-state'))
    );
    this.forceCleanConsent = Boolean(
      options.forceCleanConsent ||
        (!ignoreArgs && process.env.MPE_FORCE_CLEAN_CONSENT === '1') ||
        this.cleanState
    );
    this.enableIsolatedBackup = Boolean(
      options.enableIsolatedBackup ||
        (!ignoreArgs && process.env.MPE_ENABLE_ISOLATED_BACKUP === '1')
    );
    const explicitDataDir =
      options.dataDir !== undefined
        ? String(options.dataDir || '').trim()
        : !ignoreArgs
        ? String(process.env.MPE_DATA_DIR || '').trim()
        : '';

    this.machineId = os.hostname() || 'DEFAULT-MACHINE';
    this.userDataDir =
      options.userDataDir || (app ? app.getPath('userData') : path.join(os.homedir(), '.mpe'));
    this.isIsolated = Boolean(explicitConfigPath || this.cleanState);

    if (explicitConfigPath) {
      this.rootConfigPath = path.resolve(explicitConfigPath);
    } else if (this.cleanState) {
      this.rootConfigPath = path.join(this.userDataDir, 'mpe.clean-state.config.json');
    } else {
      this.rootConfigPath = path.join(this.codeDir, 'mpe.config.json');
    }

    this.legacyRootConfigPath = this.isIsolated
      ? this.rootConfigPath
      : path.join(this.rootDir, 'mpe.config.json');
    if (this.isIsolated) {
      this.dataDir = this.enableIsolatedBackup
        ? explicitDataDir
          ? path.resolve(explicitDataDir)
          : path.join(path.dirname(this.rootConfigPath), 'data')
        : path.join(path.dirname(this.rootConfigPath), '.mpe-data');
    } else {
      this.dataDir = path.join(this.codeDir, 'data');
    }
    this.backupConfigPath =
      !this.isIsolated || this.enableIsolatedBackup
        ? path.join(this.dataDir, 'mpe.config.backup.json')
        : null;
    this.machineConfigPath = this.isIsolated
      ? null
      : path.join(this.userDataDir, `machine-${this.machineId}.json`);

    this.config = null;
    this.lastLoadedMtimeMs = 0;
    this._cleanStateApplied = false;
    this._cleanConsentApplied = false;
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
    const isInitialCleanState = this.cleanState && !this._cleanStateApplied;

    if (
      !this.isIsolated &&
      !isInitialCleanState &&
      !fs.existsSync(this.rootConfigPath) &&
      this.legacyRootConfigPath !== this.rootConfigPath &&
      fs.existsSync(this.legacyRootConfigPath)
    ) {
      try {
        fs.mkdirSync(path.dirname(this.rootConfigPath), { recursive: true });
        fs.renameSync(this.legacyRootConfigPath, this.rootConfigPath);
      } catch (_) {}
    }

    const fileExisted = !isInitialCleanState && fs.existsSync(this.rootConfigPath);
    if (fileExisted) {
      let raw = '';
      try {
        raw = fs.readFileSync(this.rootConfigPath, 'utf-8');
        rootData = JSON.parse(raw);
      } catch (err) {
        parseFailed = true;
        console.error('[M.P.E Config] Erro ao ler mpe.config.json da raiz:', err);
        if (raw && (!this.isIsolated || this.enableIsolatedBackup)) this.saveCorruptedSnapshot(raw);
      }
    }

    // Recupera automaticamente do backup se o arquivo da raiz falhou no parse
    // ou foi zerado (sem perfil registrado e zero pontos) enquanto ha backup valido
    const looksReset =
      parseFailed ||
      (Array.isArray(rootData.points) &&
        rootData.points.length === 0 &&
        !(rootData.profile && rootData.profile.isRegistered));

    if (
      (!this.isIsolated || this.enableIsolatedBackup) &&
      !isInitialCleanState &&
      looksReset &&
      this.backupConfigPath &&
      fs.existsSync(this.backupConfigPath)
    ) {
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
    if (!this.isIsolated && this.machineConfigPath && fs.existsSync(this.machineConfigPath)) {
      try {
        const rawMachine = fs.readFileSync(this.machineConfigPath, 'utf-8');
        localMachineData = JSON.parse(rawMachine);
      } catch (err) {
        console.error('[M.P.E Config] Erro ao ler config local da maquina:', err);
      }
    }

    const wasRegistered = Boolean(rootData.profile && rootData.profile.isRegistered);

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
    if (!rootData.captures) {
      rootData.captures = {
        organizationMode: 'system_date',
        namingPattern: '{prefix}_{system}_{date}_{time}',
        defaultPrefix: 'MPE',
        defaultCategory: 'Geral',
        documentsFolder: './arquivos'
      };
    } else {
      rootData.captures = Object.assign(
        {
          organizationMode: 'system_date',
          namingPattern: '{prefix}_{system}_{date}_{time}',
          defaultPrefix: 'MPE',
          defaultCategory: 'Geral',
          documentsFolder: './arquivos'
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

    if (this.forceCleanConsent && !this._cleanConsentApplied) {
      rootData.consent = createDefaultConsent();
      this._cleanConsentApplied = true;
    } else {
      rootData.consent = normalizeConsent(rootData.consent);
    }

    const rawMini =
      rootData.miniAstrolabe && typeof rootData.miniAstrolabe === 'object' ? rootData.miniAstrolabe : null;
    const needsMiniV2 = Boolean(rawMini) && rawMini.layoutVersion !== 2;
    rootData.miniAstrolabe = Object.assign(createDefaultMiniAstrolabe(), rawMini || {});
    // Migracao v2: Mini 30% menor. Ajusta so quem ainda usa os tamanhos padrao antigos (68 / 140).
    if (needsMiniV2) {
      if (rootData.miniAstrolabe.size === 68) rootData.miniAstrolabe.size = 48;
      if (rootData.miniAstrolabe.fanRadius === 140) rootData.miniAstrolabe.fanRadius = 98;
      rootData.miniAstrolabe.layoutVersion = 2;
    }

    if (!Array.isArray(rootData.autoScripts)) {
      rootData.autoScripts = [];
    }

    // Numero unico e compartilhado (M.P.E principal e Mini Astrolabio): posicao + 1.
    if (Array.isArray(rootData.points)) {
      rootData.points = normalizeSlotPoints(rootData.points);
    }

    if (rootData.points.length === 0 && (!fileExisted || isInitialCleanState || !wasRegistered)) {
      rootData.points = createCleanDefaultPoints();
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
        hotkeyLetter: 'O',
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

    if (isInitialCleanState) {
      this._cleanStateApplied = true;
    }

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
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmpPath, content, 'utf-8');
      try {
        fs.renameSync(tmpPath, filePath);
      } catch (_) {
        fs.writeFileSync(filePath, content, 'utf-8');
      }
    } finally {
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
      if ('autoScripts' in safePatch && !Array.isArray(safePatch.autoScripts)) {
        delete safePatch.autoScripts;
      }
      if (Array.isArray(safePatch.points)) {
        safePatch.points = normalizeSlotPoints(safePatch.points);
      }
      this.config = Object.assign({}, this.config || {}, safePatch);
    }
    if (!this.config) return null;

    if (!this.config.profile) {
      this.config.profile = { userName: '', isRegistered: false, languageTone: 'amigavel' };
    }
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
    if ((!this.isIsolated || this.enableIsolatedBackup) && this.backupConfigPath) {
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
    }

    // 3. Salva no perfil local da maquina (%APPDATA%)
    if (!this.isIsolated && this.machineConfigPath) {
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
    }

    return this.config;
  }

  reorderPoint(fromIndex, toIndex) {
    const cfg = this.get();
    const points = Array.isArray(cfg && cfg.points) ? [...cfg.points] : [];

    if (
      typeof fromIndex !== 'number' ||
      typeof toIndex !== 'number' ||
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex < 0 ||
      fromIndex >= points.length ||
      toIndex < 0 ||
      toIndex >= points.length
    ) {
      return { ok: false, error: 'Indice de reordenacao invalido.' };
    }

    if (fromIndex !== toIndex) {
      const [moved] = points.splice(fromIndex, 1);
      points.splice(toIndex, 0, moved);
    }

    const updatedPoints = points.map((pt, idx) =>
      Object.assign({}, pt, {
        slotIndex: idx,
        slotNumber: idx + 1
      })
    );

    const saved = this.save({ points: updatedPoints });
    return {
      ok: true,
      fromIndex,
      toIndex,
      points: saved ? saved.points : updatedPoints,
      config: saved
    };
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
