'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Preserves M.P.E's 7 geometric/punctuation glyphs (Δ, Π, ϟ, —, •, ←, →) and bare U+00A9/U+00AE without VS16
const EMOJI_REGEX =
  /(?:[\u00A9\u00AE]\uFE0F|(?![\u00A9\u00AE])(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}]|[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}])|[0-9#*]\uFE0F?\u20E3|\uFE0F|\u200D)/gu;

function scanStringForEmojis(text, label = '<string>') {
  const matches = [];
  if (!text) return matches;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    EMOJI_REGEX.lastIndex = 0;
    let m;
    while ((m = EMOJI_REGEX.exec(line)) !== null) {
      const cps = Array.from(m[0]).map((ch) => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
      matches.push({
        file: label,
        line: i + 1,
        col: m.index + 1,
        match: m[0],
        codepoints: cps.join(' ')
      });
    }
  }
  return matches;
}

function walkScanFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const skipDirs = new Set(['node_modules', '.git', 'models', '.cache', 'dist', 'build', 'prints']);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name.toLowerCase())) {
        walkScanFiles(full, out);
      }
    } else if (/\.(js|mjs|cjs|html|css|json|py|cs|ps1|md|txt)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scanDirectoriesForEmojis(dirs = [], extraFiles = []) {
  const files = [...extraFiles.filter((f) => fs.existsSync(f))];
  for (const d of dirs) {
    walkScanFiles(d, files);
  }
  const uniqueFiles = Array.from(new Set(files));
  const violations = [];
  for (const f of uniqueFiles) {
    const raw = fs.readFileSync(f, 'utf8');
    violations.push(...scanStringForEmojis(raw, f));
  }
  return { scannedCount: uniqueFiles.length, violations };
}

function srgbToLinear(c8) {
  const s = c8 / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r, g, b) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function compositeOver(fg, bg) {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a
  };
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = relativeLuminance(rgb2.r, rgb2.g, rgb2.b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function parseCssColor(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = s.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
      return { r, g, b, a };
    }
    if (h.length === 6 || h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (rgb) {
    let a = 1;
    if (rgb[4] !== undefined) {
      a = rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    }
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: Math.max(0, Math.min(1, a))
    };
  }
  return null;
}

function extractGradientColors(bgImage) {
  if (!bgImage || bgImage === 'none') return [];
  const matches = bgImage.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|\btransparent\b/gi) || [];
  return matches.map(parseCssColor).filter(Boolean);
}

function pruneCandidatesPreservingWorstCase(candidates, fg, maxCount = 16) {
  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    const key = `${Math.round(c.r)}:${Math.round(c.g)}:${Math.round(c.b)}:${Math.round(c.a * 1000)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }
  if (unique.length <= maxCount) return unique;

  const picked = new Set();
  const byLum = [...unique].sort(
    (a, b) => relativeLuminance(a.r, a.g, a.b) - relativeLuminance(b.r, b.g, b.b)
  );
  picked.add(byLum[0]);
  picked.add(byLum[byLum.length - 1]);

  const byContrast = [...unique].sort((a, b) => {
    const fa = fg.a < 1 ? compositeOver(fg, a) : fg;
    const fb = fg.a < 1 ? compositeOver(fg, b) : fg;
    return contrastRatio(fa, a) - contrastRatio(fb, b);
  });
  for (let i = 0; i < byContrast.length && picked.size < Math.min(maxCount, 10); i++) {
    picked.add(byContrast[i]);
  }

  for (let k = 1; k < byLum.length - 1 && picked.size < maxCount; k++) {
    const idx = Math.floor((k * (byLum.length - 1)) / (maxCount - 1));
    picked.add(byLum[idx]);
  }
  for (const c of byLum) {
    if (picked.size >= maxCount) break;
    picked.add(c);
  }
  return Array.from(picked);
}

function computeWorstCaseContrast(
  fgStr,
  bgLayers,
  backdrops = [
    { r: 4, g: 4, b: 6, a: 1 },
    { r: 255, g: 255, b: 255, a: 1 }
  ],
  fgOpacity = 1
) {
  const parsedFg = parseCssColor(fgStr);
  if (!parsedFg) return null;
  const op = typeof fgOpacity === 'number' && !Number.isNaN(fgOpacity) ? Math.max(0, Math.min(1, fgOpacity)) : 1;
  const fg = { ...parsedFg, a: parsedFg.a * op };

  // Build candidate opaque background colors by folding layers bottom-up
  let candidates = backdrops.map((b) => ({ ...b }));
  for (let i = bgLayers.length - 1; i >= 0; i--) {
    const layer = bgLayers[i] || {};
    const bgCol = parseCssColor(layer.backgroundColor);
    const afterBgColor =
      bgCol && bgCol.a > 0 ? candidates.map((base) => compositeOver(bgCol, base)) : candidates;

    const gradStops = extractGradientColors(layer.backgroundImage);
    let nextCandidates = afterBgColor;
    if (gradStops.length > 0) {
      nextCandidates = [];
      for (const base of afterBgColor) {
        for (const stop of gradStops) {
          // Preserve a === 0 stops (transparent / rgba(0,0,0,0)) as pass-through over base
          nextCandidates.push(stop.a > 0 ? compositeOver(stop, base) : { ...base });
        }
      }
    }

    candidates = pruneCandidatesPreservingWorstCase(nextCandidates, fg, 16);
  }

  let minRatio = Infinity;
  for (const bg of candidates) {
    const effectiveFg = fg.a < 1 ? compositeOver(fg, bg) : fg;
    const ratio = contrastRatio(effectiveFg, bg);
    if (ratio < minRatio) minRatio = ratio;
  }
  return Number.isFinite(minRatio) ? minRatio : null;
}

// Self-contained DOM collector evaluated inside CDP Runtime.evaluate
function collectVisibleDomTextStyles() {
  const elements = Array.from(document.querySelectorAll('*'));
  const results = [];
  const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION', 'OPTGROUP']);
  for (const el of elements) {
    if (skipTags.has(el.tagName)) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) <= 0.01) {
      continue;
    }
    // Only elements with direct non-whitespace text nodes
    let directText = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) directText += node.nodeValue || '';
    }
    directText = directText.trim();
    if (!directText) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    // Skip hidden off-screen or ancestor-hidden nodes; fold ancestor CSS opacity
    let hiddenAncestor = false;
    let effectiveOpacity = 1;
    let cur = el;
    const bgLayers = [];
    while (cur && cur.nodeType === 1) {
      const cs = getComputedStyle(cur);
      const curOp = parseFloat(cs.opacity);
      if (cs.display === 'none' || cs.visibility === 'hidden' || (!Number.isNaN(curOp) && curOp <= 0.01)) {
        hiddenAncestor = true;
        break;
      }
      if (!Number.isNaN(curOp)) {
        effectiveOpacity *= Math.max(0, Math.min(1, curOp));
      }
      bgLayers.push({
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage
      });
      cur = cur.parentElement;
    }
    if (hiddenAncestor || effectiveOpacity <= 0.01) continue;

    const cls = typeof el.className === 'string' ? el.className : '';
    const isPrimary =
      el.hasAttribute('data-slot-number') ||
      el.hasAttribute('data-slot') ||
      /^H[1-3]$/.test(el.tagName) ||
      cls.includes('hotkey-num') ||
      cls.includes('inspector-code') ||
      cls.includes('inspector-title') ||
      cls.includes('org-cat-name') ||
      cls.includes('org-file-name') ||
      (cls.includes('hud-btn') && cls.includes('primary')) ||
      (cls.includes('workspace-tab') && cls.includes('active')) ||
      (cls.includes('dim-pill') && cls.includes('active'));

    results.push({
      tag: el.tagName,
      id: el.id || '',
      className: cls,
      text: directText.slice(0, 60),
      color: style.color,
      opacity: effectiveOpacity,
      fontSize: parseFloat(style.fontSize) || 0,
      fontWeight: parseInt(style.fontWeight, 10) || 400,
      tier: isPrimary ? 'primary' : 'secondary',
      bgLayers,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    });
  }
  return results;
}

async function auditPageContrast(cdpPage, options = {}) {
  const items = await cdpPage.eval(collectVisibleDomTextStyles);
  const backdrops = options.backdrops || [
    { r: 4, g: 4, b: 6, a: 1 },
    { r: 255, g: 255, b: 255, a: 1 }
  ];
  const primaryMin = options.primaryMin || 7.0;
  const secondaryMin = options.secondaryMin || 4.5;

  const failures = [];
  const checked = [];

  for (const item of items) {
    const ratio = computeWorstCaseContrast(item.color, item.bgLayers, backdrops, item.opacity);
    if (ratio === null) continue;
    const required = item.tier === 'primary' ? primaryMin : secondaryMin;
    const record = {
      id: item.id,
      className: item.className,
      text: item.text,
      tier: item.tier,
      fontSize: item.fontSize,
      fontWeight: item.fontWeight,
      opacity: item.opacity,
      ratio: Number(ratio.toFixed(2)),
      required
    };
    checked.push(record);
    if (ratio < required) {
      failures.push(record);
    }
  }

  if (checked.length === 0 && !options.allowEmpty) {
    throw new Error('auditPageContrast found 0 visible text nodes to verify');
  }

  return { checkedCount: checked.length, failures, checked };
}

async function measureProcessTreeCpuWindow(processManager, rootPid, durationMs = 8000) {
  const nCores = Math.max(1, os.cpus().length);
  const t0 = process.hrtime.bigint();
  const s0 = processManager.getProcessTreeStats(rootPid);
  if (!s0 || !Array.isArray(s0.processes) || s0.processes.length === 0) {
    throw new Error(`Cannot measure CPU: process tree for PID ${rootPid} not found at start of window`);
  }
  await new Promise((r) => setTimeout(r, durationMs));
  const t1 = process.hrtime.bigint();
  const s1 = processManager.getProcessTreeStats(rootPid);
  if (!s1 || !Array.isArray(s1.processes) || s1.processes.length === 0) {
    throw new Error(`Cannot measure CPU: process tree for PID ${rootPid} missing at end of window`);
  }

  const dtSec = Math.max(0.001, Number(t1 - t0) / 1e9);
  const cpuDeltaSec = Math.max(0, s1.totalCpuSeconds - s0.totalCpuSeconds);
  const cpuPercent = (cpuDeltaSec / (dtSec * nCores)) * 100;

  return {
    cpuPercent,
    cpuDeltaSec,
    dtSec,
    nCores,
    workingSetBytes: s1.totalWorkingSetBytes,
    processCount: s1.processes.length
  };
}

module.exports = {
  EMOJI_REGEX,
  scanStringForEmojis,
  scanDirectoriesForEmojis,
  srgbToLinear,
  relativeLuminance,
  compositeOver,
  contrastRatio,
  parseCssColor,
  extractGradientColors,
  computeWorstCaseContrast,
  collectVisibleDomTextStyles,
  auditPageContrast,
  measureProcessTreeCpuWindow
};
