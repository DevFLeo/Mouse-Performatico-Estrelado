const fs = require('fs');
const path = require('path');

/**
 * Indice simples de notas do Obsidian para alimentar a I.A local (RAG por palavras-chave).
 * Sem dependencias: varre o cofre, pontua notas pela sobreposicao de termos e devolve trechos.
 */
const STOPWORDS = new Set(
  ('a o e de da do das dos em no na nos nas um uma uns umas para por com sem que se ao aos ' +
    'como mais mas ou ser ter esta este isso isto essa esse sua seu suas seus meu minha nao sim ' +
    'the and for with from this that are you your qual quais quando onde porque pra pro faca fazer ' +
    'crie criar escreva escrever funcao codigo uma preciso quero me te lhe')
    .split(/\s+/)
);

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokenize(str) {
  return normalize(str)
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

class ObsidianIndex {
  constructor() {
    this.vaultPath = null;
    this.notes = [];
    this.builtAt = 0;
  }

  build(vaultPath) {
    const now = Date.now();
    if (this.vaultPath === vaultPath && now - this.builtAt < 60000) return this.notes;

    const notes = [];
    const walk = (dir, depth) => {
      if (depth > 8 || notes.length >= 3000) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full, depth + 1);
        } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          try {
            const stat = fs.statSync(full);
            if (stat.size > 512 * 1024) continue;
            const content = fs.readFileSync(full, 'utf8').slice(0, 40000);
            const title = e.name.replace(/\.md$/i, '');
            notes.push({
              title,
              rel: path.relative(vaultPath, full),
              content,
              norm: normalize(content),
              normTitle: normalize(title)
            });
          } catch (_) {}
        }
      }
    };

    if (vaultPath && fs.existsSync(vaultPath)) walk(vaultPath, 0);
    this.vaultPath = vaultPath;
    this.notes = notes;
    this.builtAt = now;
    return notes;
  }

  invalidate() {
    this.builtAt = 0;
  }

  search(vaultPath, query, limit = 3, snippetSize = 700) {
    const notes = this.build(vaultPath);
    const terms = Array.from(new Set(tokenize(query)));
    if (!terms.length || !notes.length) return [];

    const scored = [];
    for (const n of notes) {
      let score = 0;
      let firstHit = -1;
      for (const t of terms) {
        if (n.normTitle.includes(t)) score += 5;
        let idx = n.norm.indexOf(t);
        let count = 0;
        while (idx !== -1 && count < 12) {
          if (firstHit === -1 || idx < firstHit) firstHit = idx;
          count++;
          idx = n.norm.indexOf(t, idx + t.length);
        }
        score += count;
      }
      if (score > 0) scored.push({ n, score, firstHit });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ n, score, firstHit }) => {
      const start = Math.max(0, (firstHit === -1 ? 0 : firstHit) - Math.floor(snippetSize / 4));
      const snippet = n.content.slice(start, start + snippetSize).trim();
      return { title: n.title, rel: n.rel, score, snippet };
    });
  }

  count(vaultPath) {
    return this.build(vaultPath).length;
  }
}

ObsidianIndex.tokenize = tokenize;
ObsidianIndex.normalize = normalize;

module.exports = ObsidianIndex;
