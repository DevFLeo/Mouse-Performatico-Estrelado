/**
 * Motor Gráfico 3D Interativo do Astrolábio M.P.E
 * Renderiza fielmente a geometria estelar da imagem de referência em um espaço 3D real:
 *  - Anel graduado externo com marcadores de telemetria e barras sci-fi
 *  - Anéis orbitais excêntricos inclinados em planos 3D (Eixos X, Y, Z)
 *  - Nexus de Origem (anel branco + halo carmesim + órbitas douradas)
 *  - Vetores de trajetória (Dourados e Azul-Celeste) com setas direcionais (▲) e glifos (Π, Δ, h, C)
 *  - Rotação circular interativa para os lados (arrastar mouse, scroll wheel ou teclado) com física inercial
 */
class Astrolabe3D {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.callbacks = callbacks;

    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Estado de rotação 3D e giro circular para os lados
    this.wheelRotation = 0;        // Giro circular principal (movimento para os lados)
    this.wheelVelocity = 0.0018;   // Velocidade inercial do círculo
    this.tiltX = 0.22;             // Inclinação 3D no eixo X (perspectiva)
    this.tiltY = -0.18;            // Inclinação 3D no eixo Y
    this.targetTiltX = 0.22;
    this.targetTiltY = -0.18;
    this.zoom = 1.0;
    this.targetZoom = 1.0;

    // Controle de arraste interativo
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragMoved = 0;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    // Animação de inicialização (0 -> 1)
    this.introProgress = 1;
    this.pulseTime = 0;
    this.activePulsePointId = null;
    this.activePulseProgress = 0;

    // Dados e Tema
    this.points = [];
    this.hoveredPoint = null;
    this.selectedPoint = null;
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

    // Partículas de poeira estelar ao fundo em 3D
    this.stars = [];
    this.initStarfield(140);

    this.bindEvents();
    this.resize();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  initStarfield(count) {
    this.stars = [];
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: (Math.random() - 0.5) * 2.4,
        y: (Math.random() - 0.5) * 2.4,
        z: (Math.random() - 0.5) * 1.5,
        size: Math.random() * 1.8 + 0.4,
        alpha: Math.random() * 0.65 + 0.15,
        twinkleSpeed: Math.random() * 0.03 + 0.01
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

  triggerIntroAnimation() {
    this.introProgress = 0;
    this.wheelVelocity = 0.045;
    this.tiltX = 0.68;
    this.tiltY = -0.52;
    this.targetTiltX = 0.20;
    this.targetTiltY = -0.15;
  }

  resetView() {
    this.targetTiltX = 0.18;
    this.targetTiltY = -0.14;
    this.wheelVelocity = 0.012;
    this.targetZoom = 1.0;
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

        // Movimentar para os lados gira o círculo 3D + inclina a perspectiva
        const deltaWheel = (dx * 0.0055) * this.sensitivity;
        this.wheelRotation += deltaWheel;
        this.wheelVelocity = deltaWheel * 0.85;

        this.targetTiltY = Math.max(-0.85, Math.min(0.85, this.targetTiltY + dx * 0.0028 * this.sensitivity));
        this.targetTiltX = Math.max(-0.85, Math.min(0.85, this.targetTiltX + dy * 0.0028 * this.sensitivity));

        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      } else {
        // Parallax suave conforme posição do mouse na tela
        const normX = (mx / this.width - 0.5) * 2;
        const normY = (my / this.height - 0.5) * 2;
        this.targetTiltY = normX * 0.32 * this.sensitivity;
        this.targetTiltX = 0.18 + normY * 0.28 * this.sensitivity;

        this.updateHover(mx, my);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;

      // Se foi um clique rápido (sem arrastar), verifica se clicou em uma Estrela Salva
      if (this.dragMoved < 8) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        this.updateHover(mx, my);

        if (this.hoveredPoint) {
          if (e.button === 2) {
            // Botão direito sobre um ponto abre edição direta daquele ponto
            if (this.callbacks.onPointEdit) {
              this.callbacks.onPointEdit(this.hoveredPoint);
            }
          } else {
            // Clique esquerdo dispara a ação da estrela com pulso energético
            this.activePulsePointId = this.hoveredPoint.id;
            this.activePulseProgress = 0;
            if (this.callbacks.onPointClick) {
              this.callbacks.onPointClick(this.hoveredPoint);
            }
          }
        }
      }
    });

    // Scroll do mouse gira o círculo 3D para os lados ou dá zoom se Ctrl estiver pressionado
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.ctrlKey) {
          this.targetZoom = Math.max(0.65, Math.min(1.45, this.targetZoom - e.deltaY * 0.001));
        } else {
          const step = (e.deltaY || e.deltaX) * 0.0018 * this.sensitivity;
          this.wheelVelocity += step * 0.35;
          this.wheelRotation += step;
        }
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
   * Projeta uma coordenada 3D (x, y, z) no espaço do Astrolábio para (screenX, screenY, scale)
   */
  project3D(x, y, z, radiusBase) {
    // Rotação no eixo X (inclinação vertical) e eixo Y (inclinação lateral)
    const cosX = Math.cos(this.tiltX);
    const sinX = Math.sin(this.tiltX);
    const cosY = Math.cos(this.tiltY);
    const sinY = Math.sin(this.tiltY);

    // 1. Rotaciona em Y
    const x1 = x * cosY - z * sinY;
    const z1 = z * cosY + x * sinY;
    const y1 = y;

    // 2. Rotaciona em X
    const y2 = y1 * cosX - z1 * sinX;
    const z2 = z1 * cosX + y1 * sinX;
    const x2 = x1;

    // Projeção perspectiva
    const fov = 2.9;
    const perspective = fov / (fov + z2 * 0.55);

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
   * Desenha um anel 3D no espaço com deslocamento excêntrico (ox, oy, oz) e inclinação própria
   */
  draw3DRing(ctx, radiusNorm, offsetX, offsetY, offsetZ, ringTiltX, ringTiltY, strokeStyle, lineWidth, segments = 120) {
    const baseR = Math.min(this.width, this.height) * 0.41 * this.introProgress;
    ctx.beginPath();

    const cRX = Math.cos(ringTiltX);
    const sRX = Math.sin(ringTiltX);
    const cRY = Math.cos(ringTiltY);
    const sRY = Math.sin(ringTiltY);

    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2 + this.wheelRotation;
      let lx = Math.cos(theta) * radiusNorm;
      let ly = Math.sin(theta) * radiusNorm;
      let lz = 0;

      // Inclinação intrínseca da órbita
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
  }

  updateHover(mx, my) {
    let closest = null;
    let minDist = 34;

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
    this.pulseTime += 0.025;

    // Evolução suave da animação de entrada
    if (this.introProgress < 1) {
      this.introProgress = Math.min(1, this.introProgress + 0.022);
    }

    // Física de rotação circular lateral com inércia
    if (!this.isDragging) {
      if (this.autoOrbit) {
        this.wheelVelocity += (0.0012 - this.wheelVelocity) * 0.04;
      } else {
        this.wheelVelocity *= 0.94;
      }
      this.wheelRotation += this.wheelVelocity;
    }

    this.tiltX += (this.targetTiltX - this.tiltX) * 0.085;
    this.tiltY += (this.targetTiltY - this.tiltY) * 0.085;
    this.zoom += (this.targetZoom - this.zoom) * 0.1;

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

    // Halo Dourado sutil ao redor do Astrolábio
    const auraGrad = ctx.createRadialGradient(cx, cy, baseR * 0.65, cx, cy, baseR * 1.25);
    auraGrad.addColorStop(0, 'rgba(229, 184, 75, 0.07)');
    auraGrad.addColorStop(0.5, 'rgba(229, 184, 75, 0.03)');
    auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = auraGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. Poeira Estelar 3D ao Fundo
    for (const s of this.stars) {
      const sp = this.project3D(
        s.x * Math.cos(this.wheelRotation * 0.25) - s.y * Math.sin(this.wheelRotation * 0.25),
        s.x * Math.sin(this.wheelRotation * 0.25) + s.y * Math.cos(this.wheelRotation * 0.25),
        s.z,
        baseR
      );
      const twinkle = Math.sin(this.pulseTime * 2 + s.x * 10) * 0.25 + 0.75;
      ctx.fillStyle = `rgba(255, 224, 138, ${s.alpha * twinkle})`;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, s.size * sp.scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // Configura brilho dourado
    ctx.shadowColor = this.theme.goldPrimary;
    ctx.shadowBlur = 10 * (this.theme.glowIntensity || 0.8);

    // 3. ANEL EXTERNO DUPLO GRADUADO (Fiel à imagem de referência)
    this.draw3DRing(ctx, 1.0, 0, 0, 0, 0, 0, this.theme.goldPrimary, 2.3, 160);
    this.draw3DRing(ctx, 0.895, 0, 0, 0, 0, 0, this.theme.goldPrimary, 1.6, 160);

    // Marcações de Graus (Ticks) e Barras Equalizadoras Sci-Fi a cada 30°
    const numTicks = 72;
    for (let i = 0; i < numTicks; i++) {
      const deg = i * (360 / numTicks);
      const rad = (deg * Math.PI) / 180 + this.wheelRotation;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);

      // Tick interno (entre 0.905 e 0.922)
      const pInner = this.project3D(cosA * 0.912, sinA * 0.912, 0, baseR);
      const pOuter = this.project3D(cosA * 0.932, sinA * 0.932, 0, baseR);
      ctx.beginPath();
      ctx.moveTo(pInner.x, pInner.y);
      ctx.lineTo(pOuter.x, pOuter.y);
      ctx.strokeStyle = this.theme.goldPrimary;
      ctx.lineWidth = i % 6 === 0 ? 2.0 : 1.1;
      ctx.stroke();

      // A cada 30 graus (i % 6 === 0): desenha o cluster de barras graduadas igual à imagem
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
        // Pontos quádruplos (....) intermediários na borda externa
        for (let d = -1.5; d <= 1.5; d += 1) {
          const dotAngle = rad + d * 0.009;
          const dp = this.project3D(Math.cos(dotAngle) * 0.982, Math.sin(dotAngle) * 0.982, 0, baseR);
          ctx.fillStyle = this.theme.goldPrimary;
          ctx.fillRect(dp.x - 1, dp.y - 1, 2.2, 2.2);
        }
      }
    }

    // 4. ANÉIS ORBITAIS INTERNOS EXCÊNTRICOS EM 3D (Idênticos à geometria da imagem)
    // Órbita Grande Excêntrica 1
    this.draw3DRing(ctx, 0.78, -0.02, -0.01, 0.06, 0.14, -0.08, this.theme.goldPrimary, 1.75, 140);
    // Órbita Excêntrica 2 (deslocada para cima/esquerda como na imagem)
    this.draw3DRing(ctx, 0.68, -0.03, -0.06, -0.07, -0.16, 0.12, this.theme.goldPrimary, 1.65, 140);

    // Posição 3D do Nexus de Origem (deslocado para baixo/direita como na imagem de referência)
    const nexusLocalAngle = 0.92 + this.wheelRotation * 0.35;
    const nexus3D = {
      x: 0.31 * Math.cos(nexusLocalAngle),
      y: 0.31 * Math.sin(nexusLocalAngle),
      z: 0.08 * Math.sin(this.pulseTime * 0.7)
    };

    // Anéis concêntricos/excêntricos ao redor do Nexus (como na imagem)
    this.draw3DRing(
      ctx,
      0.31,
      nexus3D.x * 0.48,
      nexus3D.y * 0.25,
      nexus3D.z * 0.5,
      0.22,
      0.18,
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
      -0.12,
      0.15,
      this.theme.goldPrimary,
      1.5,
      90
    );
    // Anel fino carmesim/vermelho ao redor do Nexus (presente na imagem de referência!)
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

    // 5. CALCULAR E RENDERIZAR VETORES E PONTOS ESTELARES SALVOS
    this.projectedPoints = [];
    const orbitRadii = {
      1: 0.31,
      2: 0.72,
      3: 0.895
    };

    for (let idx = 0; idx < this.points.length; idx++) {
      const pt = this.points[idx];
      const orbitR = orbitRadii[pt.orbit] || 0.76;
      const rad = ((Number(pt.angle) || 0) * Math.PI) / 180 + this.wheelRotation;
      const elevZ = ((Number(pt.elevation) || 0) / 100) * 0.65;

      // Posição 3D do ponto estelar
      const px = Math.cos(rad) * orbitR;
      const py = Math.sin(rad) * orbitR;
      const pz = elevZ;

      const screenPt = this.project3D(px, py, pz, baseR);
      this.projectedPoints.push({
        point: pt,
        world: { x: px, y: py, z: pz },
        screen: screenPt
      });
    }

    // Ordena por profundidade Z (Back-to-Front painter's algorithm)
    this.projectedPoints.sort((a, b) => b.screen.z - a.screen.z);

    // 6. Desenha as linhas vetoriais do Nexus até cada Estrela Salva
    for (const item of this.projectedPoints) {
      const { point, screen: sp } = item;
      const isHovered = this.hoveredPoint && this.hoveredPoint.id === point.id;
      const isGoldVector = point.vectorStyle === 'gold';

      ctx.save();
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

      // Se o vetor possui seta direcional intermediária (▲) como na imagem de referência
      if (point.hasArrow) {
        const t = 0.42;
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

      // Se o vetor possui glifo geométrico (Π, Δ, h, C) igual à imagem de referência
      if (point.glyph) {
        const gt = 0.62;
        const gx = nexusScreen.x + (sp.x - nexusScreen.x) * gt - 18;
        const gy = nexusScreen.y + (sp.y - nexusScreen.y) * gt - 8;
        ctx.font = '600 12px "Segoe UI", Consolas, monospace';
        ctx.fillStyle = this.theme.goldPrimary;
        ctx.fillText(point.glyph, gx, gy);
      }

      // Se esta estrela acabou de ser clicada, renderiza o pulso energético ao longo do vetor
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

    // 7. Desenha o Nó Central Nexus (Anel Branco Brilhante)
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

    // Linha interna diagonal do Nexus (igual à imagem)
    ctx.beginPath();
    ctx.moveTo(nexusScreen.x - 5 * nexusScreen.scale, nexusScreen.y + 4 * nexusScreen.scale);
    ctx.lineTo(nexusScreen.x + 5 * nexusScreen.scale, nexusScreen.y - 4 * nexusScreen.scale);
    ctx.strokeStyle = this.theme.goldPrimary;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    // 8. Desenha cada Ponto Estelar Salvo (Círculo Dourado + Seta Interna + Código Sci-Fi + Nome do Atalho)
    for (const item of this.projectedPoints) {
      const { point, screen: sp } = item;
      const isHovered = this.hoveredPoint && this.hoveredPoint.id === point.id;
      const nodeR = (isHovered ? 14.5 : 11.5) * sp.scale;

      ctx.save();

      // Halo grande externo (presente nos nós de ouro como 08 7, 09 4 e 01 7 da imagem)
      if (point.vectorStyle === 'gold' || isHovered) {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, nodeR * 2.55, 0, Math.PI * 2);
        ctx.strokeStyle = isHovered ? this.theme.goldSecondary : this.theme.goldPrimary;
        ctx.lineWidth = isHovered ? 2.0 : 1.5;
        ctx.stroke();
      }

      // Corpo do Nó Estelar (Anel Dourado espesso igual à imagem)
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, nodeR, 0, Math.PI * 2);
      ctx.fillStyle = '#07070A';
      ctx.fill();
      ctx.lineWidth = (isHovered ? 3.6 : 3.0) * sp.scale;
      ctx.strokeStyle = isHovered ? this.theme.goldSecondary : this.theme.goldPrimary;
      ctx.shadowColor = this.theme.goldPrimary;
      ctx.shadowBlur = isHovered ? 22 : 10;
      ctx.stroke();

      // Triângulo/Seta direcional dentro do nó apontando na direção do vetor
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

      // Rótulo de Coordenada Sci-Fi acima do ponto (ex: "08 7", "04 7") + Nome do Ponto Salvo
      const codeText = point.code || '00 1';
      ctx.font = `700 ${Math.round(12.5 * sp.scale)}px "Consolas", "Orbitron", "Segoe UI", monospace`;
      ctx.fillStyle = isHovered ? '#FFFFFF' : '#EBF0FF';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 6;
      ctx.fillText(`${codeText} ϟ`, sp.x + 4, sp.y - nodeR - 9 * sp.scale);

      // Etiqueta do Atalho Salvo pelo Usuário
      if (point.title) {
        ctx.font = `${isHovered ? '700' : '500'} ${Math.round((isHovered ? 12.5 : 10.5) * sp.scale)}px "Segoe UI", sans-serif`;
        ctx.fillStyle = isHovered ? this.theme.goldSecondary : 'rgba(229, 184, 75, 0.86)';
        ctx.fillText(point.title.toUpperCase(), sp.x, sp.y + nodeR + 16 * sp.scale);
      }

      ctx.restore();
    }

    ctx.restore();
  }
}

window.Astrolabe3D = Astrolabe3D;
