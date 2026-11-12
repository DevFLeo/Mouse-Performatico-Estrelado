/**
 * Mascote 3D Holografico da AI Kataros (M.P.E)
 * - Giroscopio estelar 3D dourado/ambar em movimento continuo (nao interativo)
 * - No estado "processando" (chat ou envio para sistemas), acelera em modo frenetico
 *   por ~1.5 a 2 segundos e exibe o rotulo "PROCESSANDO"
 */
class KatarosMascot3D {
  constructor(canvas, statusEl, subEl, containerEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.statusEl = statusEl;
    this.subEl = subEl;
    this.containerEl = containerEl;

    this.size = 76;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.size * this.dpr;
    this.canvas.height = this.size * this.dpr;
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;

    this.time = 0;
    this.lastTs = 0;
    this.rafId = null;
    this.isPaused = true;

    this.isProcessing = false;
    this.speedFactor = 1.0;
    this.targetSpeed = 1.0;
    this.energy = 0.0;
    this.targetEnergy = 0.0;
    this.processingToken = 0;

    // Aneis 3D inclinados (replicando o giroscopio dourado/ambar da referencia)
    this.rings = [
      { r: 0.86, rx: 0.62, ry: 0.45, rz: 0.2, vx: 0.42, vy: 0.72, vz: 0.35, width: 1.8, color: '#FFD584', glow: '#FF9E1B', arcs: [[0.1, 1.35], [2.4, 3.2], [4.4, 5.4]], ticks: 28 },
      { r: 0.82, rx: -0.78, ry: 0.32, rz: -0.4, vx: -0.55, vy: 0.48, vz: -0.6, width: 1.5, color: '#FFB833', glow: '#FF7B00', arcs: [[0.5, 2.1], [3.6, 4.9]], ticks: 20 },
      { r: 0.68, rx: 1.15, ry: -0.5, rz: 0.8, vx: 0.65, vy: -0.82, vz: 0.45, width: 1.3, color: '#E5B84B', glow: '#FF8C1A', arcs: [[0.0, 1.8], [2.9, 4.1]], ticks: 16 },
      { r: 0.54, rx: 0.35, ry: 1.05, rz: -0.25, vx: -0.9, vy: 0.6, vz: 0.88, width: 1.4, color: '#FFE08A', glow: '#FFA500', arcs: [[0.4, 1.5], [2.2, 3.5], [4.6, 5.7]], ticks: 0 },
      { r: 0.38, rx: -0.95, ry: -0.65, rz: 0.5, vx: 1.1, vy: 0.95, vz: -0.7, width: 1.1, color: '#FFA93A', glow: '#FF6A00', arcs: [[0.2, 2.4], [3.4, 5.0]], ticks: 0 },
      { r: 0.22, rx: 0.75, ry: 0.75, rz: 0.0, vx: -1.45, vy: 1.2, vz: 1.1, width: 1.0, color: '#FFE5A3', glow: '#FFB732', arcs: [[0.0, Math.PI * 1.65]], ticks: 0 }
    ];

    // Raios 3D com pequenos nos circulares externos
    this.spokes = [];
    for (let i = 0; i < 12; i++) {
      const theta = (i / 12) * Math.PI * 2;
      const phi = ((i % 5) - 2) * 0.42;
      this.spokes.push({
        theta,
        phi,
        len: i % 2 === 0 ? 0.92 : 0.74,
        hasNode: i % 3 === 0
      });
    }

    this.animate = this.animate.bind(this);
  }

  resume() {
    if (!this.isPaused && this.rafId) return;
    this.isPaused = false;
    this.lastTs = performance.now();
    this.rafId = requestAnimationFrame(this.animate);
  }

  pause() {
    this.isPaused = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  setProcessing(active, subText) {
    this.isProcessing = Boolean(active);
    this.targetSpeed = this.isProcessing ? 5.8 : 1.0;
    this.targetEnergy = this.isProcessing ? 1.0 : 0.0;

    if (this.containerEl) {
      this.containerEl.classList.toggle('is-processing', this.isProcessing);
    }
    if (this.statusEl) {
      this.statusEl.textContent = this.isProcessing ? 'PROCESSANDO' : 'AI KATAROS';
    }
    if (this.subEl) {
      this.subEl.textContent = this.isProcessing ? (subText || 'AGUARDE') : 'LOCAL OK';
    }
  }

  /**
   * Executa uma operacao garantindo estado frenetico "PROCESSANDO" entre 1.5s e 2s
   */
  async runWithProcessing(fn, { minDurationMs = 1600, subText = 'ENVIANDO' } = {}) {
    const token = ++this.processingToken;
    this.setProcessing(true, subText);
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      const elapsed = performance.now() - t0;
      const remaining = Math.max(0, minDurationMs - elapsed);
      if (remaining > 0) {
        await new Promise((r) => setTimeout(r, remaining));
      }
      if (this.processingToken === token) {
        this.setProcessing(false);
      }
    }
  }

  projectPoint(x, y, z, rx, ry, rz, radius, cx, cy) {
    // Rotacao Z
    const cz = Math.cos(rz);
    const sz = Math.sin(rz);
    const x1 = x * cz - y * sz;
    const y1 = x * sz + y * cz;
    const z1 = z;

    // Rotacao X
    const cxR = Math.cos(rx);
    const sxR = Math.sin(rx);
    const y2 = y1 * cxR - z1 * sxR;
    const z2 = y1 * sxR + z1 * cxR;
    const x2 = x1;

    // Rotacao Y
    const cyR = Math.cos(ry);
    const syR = Math.sin(ry);
    const x3 = x2 * cyR + z2 * syR;
    const z3 = -x2 * syR + z2 * cyR;
    const y3 = y2;

    const perspective = 2.6 / (2.6 - z3 * 0.65);
    return {
      x: cx + x3 * radius * perspective,
      y: cy + y3 * radius * perspective,
      z: z3,
      scale: perspective
    };
  }

  animate(ts) {
    if (this.isPaused) return;
    const dt = Math.min(0.05, Math.max(0.001, (ts - (this.lastTs || ts)) / 1000));
    this.lastTs = ts;

    // Interpolacao suave da velocidade frenetica
    this.speedFactor += (this.targetSpeed - this.speedFactor) * Math.min(1, dt * 8);
    this.energy += (this.targetEnergy - this.energy) * Math.min(1, dt * 8);
    this.time += dt * this.speedFactor;

    this.draw();
    this.rafId = requestAnimationFrame(this.animate);
  }

  draw() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const w = this.size;
    const cx = w / 2;
    const cy = w / 2;
    const maxR = w * 0.43;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, w);

    // Brilho central sutil ambar/dourado
    const pulse = 0.72 + Math.sin(this.time * 3.2) * 0.18 + this.energy * 0.35;
    const bgGrad = ctx.createRadialGradient(cx, cy, 1, cx, cy, maxR * 1.05);
    bgGrad.addColorStop(0, `rgba(255, 175, 45, ${0.26 * pulse})`);
    bgGrad.addColorStop(0.55, `rgba(217, 130, 24, ${0.12 * pulse})`);
    bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 1.05, 0, Math.PI * 2);
    ctx.fill();

    // Raios 3D e nos flutuantes externos
    const globalYaw = this.time * 0.48;
    const globalPitch = Math.sin(this.time * 0.35) * 0.32 + this.energy * Math.sin(this.time * 2.4) * 0.14;
    ctx.lineCap = 'round';

    for (let i = 0; i < this.spokes.length; i++) {
      const sp = this.spokes[i];
      const px = Math.cos(sp.theta) * Math.cos(sp.phi);
      const py = Math.sin(sp.theta) * Math.cos(sp.phi);
      const pz = Math.sin(sp.phi);
      const tip = this.projectPoint(px * sp.len, py * sp.len, pz * sp.len, globalPitch, globalYaw, 0.25, maxR, cx, cy);
      const depthAlpha = 0.22 + (tip.z + 1) * 0.22;

      ctx.strokeStyle = `rgba(217, 155, 56, ${depthAlpha})`;
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();

      if (sp.hasNode) {
        ctx.strokeStyle = `rgba(255, 195, 85, ${Math.min(0.95, depthAlpha + 0.35)})`;
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 2.1 * tip.scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Desenha os aneis 3D giroscopicos
    const steps = 42;
    for (let idx = 0; idx < this.rings.length; idx++) {
      const ring = this.rings[idx];
      const rx = ring.rx + this.time * ring.vx * 0.55;
      const ry = ring.ry + this.time * ring.vy * 0.55;
      const rz = ring.rz + this.time * ring.vz * 0.55;

      // Hairline orbital completo
      ctx.strokeStyle = `rgba(217, 150, 48, ${0.24 + this.energy * 0.2})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const p = this.projectPoint(Math.cos(a) * ring.r, Math.sin(a) * ring.r, 0, rx, ry, rz, maxR, cx, cy);
        if (s === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      // Arcos brilhantes dourados/laranjas (energia do giroscopio)
      ctx.shadowColor = ring.glow;
      ctx.shadowBlur = 5 + this.energy * 6;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.width + this.energy * 0.45;
      for (let aIdx = 0; aIdx < ring.arcs.length; aIdx++) {
        const [aStart, aEnd] = ring.arcs[aIdx];
        const segs = 18;
        ctx.beginPath();
        for (let s = 0; s <= segs; s++) {
          const a = aStart + ((aEnd - aStart) * s) / segs + this.time * (idx % 2 === 0 ? 0.6 : -0.5);
          const p = this.projectPoint(Math.cos(a) * ring.r, Math.sin(a) * ring.r, 0, rx, ry, rz, maxR, cx, cy);
          if (s === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // Marcacoes finas (ticks) nos aneis externos
      if (ring.ticks > 0) {
        ctx.strokeStyle = `rgba(255, 213, 132, ${0.38 + this.energy * 0.25})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (let t = 0; t < ring.ticks; t++) {
          const a = (t / ring.ticks) * Math.PI * 2 + this.time * 0.25;
          const p1 = this.projectPoint(Math.cos(a) * (ring.r - 0.03), Math.sin(a) * (ring.r - 0.03), 0, rx, ry, rz, maxR, cx, cy);
          const p2 = this.projectPoint(Math.cos(a) * (ring.r + 0.03), Math.sin(a) * (ring.r + 0.03), 0, rx, ry, rz, maxR, cx, cy);
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }
        ctx.stroke();
      }
    }

    // Nucleo central
    ctx.fillStyle = `rgba(255, 213, 132, ${0.55 + this.energy * 0.4})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 1.8 + this.energy * 0.9, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

window.KatarosMascot3D = KatarosMascot3D;
