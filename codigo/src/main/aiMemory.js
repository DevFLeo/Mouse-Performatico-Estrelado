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
  temperatura: 0.45,
  top_p: 0.9,
  repeat_penalty: 1.12,
  presence_penalty: 0.1,
  tokens: 1024,
  historico: 10,
  detalhe: 'medio',
  persona: '',
  linguagem: 'JavaScript',
  obsidian: 'on',
  documentos: 'on'
};

const PARAM_INFO = {
  temperatura: 'Criatividade de 0 a 1.5 (padrao 0.45; menor = mais preciso)',
  top_p: 'Amostragem de nucleo de 0.1 a 1.0 (padrao 0.9; controla diversidade)',
  repeat_penalty: 'Penalidade contra repeticoes de 1.0 a 1.6 (padrao 1.12)',
  presence_penalty: 'Incentivo a novos topicos de 0.0 a 1.5 (padrao 0.1)',
  tokens: 'Tamanho maximo da resposta (64 a 4096; padrao 1024)',
  historico: 'Trocas anteriores consideradas no contexto (0 a 20; padrao 10)',
  detalhe: 'Profundidade da resposta: curto | medio | completo',
  persona: 'Instrucao fixa de comportamento',
  linguagem: 'Linguagem padrao para /codigo',
  obsidian: 'on/off - usar notas do Obsidian como contexto',
  documentos: 'on/off - usar documentos de ./arquivos como contexto'
};

const RESPONSE_PRESETS = {
  equilibrado: {
    label: 'Equilibrado',
    params: { temperatura: 0.45, top_p: 0.9, repeat_penalty: 1.12, presence_penalty: 0.1, tokens: 1024, detalhe: 'medio' }
  },
  preciso: {
    label: 'Preciso (Codigo / Revisao / Dados)',
    params: { temperatura: 0.2, top_p: 0.85, repeat_penalty: 1.08, presence_penalty: 0.0, tokens: 1024, detalhe: 'curto' }
  },
  direto: {
    label: 'Direto (Respostas Curtas)',
    params: { temperatura: 0.3, top_p: 0.85, repeat_penalty: 1.1, presence_penalty: 0.0, tokens: 600, detalhe: 'curto' }
  },
  criativo: {
    label: 'Criativo (Ideias / Textos)',
    params: { temperatura: 0.75, top_p: 0.95, repeat_penalty: 1.15, presence_penalty: 0.2, tokens: 1400, detalhe: 'completo' }
  },
  detalhado: {
    label: 'Detalhado (Passo a Passo)',
    params: { temperatura: 0.5, top_p: 0.92, repeat_penalty: 1.12, presence_penalty: 0.15, tokens: 1600, detalhe: 'completo' }
  }
};

const PARAM_ALIASES = {
  temp: 'temperatura',
  criatividade: 'temperatura',
  topp: 'top_p',
  'top-p': 'top_p',
  nucleo: 'top_p',
  repeticao: 'repeat_penalty',
  repeat: 'repeat_penalty',
  'repeat-penalty': 'repeat_penalty',
  presenca: 'presence_penalty',
  presence: 'presence_penalty',
  'presence-penalty': 'presence_penalty',
  token: 'tokens',
  max_tokens: 'tokens',
  maxtokens: 'tokens',
  tamanho: 'tokens',
  history: 'historico',
  turnos: 'historico',
  contexto: 'historico',
  profundidade: 'detalhe',
  detalhes: 'detalhe',
  tamanho_resposta: 'detalhe',
  comportamento: 'persona',
  lang: 'linguagem',
  idioma_codigo: 'linguagem',
  notas: 'obsidian',
  cofre: 'obsidian',
  docs: 'documentos',
  arquivos: 'documentos'
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
    const rawKey = String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    const key = PARAM_ALIASES[rawKey] || rawKey;
    if (!(key in DEFAULT_PARAMS)) {
      const valid = Object.keys(DEFAULT_PARAMS).join(', ');
      return { ok: false, error: `Parametro desconhecido: ${rawKey}. Disponiveis: ${valid}` };
    }
    let value = String(rawValue == null ? '' : rawValue).trim();
    if (key === 'temperatura') {
      const v = parseFloat(value.replace(',', '.'));
      if (Number.isNaN(v) || v < 0 || v > 1.5) return { ok: false, error: 'Use um valor entre 0 e 1.5' };
      value = v;
    } else if (key === 'top_p') {
      const v = parseFloat(value.replace(',', '.'));
      if (Number.isNaN(v) || v < 0.1 || v > 1.0) return { ok: false, error: 'Use um valor entre 0.1 e 1.0' };
      value = v;
    } else if (key === 'repeat_penalty') {
      const v = parseFloat(value.replace(',', '.'));
      if (Number.isNaN(v) || v < 1.0 || v > 1.6) return { ok: false, error: 'Use um valor entre 1.0 e 1.6' };
      value = v;
    } else if (key === 'presence_penalty') {
      const v = parseFloat(value.replace(',', '.'));
      if (Number.isNaN(v) || v < 0 || v > 1.5) return { ok: false, error: 'Use um valor entre 0.0 e 1.5' };
      value = v;
    } else if (key === 'tokens') {
      const v = parseInt(value, 10);
      if (Number.isNaN(v) || v < 64 || v > 4096) return { ok: false, error: 'Use um valor entre 64 e 4096' };
      value = v;
    } else if (key === 'historico') {
      const v = parseInt(value, 10);
      if (Number.isNaN(v) || v < 0 || v > 20) return { ok: false, error: 'Use um valor entre 0 e 20' };
      value = v;
    } else if (key === 'detalhe') {
      const norm = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (/^(curto|curta|breve|resumido|1)$/.test(norm)) value = 'curto';
      else if (/^(medio|media|normal|equilibrado|2)$/.test(norm)) value = 'medio';
      else if (/^(completo|completa|longo|longa|detalhado|detalhada|3)$/.test(norm)) value = 'completo';
      else return { ok: false, error: 'Use: curto, medio ou completo' };
    } else if (key === 'obsidian' || key === 'documentos') {
      if (!value) return { ok: false, error: 'Use on ou off' };
      value = /^(on|sim|1|true|ligado|ativar)$/i.test(value) ? 'on' : 'off';
    }
    s.params[key] = value;
    this.save();
    return { ok: true, key, value };
  }

  applyPreset(presetName) {
    const s = this.load();
    const norm = String(presetName || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    const aliasMap = {
      padrao: 'equilibrado',
      balanced: 'equilibrado',
      normal: 'equilibrado',
      codigo: 'preciso',
      revisao: 'preciso',
      exato: 'preciso',
      curto: 'direto',
      rapido: 'direto',
      conciso: 'direto',
      ideias: 'criativo',
      redacao: 'criativo',
      completo: 'detalhado',
      longo: 'detalhado'
    };
    const key = RESPONSE_PRESETS[norm] ? norm : aliasMap[norm];
    if (!key || !RESPONSE_PRESETS[key]) {
      return {
        ok: false,
        error: `Perfil desconhecido: ${presetName}. Opcoes: ${Object.keys(RESPONSE_PRESETS).join(', ')}`
      };
    }
    const preset = RESPONSE_PRESETS[key];
    Object.assign(s.params, preset.params);
    this.save();
    return { ok: true, preset: key, label: preset.label, params: Object.assign({}, s.params) };
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
AiMemory.RESPONSE_PRESETS = RESPONSE_PRESETS;
AiMemory.PARAM_ALIASES = PARAM_ALIASES;

module.exports = AiMemory;
