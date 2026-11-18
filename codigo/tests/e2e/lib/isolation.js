'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const E2E_DIR = path.resolve(__dirname, '..');
const CODE_DIR = path.resolve(E2E_DIR, '..', '..');
const ROOT_DIR = path.resolve(CODE_DIR, '..');

const PROD_CONFIG_PATH = path.join(CODE_DIR, 'mpe.config.json');
const PROD_BACKUP_PATH = path.join(CODE_DIR, 'data', 'mpe.config.backup.json');
const PROD_UNDO_PATH = path.join(CODE_DIR, 'data', 'organizer-undo.json');
const PROD_VERIFICACAO_DIR = path.join(ROOT_DIR, 'prints', 'Verificacao');
const ELECTRON_EXE = path.join(CODE_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const MPE_HOOK_EXE = path.join(CODE_DIR, 'src', 'native', 'bin', 'MpeHook.exe');
const MPE_LAUNCHER_EXE = path.join(ROOT_DIR, 'MPE.exe');
const RUN_TESTS_JS = path.join(CODE_DIR, 'scripts', 'run-tests.js');
const TESTES_MD = path.join(ROOT_DIR, 'Testes.md');

const THEME_PRESETS = {
  'gold-obsidian': {
    preset: 'gold-obsidian',
    bgPrimary: '#040406',
    bgSecondary: '#171206',
    goldPrimary: '#E5B84B',
    goldSecondary: '#FFE08A',
    goldDim: '#7A5B18',
    vectorAccent: '#5C73B8',
    nexusRed: '#9E2A2B',
    glowIntensity: 0.85
  },
  'solar-imperial': {
    preset: 'solar-imperial',
    bgPrimary: '#070402',
    bgSecondary: '#291B04',
    goldPrimary: '#F7C331',
    goldSecondary: '#FFF0A8',
    goldDim: '#9A6B10',
    vectorAccent: '#D9822B',
    nexusRed: '#C83E2B',
    glowIntensity: 0.85
  },
  'cyber-cyan': {
    preset: 'cyber-cyan',
    bgPrimary: '#03060A',
    bgSecondary: '#081822',
    goldPrimary: '#E5B84B',
    goldSecondary: '#73F3FF',
    goldDim: '#5B4A1E',
    vectorAccent: '#25B8D9',
    nexusRed: '#E03C67',
    glowIntensity: 0.85
  },
  'crimson-eclipse': {
    preset: 'crimson-eclipse',
    bgPrimary: '#050304',
    bgSecondary: '#1E090C',
    goldPrimary: '#D9A74A',
    goldSecondary: '#FFD584',
    goldDim: '#6B421A',
    vectorAccent: '#B84A5C',
    nexusRed: '#E63946',
    glowIntensity: 0.85
  }
};

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function snapshotFileState(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, hash: null, buf: null };
  }
  const buf = fs.readFileSync(filePath);
  return {
    exists: true,
    hash: crypto.createHash('sha256').update(buf).digest('hex'),
    buf
  };
}

function restoreFileState(filePath, snap) {
  if (!snap) return;
  const currentHash = sha256File(filePath);
  if (currentHash === snap.hash) return;
  if (!snap.exists) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {}
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, snap.buf);
  }
}

function snapshotDirFiles(dirPath) {
  const map = new Map();
  if (!fs.existsSync(dirPath)) {
    return { existed: false, files: map };
  }
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isFile()) {
      const full = path.join(dirPath, entry.name);
      map.set(entry.name, fs.readFileSync(full));
    }
  }
  return { existed: true, files: map };
}

function restoreDirFiles(dirPath, snap) {
  if (!snap) return;
  if (!snap.existed) {
    try {
      if (fs.existsSync(dirPath)) fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (_) {}
    return;
  }
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isFile()) {
      const full = path.join(dirPath, entry.name);
      if (!snap.files.has(entry.name)) {
        try {
          fs.unlinkSync(full);
        } catch (_) {}
      }
    }
  }
  for (const [name, buf] of snap.files.entries()) {
    const full = path.join(dirPath, name);
    try {
      fs.writeFileSync(full, buf);
    } catch (_) {}
  }
}

function getProdSnapshot() {
  return {
    configHash: sha256File(PROD_CONFIG_PATH),
    backupHash: sha256File(PROD_BACKUP_PATH),
    undoHash: sha256File(PROD_UNDO_PATH),
    configMtimeMs: fs.existsSync(PROD_CONFIG_PATH) ? fs.statSync(PROD_CONFIG_PATH).mtimeMs : null
  };
}

function verifyProdUnchanged(beforeSnap) {
  const afterSnap = getProdSnapshot();
  if (beforeSnap.configHash !== afterSnap.configHash) {
    throw new Error(
      `[PROD_CONFIG_MUTATED] codigo/mpe.config.json SHA-256 changed! before=${beforeSnap.configHash} after=${afterSnap.configHash}`
    );
  }
  if (beforeSnap.undoHash !== afterSnap.undoHash) {
    throw new Error(
      `[PROD_UNDO_MUTATED] codigo/data/organizer-undo.json SHA-256 changed! before=${beforeSnap.undoHash} after=${afterSnap.undoHash}`
    );
  }
  return afterSnap;
}

function isCodeIsolationSupported() {
  const configMgrPath = path.join(CODE_DIR, 'src', 'main', 'configManager.js');
  const mainJsPath = path.join(CODE_DIR, 'src', 'main', 'main.js');
  if (!fs.existsSync(configMgrPath) || !fs.existsSync(mainJsPath)) {
    return { supported: false, reason: 'Missing configManager.js or main.js' };
  }
  const cmSrc = fs.readFileSync(configMgrPath, 'utf8');
  const mainSrc = fs.readFileSync(mainJsPath, 'utf8');
  const combined = cmSrc + '\n' + mainSrc;

  const hasConfigOverride =
    combined.includes('MPE_CONFIG_PATH') || combined.includes('--config-path');
  if (!hasConfigOverride) {
    return {
      supported: false,
      reason:
        'configManager.js/main.js does not honor MPE_CONFIG_PATH or --config-path yet (M1 pending)'
    };
  }
  return { supported: true, reason: 'OK' };
}

function assertCodeIsolationReady() {
  const check = isCodeIsolationSupported();
  if (!check.supported) {
    throw new Error(
      `[ISOLATION_NOT_READY] ${check.reason}. Refusing to launch Electron against codigo/ to protect live codigo/mpe.config.json.`
    );
  }
}

function buildDefaultPoints(workspaceDir) {
  return [
    {
      id: 'slot-1-notepad',
      code: '01 1',
      title: 'Bloco de Notas',
      description: 'Abre o Bloco de Notas',
      actionType: 'launch_app_project',
      params: {
        appName: 'notepad',
        targetPath: 'notepad.exe',
        projectPath: ''
      },
      orbit: 1,
      angle: 0,
      elevation: 0,
      glyph: '1'
    },
    {
      id: 'slot-2-vscode',
      code: '02 2',
      title: 'Projeto VS Code',
      description: 'Abre projeto no VS Code',
      actionType: 'launch_app_project',
      params: {
        appName: 'vscode',
        targetPath: 'code',
        projectPath: workspaceDir
      },
      orbit: 1,
      angle: 60,
      elevation: 0,
      glyph: '2'
    },
    {
      id: 'slot-3-organizer',
      code: '03 3',
      title: 'Organizador',
      description: 'Abre organizador de arquivos',
      actionType: 'open_organizer',
      params: { scope: 'arquivos', criterion: 'type' },
      orbit: 1,
      angle: 120,
      elevation: 0,
      glyph: '3'
    }
  ];
}

function buildSeedConfig(workspaceDir, options = {}) {
  const accepted = options.consentAccepted !== undefined ? Boolean(options.consentAccepted) : true;
  const arquivosDir = options.arquivosDir || path.join(path.dirname(workspaceDir), 'arquivos');
  const printsDir = options.printsDir || path.join(path.dirname(workspaceDir), 'prints');
  const theme =
    options.theme ||
    (options.themePreset && THEME_PRESETS[options.themePreset]
      ? { ...THEME_PRESETS[options.themePreset] }
      : options.themePreset
        ? { preset: options.themePreset }
        : { ...THEME_PRESETS['gold-obsidian'] });

  return {
    version: '2.0',
    profile: {
      userName: options.userName || 'E2E Test User',
      isRegistered: options.isRegistered !== undefined ? Boolean(options.isRegistered) : true
    },
    consent: {
      accepted,
      decidedAt: accepted ? new Date().toISOString() : null,
      version: '1.0',
      permissions: {
        backgroundExecution: accepted,
        launchAppsAndLinks: accepted,
        pythonAutomation: accepted
      }
    },
    theme,
    system: {
      startWithWindows: false,
      hotkey: 'Shift+Ctrl+Alt+RightClick',
      themePreset: options.themePreset || 'gold-obsidian'
    },
    captures: options.captures || {
      organizationMode: 'system_date',
      namingPattern: '{prefix}_{system}_{date}_{time}',
      defaultPrefix: 'MPE',
      defaultCategory: 'Geral',
      documentsFolder: arquivosDir
    },
    telegram: options.telegram || {
      deliveryMode: 'desktop_and_bot',
      savedChatPath: 'Eu | Você | Leonardo',
      savedScreenshotsFolder: printsDir,
      botToken: '',
      chatId: '',
      captionTemplate: '[M.P.E] Captura enviada por {user} em {date}'
    },
    miniAstrolabe: options.miniAstrolabe || {
      enabled: true,
      x: 160,
      y: 160,
      size: 68,
      scale: 1.0,
      fanRadius: 140
    },
    organizer: options.organizer || {
      lastActiveTab: 'astrolabe',
      rememberWindowState: false,
      uiMode: 'dark',
      fontSize: 'medium',
      defaultCriterion: 'type',
      moveInsteadOfCopy: false
    },
    points: Array.isArray(options.points) ? options.points : buildDefaultPoints(workspaceDir),
    autoScripts: Array.isArray(options.autoScripts) ? options.autoScripts : [],
    lastUpdated: new Date().toISOString()
  };
}

function createIsolatedWorkspace(runId, testId, options = {}) {
  const safeId = String(testId || 'test').replace(/[^a-zA-Z0-9_-]/g, '_');
  const runToken = `mpe_e2e_${runId}_${safeId}`;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${runToken}_`));
  const userDataDir = path.join(tmpRoot, 'userData');
  const dataDir = path.join(tmpRoot, 'data');
  const scriptsDir = path.join(dataDir, 'scripts');
  const workspaceDir = path.join(tmpRoot, 'workspace');
  const arquivosDir = path.join(tmpRoot, 'arquivos');
  const printsDir = path.join(tmpRoot, 'prints');
  const logsDir = path.join(tmpRoot, 'logs');
  const configPath = path.join(tmpRoot, 'mpe.config.json');
  const backupConfigPath = path.join(dataDir, 'mpe.config.backup.json');

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(arquivosDir, { recursive: true });
  fs.mkdirSync(printsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const cleanState = Boolean(options.cleanState);
  if (!cleanState) {
    const seed = options.seedConfig || buildSeedConfig(workspaceDir, { ...options, arquivosDir, printsDir });
    fs.writeFileSync(configPath, JSON.stringify(seed, null, 2), 'utf8');
    if (options.writeBackup) {
      fs.writeFileSync(backupConfigPath, JSON.stringify(seed, null, 2), 'utf8');
    }
  }

  function buildElectronArgs(extraArgs = []) {
    const base = [
      options.appPath || CODE_DIR,
      `--user-data-dir=${userDataDir}`,
      `--config-path=${configPath}`,
      `--remote-debugging-port=0`,
      `--mpe-e2e-token=${runToken}`
    ];
    if (cleanState) base.push('--clean-state');
    if (options.startup) base.push('--startup');
    if (options.testClock) base.push(`--test-clock=${options.testClock}`);
    return base.concat(extraArgs);
  }

  function buildElectronEnv(extraEnv = {}) {
    return {
      ...process.env,
      MPE_CONFIG_PATH: configPath,
      MPE_DATA_DIR: dataDir,
      MPE_SCRIPTS_DIR: scriptsDir,
      MPE_LOGS_DIR: logsDir,
      MPE_E2E_TOKEN: runToken,
      MPE_FORCE_CLEAN_CONSENT: cleanState ? '1' : '0',
      MPE_DISABLE_STARTUP_REGISTRY: '1',
      ...extraEnv
    };
  }

  function readConfig() {
    if (!fs.existsSync(configPath)) return null;
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  function cleanup() {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (_) {}
  }

  return {
    runToken,
    tmpRoot,
    userDataDir,
    dataDir,
    scriptsDir,
    workspaceDir,
    arquivosDir,
    printsDir,
    logsDir,
    configPath,
    backupConfigPath,
    cleanState,
    buildElectronArgs,
    buildElectronEnv,
    readConfig,
    cleanup
  };
}

module.exports = {
  E2E_DIR,
  CODE_DIR,
  ROOT_DIR,
  PROD_CONFIG_PATH,
  PROD_BACKUP_PATH,
  PROD_UNDO_PATH,
  PROD_VERIFICACAO_DIR,
  ELECTRON_EXE,
  MPE_HOOK_EXE,
  MPE_LAUNCHER_EXE,
  RUN_TESTS_JS,
  TESTES_MD,
  THEME_PRESETS,
  sha256File,
  snapshotFileState,
  restoreFileState,
  snapshotDirFiles,
  restoreDirFiles,
  getProdSnapshot,
  verifyProdUnchanged,
  isCodeIsolationSupported,
  assertCodeIsolationReady,
  buildDefaultPoints,
  buildSeedConfig,
  createIsolatedWorkspace
};
