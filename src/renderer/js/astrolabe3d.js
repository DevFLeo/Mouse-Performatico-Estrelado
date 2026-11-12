/**
 * Motor Grafico 3D Interativo do Astrolabio M.P.E
 * Baseado na geometria do Astrolabio Dourado com:
 *  - Profundidade 3D expandida (Coroa cilindrica 3D no anel graduado, arcos meridianos 3D,
 *    hastes de elevacao Z entre o plano orbital e cada astro, escala e iluminacao por profundidade Z)
 *  - Movimento lento e organico entre os "astros" como uma constelacao viva (deriva orbital
 *    harmonica independente por astro, filamentos de constelacao dinamicos e particulas de luz
 *    fluindo lentamente entre os astros)
 *  - Rotacao circular interativa para os lados e inclinacao 3D em todos os eixos
 */
class Astrolabe3D {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.callbacks = callbacks;

    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Estado de rotacao 3D e giro circular para os lados (mantem a posicao onde o usuario parar)
    this.wheelRotation = 0;
    this.wheelVelocity = 0;
    this.tiltX = 0.34;
    this.tiltY = -0.24;
    this.targetTiltX = 0.34;
    this.targetTiltY = -0.24;
    this.zoom = 1.0;
    this.targetZoom = 1.0;
    this.userHasPositioned = false;
    this.loadSavedViewState();

    // Controle de arraste interativo
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragMoved = 0;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    // Tempo continuo para o movimento lento de constelacao entre os astros
    this.constellationTime = 0;
    this.introProgress = 1;
    this.activePulsePointId = null;
    this.activePulseProgress = 0;

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

    // Poeira estelar 3D em multiplas camadas de profundidade
    this.stars = [];
    this.initStarfield(180);

    this.bindEvents();
    this.resize();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  initStarfield(count) {
    this.stars = [];
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: (Math.random() - 0.5) * 2.5,
        y: (Math.random() - 0.5) * 2.5,
        z: (Math.random() - 0.5) * 1.8,
        vx: (Math.random() - 0.5) * 0.00035,
        vy: (Math.random() - 0.5) * 0.00035,
        size: Math.random() * 1.9 + 0.4,
        alpha: Math.random() * 0.65 + 0.15,
        phase: Math.random() * Math.PI * 2
      });
    }
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
          userHasPositioned: this.userHasPositioned
        })
      );
    } catch (_) {}
  }

  triggerIntroAnimation(preservePosition = true) {
    this.introProgress = 0;
    if (!preservePosition && !this.userHasPositioned) {
      this.wheelVelocity = 0.015;
      this.tiltX = 0.58;
      this.tiltY = -0.42;
      this.targetTiltX = 0.34;
      this.targetTiltY = -0.24;
    } else {
      // Mantem exatamente o ponto e angulo 3D que o usuario posicionou
      this.wheelVelocity = 0;
    }
  }

  resetView() {
    this.wheelRotation = 0;
    this.wheelVelocity = 0;
    this.targetTiltX = 0.34;
    this.targetTiltY = -0.24;
    this.targetZoom = 1.0;
    this.userHasPositioned = false;
    this.saveViewState();
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0 || e.button === 2) {
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.dragMoved = 0;
        this.wheelVelocity = 0;
      }
    });

    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (this.isDragging) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.dragMoved += Math.abs(dx) + Math.abs(dy);

        // Movimentar gira o circulo 3D e mantem exatamente no ponto onde o usuario soltar
        const deltaWheel = dx * 0.0052 * this.sensitivity;
        this.wheelRotation += deltaWheel;
        this.wheelVelocity = 0;

        this.targetTiltY = Math.max(-1.05, Math.min(1.05, this.targetTiltY + dx * 0.0034 * this.sensitivity));
        this.targetTiltX = Math.max(-1.05, Math.min(1.05, this.targetTiltX + dy * 0.0034 * this.sensitivity));

        this.userHasPositioned = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      } else {
        // Nao reseta para zero ao mover o mouse: mantem o angulo 3D travado no ponto escolhido pelo usuario
        // para facilitar o acionamento preciso do comando estelar
        this.updateHover(mx, my);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.wheelVelocity = 0;
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
            this.activePulsePointId = this.hoveredPoint.id;
            this.activePulseProgress = 0;
            if (this.callbacks.onPointClick) {
              this.callbacks.onPointClick(this.hoveredPoint);
            }
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
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  /**
   * Projeta uma coordenada 3D (x, y, z) no espaco do Astrolabio para (screenX, screenY, scale)
   */
  project3D(x, y, z, radiusBase) {
    const cosX = Math.cos(this.tiltX);
    const sinX = Math.sin(this.tiltX);
    const cosY = Math.cos(this.tiltY);
    const sinY = Math.sin(this.tiltY);

    // 1. Rotacao em Y
    const x1 = x * cosY - z * sinY;
    const z1 = z * cosY + x * sinY;
    const y1 = y;

    // 2. Rotacao em X
    const y2 = y1 * cosX - z1 * sinX;
    const z2 = z1 * cosX + y1 * sinX;
    const x2 = x1;

    // Projecao perspectiva 3D abrangente
    const fov = 2.45;
    const perspective = fov / Math.max(0.4, fov + z2 * 0.68);

    const cx = this.width / 2;
    const cy = this.height / 2;

    return {
      x: cx + x2 * radiusBase * perspective * this.zoom,
      y: cy + y2 * radiusBase * perspective * this.zoom,
      z: z2,
      scale: perspective * this.zoom
    };
  }

  /**
   * Desenha um anel 3D no espaco com deslocamento excentrico (ox, oy, oz) e inclinacao propria
   */
  draw3DRing(ctx, radiusNorm, offsetX, offsetY, offsetZ, ringTiltX, ringTiltY, strokeStyle, lineWidth, segments = 128, dashed = false) {
    const baseR = Math.min(this.width, this.height) * 0.41 * this.introProgress;
    ctx.save();
    if (dashed) {
      ctx.setLineDash([5, 7]);
    }
    ctx.beginPath();

    const cRX = Math.cos(ringTiltX);
    const sRX = Math.sin(ringTiltX);
    const cRY = Math.cos(ringTiltY);
    const sRY = Math.sin(ringTiltY);

    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2 + this.wheelRotation;
      const lx = Math.cos(theta) * radiusNorm;
      const ly = Math.sin(theta) * radiusNorm;
      const lz = 0;

      const ty = ly * cRX - lz * sRX;
      const tz = lz * cRX + ly * sRX;
      const tx = lx * cRY - tz * sRY;
      const fz = tz * cRY + lx * sRY;

      const p = this.project3D(tx + offsetX, ty + offsetY, fz + offsetZ, baseR);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }

    ctx.strokeStyle = strokeStyle;
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

    if (this.hoveredPoint !== closest) {
      this.hoveredPoint = closest;
      this.canvas.style.cursor = closest ? 'pointer' : this.isDragging ? 'grabbing' : 'grab';
      if (this.callbacks.onPointHover) {
        this.callbacks.onPointHover(closest);
      }
    }
  }

  animate() {
    // Quando o mouse esta sobre um astro, pausa o movimento da constelacao para clique instantaneo
    const timeStep = this.hoveredPoint ? 0 : 0.0085;
    this.constellationTime += timeStep;

    if (this.introProgress < 1) {
      this.introProgress = Math.min(1, this.introProgress + 0.035);
    }

    if (!this.isDragging) {
      // Desacelera suavemente e trava exatamente no ponto onde o usuario posicionou o circulo 3D
      this.wheelVelocity *= 0.84;
      if (Math.abs(this.wheelVelocity) < 0.00005) {
        this.wheelVelocity = 0;
      }
      this.wheelRotation += this.wheelVelocity;
    }

    this.tiltX += (this.targetTiltX - this.tiltX) * 0.14;
    this.tiltY += (this.targetTiltY - this.tiltY) * 0.14;
    this.zoom += (this.targetZoom - this.zoom) * 0.14;

    if (this.activePulsePointId) {
      this.activePulseProgress += 0.045;
      if (this.activePulseProgress >= 1) {
        this.activePulsePointId = null;
        this.activePulseProgress = 0;
      }
    }

    this.render();
    requestAnimationFrame(this.animate);
  }

  render() {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h / 2;
    const baseR = Math.min(w, h) * 0.41 * Math.max(0.05, this.introProgress);

    ctx.clearRect(0, 0, w, h);

    // 1. Fundo Degrade Preto e Dourado Imperial com transparencia de Overlay Nativo do Windows
    const bgGrad = ctx.createRadialGradient(cx, cy, baseR * 0.1, cx, cy, Math.max(w, h) * 0.75);
    bgGrad.addColorStop(0, this.theme.bgSecondary || '#171206');
    bgGrad.addColorStop(0.46, this.theme.bgPrimary || '#050508');
    bgGrad.addColorStop(1, 'rgba(2, 2, 4, 0.76)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Halo Dourado volumétrico 3D
    const auraGrad = ctx.createRadialGradient(cx, cy, baseR * 0.55, cx, cy, baseR * 1.28);
    auraGrad.addColorStop(0, 'rgba(229, 184, 75, 0.08)');
    auraGrad.addColorStop(0.5, 'rgba(229, 184, 75, 0.035)');
    auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = auraGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. Poeira Estelar 3D com deriva lenta de constelacao ao fundo
    for (const s of this.stars) {
      s.x += s.vx;
      s.y += s.vy;
      if (s.x > 1.3) s.x = -1.3;
      if (s.x < -1.3) s.x = 1.3;
      if (s.y > 1.3) s.y = -1.3;
      if (s.y < -1.3) s.y = 1.3;

      const sp = this.project3D(
        s.x * Math.cos(this.wheelRotation * 0.2) - s.y * Math.sin(this.wheelRotation * 0.2),
        s.x * Math.sin(this.wheelRotation * 0.2) + s.y * Math.cos(this.wheelRotation * 0.2),
        s.z,
        baseR
      );
      const twinkle = Math.sin(this.constellationTime * 2.2 + s.phase) * 0.28 + 0.72;
      ctx.fillStyle = `rgba(255, 224, 138, ${s.alpha * twinkle})`;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, s.size * sp.scale, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.shadowColor = this.theme.goldPrimary;
    ctx.shadowBlur = 10 * (this.theme.glowIntensity || 0.8);

    // 3. ESTRUTURA 3D EXPANDIDA DO ANEL EXTERNO (Coroa cilindrica 3D com anel de base em Z = -0.07)
    this.draw3DRing(ctx, 1.0, 0, 0, -0.075, 0, 0, 'rgba(229, 184, 75, 0.28)', 1.1, 128);
    this.draw3DRing(ctx, 0.895, 0, 0, 0.045, 0, 0, 'rgba(229, 184, 75, 0.24)', 1.0, 128, true);

    // Anel Principal Duplo Graduado
    this.draw3DRing(ctx, 1.0, 0, 0, 0, 0, 0, this.theme.goldPrimary, 2.3, 160);
    this.draw3DRing(ctx, 0.895, 0, 0, 0, 0, 0, this.theme.goldPrimary, 1.6, 160);

    // Pilares 3D axiais conectando o anel frontal (Z=0) ao anel de profundidade (Z=-0.075) + Ticks de Grau
    const numTicks = 72;
    for (let i = 0; i < numTicks; i++) {
      const deg = i * (360 / numTicks);
      const rad = (deg * Math.PI) / 180 + this.wheelRotation;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);

      // Conector de profundidade 3D a cada 15 graus na coroa externa
      if (i % 3 === 0) {
        const pFront = this.project3D(cosA * 1.0, sinA * 1.0, 0, baseR);
        const pDepth = this.project3D(cosA * 1.0, sinA * 1.0, -0.075, baseR);
        ctx.beginPath();
        ctx.moveTo(pFront.x, pFront.y);
        ctx.lineTo(pDepth.x, pDepth.y);
        ctx.strokeStyle = 'rgba(229, 184, 75, 0.32)';
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }

      const pInner = this.project3D(cosA * 0.912, sinA * 0.912, 0, baseR);
      const pOuter = this.project3D(cosA * 0.932, sinA * 0.932, 0, baseR);
      ctx.beginPath();
      ctx.moveTo(pInner.x, pInner.y);
      ctx.lineTo(pOuter.x, pOuter.y);
      ctx.strokeStyle = this.theme.goldPrimary;
      ctx.lineWidth = i % 6 === 0 ? 2.0 : 1.1;
      ctx.stroke();

      if (i % 6 === 0) {
        const barHeights = [0.036, 0.032, 0.025, 0.016, 0.012];
        for (let b = 0; b < barHeights.length; b++) {
          const offsetAngle = rad + (b - 2) * 0.011;
          const bStart = this.project3D(
            Math.cos(offsetAngle) * (0.992 - barHeights[b]),
            Math.sin(offsetAngle) * (0.992 - barHeights[b]),
            0,
            baseR
          );
          const bEnd = this.project3D(
            Math.cos(offsetAngle) * 0.992,
            Math.sin(offsetAngle) * 0.992,
            0,
            baseR
          );
          ctx.beginPath();
          ctx.moveTo(bStart.x, bStart.y);
          ctx.lineTo(bEnd.x, bEnd.y);
          ctx.strokeStyle = this.theme.goldSecondary;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      } else if (i % 3 === 0) {
        for (let d = -1.5; d <= 1.5; d += 1) {
          const dotAngle = rad + d * 0.009;
          const dp = this.project3D(Math.cos(dotAngle) * 0.982, Math.sin(dotAngle) * 0.982, 0, baseR);
          ctx.fillStyle = this.theme.goldPrimary;
          ctx.fillRect(dp.x - 1, dp.y - 1, 2.2, 2.2);
        }
      }
    }

    // 4. ANEIS ORBITAIS INTERNOS EXCENTRICOS EM 3D (Com precessao lenta de constelacao)
    const slowPrecession = Math.sin(this.constellationTime * 0.45) * 0.06;
    const slowNutation = Math.cos(this.constellationTime * 0.35) * 0.05;

    // Orbita Grande Excentrica 1 + Anel Gemeo de Profundidade 3D
    this.draw3DRing(ctx, 0.78, -0.02, -0.01, 0.08, 0.22 + slowPrecession, -0.14, this.theme.goldPrimary, 1.75, 140);
    this.draw3DRing(ctx, 0.78, -0.02, -0.01, -0.06, 0.22 + slowPrecession, -0.14, 'rgba(229, 184, 75, 0.20)', 0.9, 110, true);

    // Orbita Excentrica 2 (inclinada em plano 3D oposto)
    this.draw3DRing(ctx, 0.68, -0.03, -0.06, -0.09, -0.24 + slowNutation, 0.18, this.theme.goldPrimary, 1.65, 140);

    // Arco Gimbal Equatorial 3D (abrange a profundidade esferica da constelacao)
    this.draw3DRing(ctx, 0.54, 0, 0, 0.02, 0.48 + slowPrecession, 0.32 - slowNutation, 'rgba(92, 115, 184, 0.30)', 1.1, 120, true);

    // Posicao 3D do Nexus de Origem (com respiracao orbital lenta)
    const nexusLocalAngle = 0.92 + this.wheelRotation * 0.35 + Math.sin(this.constellationTime * 0.3) * 0.08;
    const nexus3D = {
      x: 0.31 * Math.cos(nexusLocalAngle),
      y: 0.31 * Math.sin(nexusLocalAngle),
      z: 0.09 * Math.sin(this.constellationTime * 0.6)
    };

    // Aneis ao redor do Nexus em planos 3D
    this.draw3DRing(
      ctx,
      0.31,
      nexus3D.x * 0.48,
      nexus3D.y * 0.25,
      nexus3D.z * 0.5,
      0.26 - slowNutation,
      0.22 + slowPrecession,
      this.theme.goldPrimary,
      1.6,
      110
    );
    this.draw3DRing(
      ctx,
      0.16,
      nexus3D.x,
      nexus3D.y,
      nexus3D.z,
      -0.18 + slowPrecession,
      0.19,
      this.theme.goldPrimary,
      1.5,
      90
    );
    this.draw3DRing(
      ctx,
      0.062,
      nexus3D.x,
      nexus3D.y,
      nexus3D.z,
      0,
      0,
      this.theme.nexusRed || '#9E2A2B',
      1.2,
      64
    );

    const nexusScreen = this.project3D(nexus3D.x, nexus3D.y, nexus3D.z, baseR);

    // 5. CALCULAR POSICOES 3D DOS "ASTROS" COM MOVIMENTO LENTO DE CONSTELACAO
    this.projectedPoints = [];
    const orbitRadii = {
      1: 0.31,
      2: 0.72,
      3: 0.895
    };

    // Cada astro possui uma oscilacao harmonica sutil (sem sair do ponto onde o usuario posicionou),
    // gerando movimento organico lento entre os astros como uma constelacao viva
    for (let idx = 0; idx < this.points.length; idx++) {
      const pt = this.points[idx];
      const orbitNum = Number(pt.orbit) || 3;
      const baseOrbitR = orbitRadii[orbitNum] || 0.76;

      // Oscilacao harmonica limitada ao redor do ponto (mantem o astro na posicao onde o usuario parar)
      const individualDrift = Math.sin(this.constellationTime * 0.48 + idx * 1.37) * 0.024;

      // Respiracao radial e oscilacao lenta em profundidade Z (3D)
      const radialBreathing = Math.cos(this.constellationTime * 0.38 + idx * 2.1) * 0.014;
      const orbitR = baseOrbitR + radialBreathing;

      const rad = ((Number(pt.angle) || 0) * Math.PI) / 180 + this.wheelRotation + individualDrift;
      const baseElevZ = ((Number(pt.elevation) || 0) / 100) * 0.75;
      const harmonicZ = Math.sin(this.constellationTime * 0.55 + idx * 1.15) * 0.055;
      const pz = baseElevZ + harmonicZ;

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

    // 6. FILAMENTOS DE CONSTELACAO ENTRE OS ASTROS + PARTICULAS LENTAS DE LUZ
    ctx.save();
    for (let i = 0; i < this.projectedPoints.length; i++) {
      for (let j = i + 1; j < this.projectedPoints.length; j++) {
        const a = this.projectedPoints[i];
        const b = this.projectedPoints[j];
        const dx = a.world.x - b.world.x;
        const dy = a.world.y - b.world.y;
        const dz = a.world.z - b.world.z;
        const dist3D = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Conecta astros vizinhos no espaco 3D formando uma malha de constelacao viva
        if (dist3D < 0.88) {
          const alpha = (1 - dist3D / 0.88) * 0.34;
          ctx.beginPath();
          ctx.moveTo(a.screen.x, a.screen.y);
          ctx.lineTo(b.screen.x, b.screen.y);
          ctx.strokeStyle = `rgba(229, 184, 75, ${alpha.toFixed(3)})`;
          ctx.lineWidth = 0.95;
          ctx.setLineDash([3, 6]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Particula estelar viajando lentamente pelo filamento entre os dois astros
          const flowT = (this.constellationTime * 0.18 + (i * 0.31 + j * 0.17)) % 1;
          const fx = a.screen.x + (b.screen.x - a.screen.x) * flowT;
          const fy = a.screen.y + (b.screen.y - a.screen.y) * flowT;
          ctx.beginPath();
          ctx.arc(fx, fy, 1.9, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 224, 138, ${(alpha * 2.2).toFixed(3)})`;
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // Ordena por profundidade Z para renderizacao 3D correta
    this.projectedPoints.sort((a, b) => b.screen.z - a.screen.z);

    // 7. HASTES DE ELEVACAO 3D (Conectam cada Astro a sua projecao no plano orbital Z=0) + VETORES DO NEXUS
    for (const item of this.projectedPoints) {
      const { point, screen: sp, planeScreen: pp } = item;
      const isHovered = this.hoveredPoint && this.hoveredPoint.id === point.id;
      const isGoldVector = point.vectorStyle === 'gold';

      ctx.save();

      // Haste de Profundidade 3D (mostra visualmente o quanto o astro flutua em 3D acima/abaixo do plano)
      const elevDist = Math.hypot(sp.x - pp.x, sp.y - pp.y);
      if (elevDist > 3) {
        ctx.beginPath();
        ctx.moveTo(pp.x, pp.y);
        ctx.lineTo(sp.x, sp.y);
        ctx.strokeStyle = 'rgba(255, 224, 138, 0.38)';
        ctx.lineWidth = 1.1;
        ctx.setLineDash([2, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Pequeno anel de ancoragem no plano orbital Z=0
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 3.2 * pp.scale, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(229, 184, 75, 0.55)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }

      // Linha vetorial do Nexus ate o Astro
      ctx.beginPath();
      ctx.moveTo(nexusScreen.x, nexusScreen.y);
      ctx.lineTo(sp.x, sp.y);

      if (isHovered) {
        ctx.strokeStyle = this.theme.goldSecondary;
        ctx.lineWidth = 2.4;
        ctx.shadowColor = this.theme.goldSecondary;
        ctx.shadowBlur = 16;
      } else if (isGoldVector) {
        ctx.strokeStyle = this.theme.goldPrimary;
        ctx.lineWidth = 1.45;
        ctx.shadowBlur = 4;
      } else {
        ctx.strokeStyle = this.theme.vectorAccent || '#5C73B8';
        ctx.lineWidth = 1.35;
        ctx.shadowBlur = 0;
      }
      ctx.stroke();

      // Seta direcional no vetor (com deslize harmonico suave)
      if (point.hasArrow) {
        const t = 0.40 + Math.sin(this.constellationTime * 0.8 + item.idx) * 0.04;
        const ax = nexusScreen.x + (sp.x - nexusScreen.x) * t;
        const ay = nexusScreen.y + (sp.y - nexusScreen.y) * t;
        const angle = Math.atan2(sp.y - nexusScreen.y, sp.x - nexusScreen.x);

        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(angle);
        ctx.fillStyle = this.theme.goldPrimary;
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(-5, -4.2);
        ctx.lineTo(-3, 0);
        ctx.lineTo(-5, 4.2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Glifo geometrico (Π, Δ, h, C)
      if (point.glyph) {
        const gt = 0.62;
        const gx = nexusScreen.x + (sp.x - nexusScreen.x) * gt - 18;
        const gy = nexusScreen.y + (sp.y - nexusScreen.y) * gt - 8;
        ctx.font = '600 12px "Segoe UI", Consolas, monospace';
        ctx.fillStyle = this.theme.goldPrimary;
        ctx.fillText(point.glyph, gx, gy);
      }

      // Pulso energetico ao acionar o astro
      if (this.activePulsePointId === point.id) {
        const px = nexusScreen.x + (sp.x - nexusScreen.x) * this.activePulseProgress;
        const py = nexusScreen.y + (sp.y - nexusScreen.y) * this.activePulseProgress;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = this.theme.goldSecondary;
        ctx.shadowBlur = 20;
        ctx.fill();
      }

      ctx.restore();
    }

    // 8. Desenha o No Central Nexus
    ctx.save();
    ctx.beginPath();
    ctx.arc(nexusScreen.x, nexusScreen.y, 10.5 * nexusScreen.scale, 0, Math.PI * 2);
    ctx.fillStyle = '#050508';
    ctx.fill();
    ctx.lineWidth = 3.8 * nexusScreen.scale;
    ctx.strokeStyle = '#FFFFFF';
    ctx.shadowColor = '#FFFFFF';
    ctx.shadowBlur = 12;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(nexusScreen.x - 5 * nexusScreen.scale, nexusScreen.y + 4 * nexusScreen.scale);
    ctx.lineTo(nexusScreen.x + 5 * nexusScreen.scale, nexusScreen.y - 4 * nexusScreen.scale);
    ctx.strokeStyle = this.theme.goldPrimary;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    // 9. Desenha cada Astro Salvo (Com Halo 3D, Seta Direcional, Codigo e Titulo)
    for (const item of this.projectedPoints) {
      const { point, screen: sp } = item;
      const isHovered = this.hoveredPoint && this.hoveredPoint.id === point.id;
      const nodeR = (isHovered ? 14.8 : 11.5) * sp.scale;

      ctx.save();

      if (point.vectorStyle === 'gold' || isHovered) {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, nodeR * 2.55, 0, Math.PI * 2);
        ctx.strokeStyle = isHovered ? this.theme.goldSecondary : this.theme.goldPrimary;
        ctx.lineWidth = isHovered ? 2.0 : 1.5;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(sp.x, sp.y, nodeR, 0, Math.PI * 2);
      ctx.fillStyle = '#07070A';
      ctx.fill();
      ctx.lineWidth = (isHovered ? 3.6 : 3.0) * sp.scale;
      ctx.strokeStyle = isHovered ? this.theme.goldSecondary : this.theme.goldPrimary;
      ctx.shadowColor = this.theme.goldPrimary;
      ctx.shadowBlur = isHovered ? 22 : 10;
      ctx.stroke();

      const vecAngle = Math.atan2(sp.y - nexusScreen.y, sp.x - nexusScreen.x);
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(vecAngle);
      ctx.fillStyle = isHovered ? '#FFFFFF' : this.theme.goldPrimary;
      ctx.beginPath();
      ctx.moveTo(nodeR * 0.55, 0);
      ctx.lineTo(-nodeR * 0.42, -nodeR * 0.42);
      ctx.lineTo(-nodeR * 0.2, 0);
      ctx.lineTo(-nodeR * 0.42, nodeR * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      const codeText = point.code || '00 1';
      ctx.font = `700 ${Math.round(12.5 * sp.scale)}px "Consolas", "Orbitron", "Segoe UI", monospace`;
      ctx.fillStyle = isHovered ? '#FFFFFF' : '#EBF0FF';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 6;
      ctx.fillText(`${codeText} ϟ`, sp.x + 4, sp.y - nodeR - 9 * sp.scale);

      if (point.title) {
        ctx.font = `${isHovered ? '700' : '500'} ${Math.round((isHovered ? 12.5 : 10.5) * sp.scale)}px "Segoe UI", sans-serif`;
        ctx.fillStyle = isHovered ? this.theme.goldSecondary : 'rgba(229, 184, 75, 0.88)';
        ctx.fillText(point.title.toUpperCase(), sp.x, sp.y + nodeR + 16 * sp.scale);
      }

      ctx.restore();
    }

    ctx.restore();
  }
}

window.Astrolabe3D = Astrolabe3D;
