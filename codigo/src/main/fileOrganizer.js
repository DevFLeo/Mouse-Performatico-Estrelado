const fs = require('fs');
const path = require('path');
const { shell } = require('electron');

const EXT_GROUPS = {
  // Imagens
  png: 'imagens/png',
  jpg: 'imagens/jpg',
  jpeg: 'imagens/jpg',
  webp: 'imagens/webp',
  gif: 'imagens/gif',
  bmp: 'imagens/bmp',
  svg: 'imagens/svg',
  ico: 'imagens/ico',
  tif: 'imagens/tiff',
  tiff: 'imagens/tiff',
  heic: 'imagens/heic',
  avif: 'imagens/avif',
  raw: 'imagens/raw',
  cr2: 'imagens/raw',
  nef: 'imagens/raw',

  // Documentos
  pdf: 'documentos/pdf',
  doc: 'documentos/word',
  docx: 'documentos/word',
  txt: 'documentos/txt',
  md: 'documentos/md',
  rtf: 'documentos/rtf',
  odt: 'documentos/odt',
  pages: 'documentos/pages',
  tex: 'documentos/tex',
  log: 'documentos/log',

  // Financeiro / Extratos
  ofx: 'financeiro/ofx',
  qfx: 'financeiro/qfx',

  // Planilhas
  csv: 'planilhas/csv',
  tsv: 'planilhas/tsv',
  xls: 'planilhas/excel',
  xlsx: 'planilhas/excel',
  xlsm: 'planilhas/excel',
  ods: 'planilhas/ods',
  numbers: 'planilhas/numbers',

  // Apresentacoes
  ppt: 'apresentacoes/powerpoint',
  pptx: 'apresentacoes/powerpoint',
  odp: 'apresentacoes/odp',
  key: 'apresentacoes/keynote',

  // E-books
  epub: 'ebooks/epub',
  mobi: 'ebooks/mobi',
  azw: 'ebooks/kindle',
  azw3: 'ebooks/kindle',
  fb2: 'ebooks/fb2',

  // Multimedia: Audio & Video
  mp3: 'multimedia/audio',
  wav: 'multimedia/audio',
  flac: 'multimedia/audio',
  ogg: 'multimedia/audio',
  m4a: 'multimedia/audio',
  aac: 'multimedia/audio',
  wma: 'multimedia/audio',
  opus: 'multimedia/audio',

  mp4: 'multimedia/video',
  mkv: 'multimedia/video',
  avi: 'multimedia/video',
  mov: 'multimedia/video',
  wmv: 'multimedia/video',
  webm: 'multimedia/video',
  m4v: 'multimedia/video',
  flv: 'multimedia/video',

  // Compactados
  zip: 'compactados/zip',
  rar: 'compactados/rar',
  '7z': 'compactados/7z',
  tar: 'compactados/tar',
  gz: 'compactados/gz',
  bz2: 'compactados/bz2',
  xz: 'compactados/xz',
  iso: 'compactados/iso',

  // Codigo-fonte
  js: 'codigo/js',
  mjs: 'codigo/js',
  cjs: 'codigo/js',
  ts: 'codigo/ts',
  jsx: 'codigo/js',
  tsx: 'codigo/ts',
  py: 'codigo/python',
  cs: 'codigo/csharp',
  cpp: 'codigo/cpp',
  c: 'codigo/c',
  h: 'codigo/c',
  java: 'codigo/java',
  go: 'codigo/go',
  rs: 'codigo/rust',
  php: 'codigo/php',
  rb: 'codigo/ruby',
  html: 'codigo/web',
  htm: 'codigo/web',
  css: 'codigo/web',
  scss: 'codigo/web',
  json: 'codigo/json',
  xml: 'codigo/xml',
  yaml: 'codigo/yaml',
  yml: 'codigo/yaml',
  sql: 'codigo/sql',
  ps1: 'codigo/scripts',
  sh: 'codigo/scripts',
  bat: 'codigo/scripts',

  // Design / CAD
  psd: 'design/photoshop',
  ai: 'design/illustrator',
  fig: 'design/figma',
  xd: 'design/xd',
  sketch: 'design/sketch',
  dwg: 'design/cad',
  dxf: 'design/cad',
  stl: 'design/3d',
  obj: 'design/3d',
  blend: 'design/blender',
  cdr: 'design/corel',

  // Executaveis
  exe: 'executaveis/exe',
  msi: 'executaveis/msi',
  cmd: 'executaveis/cmd',
  appimage: 'executaveis/appimage',
  msix: 'executaveis/msix',

  // Fontes
  ttf: 'fontes/ttf',
  otf: 'fontes/otf',
  woff: 'fontes/woff',
  woff2: 'fontes/woff2',
  eot: 'fontes/eot'
};

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.py', '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx',
  '.json', '.csv', '.tsv', '.ofx', '.qfx', '.log', '.html', '.htm',
  '.css', '.scss', '.xml', '.yaml', '.yml', '.sql', '.ps1', '.sh',
  '.bat', '.cs', '.c', '.cpp', '.h', '.java', '.go', '.rs', '.php',
  '.rb', '.ini', '.conf', '.cfg', '.env', '.tex', '.rtf'
]);

function normalizeText(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDateBr(ms) {
  const d = new Date(ms || Date.now());
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

class FileOrganizer {
  constructor(rootDir, codeDir, configManager, options = {}) {
    this.rootDir = path.resolve(rootDir);
    this.codeDir = path.resolve(codeDir || path.join(rootDir, 'codigo'));
    this.configManager = configManager;

    const opts = options && typeof options === 'object' ? options : {};
    const explicitDataDir =
      opts.dataDir !== undefined ? String(opts.dataDir || '').trim() : '';
    const envDataDir = opts.ignoreProcessArgs
      ? ''
      : String(process.env.MPE_DATA_DIR || '').trim();
    const cmDataDir =
      this.configManager && this.configManager.dataDir
        ? String(this.configManager.dataDir || '').trim()
        : '';

    this.dataDir = explicitDataDir
      ? path.resolve(explicitDataDir)
      : envDataDir
      ? path.resolve(envDataDir)
      : cmDataDir
      ? path.resolve(cmDataDir)
      : path.join(this.codeDir, 'data');

    this.undoFilePath = path.join(this.dataDir, 'organizer-undo.json');
    this._scanCache = new Map();
    this._contentCache = new Map();
  }

  invalidateCache(scope = null) {
    if (scope) this._scanCache.delete(scope);
    else this._scanCache.clear();
  }

  _readNormalizedContent(fileEntry) {
    const cached = this._contentCache.get(fileEntry.fullPath);
    if (cached && cached.mtimeMs === fileEntry.mtimeMs && cached.size === fileEntry.size) {
      return cached;
    }
    const rawContent = fs.readFileSync(fileEntry.fullPath, 'utf8');
    const normContent = normalizeText(rawContent);
    const entry = {
      mtimeMs: fileEntry.mtimeMs,
      size: fileEntry.size,
      rawContent,
      normContent
    };
    if (this._contentCache.size >= 300) {
      const oldestKey = this._contentCache.keys().next().value;
      this._contentCache.delete(oldestKey);
    }
    this._contentCache.set(fileEntry.fullPath, entry);
    return entry;
  }

  getScopeDir(scope = 'arquivos') {
    const cfg = this.configManager ? this.configManager.get() : {};
    if (scope === 'prints') {
      const raw = (cfg.telegram && cfg.telegram.savedScreenshotsFolder) || './prints';
      return this.configManager ? this.configManager.resolvePath(raw) : path.join(this.rootDir, 'prints');
    }
    const raw = (cfg.captures && cfg.captures.documentsFolder) || './arquivos';
    return this.configManager ? this.configManager.resolvePath(raw) : path.join(this.rootDir, 'arquivos');
  }

  ensureScopeDir(scope = 'arquivos') {
    const dir = this.getScopeDir(scope);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  isProtectedSelfPath(candidatePath) {
    const resolved = path.resolve(candidatePath);
    const protectedDirs = [
      this.rootDir,
      this.codeDir,
      this.getScopeDir('arquivos'),
      this.getScopeDir('prints')
    ];

    const lowRes = resolved.toLowerCase();
    for (const pDir of protectedDirs) {
      const lowP = path.resolve(pDir).toLowerCase();
      // Recusa a propria pasta do sistema, a pasta codigo/ ou qualquer ancestral direto do rootDir
      if (lowRes === lowP) return true;
      if (lowP.startsWith(lowRes + path.sep)) return true;
    }
    // Recusa qualquer item dentro de codigo/
    const lowCode = this.codeDir.toLowerCase();
    if (lowRes.startsWith(lowCode + path.sep)) return true;
    return false;
  }

  collectFiles(inputPaths) {
    const collected = [];
    const seen = new Set();

    const walk = (p) => {
      let stat;
      try {
        stat = fs.statSync(p);
      } catch (_) {
        return;
      }
      if (stat.isDirectory()) {
        let entries = [];
        try {
          entries = fs.readdirSync(p);
        } catch (_) {
          return;
        }
        for (const name of entries) {
          walk(path.join(p, name));
        }
      } else if (stat.isFile()) {
        const resolved = path.resolve(p);
        if (!seen.has(resolved)) {
          seen.add(resolved);
          collected.push({ filePath: resolved, stat });
        }
      }
    };

    for (const rawPath of inputPaths || []) {
      if (!rawPath) continue;
      const resolved = path.resolve(String(rawPath));
      if (!fs.existsSync(resolved)) continue;
      if (this.isProtectedSelfPath(resolved)) {
        throw new Error(`Nao e permitido organizar a propria pasta do M.P.E: ${resolved}`);
      }
      walk(resolved);
    }

    return collected;
  }

  resolveCategory(filePath, stat, criterion = 'type') {
    const fileName = path.basename(filePath);
    const extRaw = path.extname(fileName).replace(/^\./, '').toLowerCase();

    if (criterion === 'date') {
      const d = new Date(stat.mtimeMs || Date.now());
      const yyyy = String(d.getFullYear());
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${yyyy}/${yyyy}-${mm}`;
    }

    if (criterion === 'name') {
      const first = normalizeText(fileName).charAt(0).toUpperCase();
      if (first >= 'A' && first <= 'Z') return `Nome/${first}`;
      if (first >= '0' && first <= '9') return 'Nome/0-9';
      return 'Nome/Outros';
    }

    if (criterion === 'size') {
      const sz = stat.size || 0;
      if (sz < 100 * 1024) return 'Tamanho/Pequenos (ate 100 KB)';
      if (sz <= 10 * 1024 * 1024) return 'Tamanho/Medios (100 KB - 10 MB)';
      return 'Tamanho/Grandes (acima de 10 MB)';
    }

    // Padrao: 'type' (dicionario de extensoes estilo Arquithon)
    if (!extRaw) return 'outros/sem_extensao';
    if (EXT_GROUPS[extRaw]) return EXT_GROUPS[extRaw];
    const safeExt = extRaw.replace(/[^a-z0-9_-]/g, '') || 'desconhecido';
    return `outros/${safeExt}`;
  }

  getUniqueDestPath(destDir, originalName) {
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext);
    let candidate = path.join(destDir, originalName);
    let counter = 2;
    let renamed = false;

    while (fs.existsSync(candidate)) {
      renamed = true;
      candidate = path.join(destDir, `${base} (${counter})${ext}`);
      counter++;
    }
    return {
      destPath: candidate,
      finalName: path.basename(candidate),
      renamed
    };
  }

  copyOrMoveFile(srcPath, destPath, moveInsteadOfCopy) {
    if (!moveInsteadOfCopy) {
      fs.copyFileSync(srcPath, destPath);
      return;
    }
    try {
      fs.renameSync(srcPath, destPath);
    } catch (_) {
      fs.copyFileSync(srcPath, destPath);
      fs.unlinkSync(srcPath);
    }
  }

  loadUndoState() {
    try {
      if (fs.existsSync(this.undoFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.undoFilePath, 'utf8'));
        if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
          return parsed;
        }
      }
    } catch (_) {}
    return null;
  }

  saveUndoState(batch) {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      if (!batch) {
        if (fs.existsSync(this.undoFilePath)) fs.unlinkSync(this.undoFilePath);
      } else {
        fs.writeFileSync(this.undoFilePath, JSON.stringify(batch, null, 2), 'utf8');
      }
    } catch (_) {}
  }

  getUndoInfo() {
    const batch = this.loadUndoState();
    if (!batch) return { available: false };
    return {
      available: true,
      batchId: batch.id,
      count: batch.items.length,
      moved: Boolean(batch.moveInsteadOfCopy),
      createdAt: batch.createdAt
    };
  }

  organizePaths({ paths = [], criterion = 'type', moveInsteadOfCopy = false, targetScope = 'arquivos', onProgress } = {}) {
    if (!Array.isArray(paths) || paths.length === 0) {
      return { ok: false, error: 'Nenhum arquivo ou pasta selecionado.' };
    }

    let files = [];
    try {
      files = this.collectFiles(paths);
    } catch (err) {
      return { ok: false, error: err.message };
    }

    if (files.length === 0) {
      return { ok: false, error: 'Nenhum arquivo encontrado nos caminhos informados.' };
    }

    const baseTargetDir = this.ensureScopeDir(targetScope);
    const results = [];
    const undoItems = [];
    const errors = [];

    for (let i = 0; i < files.length; i++) {
      const { filePath, stat } = files[i];
      const origName = path.basename(filePath);

      if (typeof onProgress === 'function') {
        onProgress({ current: i + 1, total: files.length, fileName: origName });
      }

      // Se o arquivo ja esta dentro da propria subpasta de destino exata, pula com seguranca
      if (path.dirname(filePath).toLowerCase().startsWith(baseTargetDir.toLowerCase() + path.sep) && moveInsteadOfCopy) {
        // Permite reorganizar de dentro da pasta se for criterio diferente, mas evita sobrescrever
      }

      const category = this.resolveCategory(filePath, stat, criterion);
      const destDir = path.join(baseTargetDir, ...category.split('/'));
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const { destPath, finalName, renamed } = this.getUniqueDestPath(destDir, origName);

      try {
        if (path.resolve(filePath) === path.resolve(destPath)) {
          continue;
        }
        this.copyOrMoveFile(filePath, destPath, Boolean(moveInsteadOfCopy));
        const relPath = path.relative(baseTargetDir, destPath).replace(/\\/g, '/');

        results.push({
          originalName: origName,
          finalName,
          renamedAs: renamed ? finalName : '',
          category,
          relPath,
          destPath,
          sourcePath: filePath,
          moved: Boolean(moveInsteadOfCopy),
          size: stat.size,
          sizeFormatted: formatBytes(stat.size)
        });

        undoItems.push({
          src: filePath,
          dest: destPath,
          moved: Boolean(moveInsteadOfCopy)
        });
      } catch (err) {
        errors.push({ fileName: origName, error: err.message });
      }
    }

    const batchId = `batch-${Date.now()}`;
    if (undoItems.length > 0) {
      this.saveUndoState({
        id: batchId,
        createdAt: new Date().toISOString(),
        targetScope,
        moveInsteadOfCopy: Boolean(moveInsteadOfCopy),
        items: undoItems
      });
    }

    this.invalidateCache(targetScope);

    return {
      ok: true,
      batchId,
      targetScope,
      baseTargetDir,
      criterion,
      moved: Boolean(moveInsteadOfCopy),
      organizedCount: results.length,
      results,
      errors,
      undoAvailable: undoItems.length > 0
    };
  }

  removeEmptyParents(dirPath, stopAtDir) {
    let current = path.resolve(dirPath);
    const stop = path.resolve(stopAtDir);
    while (current !== stop && current.toLowerCase().startsWith(stop.toLowerCase() + path.sep)) {
      try {
        const entries = fs.readdirSync(current);
        if (entries.length === 0) {
          fs.rmdirSync(current);
          current = path.dirname(current);
        } else {
          break;
        }
      } catch (_) {
        break;
      }
    }
  }

  revertLastBatch() {
    const batch = this.loadUndoState();
    if (!batch || !Array.isArray(batch.items) || batch.items.length === 0) {
      return { ok: false, error: 'Nenhuma organizacao recente para desfazer.' };
    }

    const baseTargetDir = this.getScopeDir(batch.targetScope || 'arquivos');
    let revertedCount = 0;
    const errors = [];

    for (let i = batch.items.length - 1; i >= 0; i--) {
      const item = batch.items[i];
      try {
        if (!fs.existsSync(item.dest)) continue;
        if (item.moved) {
          const srcDir = path.dirname(item.src);
          if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });
          let restorePath = item.src;
          if (fs.existsSync(restorePath)) {
            const unique = this.getUniqueDestPath(srcDir, path.basename(item.src));
            restorePath = unique.destPath;
          }
          this.copyOrMoveFile(item.dest, restorePath, true);
        } else {
          fs.unlinkSync(item.dest);
        }
        this.removeEmptyParents(path.dirname(item.dest), baseTargetDir);
        revertedCount++;
      } catch (err) {
        errors.push({ dest: item.dest, error: err.message });
      }
    }

    this.saveUndoState(null);
    this.invalidateCache(batch.targetScope || 'arquivos');

    return {
      ok: true,
      revertedCount,
      errors,
      undoAvailable: false
    };
  }

  scanScope(scope = 'arquivos', { forceRefresh = false } = {}) {
    const cacheKey = String(scope || 'arquivos').toLowerCase();
    const cached = !forceRefresh && this._scanCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < 5000) {
      return cached.data;
    }
    const baseDir = this.ensureScopeDir(scope);
    const files = [];

    const walk = (dir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          try {
            const st = fs.statSync(fullPath);
            const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
            const parts = relPath.split('/');
            const category = parts.length > 1 ? parts.slice(0, -1).join('/') : 'Raiz';
            const ext = path.extname(entry.name).toLowerCase();
            files.push({
              name: entry.name,
              relPath,
              fullPath,
              category,
              ext,
              isText: TEXT_EXTENSIONS.has(ext),
              size: st.size,
              sizeFormatted: formatBytes(st.size),
              mtimeMs: st.mtimeMs,
              mtimeFormatted: formatDateBr(st.mtimeMs),
              nameNorm: normalizeText(entry.name),
              catNorm: normalizeText(category),
              relNorm: normalizeText(relPath)
            });
          } catch (_) {}
        }
      }
    };

    walk(baseDir);

    // Agrupa por categoria para renderizacao em arvore
    const categoryMap = new Map();
    for (const f of files) {
      if (!categoryMap.has(f.category)) {
        categoryMap.set(f.category, []);
      }
      categoryMap.get(f.category).push(f);
    }

    const categories = Array.from(categoryMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
      .map(([name, items]) => ({
        name,
        count: items.length,
        totalSize: items.reduce((acc, it) => acc + it.size, 0),
        totalSizeFormatted: formatBytes(items.reduce((acc, it) => acc + it.size, 0)),
        files: items.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      }));

    const result = {
      ok: true,
      scope,
      baseDir,
      totalFiles: files.length,
      categories,
      files
    };

    this._scanCache.set(cacheKey, { ts: Date.now(), data: result });
    return result;
  }

  searchScope({ scope = 'arquivos', query = '', searchInContent = true } = {}) {
    const scan = this.scanScope(scope);
    const qRaw = String(query || '').trim();
    if (!qRaw) {
      return Object.assign({}, scan, { query: '', searchResults: null });
    }

    const qNorm = normalizeText(qRaw);
    const tokens = qNorm.split(/\s+/).filter(Boolean);
    const matches = [];

    for (const f of scan.files) {
      const nameNorm = f.nameNorm || normalizeText(f.name);
      const catNorm = f.catNorm || normalizeText(f.category);
      const relNorm = f.relNorm || normalizeText(f.relPath);

      const allInName = tokens.every((t) => nameNorm.includes(t));
      if (allInName) {
        matches.push(Object.assign({}, f, { matchType: 'name', priority: 3, snippet: '' }));
        continue;
      }

      const allInFolder = tokens.every((t) => catNorm.includes(t) || relNorm.includes(t));
      if (allInFolder) {
        matches.push(Object.assign({}, f, { matchType: 'folder', priority: 2, snippet: '' }));
        continue;
      }

      if (searchInContent && f.isText && f.size <= 512 * 1024) {
        const contentData = this._readNormalizedContent(f);
        if (contentData) {
          const { rawContent, normContent } = contentData;
          const firstIdx = normContent.indexOf(qNorm);
          const allTokensInContent = firstIdx !== -1 || tokens.every((t) => normContent.includes(t));

          if (allTokensInContent) {
            const hitPos = firstIdx !== -1 ? firstIdx : normContent.indexOf(tokens[0]);
            const start = Math.max(0, hitPos - 35);
            const snippet = rawContent
              .slice(start, start + 140)
              .replace(/\s+/g, ' ')
              .trim();
            matches.push(Object.assign({}, f, { matchType: 'content', priority: 1, snippet }));
          }
        }
      }
    }

    // Ordenacao rigorosa: Nome > Pasta > Conteudo
    matches.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.name.localeCompare(b.name, 'pt-BR');
    });

    return {
      ok: true,
      scope,
      baseDir: scan.baseDir,
      totalFiles: scan.totalFiles,
      query: qRaw,
      searchResults: matches
    };
  }

  deleteOrganizedFile({ scope = 'arquivos', relPath = '' } = {}) {
    if (!relPath) return { ok: false, error: 'Caminho invalido.' };
    const baseDir = this.getScopeDir(scope);
    const fullPath = path.resolve(baseDir, relPath);

    if (!fullPath.toLowerCase().startsWith(baseDir.toLowerCase() + path.sep)) {
      return { ok: false, error: 'Operacao bloqueada: fora da pasta permitida.' };
    }
    if (!fs.existsSync(fullPath)) {
      return { ok: false, error: 'Arquivo nao encontrado.' };
    }
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      return { ok: false, error: 'Somente arquivos individuais podem ser excluidos.' };
    }

    fs.unlinkSync(fullPath);
    this._contentCache.delete(fullPath);
    this.invalidateCache(scope);
    this.removeEmptyParents(path.dirname(fullPath), baseDir);
    return { ok: true, deleted: relPath };
  }

  openInExplorer({ scope = 'arquivos', relPath = '', select = false } = {}) {
    const baseDir = this.ensureScopeDir(scope);
    if (!relPath) {
      shell.openPath(baseDir);
      return { ok: true, path: baseDir };
    }
    const fullPath = path.resolve(baseDir, relPath);
    if (!fullPath.toLowerCase().startsWith(baseDir.toLowerCase() + path.sep) && fullPath.toLowerCase() !== baseDir.toLowerCase()) {
      return { ok: false, error: 'Caminho fora da pasta permitida.' };
    }
    if (!fs.existsSync(fullPath)) {
      shell.openPath(baseDir);
      return { ok: true, path: baseDir };
    }
    if (select) {
      shell.showItemInFolder(fullPath);
    } else {
      shell.openPath(fullPath);
    }
    return { ok: true, path: fullPath };
  }
}

FileOrganizer.EXT_GROUPS = EXT_GROUPS;
module.exports = FileOrganizer;
