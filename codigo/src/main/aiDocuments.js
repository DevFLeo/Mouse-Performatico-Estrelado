const fs = require('fs');
const path = require('path');
const ObsidianIndex = require('./obsidianIndex');

/**
 * Gerenciador de Documentos Organizados & Parser Financeiro Offline (AI Kataros - M.P.E)
 * - Organiza documentos fisicamente em: <documentsFolder>/<Categoria>/<YYYY-MM>/<arquivo>
 * - Mantem indice pesquisavel em data/ai-documents.json
 * - Extrai saldos, entradas, saidas e lancamentos de arquivos .OFX, .CSV, .TXT, .MD, .JSON, .LOG
 */

const CATEGORIES = ['Extratos', 'Recibos', 'Comprovantes', 'Contratos', 'Financeiro', 'Geral'];

function sanitizeName(str, fallback = 'Documento') {
  const cleaned = String(str || '')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, 80) : fallback;
}

function sanitizeSegment(str, fallback = 'Geral') {
  const cleaned = String(str || '')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned ? cleaned.slice(0, 40) : fallback;
}

function parseBrMoney(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  let s = String(raw || '').trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/[-−]\s*/.test(s) || /\b[dD]\b\s*$/.test(s)) {
    negative = true;
  }
  s = s.replace(/R\$/gi, '').replace(/[^\d.,]/g, '');
  if (!s) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let numStr = s;
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      // Padrao BR: 1.234,56
      numStr = s.replace(/\./g, '').replace(',', '.');
    } else {
      // Padrao US: 1,234.56
      numStr = s.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const decimals = s.length - lastComma - 1;
    if (decimals <= 2) {
      numStr = s.replace(',', '.');
    } else {
      numStr = s.replace(/,/g, '');
    }
  } else if (lastDot > -1) {
    const parts = s.split('.');
    if (parts.length > 2) {
      numStr = s.replace(/\./g, '');
    }
  }

  const val = parseFloat(numStr);
  if (!Number.isFinite(val)) return null;
  return negative ? -Math.abs(val) : val;
}

function formatBRL(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/D';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value).toFixed(2);
  const [intPart, decPart] = abs.split('.');
  const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}R$ ${withDots},${decPart}`;
}

function formatOfxDate(raw) {
  const m = String(raw || '').match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return String(raw || '').trim();
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function detectCategory(title = '', text = '', ext = '') {
  const sample = ObsidianIndex.normalize(`${title} ${text.slice(0, 1500)} ${ext}`);
  if (/\b(ofx|qfx)\b/.test(sample) || /(extrato|saldo|lancamento|agencia|conta corrente|ledgerbal|stmttrn)/.test(sample)) {
    return 'Extratos';
  }
  if (/(comprovante|pix|ted|doc|transferencia|autenticacao)/.test(sample)) {
    return 'Comprovantes';
  }
  if (/(recibo|pagamento|pago|valor recebido|quitacao)/.test(sample)) {
    return 'Recibos';
  }
  if (/(contrato|clausula|assinatura|locacao|prestacao)/.test(sample)) {
    return 'Contratos';
  }
  if (/(boleto|fatura|nota fiscal|nf-e|nfe|vencimento|imposto|darf)/.test(sample)) {
    return 'Financeiro';
  }
  return 'Geral';
}

function readTextSmart(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    // Extrator leve sem dependencias: coleta literais de texto PDF legiveis quando nao comprimidos
    const latin = buf.toString('latin1');
    const chunks = [];
    const rx = /\(([^()\\]{3,200})\)/g;
    let m;
    while ((m = rx.exec(latin)) !== null && chunks.length < 400) {
      const cleaned = m[1].replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').trim();
      if (cleaned.length >= 3 && /[a-zA-Z0-9]/.test(cleaned)) {
        chunks.push(cleaned);
      }
    }
    if (chunks.length > 0) {
      return chunks.join('\n').slice(0, 80000);
    }
    return '';
  }

  let utf8 = buf.toString('utf8');
  if (utf8.includes('\uFFFD')) {
    utf8 = buf.toString('latin1');
  }
  if (ext === '.html' || ext === '.htm') {
    utf8 = utf8
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ');
  }
  return utf8.slice(0, 120000);
}

function parseOfxDocument(text) {
  const bankMatch = text.match(/<BANKID>([^<\r\n]+)/i);
  const acctMatch = text.match(/<ACCTID>([^<\r\n]+)/i);
  const dtStart = text.match(/<DTSTART>([^<\r\n]+)/i);
  const dtEnd = text.match(/<DTEND>([^<\r\n]+)/i);

  const ledgerBlock = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)/i);
  const availBlock = text.match(/<AVAILBAL>[\s\S]*?<BALAMT>([^<\r\n]+)/i);
  const balAmtRaw = (availBlock && availBlock[1]) || (ledgerBlock && ledgerBlock[1]) || null;
  const balDateMatch = text.match(/<(?:LEDGERBAL|AVAILBAL)>[\s\S]*?<DTASOF>([^<\r\n]+)/i);

  const balance = balAmtRaw ? parseFloat(String(balAmtRaw).replace(',', '.').trim()) : null;
  const entries = [];
  let totalCredits = 0;
  let totalDebits = 0;

  const trnRx = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>))/gi;
  let m;
  while ((m = trnRx.exec(text)) !== null) {
    const block = m[1];
    const amtM = block.match(/<TRNAMT>([^<\r\n]+)/i);
    if (!amtM) continue;
    const amount = parseFloat(String(amtM[1]).replace(',', '.').trim());
    if (!Number.isFinite(amount)) continue;

    const dateM = block.match(/<DTPOSTED>([^<\r\n]+)/i);
    const memoM = block.match(/<MEMO>([^<\r\n]+)/i);
    const nameM = block.match(/<NAME>([^<\r\n]+)/i);
    const typeM = block.match(/<TRNTYPE>([^<\r\n]+)/i);

    const desc = ((memoM && memoM[1]) || (nameM && nameM[1]) || (typeM && typeM[1]) || 'Lancamento').trim();
    const date = dateM ? formatOfxDate(dateM[1]) : '';
    if (amount >= 0) totalCredits += amount;
    else totalDebits += Math.abs(amount);

    entries.push({ date, description: desc, amount });
  }

  return {
    isFinancial: entries.length > 0 || balance !== null,
    kind: 'extrato_ofx',
    accountInfo: [
      bankMatch ? `Banco ${bankMatch[1].trim()}` : '',
      acctMatch ? `Conta ${acctMatch[1].trim()}` : '',
      dtStart && dtEnd ? `Periodo ${formatOfxDate(dtStart[1])} a ${formatOfxDate(dtEnd[1])}` : ''
    ]
      .filter(Boolean)
      .join(' | '),
    balance: Number.isFinite(balance) ? balance : null,
    balanceDate: balDateMatch ? formatOfxDate(balDateMatch[1]) : '',
    totalCredits,
    totalDebits,
    entryCount: entries.length,
    entries: entries.slice(0, 120)
  };
}

function parseCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseCsvDocument(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const first = lines[0];
  const semiCount = (first.match(/;/g) || []).length;
  const commaCount = (first.match(/,/g) || []).length;
  const tabCount = (first.match(/\t/g) || []).length;
  const sep = semiCount >= commaCount && semiCount >= tabCount && semiCount > 0
    ? ';'
    : tabCount > commaCount && tabCount > 0
    ? '\t'
    : ',';

  let headerIdx = 0;
  let headers = [];
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const cols = parseCsvLine(lines[i], sep).map((c) => ObsidianIndex.normalize(c));
    if (cols.some((c) => /(data|valor|credito|debito|saldo|descricao|historico|lancamento|titulo)/.test(c))) {
      headerIdx = i;
      headers = cols;
      break;
    }
  }
  if (!headers.length) {
    headers = parseCsvLine(lines[0], sep).map((c) => ObsidianIndex.normalize(c));
  }

  const idxDate = headers.findIndex((h) => /\bdata\b|dt|vencimento/.test(h));
  const idxDesc = headers.findIndex((h) => /(desc|hist|lanc|memo|titulo|estab|favorecid|pagador)/.test(h));
  const idxVal = headers.findIndex((h) => /^(valor|quantia|montante|total|amount)/.test(h) || /\bvalor\b/.test(h));
  const idxCred = headers.findIndex((h) => /cred|entrad/.test(h));
  const idxDeb = headers.findIndex((h) => /deb|said/.test(h));
  const idxBal = headers.findIndex((h) => /saldo/.test(h));

  const entries = [];
  let totalCredits = 0;
  let totalDebits = 0;
  let lastBalance = null;
  let lastBalanceDate = '';

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], sep);
    if (cols.length < 2) continue;

    const date = idxDate >= 0 ? cols[idxDate] || '' : (cols[0].match(/\d{2}\/\d{2}\/\d{2,4}/) ? cols[0] : '');
    let desc = idxDesc >= 0 ? cols[idxDesc] || '' : '';
    if (!desc) {
      desc = cols.find((c, idx) => idx !== idxDate && idx !== idxVal && idx !== idxBal && /[a-zA-Z]/.test(c)) || 'Lancamento';
    }

    let amount = null;
    if (idxVal >= 0 && cols[idxVal]) {
      amount = parseBrMoney(cols[idxVal]);
    } else if (idxCred >= 0 || idxDeb >= 0) {
      const c = idxCred >= 0 ? parseBrMoney(cols[idxCred]) : null;
      const d = idxDeb >= 0 ? parseBrMoney(cols[idxDeb]) : null;
      if (c && c !== 0) amount = Math.abs(c);
      else if (d && d !== 0) amount = -Math.abs(d);
    } else {
      for (let j = cols.length - 1; j >= 0; j--) {
        if (j === idxDate) continue;
        const parsed = parseBrMoney(cols[j]);
        if (parsed !== null && /[\d.,]/.test(cols[j]) && /[.,]\d{2}/.test(cols[j])) {
          amount = parsed;
          break;
        }
      }
    }

    if (idxBal >= 0 && cols[idxBal]) {
      const b = parseBrMoney(cols[idxBal]);
      if (b !== null) {
        lastBalance = b;
        lastBalanceDate = date;
      }
    }

    const descNorm = ObsidianIndex.normalize(desc);
    if (/saldo/.test(descNorm) && amount !== null && entries.length > 0) {
      lastBalance = amount;
      lastBalanceDate = date;
      continue;
    }

    if (amount !== null) {
      if (amount >= 0) totalCredits += amount;
      else totalDebits += Math.abs(amount);
      entries.push({ date, description: desc, amount });
    }
  }

  // Verifica se existe linha de "Saldo" fora das colunas
  if (lastBalance === null) {
    const balLine = lines.find((l) => /saldo\s*(atual|disponivel|final)?/i.test(l));
    if (balLine) {
      const m = balLine.match(/(-?\s*(?:R\$\s*)?[\d.]*,\d{2})/);
      if (m) lastBalance = parseBrMoney(m[1]);
    }
  }

  if (!entries.length && lastBalance === null) return null;

  return {
    isFinancial: true,
    kind: 'extrato_csv',
    accountInfo: '',
    balance: lastBalance,
    balanceDate: lastBalanceDate,
    totalCredits,
    totalDebits,
    entryCount: entries.length,
    entries: entries.slice(0, 120)
  };
}

function parseFreeTextFinancial(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let balance = null;
  let balanceDate = '';
  let totalCredits = 0;
  let totalDebits = 0;
  const entries = [];

  // 1. Procura saldo explicito
  const balancePatterns = [
    /saldo\s*(?:atual|disponivel|em conta|final|total|contabil)?\s*[:\-=]?\s*(?:R\$\s*)?(-?\s*(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})/i,
    /saldo\s*(?:atual|disponivel|em conta|final|total)?\s*[:\-=]?\s*(?:R\$\s*)?(-?\s*\d+\.\d{2})/i
  ];
  for (const line of lines) {
    for (const rx of balancePatterns) {
      const m = line.match(rx);
      if (m) {
        const parsed = parseBrMoney(m[1]);
        if (parsed !== null) {
          balance = parsed;
          const dm = line.match(/\b(\d{2}\/\d{2}(?:\/\d{2,4})?)\b/);
          if (dm) balanceDate = dm[1];
          break;
        }
      }
    }
  }

  // 2. Procura linhas de lancamento ou recibo com valores
  for (const line of lines) {
    const norm = ObsidianIndex.normalize(line);
    if (/saldo\s*(atual|disponivel|anterior|final|em conta)/.test(norm)) continue;

    const moneyMatch = line.match(/([+-]?\s*R\$\s*(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}|[+-]\s*(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}|\b(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}\s*[CDcd]?\b)/);
    if (!moneyMatch) continue;

    let val = parseBrMoney(moneyMatch[1]);
    if (val === null) continue;

    // Heuristica de sinal quando o extrato/recibo nao traz sinal '-'
    if (val > 0 && !moneyMatch[1].includes('+')) {
      if (/\b(debito|saida|pago|pagamento|compra|tarifa|saque|enviado|envio|transferencia enviada|boleto)\b/.test(norm)) {
        val = -Math.abs(val);
      }
    }

    const dm = line.match(/\b(\d{2}\/\d{2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})\b/);
    const date = dm ? dm[1] : '';
    const desc = line
      .replace(moneyMatch[0], '')
      .replace(date, '')
      .replace(/^[\s\-|:]+|[\s\-|:]+$/g, '')
      .trim() || 'Registro financeiro';

    if (val >= 0) totalCredits += val;
    else totalDebits += Math.abs(val);

    entries.push({ date, description: desc.slice(0, 90), amount: val });
  }

  if (balance === null && entries.length === 0) {
    return { isFinancial: false };
  }

  const normAll = ObsidianIndex.normalize(text.slice(0, 1500));
  const kind = /(recibo|comprovante|pix)/.test(normAll) ? 'recibo_comprovante' : 'extrato_texto';

  return {
    isFinancial: true,
    kind,
    accountInfo: '',
    balance,
    balanceDate,
    totalCredits,
    totalDebits,
    entryCount: entries.length,
    entries: entries.slice(0, 80)
  };
}

function parseFinancialDocument(text, ext = '', fileName = '') {
  const cleanText = String(text || '');
  if (!cleanText.trim()) return { isFinancial: false };

  const lowerExt = String(ext || '').toLowerCase();
  if (lowerExt === '.ofx' || lowerExt === '.qfx' || /<OFX>|<STMTTRN>/i.test(cleanText)) {
    return parseOfxDocument(cleanText);
  }
  if (lowerExt === '.csv' || lowerExt === '.tsv') {
    const csvRes = parseCsvDocument(cleanText);
    if (csvRes) return csvRes;
  }
  return parseFreeTextFinancial(cleanText, fileName);
}

class AiDocuments {
  constructor(rootDir, configManager, codeDir) {
    this.rootDir = rootDir;
    this.codeDir = codeDir || (configManager && configManager.codeDir) || rootDir;
    this.configManager = configManager;
    this.dataDir = path.join(this.codeDir, 'data');
    this.indexPath = path.join(this.dataDir, 'ai-documents.json');
    this.state = null;
  }

  getDocumentsFolder() {
    const cfg =
      this.configManager && typeof this.configManager.get === 'function'
        ? this.configManager.get()
        : {};
    const raw = (cfg.captures && cfg.captures.documentsFolder) || './arquivos';
    return this.configManager && typeof this.configManager.resolvePath === 'function'
      ? this.configManager.resolvePath(raw)
      : path.resolve(this.rootDir, raw);
  }

  load() {
    if (this.state) return this.state;
    let data = {};
    try {
      if (fs.existsSync(this.indexPath)) {
        data = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      }
    } catch (err) {
      console.warn('[AiDocuments] Falha ao ler indice, iniciando vazio:', err.message);
    }
    this.state = {
      documents: Array.isArray(data.documents) ? data.documents : []
    };
    return this.state;
  }

  saveIndex() {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.indexPath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.warn('[AiDocuments] Falha ao gravar indice de documentos:', err.message);
    }
  }

  list(categoryFilter = '') {
    const docs = this.load().documents;
    if (!categoryFilter) return docs;
    const normCat = ObsidianIndex.normalize(categoryFilter);
    return docs.filter((d) => ObsidianIndex.normalize(d.category) === normCat);
  }

  /**
   * Salva um texto ou arquivo importado na estrutura organizada de documentos
   * e indexa na I.A Local (AI Kataros).
   */
  addDocument({ title, category, text, sourceFilePath, tags = [], linkedImagePath = '' }) {
    const s = this.load();
    const now = new Date();
    const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    let extractedText = String(text || '').trim();
    let ext = '.md';
    let originalBase = '';

    if (sourceFilePath && fs.existsSync(sourceFilePath)) {
      ext = path.extname(sourceFilePath) || '.txt';
      originalBase = path.basename(sourceFilePath, ext);
      const fromFile = readTextSmart(sourceFilePath);
      if (fromFile) {
        extractedText = extractedText ? `${extractedText}\n\n${fromFile}` : fromFile;
      }
    }

    const cleanTitle = sanitizeName(
      title || originalBase || (extractedText.split(/\r?\n/)[0] || '').slice(0, 48) || `Documento_${Date.now()}`
    );
    const chosenCategory = sanitizeSegment(
      category && category !== 'Auto' ? category : detectCategory(cleanTitle, extractedText, ext),
      'Geral'
    );

    const baseDocsDir = this.getDocumentsFolder();
    const targetDir = path.join(baseDocsDir, chosenCategory, monthDir);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    let destPath = '';
    let destFileName = '';

    if (sourceFilePath && fs.existsSync(sourceFilePath)) {
      destFileName = `${cleanTitle}${ext}`;
      destPath = path.join(targetDir, destFileName);
      if (fs.existsSync(destPath) && path.resolve(sourceFilePath) !== path.resolve(destPath)) {
        const hhmmss = now.toTimeString().slice(0, 8).replace(/:/g, '');
        destFileName = `${cleanTitle}_${hhmmss}${ext}`;
        destPath = path.join(targetDir, destFileName);
      }
      if (path.resolve(sourceFilePath) !== path.resolve(destPath)) {
        fs.copyFileSync(sourceFilePath, destPath);
      }
    } else {
      destFileName = `${cleanTitle}.md`;
      destPath = path.join(targetDir, destFileName);
      if (fs.existsSync(destPath)) {
        const hhmmss = now.toTimeString().slice(0, 8).replace(/:/g, '');
        destFileName = `${cleanTitle}_${hhmmss}.md`;
        destPath = path.join(targetDir, destFileName);
      }
      const tagArr = Array.isArray(tags) && tags.length ? tags : [chosenCategory.toLowerCase(), 'mpe'];
      const mdContent = [
        '---',
        `title: "${cleanTitle}"`,
        `category: "${chosenCategory}"`,
        `date: ${now.toISOString()}`,
        linkedImagePath ? `image: "${linkedImagePath.replace(/\\/g, '/')}"` : null,
        `tags: [${tagArr.join(', ')}]`,
        'source: "M.P.E AI Kataros"',
        '---',
        '',
        `# ${cleanTitle}`,
        '',
        extractedText || '(Sem conteudo textual adicional)',
        ''
      ]
        .filter((l) => l !== null)
        .join('\n');
      fs.writeFileSync(destPath, mdContent, 'utf8');
    }

    const parsedFinancial = parseFinancialDocument(extractedText, ext, cleanTitle);
    const relPath = path.relative(baseDocsDir, destPath).replace(/\\/g, '/');

    const docEntry = {
      id: `doc-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      title: cleanTitle,
      category: chosenCategory,
      fileName: destFileName,
      filePath: destPath,
      relPath,
      ext,
      linkedImagePath: linkedImagePath || '',
      createdAt: now.toISOString(),
      textContent: extractedText.slice(0, 50000),
      summary: this.buildDocSummary(cleanTitle, chosenCategory, parsedFinancial, extractedText),
      parsedFinancial
    };

    s.documents.push(docEntry);
    this.saveIndex();

    return {
      ok: true,
      document: docEntry,
      docsDir: baseDocsDir
    };
  }

  buildDocSummary(title, category, fin, text) {
    if (fin && fin.isFinancial) {
      const parts = [`[${category}] ${title}`];
      if (fin.balance !== null && Number.isFinite(fin.balance)) {
        parts.push(`Saldo: ${formatBRL(fin.balance)}`);
      }
      if (fin.entryCount > 0) {
        parts.push(`${fin.entryCount} lancamentos`);
        parts.push(`Entradas: ${formatBRL(fin.totalCredits)}`);
        parts.push(`Saidas: ${formatBRL(fin.totalDebits)}`);
      }
      return parts.join(' | ');
    }
    const snippet = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return `[${category}] ${title}${snippet ? `: ${snippet}` : ''}`;
  }

  removeDocument(idOrIndex) {
    const s = this.load();
    if (idOrIndex === 'tudo') {
      const n = s.documents.length;
      s.documents = [];
      this.saveIndex();
      return n;
    }
    const idx = /^\d+$/.test(String(idOrIndex))
      ? parseInt(idOrIndex, 10) - 1
      : s.documents.findIndex((d) => d.id === idOrIndex);
    if (idx < 0 || idx >= s.documents.length) return 0;
    s.documents.splice(idx, 1);
    this.saveIndex();
    return 1;
  }

  search(query = '', limit = 5, snippetSize = 800) {
    const docs = this.load().documents;
    if (!docs.length) return [];

    const qStr = String(query || '').trim();
    const terms = Array.from(new Set(ObsidianIndex.tokenize(qStr)));
    const financialIntent = /(extrato|saldo|recibo|comprovante|pix|banco|entrada|saida|receita|despesa|pagamento|conta|lancamento|fatura|valor|quanto)/.test(
      ObsidianIndex.normalize(qStr)
    );

    const scored = [];
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      let score = 0;
      let firstHit = -1;
      const normTitle = ObsidianIndex.normalize(d.title);
      const normCat = ObsidianIndex.normalize(d.category);
      const normText = ObsidianIndex.normalize(`${d.title} ${d.category} ${d.relPath} ${d.textContent}`);

      if (!terms.length) {
        score = 1;
      } else {
        for (const t of terms) {
          if (normTitle.includes(t)) score += 6;
          if (normCat.includes(t)) score += 4;
          let idx = normText.indexOf(t);
          let count = 0;
          while (idx !== -1 && count < 10) {
            if (firstHit === -1 || idx < firstHit) firstHit = idx;
            count++;
            idx = normText.indexOf(t, idx + t.length);
          }
          score += count;
        }
      }

      if (financialIntent && d.parsedFinancial && d.parsedFinancial.isFinancial) {
        score += 3;
      }

      if (score > 0) {
        scored.push({ doc: d, score, idx: i, firstHit });
      }
    }

    scored.sort((a, b) => b.score - a.score || b.idx - a.idx);
    return scored.slice(0, limit).map(({ doc, score, firstHit }) => {
      const start = Math.max(0, (firstHit === -1 ? 0 : firstHit) - Math.floor(snippetSize / 4));
      return {
        document: doc,
        score,
        snippet: (doc.textContent || doc.summary || '').slice(start, start + snippetSize).trim()
      };
    });
  }

  formatFinancialReport(doc, mode = 'extrato') {
    const fin = doc.parsedFinancial;
    const lines = [`[${doc.category}] ${doc.title} (${doc.relPath})`];
    if (!fin || !fin.isFinancial) {
      lines.push(doc.summary || (doc.textContent || '').slice(0, 400));
      return lines.join('\n');
    }
    if (fin.accountInfo) lines.push(`Conta/Periodo: ${fin.accountInfo}`);
    if (fin.balance !== null && Number.isFinite(fin.balance)) {
      lines.push(
        `Saldo: ${formatBRL(fin.balance)}${fin.balanceDate ? ` (em ${fin.balanceDate})` : ''}`
      );
    }
    if (fin.entryCount > 0) {
      lines.push(
        `Entradas: ${formatBRL(fin.totalCredits)} | Saidas: ${formatBRL(fin.totalDebits)} | Movimentacao Liquida: ${formatBRL(fin.totalCredits - fin.totalDebits)}`
      );
      if (mode !== 'saldo') {
        const showEntries = fin.entries.slice(0, 12);
        lines.push(`Lancamentos (${fin.entryCount} total, exibindo ${showEntries.length}):`);
        showEntries.forEach((e) => {
          const sign = e.amount >= 0 ? '+' : '';
          lines.push(`- ${e.date ? `[${e.date}] ` : ''}${e.description}: ${sign}${formatBRL(e.amount)}`);
        });
      }
    }
    if (doc.linkedImagePath) {
      lines.push(`Print vinculado: ${doc.linkedImagePath}`);
    }
    return lines.join('\n');
  }
}

AiDocuments.CATEGORIES = CATEGORIES;
AiDocuments.parseFinancialDocument = parseFinancialDocument;
AiDocuments.formatBRL = formatBRL;
AiDocuments.detectCategory = detectCategory;

module.exports = AiDocuments;
