const fs = require('fs');
const path = require('path');

/**
 * Memoria persistente da I.A local do M.P.E
 * - facts: fatos que o usuario pediu para lembrar (/lembrar)
 * - examples: pares pergunta => resposta usados como treinamento few-shot (/treinar)
 * - params: parametros de geracao ajustaveis (/param)
 * - history: ultimas mensagens da conversa (contexto curto)
 * Arquivo: data/ai-memory.json
 */
const DEFAULT_PARAMS = {
  temperatura: 0.4,
  tokens: 700,
  historico: 6,
  persona: '',
  linguagem: 'JavaScript',
  obsidian: 'on'
};

const PARAM_INFO = {
  temperatura: 'Criatividade de 0 a 1.5 (baixo = preciso)',
  tokens: 'Tamanho maximo da resposta (64 a 4096)',
  historico: 'Quantas trocas anteriores a I.A considera (0 a 20)',
  persona: 'Instrucao fixa de comportamento',
  linguagem: 'Linguagem padrao para /codigo',
  obsidian: 'on/off - usar notas do Obsidian como contexto'
};

class AiMemory {
  constructor(codeDir) {
    this.dataDir = path.join(codeDir, 'data');
    this.filePath = path.join(this.dataDir, 'ai-memory.json');
    this.state = null;
  }

  load() {
    if (this.state) return this.state;
    let data = {};
    try {
      if (fs.existsSync(this.filePath)) {
        data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch (err) {
      console.warn('[AiMemory] Falha ao ler memoria, iniciando vazia:', err.message);
    }
    this.state = {
      facts: Array.isArray(data.facts) ? data.facts : [],
      examples: Array.isArray(data.examples) ? data.examples : [],
      params: Object.assign({}, DEFAULT_PARAMS, data.params || {}),
      history: Array.isArray(data.history) ? data.history : []
    };
    return this.state;
  }

  save() {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.warn('[AiMemory] Falha ao gravar memoria:', err.message);
    }
  }

  // ---------- Fatos ----------
  addFact(text) {
    const s = this.load();
    const clean = String(text || '').trim();
    if (!clean) return null;
    s.facts.push({ text: clean, date: new Date().toISOString() });
    this.save();
    return s.facts.length;
  }

  removeFact(indexOrAll) {
    const s = this.load();
    if (indexOrAll === 'tudo') {
      const n = s.facts.length;
      s.facts = [];
      this.save();
      return n;
    }
    const i = parseInt(indexOrAll, 10) - 1;
    if (Number.isNaN(i) || i < 0 || i >= s.facts.length) return 0;
    s.facts.splice(i, 1);
    this.save();
    return 1;
  }

  // ---------- Exemplos (treinamento) ----------
  addExample(question, answer) {
    const s = this.load();
    s.examples.push({ q: String(question).trim(), a: String(answer).trim(), date: new Date().toISOString() });
    this.save();
    return s.examples.length;
  }

  removeExample(indexOrAll) {
    const s = this.load();
    if (indexOrAll === 'tudo') {
      const n = s.examples.length;
      s.examples = [];
      this.save();
      return n;
    }
    const i = parseInt(indexOrAll, 10) - 1;
    if (Number.isNaN(i) || i < 0 || i >= s.examples.length) return 0;
    s.examples.splice(i, 1);
    this.save();
    return 1;
  }

  // ---------- Parametros ----------
  setParam(name, rawValue) {
    const s = this.load();
    const key = String(name || '').toLowerCase().trim();
    if (!(key in DEFAULT_PARAMS)) {
      return { ok: false, error: `Parametro desconhecido: ${key}` };
    }
    let value = String(rawValue == null ? '' : rawValue).trim();
    if (key === 'temperatura') {
      const v = parseFloat(value.replace(',', '.'));
      if (Number.isNaN(v) || v < 0 || v > 1.5) return { ok: false, error: 'Use um valor entre 0 e 1.5' };
      value = v;
    } else if (key === 'tokens') {
      const v = parseInt(value, 10);
      if (Number.isNaN(v) || v < 64 || v > 4096) return { ok: false, error: 'Use um valor entre 64 e 4096' };
      value = v;
    } else if (key === 'historico') {
      const v = parseInt(value, 10);
      if (Number.isNaN(v) || v < 0 || v > 20) return { ok: false, error: 'Use um valor entre 0 e 20' };
      value = v;
    } else if (key === 'obsidian') {
      value = /^(on|sim|1|true|ligado)$/i.test(value) ? 'on' : 'off';
    }
    s.params[key] = value;
    this.save();
    return { ok: true, key, value };
  }

  resetParams() {
    const s = this.load();
    s.params = Object.assign({}, DEFAULT_PARAMS);
    this.save();
  }

  // ---------- Historico ----------
  pushHistory(role, content) {
    const s = this.load();
    s.history.push({ role, content: String(content || '').slice(0, 4000) });
    if (s.history.length > 40) s.history = s.history.slice(-40);
    this.save();
  }

  recentHistory(turns) {
    const s = this.load();
    const n = Math.max(0, turns) * 2;
    return n ? s.history.slice(-n) : [];
  }

  clearHistory() {
    const s = this.load();
    s.history = [];
    this.save();
  }
}

AiMemory.DEFAULT_PARAMS = DEFAULT_PARAMS;
AiMemory.PARAM_INFO = PARAM_INFO;

module.exports = AiMemory;
