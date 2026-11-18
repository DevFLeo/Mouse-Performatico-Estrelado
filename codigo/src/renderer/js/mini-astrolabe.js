(() => {
  'use strict';

  const rootEl = document.getElementById('mini-root');
  const hitplateEl = document.getElementById('mini-fan-hitplate');
  const guidesSvg = document.getElementById('mini-fan-guides');
  const fanLayerEl = document.getElementById('mini-fan-layer');
  const controlsEl = document.getElementById('mini-controls');
  const btnScaleDown = document.getElementById('btn-mini-scale-down');
  const btnScaleUp = document.getElementById('btn-mini-scale-up');
  const scaleBadgeEl = document.getElementById('mini-scale-badge');
  const hubEl = document.getElementById('mini-hub');
  const statusEl = document.getElementById('mini-status');

  const state = {
    config: null,
    points: [],
    consentAccepted: false,
    expanded: false,
    paused: false,
    dragging: false,
    size: 48,
    scale: 1.0,
    fanRadius: 98,
    hubDia: 48,
    btnDia: 48,
    hubX: 600,
    hubY: 400,
    hubLocalX: 52,
    hubLocalY: 52,
    hitRadius: 120,
    bounds: null,
    workArea: null,
    justExpandedUntil: 0,
    suppressClickUntil: 0,
    lastIgnore: null,
    collapseTimer: null,
    statusTimer: null,
    buttonRects: [],
    controlsRect: null
  };

  const dragState = {
    active: false,
    moved: false,
    startScreenX: 0,
    startScreenY: 0,
    startHubX: 0,
    startHubY: 0,
    pendingX: null,
    pendingY: null,
    rafScheduled: false
  };

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function showStatus(message, isError = false) {
    if (!statusEl || !message) return;
    statusEl.textContent = String(message);
    statusEl.classList.toggle('is-error', Boolean(isError));
    statusEl.classList.remove('hidden');
    if (state.statusTimer) {
      clearTimeout(state.statusTimer);
    }
    state.statusTimer = setTimeout(() => {
      statusEl.classList.add('hidden');
      state.statusTimer = null;
    }, 2400);
  }

  function setIgnoreMouseCached(ignore, forward) {
    if (!window.mpeApi || typeof window.mpeApi.setMiniIgnoreMouse !== 'function') return;
    const nextIgnore = Boolean(ignore);
    const nextForward = nextIgnore ? Boolean(forward) : false;
    if (
      state.lastIgnore &&
      state.lastIgnore.ignore === nextIgnore &&
      state.lastIgnore.forward === nextForward
    ) {
      return;
    }
    state.lastIgnore = { ignore: nextIgnore, forward: nextForward };
    window.mpeApi.setMiniIgnoreMouse(nextIgnore, nextForward);
  }

  function syncRootAttributes() {
    rootEl.classList.toggle('is-expanded', state.expanded);
    rootEl.classList.toggle('is-paused', state.paused || state.expanded);
    rootEl.dataset.expanded = state.expanded ? 'true' : 'false';
    rootEl.dataset.paused = state.paused || state.expanded ? 'true' : 'false';
  }

  function applyTheme(cfg) {
    const theme = cfg && cfg.theme;
    if (!theme || typeof theme !== 'object') return;
    const rootStyle = document.documentElement.style;
    if (theme.bgPrimary) rootStyle.setProperty('--bg-primary', theme.bgPrimary);
    if (theme.goldPrimary) rootStyle.setProperty('--gold-primary', theme.goldPrimary);
    if (theme.goldSecondary) rootStyle.setProperty('--gold-secondary', theme.goldSecondary);
    if (theme.vectorAccent) rootStyle.setProperty('--vector-accent', theme.vectorAccent);
    if (theme.nexusRed) rootStyle.setProperty('--nexus-red', theme.nexusRed);
  }

  function applyLayoutVars() {
    state.hubDia = clamp(Math.round(state.size * state.scale), 40, 132);
    state.btnDia = clamp(Math.round(40 * state.scale), 40, 64);
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--hub-size', `${state.hubDia}px`);
    rootStyle.setProperty('--hub-x', `${state.hubLocalX}px`);
    rootStyle.setProperty('--hub-y', `${state.hubLocalY}px`);
    rootStyle.setProperty('--btn-dia', `${state.btnDia}px`);

    if (scaleBadgeEl) {
      const rounded = Math.round(state.scale * 100) / 100;
      scaleBadgeEl.textContent = `${rounded.toFixed(2).replace(/\.?0+$/, '')}x`;
    }
  }

  function applyMiniState(miniState) {
    if (!miniState || typeof miniState !== 'object') return;
    if (typeof miniState.size === 'number') state.size = miniState.size;
    if (typeof miniState.scale === 'number') state.scale = miniState.scale;
    if (typeof miniState.fanRadius === 'number') state.fanRadius = miniState.fanRadius;
    if (typeof miniState.hubX === 'number') state.hubX = miniState.hubX;
    if (typeof miniState.hubY === 'number') state.hubY = miniState.hubY;
    if (typeof miniState.hubLocalX === 'number') state.hubLocalX = miniState.hubLocalX;
    if (typeof miniState.hubLocalY === 'number') state.hubLocalY = miniState.hubLocalY;
    if (miniState.bounds) state.bounds = miniState.bounds;
    if (miniState.workArea) state.workArea = miniState.workArea;

    if (typeof miniState.expanded === 'boolean') {
      state.expanded = miniState.expanded;
      state.paused = miniState.expanded;
      if (!miniState.expanded) {
        state.lastIgnore = null;
      }
    }

    applyLayoutVars();
    syncRootAttributes();
    renderFan();
  }

  // Mesmo numero do M.P.E principal: slotNumber = posicao na lista unica de pontos.
  // Se houver favoritos marcados (showInMini), o leque mostra so eles; senao os primeiros.
  const MINI_MAX_SLOTS = 12;
  function selectMiniPoints(rawPoints) {
    const all = Array.isArray(rawPoints) ? rawPoints : [];
    const numbered = all.map((pt, idx) =>
      Object.assign({}, pt, { slotNumber: Number(pt && pt.slotNumber) || idx + 1 })
    );
    const favorites = numbered.filter((pt) => pt && pt.showInMini === true);
    const base = favorites.length > 0 ? favorites : numbered;
    return base.slice(0, MINI_MAX_SLOTS);
  }

  function applyConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    state.config = cfg;
    applyTheme(cfg);
    state.points = selectMiniPoints(cfg.points);
    if (cfg.consent && typeof cfg.consent.accepted === 'boolean') {
      state.consentAccepted = cfg.consent.accepted;
    }
    if (cfg.miniAstrolabe && typeof cfg.miniAstrolabe === 'object') {
      if (typeof cfg.miniAstrolabe.size === 'number') state.size = cfg.miniAstrolabe.size;
      if (typeof cfg.miniAstrolabe.scale === 'number') state.scale = cfg.miniAstrolabe.scale;
      if (typeof cfg.miniAstrolabe.fanRadius === 'number') state.fanRadius = cfg.miniAstrolabe.fanRadius;
    }
    applyLayoutVars();
    renderFan();
  }

  function buildSlotHaloSvg() {
    const cx = 32;
    const cy = 32;
    const rOuter = 30.5;
    const rInner = 27.2;
    const ticks = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const len = i % 2 === 0 ? rInner - 1.2 : rInner;
      const x1 = (cx + Math.cos(a) * rOuter).toFixed(1);
      const y1 = (cy + Math.sin(a) * rOuter).toFixed(1);
      const x2 = (cx + Math.cos(a) * len).toFixed(1);
      const y2 = (cy + Math.sin(a) * len).toFixed(1);
      ticks.push(`M${x1} ${y1} L${x2} ${y2}`);
    }
    return (
      '<svg class="fan-slot-halo" viewBox="0 0 64 64" aria-hidden="true">' +
      `<circle cx="32" cy="32" r="28.5" fill="none" stroke="var(--gold-primary)" stroke-width="0.9" stroke-opacity="0.6" />` +
      `<path d="${ticks.join(' ')}" stroke="var(--gold-secondary)" stroke-width="1.15" stroke-linecap="round" stroke-opacity="0.85" />` +
      '</svg>'
    );
  }

  function getLocalWorkArea() {
    const winW = Math.max(1, window.innerWidth || (state.bounds && state.bounds.width) || 300);
    const winH = Math.max(1, window.innerHeight || (state.bounds && state.bounds.height) || 300);
    if (state.bounds && state.workArea) {
      const wa = state.workArea;
      const b = state.bounds;
      return {
        left: Math.max(0, wa.x - b.x),
        top: Math.max(0, wa.y - b.y),
        right: Math.min(winW, wa.x + wa.width - b.x),
        bottom: Math.min(winH, wa.y + wa.height - b.y),
        winW,
        winH
      };
    }
    return { left: 0, top: 0, right: winW, bottom: winH, winW, winH };
  }

  function rectsOverlap(a, b, gap = 4) {
    return !(
      a.right + gap <= b.left ||
      b.right + gap <= a.left ||
      a.bottom + gap <= b.top ||
      b.bottom + gap <= a.top
    );
  }

  function placeControls(hubX, hubY, hubDia, dirAngle, arcRad, localWa) {
    const ctrlW = 92;
    const ctrlH = 30;
    const halfW = ctrlW / 2;
    const halfH = ctrlH / 2;
    const minLeft = localWa.left + halfW + 6;
    const maxRight = Math.max(minLeft, localWa.right - halfW - 6);
    const minTop = localWa.top + halfH + 6;
    const maxBottom = Math.max(minTop, localWa.bottom - halfH - 6);

    const dist = hubDia / 2 + 26;
    const candidates = [
      dirAngle + Math.PI,
      dirAngle + arcRad / 2 + 0.55,
      dirAngle - arcRad / 2 - 0.55,
      Math.PI / 2,
      -Math.PI / 2,
      0,
      Math.PI
    ];

    let best = null;
    for (const ang of candidates) {
      const cx = hubX + Math.cos(ang) * dist;
      const cy = hubY + Math.sin(ang) * dist;
      if (cx < minLeft || cx > maxRight || cy < minTop || cy > maxBottom) continue;
      const hubRect = {
        left: hubX - hubDia / 2,
        top: hubY - hubDia / 2,
        right: hubX + hubDia / 2,
        bottom: hubY + hubDia / 2
      };
      const ctrlRect = {
        left: cx - halfW,
        top: cy - halfH,
        right: cx + halfW,
        bottom: cy + halfH
      };
      if (rectsOverlap(hubRect, ctrlRect, 4)) continue;
      best = { x: Math.round(cx), y: Math.round(cy), w: ctrlW, h: ctrlH };
      break;
    }

    if (!best) {
      const fx = clamp(hubX, minLeft, maxRight);
      const fy = clamp(
        hubY + (hubY - localWa.top > localWa.bottom - hubY ? -(hubDia / 2 + halfH + 10) : hubDia / 2 + halfH + 10),
        minTop,
        maxBottom
      );
      best = { x: Math.round(fx), y: Math.round(fy), w: ctrlW, h: ctrlH };
    }
    return best;
  }

  function computeFanLayout(points) {
    const localWa = getLocalWorkArea();
    const hubX = state.hubLocalX;
    const hubY = state.hubLocalY;
    const hubDia = state.hubDia;
    const scale = state.scale;
    const n = points.length;

    let btnDia = state.btnDia;
    const halfBtn = btnDia / 2;

    const availLeft = hubX - localWa.left;
    const availRight = localWa.right - hubX;
    const availTop = hubY - localWa.top;
    const availBottom = localWa.bottom - hubY;

    const edgeThresh = Math.max(150, Math.round(180 * scale));
    const nearLeft = availLeft < edgeThresh;
    const nearRight = availRight < edgeThresh;
    const nearTop = availTop < edgeThresh;
    const nearBottom = availBottom < edgeThresh;
    const edgeCount =
      (nearLeft ? 1 : 0) + (nearRight ? 1 : 0) + (nearTop ? 1 : 0) + (nearBottom ? 1 : 0);

    let dirAngle = Math.atan2(availBottom - availTop, availRight - availLeft);
    let arcDeg = 286;

    if (edgeCount === 0) {
      dirAngle = -Math.PI / 2;
      arcDeg = 286;
    } else if (edgeCount === 1) {
      arcDeg = 172;
      if (nearLeft) dirAngle = 0;
      else if (nearRight) dirAngle = Math.PI;
      else if (nearTop) dirAngle = Math.PI / 2;
      else if (nearBottom) dirAngle = -Math.PI / 2;
    } else {
      arcDeg = 128;
      if (nearLeft && nearTop) dirAngle = Math.PI * 0.25;
      else if (nearRight && nearTop) dirAngle = Math.PI * 0.75;
      else if (nearRight && nearBottom) dirAngle = -Math.PI * 0.75;
      else if (nearLeft && nearBottom) dirAngle = -Math.PI * 0.25;
    }

    const arcRad = (arcDeg * Math.PI) / 180;
    const controls = placeControls(hubX, hubY, hubDia, dirAngle, arcRad, localWa);

    const safeLeft = localWa.left + halfBtn + 10;
    const safeRight = Math.max(safeLeft, localWa.right - halfBtn - 10);
    const safeTop = localWa.top + halfBtn + 10;
    const safeBottom = Math.max(safeTop, localWa.bottom - halfBtn - 24);

    // Check max available inward span along dirAngle to prevent radial overflow on compact screens
    const cosD = Math.cos(dirAngle);
    const sinD = Math.sin(dirAngle);
    const tx = cosD > 0.01 ? (safeRight - hubX) / cosD : cosD < -0.01 ? (safeLeft - hubX) / cosD : 9999;
    const ty = sinD > 0.01 ? (safeBottom - hubY) / sinD : sinD < -0.01 ? (safeTop - hubY) / sinD : 9999;
    const maxInwardR = Math.max(96, Math.min(tx, ty));

    let r1 = Math.max(
      Math.round(hubDia / 2 + btnDia / 2 + 22 * scale),
      Math.round(state.fanRadius * 0.74 * scale),
      Math.round(73 * scale)
    );
    let minSep = btnDia + Math.max(14, Math.round(16 * scale));
    let radialStep = btnDia + Math.max(24, Math.round(26 * scale));

    const slots = [];
    const ringRadii = [];

    if (n === 0) {
      const r0 = Math.min(r1, maxInwardR);
      ringRadii.push(r0);
      slots.push({
        isEmptyCta: true,
        slotNumber: '+',
        title: 'Abrir M.P.E',
        vectorStyle: 'gold',
        x: clamp(hubX + Math.cos(dirAngle) * r0, safeLeft, safeRight),
        y: clamp(hubY + Math.sin(dirAngle) * r0, safeTop, safeBottom),
        angle: dirAngle,
        ringRadius: r0
      });
    } else {
      let remaining = n;
      let cursor = 0;
      let ringIdx = 0;
      const maxHalfArcRad = (arcDeg * Math.PI) / 360;

      const isInsideSafe = (px, py) =>
        px >= safeLeft && px <= safeRight && py >= safeTop && py <= safeBottom;

      const computeValidArcForRing = (ringR) => {
        if (edgeCount === 0 && isInsideSafe(hubX + ringR, hubY) && isInsideSafe(hubX - ringR, hubY) && isInsideSafe(hubX, hubY + ringR) && isInsideSafe(hubX, hubY - ringR)) {
          return { minA: dirAngle - maxHalfArcRad, maxA: dirAngle + maxHalfArcRad };
        }
        const stepRad = (2 * Math.PI) / 180; // 2 deg
        let posSpan = 0;
        for (let a = stepRad; a <= maxHalfArcRad; a += stepRad) {
          const px = hubX + Math.cos(dirAngle + a) * ringR;
          const py = hubY + Math.sin(dirAngle + a) * ringR;
          if (!isInsideSafe(px, py)) break;
          posSpan = a;
        }
        let negSpan = 0;
        for (let a = stepRad; a <= maxHalfArcRad; a += stepRad) {
          const px = hubX + Math.cos(dirAngle - a) * ringR;
          const py = hubY + Math.sin(dirAngle - a) * ringR;
          if (!isInsideSafe(px, py)) break;
          negSpan = a;
        }
        if (posSpan + negSpan < 0.25) {
          return { minA: dirAngle - 0.25, maxA: dirAngle + 0.25 };
        }
        return { minA: dirAngle - negSpan, maxA: dirAngle + posSpan };
      };

      while (remaining > 0 && ringIdx < 6) {
        const ringR = r1 + ringIdx * radialStep;
        ringRadii.push(ringR);

        const { minA, maxA } = computeValidArcForRing(ringR);
        const effArcRad = Math.max(0.2, maxA - minA);
        const effArcDeg = (effArcRad * 180) / Math.PI;

        const cap =
          effArcDeg >= 330
            ? Math.max(1, Math.floor((2 * Math.PI * ringR) / minSep))
            : Math.max(1, Math.floor((ringR * effArcRad) / minSep) + 1);

        const count = ringIdx === 5 ? remaining : Math.min(remaining, cap);
        const stepA = count > 1 ? effArcRad / (count - 1) : 0;
        const stagger = ringIdx % 2 === 1 && count > 1 ? Math.min(0.14, stepA * 0.25) : 0;

        for (let i = 0; i < count; i++) {
          const pt = points[cursor];
          let ang = (minA + maxA) / 2;
          if (count > 1) {
            ang = minA + i * stepA;
            if (stagger !== 0 && effArcRad > stagger * 3) {
              ang = minA + stagger + i * ((effArcRad - 2 * stagger) / (count - 1));
            }
          }
          const bx = clamp(hubX + Math.cos(ang) * ringR, safeLeft, safeRight);
          const by = clamp(hubY + Math.sin(ang) * ringR, safeTop, safeBottom);
          slots.push({
            point: pt,
            slotNumber: (pt && Number(pt.slotNumber)) || cursor + 1,
            title: (pt && pt.title) || `Atalho ${cursor + 1}`,
            vectorStyle: (pt && pt.vectorStyle) || 'gold',
            x: bx,
            y: by,
            angle: ang,
            ringRadius: ringR
          });
          cursor++;
        }
        remaining -= count;
        ringIdx++;
      }

      // Deterministic collision resolution pass (pairwise AABB + circle + hub + controls + workArea clamp)
      const hubSafeDist = hubDia / 2 + halfBtn + 8;
      const slotSafeDist = btnDia + 10;
      const aabbMinSep = btnDia + 6;
      const ctrlHalfW = controls.w / 2;
      const ctrlHalfH = controls.h / 2;

      for (let iter = 0; iter < 64; iter++) {
        let movedAny = false;

        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];

          // Hub exclusion (distancia de Chebyshev: botoes e hub sao caixas, nao circulos;
          // na diagonal a distancia circular deixava o canto do botao sobre o hub)
          let hdx = s.x - hubX;
          let hdy = s.y - hubY;
          let hCheb = Math.max(Math.abs(hdx), Math.abs(hdy));
          if (hCheb < hubSafeDist) {
            if (hCheb < 0.01) {
              hdx = Math.cos(s.angle);
              hdy = Math.sin(s.angle);
              hCheb = Math.max(Math.abs(hdx), Math.abs(hdy));
            }
            const factor = (hubSafeDist + 1) / hCheb;
            s.x = hubX + hdx * factor;
            s.y = hubY + hdy * factor;
            movedAny = true;
          }

          // Controls toolbar exclusion
          const dxCtrl = s.x - controls.x;
          const dyCtrl = s.y - controls.y;
          const overlapX = ctrlHalfW + halfBtn + 6 - Math.abs(dxCtrl);
          const overlapY = ctrlHalfH + halfBtn + 6 - Math.abs(dyCtrl);
          if (overlapX > 0 && overlapY > 0) {
            if (overlapX < overlapY) {
              s.x += (dxCtrl >= 0 ? 1 : -1) * (overlapX + 1);
            } else {
              s.y += (dyCtrl >= 0 ? 1 : -1) * (overlapY + 1);
            }
            movedAny = true;
          }
        }

        // Pairwise button separation (ensuring zero bounding-rect overlap)
        for (let i = 0; i < slots.length; i++) {
          for (let j = i + 1; j < slots.length; j++) {
            const a = slots[i];
            const b = slots[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let dist = Math.hypot(dx, dy);
            const ovX = aabbMinSep - Math.abs(dx);
            const ovY = aabbMinSep - Math.abs(dy);

            if (ovX > 0 && ovY > 0) {
              if (ovX < ovY) {
                const dir = dx === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(dx);
                const step = ovX / 2 + 0.75;
                a.x -= dir * step;
                b.x += dir * step;
              } else {
                const dir = dy === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(dy);
                const step = ovY / 2 + 0.75;
                a.y -= dir * step;
                b.y += dir * step;
              }
              movedAny = true;
            } else if (dist < slotSafeDist) {
              if (dist < 0.01) {
                dx = Math.cos(a.angle + 0.35);
                dy = Math.sin(a.angle + 0.35);
                dist = 1;
              }
              const push = (slotSafeDist - dist) / 2 + 0.5;
              const nx = dx / dist;
              const ny = dy / dist;
              a.x -= nx * push;
              a.y -= ny * push;
              b.x += nx * push;
              b.y += ny * push;
              movedAny = true;
            }
          }
        }

        for (let i = 0; i < slots.length; i++) {
          slots[i].x = clamp(slots[i].x, safeLeft, safeRight);
          slots[i].y = clamp(slots[i].y, safeTop, safeBottom);
        }

        if (!movedAny) break;
      }
    }

    let maxReach = hubDia / 2 + 32;
    for (const s of slots) {
      s.x = Math.round(s.x);
      s.y = Math.round(s.y);
      const d = Math.hypot(s.x - hubX, s.y - hubY);
      if (d > maxReach) maxReach = d;

      if (s.x - localWa.left < 56) s.labelAlign = 'left';
      else if (localWa.right - s.x < 56) s.labelAlign = 'right';
      else s.labelAlign = 'center';
    }

    const ctrlDist = Math.hypot(controls.x - hubX, controls.y - hubY) + controls.w / 2;
    const hitRadius = Math.ceil(Math.max(maxReach + halfBtn + 24, ctrlDist + 16));

    return {
      slots,
      controls,
      ringRadii,
      hitRadius,
      dirAngle,
      arcRad,
      localWa,
      btnDia
    };
  }

  function renderFanGuides(layout) {
    if (!guidesSvg) return;
    const { slots, ringRadii, localWa } = layout;
    const w = localWa.winW;
    const h = localWa.winH;
    const hubX = state.hubLocalX;
    const hubY = state.hubLocalY;

    guidesSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    const parts = [];
    const sqR = ringRadii.length ? Math.min(ringRadii[0] + 24, Math.min(w, h) * 0.44) : 84;
    parts.push(
      `<rect x="${(hubX - sqR).toFixed(1)}" y="${(hubY - sqR).toFixed(1)}" width="${(sqR * 2).toFixed(1)}" height="${(sqR * 2).toFixed(1)}" fill="none" stroke="var(--gold-primary)" stroke-opacity="0.14" stroke-width="1" />`
    );

    for (let i = 0; i < ringRadii.length; i++) {
      const r = ringRadii[i];
      const dash = i % 2 === 1 ? ' stroke-dasharray="3 5"' : '';
      parts.push(
        `<circle cx="${hubX}" cy="${hubY}" r="${r.toFixed(1)}" fill="none" stroke="var(--gold-primary)" stroke-opacity="0.34" stroke-width="1.1"${dash} />`
      );
    }

    if (ringRadii.length) {
      const outerBezel = ringRadii[ringRadii.length - 1] + state.btnDia * 0.65;
      parts.push(
        `<circle cx="${hubX}" cy="${hubY}" r="${outerBezel.toFixed(1)}" fill="none" stroke="var(--gold-secondary)" stroke-opacity="0.22" stroke-width="1" />`
      );
    }

    for (const s of slots) {
      const strokeColor = s.vectorStyle === 'blue' ? 'var(--vector-accent)' : 'var(--gold-primary)';
      parts.push(
        `<line x1="${hubX}" y1="${hubY}" x2="${s.x}" y2="${s.y}" stroke="${strokeColor}" stroke-opacity="0.58" stroke-width="1.25" />`
      );
    }

    guidesSvg.innerHTML = parts.join('');
  }

  async function handleSlotExecute(slot) {
    if (!window.mpeApi) return;

    if (slot.isEmptyCta) {
      if (typeof window.mpeApi.executePoint === 'function') {
        const res = await window.mpeApi.executePoint({
          id: 'mini-empty-settings',
          title: 'Abrir M.P.E',
          actionType: 'open_settings',
          params: {}
        });
        rootEl.dataset.lastExecOk = res && res.ok ? 'true' : 'false';
        rootEl.dataset.lastExecType = (res && res.type) || 'open_settings';
        showStatus('Use o painel principal do M.P.E para criar atalhos.');
      }
      return;
    }

    const pt = slot.point;
    if (!pt || typeof window.mpeApi.executePoint !== 'function') return;

    try {
      const res = await window.mpeApi.executePoint(pt);
      const ok = Boolean(res && res.ok !== false);
      rootEl.dataset.lastExecOk = ok ? 'true' : 'false';
      rootEl.dataset.lastExecType = String((res && res.type) || pt.actionType || '');
      rootEl.dataset.lastExecId = String(pt.id || '');

      if (res && res.blockedByConsent) {
        showStatus(res.message || 'Aceite de primeiro acesso necessario.', true);
      } else if (!ok) {
        showStatus((res && res.message) || 'Falha ao executar atalho.', true);
      } else if (
        res &&
        ['open_organizer', 'organize_files_quick', 'open_settings', 'request_area_crop', 'request_named_print', 'text_selection'].includes(res.type)
      ) {
        showStatus(res.message || `Slot ${slot.slotNumber}: abra o HUD principal.`);
      } else {
        showStatus((res && res.message) || `Slot ${slot.slotNumber}: ${slot.title}`);
      }
    } catch (err) {
      rootEl.dataset.lastExecOk = 'false';
      showStatus((err && err.message) || 'Erro ao executar atalho.', true);
    }
  }

  function renderFan() {
    if (!fanLayerEl) return;
    const layout = computeFanLayout(state.points);
    state.hitRadius = layout.hitRadius;

    if (hitplateEl) {
      const d = layout.hitRadius * 2;
      hitplateEl.style.width = `${d}px`;
      hitplateEl.style.height = `${d}px`;
    }

    if (controlsEl) {
      controlsEl.style.left = `${layout.controls.x}px`;
      controlsEl.style.top = `${layout.controls.y}px`;
      state.controlsRect = {
        left: layout.controls.x - layout.controls.w / 2,
        top: layout.controls.y - layout.controls.h / 2,
        right: layout.controls.x + layout.controls.w / 2,
        bottom: layout.controls.y + layout.controls.h / 2
      };
    }

    renderFanGuides(layout);

    fanLayerEl.innerHTML = '';
    const haloSvg = buildSlotHaloSvg();
    const halfBtn = layout.btnDia / 2;
    state.buttonRects = [];

    for (const s of layout.slots) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fan-slot-btn';
      if (s.isEmptyCta) btn.classList.add('is-empty-cta');
      if (String(s.slotNumber).length >= 2) btn.classList.add('is-two-digits');
      btn.style.left = `${s.x}px`;
      btn.style.top = `${s.y}px`;
      btn.dataset.vectorStyle = s.vectorStyle || 'gold';
      btn.dataset.slotNumber = String(s.slotNumber);
      if (s.point) {
        btn.dataset.pointId = String(s.point.id || '');
        btn.dataset.actionType = String(s.point.actionType || 'print');
      }
      btn.setAttribute(
        'aria-label',
        s.isEmptyCta ? 'Nenhum atalho salvo' : `Atalho ${s.slotNumber}: ${s.title}`
      );
      btn.title = s.isEmptyCta
        ? 'Nenhum atalho salvo'
        : `${s.slotNumber}${s.point && s.point.hotkeyLetter ? ' ou ' + s.point.hotkeyLetter : ''}. ${s.title}`;

      const numSpan = document.createElement('span');
      numSpan.className = 'fan-slot-num';
      numSpan.textContent = String(s.slotNumber);

      const labelSpan = document.createElement('span');
      labelSpan.className = 'fan-slot-label';
      if (s.labelAlign === 'left') labelSpan.classList.add('align-left');
      else if (s.labelAlign === 'right') labelSpan.classList.add('align-right');
      labelSpan.textContent = s.point && s.point.hotkeyLetter ? `${s.point.hotkeyLetter} - ${s.title}` : s.title;

      btn.innerHTML = haloSvg;
      btn.appendChild(numSpan);
      btn.appendChild(labelSpan);

      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        handleSlotExecute(s);
      });

      fanLayerEl.appendChild(btn);
      state.buttonRects.push({
        left: s.x - halfBtn,
        top: s.y - halfBtn,
        right: s.x + halfBtn,
        bottom: s.y + halfBtn
      });
    }
  }

  function clearCollapseTimer() {
    if (state.collapseTimer) {
      clearTimeout(state.collapseTimer);
      state.collapseTimer = null;
    }
  }

  async function enterExpanded() {
    if (state.dragging) return;
    clearCollapseTimer();
    if (state.expanded) {
      state.paused = true;
      syncRootAttributes();
      setIgnoreMouseCached(false, false);
      return;
    }

    state.expanded = true;
    state.paused = true;
    state.justExpandedUntil = Date.now() + 180;
    syncRootAttributes();
    setIgnoreMouseCached(false, false);

    if (window.mpeApi && typeof window.mpeApi.setMiniExpandedBounds === 'function') {
      try {
        const res = await window.mpeApi.setMiniExpandedBounds(true);
        if (res && res.ok && state.expanded) {
          applyMiniState(res);
        } else if (res && res.blockedByConsent) {
          showStatus(res.message || 'Aceite de primeiro acesso necessario.', true);
        }
      } catch (_) {}
    }
  }

  async function collapseNow(immediate = false) {
    clearCollapseTimer();
    if (!state.expanded && !state.paused) return;
    state.expanded = false;
    state.paused = false;
    syncRootAttributes();
    setIgnoreMouseCached(true, true);

    if (window.mpeApi && typeof window.mpeApi.setMiniExpandedBounds === 'function') {
      try {
        const res = await window.mpeApi.setMiniExpandedBounds(false);
        if (res && res.ok && !state.expanded) {
          applyMiniState(res);
        }
      } catch (_) {}
    }
    if (immediate) {
      state.justExpandedUntil = 0;
    }
  }

  function scheduleCollapse() {
    if (state.dragging || !state.expanded) return;
    if (Date.now() < state.justExpandedUntil) return;
    if (state.collapseTimer) return;
    state.collapseTimer = setTimeout(() => {
      state.collapseTimer = null;
      if (!state.dragging) {
        collapseNow(false);
      }
    }, 160);
  }

  function isPointerInInteractiveZone(clientX, clientY) {
    const distHub = Math.hypot(clientX - state.hubLocalX, clientY - state.hubLocalY);
    if (!state.expanded) {
      return distHub <= state.hubDia / 2 + 8;
    }
    if (distHub <= state.hitRadius) {
      return true;
    }
    const pad = 10;
    for (const r of state.buttonRects) {
      if (
        clientX >= r.left - pad &&
        clientX <= r.right + pad &&
        clientY >= r.top - pad &&
        clientY <= r.bottom + pad
      ) {
        return true;
      }
    }
    if (state.controlsRect) {
      const c = state.controlsRect;
      if (
        clientX >= c.left - pad &&
        clientX <= c.right + pad &&
        clientY >= c.top - pad &&
        clientY <= c.bottom + pad
      ) {
        return true;
      }
    }
    return false;
  }

  function flushDragMove() {
    dragState.rafScheduled = false;
    if (!dragState.active || !dragState.moved) return;
    if (
      typeof dragState.pendingX === 'number' &&
      typeof dragState.pendingY === 'number' &&
      window.mpeApi &&
      typeof window.mpeApi.updateMiniAstrolabeLayout === 'function'
    ) {
      window.mpeApi.updateMiniAstrolabeLayout({
        x: Math.round(dragState.pendingX),
        y: Math.round(dragState.pendingY),
        transient: true,
        dragging: true
      });
    }
  }

  async function adjustScale(delta) {
    if (!window.mpeApi || typeof window.mpeApi.updateMiniAstrolabeLayout !== 'function') return;
    const nextScale = Math.round(clamp(state.scale + delta, 0.75, 1.5) * 100) / 100;
    if (nextScale === state.scale) return;
    state.scale = nextScale;
    applyLayoutVars();
    renderFan();
    try {
      const res = await window.mpeApi.updateMiniAstrolabeLayout({ scale: nextScale });
      if (res && res.state) {
        applyMiniState(res.state);
      }
    } catch (_) {}
  }

  function bindEvents() {
    if (hubEl) {
      hubEl.addEventListener('mouseenter', () => {
        if (!dragState.active) {
          enterExpanded();
        }
      });

      hubEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        dragState.active = true;
        dragState.moved = false;
        dragState.startScreenX = e.screenX;
        dragState.startScreenY = e.screenY;
        dragState.startHubX = state.hubX;
        dragState.startHubY = state.hubY;
        dragState.pendingX = null;
        dragState.pendingY = null;
        setIgnoreMouseCached(false, false);
      });

      hubEl.addEventListener('click', (e) => {
        if (Date.now() < state.suppressClickUntil) {
          e.preventDefault();
          return;
        }
        if (state.expanded) {
          collapseNow(true);
        } else {
          enterExpanded();
        }
      });
    }

    window.addEventListener('pointermove', (e) => {
      if (!dragState.active) return;
      const dx = e.screenX - dragState.startScreenX;
      const dy = e.screenY - dragState.startScreenY;
      if (!dragState.moved && Math.hypot(dx, dy) > 5) {
        dragState.moved = true;
        state.dragging = true;
        rootEl.classList.add('is-dragging');
        collapseNow(true);
      }
      if (dragState.moved) {
        dragState.pendingX = dragState.startHubX + dx;
        dragState.pendingY = dragState.startHubY + dy;
        if (!dragState.rafScheduled) {
          dragState.rafScheduled = true;
          requestAnimationFrame(flushDragMove);
        }
      }
    });

    const endDrag = async (e) => {
      if (!dragState.active) return;
      const wasMoved = dragState.moved;
      const dx = e.screenX - dragState.startScreenX;
      const dy = e.screenY - dragState.startScreenY;
      dragState.active = false;
      dragState.moved = false;
      state.dragging = false;
      rootEl.classList.remove('is-dragging');

      if (wasMoved) {
        state.suppressClickUntil = Date.now() + 180;
        const finalX = Math.round(dragState.startHubX + dx);
        const finalY = Math.round(dragState.startHubY + dy);
        if (window.mpeApi && typeof window.mpeApi.updateMiniAstrolabeLayout === 'function') {
          try {
            const res = await window.mpeApi.updateMiniAstrolabeLayout({
              x: finalX,
              y: finalY,
              dragging: false
            });
            if (res && res.state) {
              applyMiniState(res.state);
            }
          } catch (_) {}
        }
      }
    };

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    window.addEventListener('mousemove', (e) => {
      if (dragState.active || state.dragging) {
        setIgnoreMouseCached(false, false);
        return;
      }
      const inZone = isPointerInInteractiveZone(e.clientX, e.clientY);
      if (!state.expanded) {
        if (inZone) {
          enterExpanded();
        } else {
          setIgnoreMouseCached(true, true);
        }
        return;
      }

      if (inZone) {
        clearCollapseTimer();
        setIgnoreMouseCached(false, false);
      } else {
        setIgnoreMouseCached(true, true);
        scheduleCollapse();
      }
    });

    document.addEventListener('mouseleave', () => {
      if (state.dragging || dragState.active) return;
      if (state.expanded) {
        setIgnoreMouseCached(true, true);
        scheduleCollapse();
      } else {
        setIgnoreMouseCached(true, true);
      }
    });

    if (btnScaleDown) {
      btnScaleDown.addEventListener('click', (e) => {
        e.stopPropagation();
        adjustScale(-0.15);
      });
    }
    if (btnScaleUp) {
      btnScaleUp.addEventListener('click', (e) => {
        e.stopPropagation();
        adjustScale(0.15);
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.expanded) {
        collapseNow(true);
        return;
      }
      if (/^[a-zA-Z]$/.test(e.key) && state.expanded && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const letter = e.key.toUpperCase();
        const all = state.config && Array.isArray(state.config.points) ? state.config.points : [];
        const pt = all.find((p) => p && p.hotkeyLetter === letter);
        if (pt) {
          handleSlotExecute({ point: pt, slotNumber: pt.slotNumber, title: pt.title || `Atalho ${letter}` });
        }
        return;
      }
      if (/^[1-9]$/.test(e.key) && state.expanded) {
        const wanted = Number(e.key);
        const pt = state.points.find((p) => Number(p && p.slotNumber) === wanted);
        if (pt) {
          handleSlotExecute({
            point: pt,
            slotNumber: wanted,
            title: pt.title || `Atalho ${wanted}`
          });
        }
      }
    });

    window.addEventListener('resize', () => {
      renderFan();
    });
  }

  async function init() {
    bindEvents();
    if (!window.mpeApi) return;

    if (typeof window.mpeApi.onConfigUpdated === 'function') {
      window.mpeApi.onConfigUpdated((payload) => {
        if (payload && payload.config) {
          applyConfig(payload.config);
        }
      });
    }

    if (typeof window.mpeApi.onMiniStateChanged === 'function') {
      window.mpeApi.onMiniStateChanged((miniState) => {
        applyMiniState(miniState);
      });
    }

    if (typeof window.mpeApi.onConsentUpdated === 'function') {
      window.mpeApi.onConsentUpdated((consent) => {
        state.consentAccepted = Boolean(consent && consent.accepted);
      });
    }

    try {
      const [cfg, miniState] = await Promise.all([
        typeof window.mpeApi.getConfig === 'function' ? window.mpeApi.getConfig() : null,
        typeof window.mpeApi.getMiniAstrolabeState === 'function'
          ? window.mpeApi.getMiniAstrolabeState()
          : null
      ]);
      if (cfg) applyConfig(cfg);
      if (miniState) applyMiniState(miniState);
    } catch (_) {}

    setIgnoreMouseCached(true, true);
  }

  init();
})();
