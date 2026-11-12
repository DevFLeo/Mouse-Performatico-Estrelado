/**
 * Motor Grafico Hibrido 2D / 3D de Alta Performance do Astrolabio M.P.E
 * - Modo 2D ("2d"): Geometria plana fiel a imagem de referencia (assets/reference-astrolabe.jpg),
 *   com circulos excentricos classicos, Nexus no quadrante inferior-direito, vetores azuis/dourados,
 *   setas direcionais, glifos (Π, Δ, h, C), varredura de radar animada e ondas de choque 2D.
 * - Modo 3D ("3d"): Profundidade orbital expandida com coroa cilindrica 3D, hastes de elevacao Z,
 *   malha de constelacao viva entre os astros e inclinacao 3D travada no ponto onde o usuario parar.
 * - Otimizacao Extrema (Zero Lag): Batching de chamadas Canvas (1 unico stroke por camada de ticks/barras),
 *   eliminacao de Gaussian shadowBlur em loops massivos e pausa automatica quando minimizado (0% CPU/GPU).
 */
class Astrolabe3D {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true }) || canvas.getContext('2d');
    this.callbacks = callbacks;

    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    // Modo de Projecao: '2d' (Base fiel da imagem) ou '3d' (Orbital profundo)
    // modeBlend: 0.0 = 2D puro, 1.0 = 3D completo (transicao animada suave)
    this.projectionMode = '3d';
    this.modeBlend = 1.0;
    this.targetModeBlend = 1.0;

    // Estado de rotacao circular e inclinacao 3D (permanece travado onde o usuario posicionar)
    this.wheelRotation = 0;
    this.wheelVelocity = 0;
    this.tiltX = 0.34;
    this.tiltY = -0.24;
    this.targetTiltX = 0.34;
    this.targetTiltY = -0.24;
    this.zoom = 1.0;
    this.targetZoom = 1.0;
    this.userHasPositioned = false;

    // Controle de arraste interativo e reposicionamento de estrelas
    this.isDragging = false;
    this.draggingPoint = null;
    this.isMovePointsMode = false;
    this.isPickingLocation = false;
    this.pickLocationCallback = null;
    this.previewCursorCoords = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragMoved = 0;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    // Animacoes de alta performance (2D e 3D)
    this.constellationTime = 0;
    this.radarAngle = 0;
    this.reticleAngle = 0;
    this.introProgress = 1;
    this.activePulsePointId = null;
    this.activePulseProgress = 0;
    this.shockwaves = [];
    this.laserBursts = [];
    this.nexusHovered = false;
    this.nexusScreenPos = { x: 0, y: 0, r: 18 };

    // Controle de ciclo de renderizacao para 0% de uso em segundo plano
    this.isPaused = false;
    this.rafId = null;

    // Dados e Tema
    this.points = [];
    this.hoveredPoint = null;
    this.projectedPoints = [];
    this.autoOrbit = true;
    this.sensitivity = 1.0;

    this.theme = {
      bgPrimary: '#040406',
      bgSecondary: '#171206',
      goldPrimary: '#E5B84B',
      goldSecondary: '#FFE08A',
      goldDim: '#7A5B18',
      vectorAccent: '#5C73B8',
      nexusRed: '#9E2A2B',
      glowIntensity: 0.85
    };

    // Poeira estelar otimizada
    this.stars = [];
    this.initStarfield(95);
    this.loadSavedViewState();

    this.bindEvents();
    this.resize();
    this.animate = this.animate.bind(this);
    this.startLoop();
  }

  startLoop() {
    if (!this.rafId && !this.isPaused) {
      this.rafId = requestAnimationFrame(this.animate);
    }
  }

  pause() {
    this.isPaused = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resume() {
    if (!this.isPaused && this.rafId) return;
    this.isPaused = false;
    this.startLoop();
  }

  initStarfield(count) {
    this.stars = [];
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: (Math.random() - 0.5) * 2.4,
        y: (Math.random() - 0.5) * 2.4,
        z: (Math.random() - 0.5) * 1.4,
        vx: (Math.random() - 0.5) * 0.0003,
        vy: (Math.random() - 0.5) * 0.0003,
        size: Math.random() * 1.6 + 0.5,
        alpha: Math.random() * 0.55 + 0.15,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  loadSavedViewState() {
    try {
      const raw = localStorage.getItem('mpe_3d_view_state');
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.wheelRotation === 'number') this.wheelRotation = saved.wheelRotation;
      if (typeof saved.targetTiltX === 'number') {
        this.targetTiltX = saved.targetTiltX;
        this.tiltX = saved.targetTiltX;
      }
      if (typeof saved.targetTiltY === 'number') {
        this.targetTiltY = saved.targetTiltY;
        this.tiltY = saved.targetTiltY;
      }
      if (typeof saved.targetZoom === 'number') {
        this.targetZoom = saved.targetZoom;
        this.zoom = saved.targetZoom;
      }
      if (saved.projectionMode === '2d' || saved.projectionMode === '3d') {
        this.projectionMode = saved.projectionMode;
        this.targetModeBlend = saved.projectionMode === '2d' ? 0.0 : 1.0;
        this.modeBlend = this.targetModeBlend;
      }
      this.userHasPositioned = Boolean(saved.userHasPositioned);
    } catch (_) {}
  }

  saveViewState() {
    try {
      localStorage.setItem(
        'mpe_3d_view_state',
        JSON.stringify({
          wheelRotation: this.wheelRotation,
          targetTiltX: this.targetTiltX,
          targetTiltY: this.targetTiltY,
          targetZoom: this.targetZoom,
          projectionMode: this.projectionMode,
          userHasPositioned: this.userHasPositioned
        })
      );
    } catch (_) {}
  }

  setConfig(config) {
    if (!config) return;
    if (Array.isArray(config.points)) {
      this.points = config.points;
    }
    if (config.theme) {
      this.theme = Object.assign({}, this.theme, config.theme);
    }
    if (config.system) {
      this.autoOrbit = config.system.autoOrbit !== false;
      this.sensitivity = Number(config.system.sensitivity3D) || 1.0;
      if (config.system.projectionMode === '2d' || config.system.projectionMode === '3d') {
        this.setProjectionMode(config.system.projectionMode, false);
      }
    }
  }

  setProjectionMode(mode, animateBurst = true) {
    const normalized = mode === '2d' ? '2d' : '3d';
    this.projectionMode = normalized;
    this.targetModeBlend = normalized === '2d' ? 0.0 : 1.0;
    if (normalized === '2d' && animateBurst) {
      // Alinha exatamente na orientacao canonica da imagem base em 2D
      this.wheelRotation = 0;
      this.wheelVelocity = 0;
    }
    this.saveViewState();

    if (animateBurst) {
      this.spawnShockwave(
        this.nexusScreenPos.x || this.width / 2,
        this.nexusScreenPos.y || this.height / 2,
        normalized === '2d' ? this.theme.goldSecondary : this.theme.vectorAccent,
        1.35
      );
      this.triggerAllVectorsBurst();
    }

    if (this.callbacks.onModeChange) {
      this.callbacks.onModeChange(normalized);
    }
  }

  toggleProjectionMode() {
    const nextMode = this.projectionMode === '2d' ? '3d' : '2d';
    this.setProjectionMode(nextMode, true);
    return nextMode;
  }

  spawnShockwave(x, y, color, speed = 1.0) {
    this.shockwaves.push({
      x,
      y,
      radius: 8,
      maxRadius: Math.min(this.width, this.height) * 0.44,
      alpha: 0.92,
      color: color || this.theme.goldSecondary,
      speed: speed * 9.5
    });
    if (this.shockwaves.length > 8) {
      this.shockwaves.shift();
    }
  }

  triggerAllVectorsBurst() {
    this.laserBursts = [];
    for (let i = 0; i < this.projectedPoints.length; i++) {
      const p = this.projectedPoints[i];
      this.laserBursts.push({
        pointId: p.point.id,
        progress: 0,
        speed: 0.045 + (i % 3) * 0.008,
        color: p.point.vectorStyle === 'gold' ? this.theme.goldSecondary : '#8AB4FF'
      });
    }
  }

  triggerPointBurst(point) {
    if (!point) return;
    this.activePulsePointId = point.id;
    this.activePulseProgress = 0;
    const found = this.projectedPoints.find((p) => p.point.id === point.id);
    if (found) {
      this.spawnShockwave(found.screen.x, found.screen.y, this.theme.goldSecondary, 0.9);
      this.laserBursts.push({
        pointId: point.id,
        progress: 0,
        speed: 0.065,
        color: '#FFFFFF'
      });
    }
  }

  triggerIntroAnimation(preservePosition = true) {
    this.resume();
    this.introProgress = 0.2;
    // Pulso estelar de ignicao holografica ao abrir via Shift + Ctrl + Alt + Botao Direito
    this.spawnShockwave(
      this.nexusScreenPos.x || this.width / 2,
      this.nexusScreenPos.y || this.height / 2,
      this.theme.goldSecondary,
      1.45
    );
    this.triggerAllVectorsBurst();
    if (!preservePosition && !this.userHasPositioned) {
      this.wheelVelocity = 0.012;
      this.tiltX = 0.52;
      this.tiltY = -0.36;
      this.targetTiltX = 0.34;
      this.targetTiltY = -0.24;
    } else {
      this.wheelVelocity = 0.005;
    }
  }

  setMovePointsMode(enabled) {
    this.isMovePointsMode = Boolean(enabled);
    if (this.callbacks.onMoveModeChange) {
      this.callbacks.onMoveModeChange(this.isMovePointsMode);
    }
  }

  toggleMovePointsMode() {
    this.setMovePointsMode(!this.isMovePointsMode);
    return this.isMovePointsMode;
  }

  startPickingLocation(callback) {
    this.isPickingLocation = true;
    this.pickLocationCallback = callback || null;
    this.canvas.style.cursor = 'crosshair';
  }

  cancelPickingLocation() {
    this.isPickingLocation = false;
    this.pickLocationCallback = null;
    this.previewCursorCoords = null;
    this.canvas.style.cursor = 'grab';
  }

  /**
   * Converte (mx, my) da tela para (angle: 0..360, orbit: 1..3, customRadius: 0.12..0.90) no Astrolabio
   */
  screenToCircleCoords(mx, my) {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const baseR = Math.min(this.width, this.height) * 0.425 * Math.max(0.1, this.introProgress) * this.zoom;

    const dx = mx - cx;
    const dy = my - cy;
    const rawDist = Math.hypot(dx, dy) / Math.max(1, baseR);
    const customRadius = Number(Math.max(0.12, Math.min(0.9, rawDist)).toFixed(3));

    let rad = Math.atan2(dy, dx) - this.wheelRotation;
    let deg = ((rad * 180) / Math.PI + 90) % 360;
    if (deg < 0) deg += 360;
    const angle = Math.round(deg) % 360;

    let orbit = 3;
    if (customRadius < 0.34) {
      orbit = 1;
    } else if (customRadius < 0.79) {
      orbit = 2;
    }

    return {
      angle,
      orbit,
      customRadius,
      screenX: mx,
      screenY: my
    };
  }

  resetView() {
    this.wheelRotation = 0;
    this.wheelVelocity = 0;
    this.targetTiltX = 0.34;
    this.targetTiltY = -0.24;
    this.targetZoom = 1.0;
    this.userHasPositioned = false;
    this.saveViewState();
    this.spawnShockwave(this.width / 2, this.height / 2, this.theme.goldPrimary, 1.1);
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (this.isPickingLocation && e.button === 0) {
        const coords = this.screenToCircleCoords(mx, my);
        const cb = this.pickLocationCallback;
        this.cancelPickingLocation();
        this.spawnShockwave(mx, my, '#73F3FF', 0.9);
        if (cb) cb(coords);
        return;
      }

      if (e.button === 0 || e.button === 2) {
        this.updateHover(mx, my);
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.dragMoved = 0;
        this.wheelVelocity = 0;

        // Se clicou sobre um astro com Modo Mover ativo, ou com Shift, ou com Botao Direito -> Arrasta o Astro!
        if (this.hoveredPoint && (this.isMovePointsMode || e.shiftKey || e.button === 2)) {
          this.draggingPoint = this.hoveredPoint;
        } else {
          this.draggingPoint = null;
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPaused) return;
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (this.isPickingLocation) {
        this.previewCursorCoords = this.screenToCircleCoords(mx, my);
        this.canvas.style.cursor = 'crosshair';
        return;
      }

      if (this.isDragging) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.dragMoved += Math.abs(dx) + Math.abs(dy);

        if (this.draggingPoint && this.dragMoved >= 4) {
          // Move a estrela diretamente para onde o mouse está no circulo!
          const coords = this.screenToCircleCoords(mx, my);
          this.draggingPoint.angle = coords.angle;
          this.draggingPoint.orbit = coords.orbit;
          this.draggingPoint.customRadius = coords.customRadius;
          this.canvas.style.cursor = 'grabbing';
          this.lastMouseX = e.clientX;
          this.lastMouseY = e.clientY;
          return;
        }

        // Gira o circulo suavemente em 2D e 3D e mantem exatamente onde o usuario parar
        const deltaWheel = dx * 0.0052 * this.sensitivity;
        this.wheelRotation += deltaWheel;
        this.wheelVelocity = 0;

        if (this.modeBlend > 0.1) {
          this.targetTiltY = Math.max(-1.05, Math.min(1.05, this.targetTiltY + dx * 0.0034 * this.sensitivity));
          this.targetTiltX = Math.max(-1.05, Math.min(1.05, this.targetTiltX + dy * 0.0034 * this.sensitivity));
        }

        this.userHasPositioned = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      } else {
        this.updateHover(mx, my);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.wheelVelocity = 0;

      if (this.draggingPoint && this.dragMoved >= 6) {
        const movedPt = this.draggingPoint;
        this.draggingPoint = null;
        this.spawnShockwave(e.clientX, e.clientY, '#73F3FF', 0.85);
        if (this.callbacks.onPointMoved) {
          this.callbacks.onPointMoved(movedPt);
        }
        return;
      }
      this.draggingPoint = null;

      if (this.dragMoved >= 4) {
        this.saveViewState();
      }

      if (this.dragMoved < 8) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        this.updateHover(mx, my);

        if (this.hoveredPoint) {
          if (e.button === 2) {
            if (this.callbacks.onPointEdit) {
              this.callbacks.onPointEdit(this.hoveredPoint);
            }
          } else {
            this.triggerPointBurst(this.hoveredPoint);
            if (this.callbacks.onPointClick) {
              this.callbacks.onPointClick(this.hoveredPoint);
            }
          }
        } else if (this.nexusHovered && e.button === 0) {
          // Clicar no Nexus de Origem executa a Acao Orbital 2D/3D (pulso + alternancia de modo)
          const newMode = this.toggleProjectionMode();
          if (this.callbacks.onNexusAction) {
            this.callbacks.onNexusAction(newMode);
          }
        }
      }
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.ctrlKey) {
          this.targetZoom = Math.max(0.65, Math.min(1.45, this.targetZoom - e.deltaY * 0.001));
        } else {
          const step = (e.deltaY || e.deltaX) * 0.0018 * this.sensitivity;
          this.wheelRotation += step;
          this.wheelVelocity = 0;
        }
        this.userHasPositioned = true;
        this.saveViewState();
      },
      { passive: false }
    );
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  /**
   * Projeta coordenadas (x, y, z) interpolando suavemente entre:
   * - Modo 2D (modeBlend = 0): Plano 2D fiel a imagem de referencia (tilt = 0, z = 0)
   * - Modo 3D (modeBlend = 1): Perspectiva 3D completa com inclinacao X/Y e elevacao Z
   */
  project3D(x, y, z, radiusBase) {
    const blend = this.modeBlend;
    const effTiltX = this.tiltX * blend;
    const effTiltY = this.tiltY * blend;
    const effZ = z * blend;

    const cosX = Math.cos(effTiltX);
    const sinX = Math.sin(effTiltX);
    const cosY = Math.cos(effTiltY);
    const sinY = Math.sin(effTiltY);

    const x1 = x * cosY - effZ * sinY;
    const z1 = effZ * cosY + x * sinY;
    const y1 = y;

    const y2 = y1 * cosX - z1 * sinX;
    const z2 = z1 * cosX + y1 * sinX;
    const x2 = x1;

    const fov = 3.2;
    const perspective = fov / (fov + z2 * 0.85 * blend);
    const scale = perspective * this.zoom;

    return {
      x: this.width / 2 + x2 * radiusBase * scale,
      y: this.height / 2 + y2 * radiusBase * scale,
      z: z2,
      scale
    };
  }

  draw3DRing(
    ctx,
    radiusNorm,
    offsetX = 0,
    offsetY = 0,
    offsetZ = 0,
    ringTiltX = 0,
    ringTiltY = 0,
    color = '#E5B84B',
    lineWidth = 1.6,
    segments = 96,
    dashed = false
  ) {
    const baseR = Math.min(this.width, this.height) * 0.42 * this.introProgress;
    const blend = this.modeBlend;
    const effRingTiltX = ringTiltX * blend;
    const effRingTiltY = ringTiltY * blend;
    const effOffsetZ = offsetZ * blend;

    ctx.save();
    ctx.beginPath();
    if (dashed) {
      ctx.setLineDash([4, 6]);
    }

    const cRX = Math.cos(effRingTiltX);
    const sRX = Math.sin(effRingTiltX);
    const cRY = Math.cos(effRingTiltY);
    const sRY = Math.sin(effRingTiltY);

    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2 + this.wheelRotation * 0.25;
      const lx = Math.cos(theta) * radiusNorm;
      const ly = Math.sin(theta) * radiusNorm;

      const rx1 = lx * cRY;
      const rz1 = lx * sRY;
      const ry1 = ly * cRX - rz1 * sRX;
      const rz2 = rz1 * cRX + ly * sRX;

      const p = this.project3D(rx1 + offsetX, ry1 + offsetY, rz2 + effOffsetZ, baseR);
      if (i === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  updateHover(mx, my) {
    let closest = null;
    let minDist = 36;

    for (const item of this.projectedPoints) {
      const dx = mx - item.screen.x;
      const dy = my - item.screen.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        closest = item.point;
      }
    }

    const ndx = mx - this.nexusScreenPos.x;
    const ndy = my - this.nexusScreenPos.y;
    this.nexusHovered = !closest && Math.sqrt(ndx * ndx + ndy * ndy) < 24;

    if (this.hoveredPoint !== closest) {
      this.hoveredPoint = closest;
      if (this. callbacks && this.callbacks.onPointHover) {
        this.callbacks.onPointHover(closest);
      }
    }

    this.canvas.style.cursor =
      closest || this.nexusHovered ? 'pointer' : this.isDragging ? 'grabbing' : 'grab';
  }

  animate() {
    if (this.isPaused) {
      this.rafId = null;
      return;
    }

    const timeStep = this.hoveredPoint ? 0 : 0.011;
    this.constellationTime += timeStep;
    this.radarAngle = (this.radarAngle + 0.014) % (Math.PI * 2);
    this.reticleAngle = (this.reticleAngle + 0.022) % (Math.PI * 2);

    if (this.introProgress < 1) {
      this.introProgress = Math.min(1, this.introProgress + 0.055);
    }

    // Interpolacao suave entre Modo 2D (0.0) e Modo 3D (1.0)
    this.modeBlend += (this.targetModeBlend - this.modeBlend) * 0.14;
    if (Math.abs(this.targetModeBlend - this.modeBlend) < 0.001) {
      this.modeBlend = this.targetModeBlend;
    }

    if (!this.isDragging) {
      this.wheelVelocity *= 0.82;
      if (Math.abs(this.wheelVelocity) < 0.00005) {
        this.wheelVelocity = 0;
      }
      this.wheelRotation += this.wheelVelocity;
    }

    this.tiltX += (this.targetTiltX - this.tiltX) * 0.16;
    this.tiltY += (this.targetTiltY - this.tiltY) * 0.16;
    this.zoom += (this.targetZoom - this.zoom) * 0.16;

    if (this.activePulsePointId) {
      this.activePulseProgress += 0.055;
      if (this.activePulseProgress >= 1) {
        this.activePulsePointId = null;
        this.activePulseProgress = 0;
      }
    }

    // Atualiza ondas de choque (shockwaves)
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += sw.speed;
      sw.alpha = Math.max(0, 1 - sw.radius / sw.maxRadius);
      if (sw.alpha <= 0.02) {
        this.shockwaves.splice(i, 1);
      }
    }

    // Atualiza rajadas de laser nos vetores
    for (let i = this.laserBursts.length - 1; i >= 0; i--) {
      const lb = this.laserBursts[i];
      lb.progress += lb.speed;
      if (lb.progress >= 1) {
        this.laserBursts.splice(i, 1);
      }
    }

    this.render();
    this.rafId = requestAnimationFrame(this.animate);
  }

  render() {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h / 2;
    const blend = this.modeBlend;
    const baseR = Math.min(w, h) * 0.425 * Math.max(0.08, this.introProgress);

    ctx.clearRect(0, 0, w, h);

    // 1. Fundo Degrade Preto Obsidiana e Ouro Imperial
    const bgGrad = ctx.createRadialGradient(cx, cy, baseR * 0.08, cx, cy, Math.max(w, h) * 0.72);
    bgGrad.addColorStop(0, blend < 0.3 ? '#0E0B05' : this.theme.bgSecondary || '#171206');
    bgGrad.addColorStop(0.5, this.theme.bgPrimary || '#040406');
    bgGrad.addColorStop(1, 'rgba(3, 3, 5, 0.84)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. Poeira Estelar Otimizada (sem shadowBlur para maxima taxa de FPS)
    ctx.fillStyle = 'rgba(255, 224, 138, 0.48)';
    ctx.beginPath();
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      s.x += s.vx;
      s.y += s.vy;
      if (s.x > 1.3) s.x = -1.3;
      if (s.x < -1.3) s.x = 1.3;
      if (s.y > 1.3) s.y = -1.3;
      if (s.y < -1.3) s.y = 1.3;

      const sp = this.project3D(s.x, s.y, s.z, baseR);
      const r = s.size * sp.scale;
      ctx.moveTo(sp.x + r, sp.y);
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    }
    ctx.fill();

    // 3. ANEL EXTERNO PRINCIPAL (Astrolabio de Alta Precisao - Bezel Duplo, Pista Metalica e Graduacoes)
    // 3a. Pista metalica de fundo entre os aneis (R = 0.895 ate R = 1.0)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const theta = (i / 96) * Math.PI * 2;
      const p = this.project3D(Math.cos(theta), Math.sin(theta), 0, baseR);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let i = 96; i >= 0; i--) {
      const theta = (i / 96) * Math.PI * 2;
      const p = this.project3D(Math.cos(theta) * 0.895, Math.sin(theta) * 0.895, 0, baseR);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(229, 184, 75, 0.055)';
    ctx.fill();
    ctx.restore();

    // 3b. Coroa 3D cilindrica quando em modo 3D
    if (blend > 0.05) {
      this.draw3DRing(
        ctx,
        1.0,
        0,
        0,
        -0.075,
        0,
        0,
        `rgba(229, 184, 75, ${(0.32 * blend).toFixed(2)})`,
        1.1,
        84
      );
      this.draw3DRing(
        ctx,
        0.895,
        0,
        0,
        0.045,
        0,
        0,
        `rgba(229, 184, 75, ${(0.26 * blend).toFixed(2)})`,
        1.0,
        84,
        true
      );
    }

    // 3c. Anel Orbital Pontilhado Externo (Fiel a reference-astrolabe.jpg - R = 1.032)
    this.draw3DRing(
      ctx,
      1.032,
      0,
      0,
      0,
      0,
      0,
      'rgba(229, 184, 75, 0.38)',
      1.2,
      96,
      true
    );

    // 3d. Borda externa principal e interna com brilho dourado
    this.draw3DRing(ctx, 1.0, 0, 0, 0, 0, 0, 'rgba(229, 184, 75, 0.22)', 5.5, 112);
    this.draw3DRing(ctx, 1.0, 0, 0, 0, 0, 0, this.theme.goldSecondary, 1.5, 112);
    this.draw3DRing(ctx, 0.996, 0, 0, 0, 0, 0, this.theme.goldPrimary, 2.2, 112);
    this.draw3DRing(ctx, 0.895, 0, 0, 0, 0, 0, this.theme.goldPrimary, 2.0, 112);
    this.draw3DRing(ctx, 0.891, 0, 0, 0, 0, 0, 'rgba(229, 184, 75, 0.28)', 1.0, 112);

    // 4. MARCADORES GRADUADOS E COMPASSO ASTRONOMICO NO ULTIMO ANEL
    const numTicks = 72;

    // 4a. Conectores 3D de profundidade (apenas quando em 3D)
    if (blend > 0.08) {
      ctx.beginPath();
      for (let i = 0; i < numTicks; i += 3) {
        const rad = ((i * 5) * Math.PI) / 180 + this.wheelRotation;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);
        const pFront = this.project3D(cosA, sinA, 0, baseR);
        const pDepth = this.project3D(cosA, sinA, -0.075, baseR);
        ctx.moveTo(pFront.x, pFront.y);
        ctx.lineTo(pDepth.x, pDepth.y);
      }
      ctx.strokeStyle = `rgba(229, 184, 75, ${(0.35 * blend).toFixed(2)})`;
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }

    // 4b. 12 Raios Maiores de Divisao que conectam o anel interno ao externo (R = 0.895 a 1.0)
    ctx.beginPath();
    for (let i = 0; i < numTicks; i += 6) {
      const rad = ((i * 5) * Math.PI) / 180 + this.wheelRotation;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      const pIn = this.project3D(cosA * 0.895, sinA * 0.895, 0, baseR);
      const pOut = this.project3D(cosA * 1.0, sinA * 1.0, 0, baseR);
      ctx.moveTo(pIn.x, pIn.y);
      ctx.lineTo(pOut.x, pOut.y);
    }
    ctx.strokeStyle = this.theme.goldSecondary;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 4c. Ticks Hierarquicos de Grau (Batch unico: 15° longos, 5° medios)
    ctx.beginPath();
    for (let i = 0; i < numTicks; i++) {
      if (i % 6 === 0) continue; // Pula os raios maiores ja desenhados
      const rad = ((i * 5) * Math.PI) / 180 + this.wheelRotation;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      const isMajor15 = i % 3 === 0;
      const innerR = isMajor15 ? 0.902 : 0.916;
      const outerR = isMajor15 ? 0.942 : 0.932;
      const pInner = this.project3D(cosA * innerR, sinA * innerR, 0, baseR);
      const pOuter = this.project3D(cosA * outerR, sinA * outerR, 0, baseR);
      ctx.moveTo(pInner.x, pInner.y);
      ctx.lineTo(pOuter.x, pOuter.y);
    }
    ctx.strokeStyle = this.theme.goldPrimary;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // 4d. 12 Indicadores de Barras de Sinal (|||||) a cada 30 graus com pulso de onda
    const barHeights = [0.038, 0.032, 0.025, 0.017, 0.011];
    ctx.beginPath();
    for (let i = 0; i < numTicks; i += 6) {
      const rad = ((i * 5) * Math.PI) / 180 + this.wheelRotation;
      const waveBoost = 1 + Math.sin(this.constellationTime * 3.0 + i * 0.5) * 0.18;
      for (let b = 0; b < barHeights.length; b++) {
        const offsetAngle = rad + (b - 2) * 0.0115;
        const hBar = barHeights[b] * waveBoost;
        const bStart = this.project3D(
          Math.cos(offsetAngle) * (0.991 - hBar),
          Math.sin(offsetAngle) * (0.991 - hBar),
          0,
          baseR
        );
        const bEnd = this.project3D(
          Math.cos(offsetAngle) * 0.991,
          Math.sin(offsetAngle) * 0.991,
          0,
          baseR
        );
        ctx.moveTo(bStart.x, bStart.y);
        ctx.lineTo(bEnd.x, bEnd.y);
      }
    }
    ctx.strokeStyle = this.theme.goldSecondary;
    ctx.lineWidth = 1.7;
    ctx.stroke();

    // 4e. 12 Grupos de 4 Pontos (....) intercalados a cada 30 graus
    ctx.fillStyle = this.theme.goldPrimary;
    ctx.beginPath();
    for (let i = 3; i < numTicks; i += 6) {
      const rad = ((i * 5) * Math.PI) / 180 + this.wheelRotation;
      for (let d = -1.5; d <= 1.5; d += 1) {
        const dotAngle = rad + d * 0.0095;
        const dp = this.project3D(Math.cos(dotAngle) * 0.981, Math.sin(dotAngle) * 0.981, 0, baseR);
        ctx.rect(dp.x - 1.2, dp.y - 1.2, 2.4, 2.4);
      }
    }
    ctx.fill();

    // 4f. Balizas Cardinais Astronomicas (Losangos nos 4 polos cardinais: 0°, 90°, 180°, 270°)
    const cardinalAngles = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
    ctx.save();
    for (let c = 0; c < cardinalAngles.length; c++) {
      const cAng = cardinalAngles[c] + this.wheelRotation;
      const midR = 0.947;
      const cp = this.project3D(Math.cos(cAng) * midR, Math.sin(cAng) * midR, 0, baseR);
      const dSize = 3.8 * cp.scale;

      ctx.beginPath();
      ctx.moveTo(cp.x, cp.y - dSize);
      ctx.lineTo(cp.x + dSize * 0.75, cp.y);
      ctx.lineTo(cp.x, cp.y + dSize);
      ctx.lineTo(cp.x - dSize * 0.75, cp.y);
      ctx.closePath();
      ctx.fillStyle = this.theme.goldSecondary;
      ctx.fill();
      ctx.strokeStyle = this.theme.goldPrimary;
      ctx.lineWidth = 1.0;
      ctx.stroke();

      // Micro-astro brilhante na orbita pontilhada externa
      const outerStarP = this.project3D(Math.cos(cAng) * 1.032, Math.sin(cAng) * 1.032, 0, baseR);
      ctx.beginPath();
      ctx.arc(outerStarP.x, outerStarP.y, 2.2 * outerStarP.scale, 0, Math.PI * 2);
      ctx.fillStyle = this.theme.goldSecondary;
      ctx.fill();
    }
    ctx.restore();

    // 5. CIRCULOS INTERNOS EXCENTRICOS (Geometria 1:1 da imagem reference-astrolabe.jpg em 2D + inclinacao 3D)
    const slowPrecession = Math.sin(this.constellationTime * 0.45) * 0.05 * blend;
    const slowNutation = Math.cos(this.constellationTime * 0.35) * 0.04 * blend;

    // Circulo Excentrico Grande A (R = 0.805)
    this.draw3DRing(
      ctx,
      0.805,
      0.01,
      -0.01,
      0.07 * blend,
      0.21 + slowPrecession,
      -0.14,
      this.theme.goldPrimary,
      1.8,
      104
    );

    // Circulo Excentrico Grande B (R = 0.725, tangenciando o topo perto de 04 7 e 08 1 como na imagem base)
    this.draw3DRing(
      ctx,
      0.725,
      -0.025,
      -0.075,
      -0.08 * blend,
      -0.22 + slowNutation,
      0.17,
      this.theme.goldPrimary,
      1.75,
      104
    );

    // Posicao do Nexus de Origem no quadrante inferior-direito (fiel a imagem reference-astrolabe.jpg)
    const nexusBaseAngle = 0.72 + this.wheelRotation * 0.35;
    const nexusDist = 0.34;
    const nexus3D = {
      x: nexusDist * Math.cos(nexusBaseAngle),
      y: nexusDist * Math.sin(nexusBaseAngle),
      z: 0.07 * Math.sin(this.constellationTime * 0.6) * blend
    };

    // Circulo Excentrico Medio C (R = 0.285, passando pelo astro 01 7 e pelo Nexus)
    this.draw3DRing(
      ctx,
      0.285,
      0.105,
      0.035,
      nexus3D.z * 0.4,
      0.24 - slowNutation,
      0.2 + slowPrecession,
      this.theme.goldPrimary,
      1.7,
      90
    );

    // Circulo D ao redor do Nexus (R = 0.165)
    this.draw3DRing(
      ctx,
      0.165,
      nexus3D.x,
      nexus3D.y,
      nexus3D.z,
      -0.16 + slowPrecession,
      0.18,
      this.theme.goldPrimary,
      1.6,
      80
    );

    // Circulo E Vermelho Carmesim ao redor do Nexus (R = 0.062)
    this.draw3DRing(
      ctx,
      0.062,
      nexus3D.x,
      nexus3D.y,
      nexus3D.z,
      0,
      0,
      this.theme.nexusRed || '#9E2A2B',
      1.3,
      56
    );

    const nexusScreen = this.project3D(nexus3D.x, nexus3D.y, nexus3D.z, baseR);
    this.nexusScreenPos = { x: nexusScreen.x, y: nexusScreen.y, r: 22 };

    // Varredura de Radar Animada emanando do Nexus (Foco nas animacoes 2D e 3D)
    ctx.save();
    const sweepLen = baseR * 0.85 * this.zoom;
    const sx = nexusScreen.x + Math.cos(this.radarAngle) * sweepLen;
    const sy = nexusScreen.y + Math.sin(this.radarAngle) * sweepLen;
    const sweepGrad = ctx.createLinearGradient(nexusScreen.x, nexusScreen.y, sx, sy);
    sweepGrad.addColorStop(0, 'rgba(255, 224, 138, 0.30)');
    sweepGrad.addColorStop(0.6, 'rgba(229, 184, 75, 0.09)');
    sweepGrad.addColorStop(1, 'rgba(229, 184, 75, 0)');
    ctx.beginPath();
    ctx.moveTo(nexusScreen.x, nexusScreen.y);
    ctx.arc(nexusScreen.x, nexusScreen.y, sweepLen, this.radarAngle - 0.22, this.radarAngle);
    ctx.closePath();
    ctx.fillStyle = sweepGrad;
    ctx.fill();
    ctx.restore();

    // 6. POSICOES DOS ASTROS (0 graus = topo 12h, sentido horario, identico a reference-astrolabe.jpg)
    this.projectedPoints = [];
    const orbitRadii = {
      1: 0.165,
      2: 0.725,
      3: 0.855
    };

    for (let idx = 0; idx < this.points.length; idx++) {
      const pt = this.points[idx];
      const orbitNum = Number(pt.orbit) || 3;
      const hasCustomR = typeof pt.customRadius === 'number' && pt.customRadius > 0.08;
      const baseOrbitR = hasCustomR ? Number(pt.customRadius) : orbitRadii[orbitNum] || 0.76;
      const isBeingDragged = this.draggingPoint && this.draggingPoint.id === pt.id;

      // Oscilacao harmonica sutil ao redor do ponto (pausa quando arrastando a estrela)
      const individualDrift = isBeingDragged
        ? 0
        : Math.sin(this.constellationTime * 0.45 + idx * 1.37) * 0.014;
      const radialBreathing = isBeingDragged
        ? 0
        : Math.cos(this.constellationTime * 0.38 + idx * 2.1) * 0.007;
      const orbitR = baseOrbitR + radialBreathing;

      const rad =
        (((Number(pt.angle) || 0) - 90) * Math.PI) / 180 + this.wheelRotation + individualDrift;
      const baseElevZ = ((Number(pt.elevation) || 0) / 100) * 0.72;
      const harmonicZ = Math.sin(this.constellationTime * 0.55 + idx * 1.15) * 0.045;
      const pz = (baseElevZ + harmonicZ) * blend;

      const px = Math.cos(rad) * orbitR;
      const py = Math.sin(rad) * orbitR;

      const screenPt = this.project3D(px, py, pz, baseR);
      const planePt = this.project3D(px, py, 0, baseR);

      this.projectedPoints.push({
        point: pt,
        idx,
        world: { x: px, y: py, z: pz },
        planeScreen: planePt,
        screen: screenPt
      });
    }

    // 7. MALHA DE CONSTELACAO E PARTICULAS DE LUZ ENTRE OS ASTROS
    ctx.save();
    for (let i = 0; i < this.projectedPoints.length; i++) {
      for (let j = i + 1; j < this.projectedPoints.length; j++) {
        const a = this.projectedPoints[i];
        const b = this.projectedPoints[j];
        const dx = a.world.x - b.world.x;
        const dy = a.world.y - b.world.y;
        const dz = a.world.z - b.world.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < 0.85) {
          const alpha = (1 - dist / 0.85) * 0.28;
          ctx.beginPath();
          ctx.moveTo(a.screen.x, a.screen.y);
          ctx.lineTo(b.screen.x, b.screen.y);
          ctx.strokeStyle = `rgba(229, 184, 75, ${alpha.toFixed(3)})`;
          ctx.lineWidth = 0.9;
          ctx.setLineDash([3, 6]);
          ctx.stroke();
          ctx.setLineDash([]);

          const flowT = (this.constellationTime * 0.22 + (i * 0.31 + j * 0.17)) % 1;
          const fx = a.screen.x + (b.screen.x - a.screen.x) * flowT;
          const fy = a.screen.y + (b.screen.y - a.screen.y) * flowT;
          ctx.beginPath();
          ctx.arc(fx, fy, 1.8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 224, 138, ${(alpha * 2.4).toFixed(3)})`;
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // Ordena por profundidade Z
    this.projectedPoints.sort((a, b) => b.screen.z - a.screen.z);

    // 8. VETORES DO NEXUS ATE CADA ASTRO + SETAS DIRECIONAIS + GLIFOS + PULSOS ANIMADOS
    for (const item of this.projectedPoints) {
      const { point, screen: sp, planeScreen: pp } = item;
      const isHovered = this.hoveredPoint && this.hoveredPoint.id === point.id;
      const isGoldVector = point.vectorStyle === 'gold';

      // Haste de elevacao 3D (visivel quando modeBlend > 0.1)
      if (blend > 0.1) {
        const elevDist = Math.hypot(sp.x - pp.x, sp.y - pp.y);
        if (elevDist > 3) {
          ctx.beginPath();
          ctx.moveTo(pp.x, pp.y);
          ctx.lineTo(sp.x, sp.y);
          ctx.strokeStyle = `rgba(255, 224, 138, ${(0.36 * blend).toFixed(2)})`;
          ctx.lineWidth = 1.0;
          ctx.setLineDash([2, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Linha vetorial principal partindo do Nexus
      ctx.beginPath();
      ctx.moveTo(nexusScreen.x, nexusScreen.y);
      ctx.lineTo(sp.x, sp.y);
      ctx.strokeStyle = isHovered
        ? this.theme.goldSecondary
        : isGoldVector
        ? this.theme.goldPrimary
        : this.theme.vectorAccent || '#5C73B8';
      ctx.lineWidth = isHovered ? 2.5 : isGoldVector ? 1.55 : 1.45;
      ctx.stroke();

      // Particula de pulso continuo viajando pelo vetor (animacao fluida em 2D e 3D)
      const streamT = (this.constellationTime * 0.36 + item.idx * 0.19) % 1;
      const stX = nexusScreen.x + (sp.x - nexusScreen.x) * streamT;
      const stY = nexusScreen.y + (sp.y - nexusScreen.y) * streamT;
      ctx.beginPath();
      ctx.arc(stX, stY, isHovered ? 3.2 : 2.1, 0, Math.PI * 2);
      ctx.fillStyle = isGoldVector ? this.theme.goldSecondary : '#9BB8FF';
      ctx.fill();

      // Seta direcional dourada no vetor azul (exatamente como na imagem de referencia)
      if (point.hasArrow || point.vectorStyle === 'blue') {
        const t = 0.39 + Math.sin(this.constellationTime * 1.1 + item.idx) * 0.025;
        const ax = nexusScreen.x + (sp.x - nexusScreen.x) * t;
        const ay = nexusScreen.y + (sp.y - nexusScreen.y) * t;
        const angle = Math.atan2(sp.y - nexusScreen.y, sp.x - nexusScreen.x);

        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(angle);
        ctx.fillStyle = this.theme.goldPrimary;
        ctx.beginPath();
        ctx.moveTo(6.5, 0);
        ctx.lineTo(-5.2, -4.4);
        ctx.lineTo(-3.2, 0);
        ctx.lineTo(-5.2, 4.4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Glifo geometrico (Π, Δ, h, C)
      if (point.glyph) {
        const gt = 0.6;
        const gx = nexusScreen.x + (sp.x - nexusScreen.x) * gt - 16;
        const gy = nexusScreen.y + (sp.y - nexusScreen.y) * gt - 8;
        ctx.font = '600 12.5px "Consolas", "Segoe UI", monospace';
        ctx.fillStyle = this.theme.goldPrimary;
        ctx.fillText(point.glyph, gx, gy);
      }

      // Rajadas de laser ativas no vetor
      for (let b = 0; b < this.laserBursts.length; b++) {
        const lb = this.laserBursts[b];
        if (lb.pointId === point.id) {
          const lx = nexusScreen.x + (sp.x - nexusScreen.x) * lb.progress;
          const ly = nexusScreen.y + (sp.y - nexusScreen.y) * lb.progress;
          ctx.beginPath();
          ctx.arc(lx, ly, 5.2, 0, Math.PI * 2);
          ctx.fillStyle = lb.color;
          ctx.fill();
        }
      }
    }

    // 9. ONDAS DE CHOQUE (SHOCKWAVES) 2D / 3D
    for (let i = 0; i < this.shockwaves.length; i++) {
      const sw = this.shockwaves[i];
      ctx.save();
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.strokeStyle = sw.color;
      ctx.globalAlpha = sw.alpha;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();
    }

    // 10. NO DE ORIGEM NEXUS (Interativo: Clique alterna 2D/3D e dispara pulso orbital)
    ctx.save();
    const nxScale = nexusScreen.scale;
    const nxR = (this.nexusHovered ? 13 : 10.8) * nxScale;

    if (this.nexusHovered) {
      ctx.beginPath();
      ctx.arc(nexusScreen.x, nexusScreen.y, nxR * 2.1, 0, Math.PI * 2);
      ctx.strokeStyle = this.theme.goldSecondary;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.arc(nexusScreen.x, nexusScreen.y, nxR, 0, Math.PI * 2);
    ctx.fillStyle = '#050508';
    ctx.fill();
    ctx.lineWidth = 3.8 * nxScale;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();

    // Etiqueta discreta do modo 2D/3D junto ao Nexus quando sob o mouse
    if (this.nexusHovered) {
      ctx.font = '700 10.5px "Segoe UI", sans-serif';
      ctx.fillStyle = this.theme.goldSecondary;
      ctx.textAlign = 'center';
      ctx.fillText(
        this.projectionMode === '2d' ? 'NEXUS [MODO 2D -> 3D]' : 'NEXUS [MODO 3D -> 2D]',
        nexusScreen.x,
        nexusScreen.y + nxR + 18
      );
    }
    ctx.restore();

    // 11. ASTROS / PONTOS ESTELARES (Fiel a imagem reference-astrolabe.jpg + Reticulas Animadas)
    for (const item of this.projectedPoints) {
      const { point, screen: sp } = item;
      const isHovered = this.hoveredPoint && this.hoveredPoint.id === point.id;
      const nodeR = (isHovered ? 15.0 : 11.8) * sp.scale;

      ctx.save();

      // Anel externo grande nos astros principais (08 7, 09 4, 01 7) e no astro sob o cursor
      if (point.vectorStyle === 'gold' || isHovered) {
        const outerRingR = nodeR * 2.6;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, outerRingR, 0, Math.PI * 2);
        ctx.strokeStyle = isHovered ? this.theme.goldSecondary : this.theme.goldPrimary;
        ctx.lineWidth = isHovered ? 2.1 : 1.55;
        ctx.stroke();

        // Arco reticular animado ao redor do astro em foco
        if (isHovered) {
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, outerRingR + 5, this.reticleAngle, this.reticleAngle + Math.PI * 0.65);
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.8;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(
            sp.x,
            sp.y,
            outerRingR + 5,
            this.reticleAngle + Math.PI,
            this.reticleAngle + Math.PI * 1.65
          );
          ctx.stroke();
        }
      }

      // Circulo principal do Astro
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, nodeR, 0, Math.PI * 2);
      ctx.fillStyle = '#060609';
      ctx.fill();
      ctx.lineWidth = (isHovered ? 3.6 : 3.0) * sp.scale;
      ctx.strokeStyle = isHovered ? this.theme.goldSecondary : this.theme.goldPrimary;
      if (isHovered) {
        ctx.shadowColor = this.theme.goldSecondary;
        ctx.shadowBlur = 16;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Ponteiro de bussola interno apontando na direcao do vetor
      const vecAngle = Math.atan2(sp.y - nexusScreen.y, sp.x - nexusScreen.x);
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(vecAngle);
      ctx.fillStyle = isHovered ? '#FFFFFF' : this.theme.goldPrimary;
      ctx.beginPath();
      ctx.moveTo(nodeR * 0.56, 0);
      ctx.lineTo(-nodeR * 0.42, -nodeR * 0.42);
      ctx.lineTo(-nodeR * 0.2, 0);
      ctx.lineTo(-nodeR * 0.42, nodeR * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Codigo numerico superior (ex: 08 7 ϟ) exatamente como na imagem de referencia
      const codeText = point.code || '00 1';
      ctx.font = `700 ${Math.round(12.5 * sp.scale)}px "Consolas", "Orbitron", "Segoe UI", monospace`;
      ctx.fillStyle = isHovered ? '#FFFFFF' : '#EBF0FF';
      ctx.textAlign = 'center';
      ctx.fillText(`${codeText} ϟ`, sp.x + 3, sp.y - nodeR - 9 * sp.scale);

      if (point.title) {
        ctx.font = `${isHovered ? '700' : '600'} ${Math.round((isHovered ? 12.2 : 10.5) * sp.scale)}px "Segoe UI", sans-serif`;
        ctx.fillStyle = isHovered ? this.theme.goldSecondary : 'rgba(229, 184, 75, 0.90)';
        ctx.fillText(point.title.toUpperCase(), sp.x, sp.y + nodeR + 16 * sp.scale);
      }

      if (this.draggingPoint && this.draggingPoint.id === point.id) {
        ctx.font = '700 11px "Consolas", monospace';
        ctx.fillStyle = '#73F3FF';
        ctx.fillText(
          `POSICAO: ${point.angle}° | ORBITA ${point.orbit}`,
          sp.x,
          sp.y - nodeR - 26 * sp.scale
        );
      }

      ctx.restore();
    }

    // 12. PREVIEW INTERATIVO QUANDO ESCOLHENDO ONDE COLOCAR UM PONTO NO CIRCULO
    if (this.isPickingLocation && this.previewCursorCoords) {
      const pc = this.previewCursorCoords;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(nexusScreen.x, nexusScreen.y);
      ctx.lineTo(pc.screenX, pc.screenY);
      ctx.strokeStyle = '#73F3FF';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(pc.screenX, pc.screenY, 15, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(115, 243, 255, 0.22)';
      ctx.fill();
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = '#73F3FF';
      ctx.stroke();

      ctx.font = '700 12px "Segoe UI", sans-serif';
      ctx.fillStyle = '#73F3FF';
      ctx.textAlign = 'center';
      ctx.fillText(
        `CLIQUE PARA COLOCAR AQUI (${pc.angle}° • Orbita ${pc.orbit})`,
        pc.screenX,
        pc.screenY - 24
      );
      ctx.restore();
    }

    ctx.restore();
  }
}

window.Astrolabe3D = Astrolabe3D;
