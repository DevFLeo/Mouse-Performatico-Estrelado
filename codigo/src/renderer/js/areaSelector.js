/**
 * Seletor Interativo de Área para Print / Recorte + Envio ao Telegram
 */
class AreaSelector {
  constructor(overlayEl, canvasEl, onComplete, onCancel) {
    this.overlayEl = overlayEl;
    this.canvasEl = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.onComplete = onComplete;
    this.onCancel = onCancel;

    this.isActive = false;
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.currX = 0;
    this.currY = 0;
    this.sourceImage = null;
    this.pendingContext = null;

    this.bindEvents();
  }

  bindEvents() {
    this.canvasEl.addEventListener('mousedown', (e) => {
      if (!this.isActive) return;
      if (e.button === 2) {
        this.cancel();
        return;
      }
      this.isDrawing = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.currX = e.clientX;
      this.currY = e.clientY;
      this.draw();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isActive || !this.isDrawing) return;
      this.currX = e.clientX;
      this.currY = e.clientY;
      this.draw();
    });

    window.addEventListener('mouseup', () => {
      if (!this.isActive || !this.isDrawing) return;
      this.isDrawing = false;
      this.finishSelection();
    });
  }

  open(fullScreenDataUrl, contextData) {
    this.pendingContext = contextData;
    this.sourceImage = new Image();
    this.sourceImage.onload = () => {
      this.isActive = true;
      this.overlayEl.classList.remove('hidden');
      this.canvasEl.width = window.innerWidth;
      this.canvasEl.height = window.innerHeight;
      this.draw();
    };
    this.sourceImage.src = fullScreenDataUrl;
  }

  draw() {
    if (!this.sourceImage) return;
    const w = this.canvasEl.width;
    const h = this.canvasEl.height;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.sourceImage, 0, 0, w, h);

    // Escurece o fundo
    ctx.fillStyle = 'rgba(4, 4, 8, 0.62)';
    ctx.fillRect(0, 0, w, h);

    if (this.isDrawing) {
      const rx = Math.min(this.startX, this.currX);
      const ry = Math.min(this.startY, this.currY);
      const rw = Math.abs(this.currX - this.startX);
      const rh = Math.abs(this.currY - this.startY);

      if (rw > 4 && rh > 4) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rx, ry, rw, rh);
        ctx.clip();
        ctx.drawImage(this.sourceImage, 0, 0, w, h);
        ctx.restore();

        // Moldura Dourada Estelar
        ctx.strokeStyle = '#E5B84B';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, rw, rh);

        ctx.fillStyle = '#E5B84B';
        ctx.font = '700 12px Consolas, monospace';
        ctx.fillText(`${Math.round(rw)} × ${Math.round(rh)} px`, rx + 6, Math.max(20, ry - 8));
      }
    }
  }

  finishSelection() {
    const rx = Math.min(this.startX, this.currX);
    const ry = Math.min(this.startY, this.currY);
    const rw = Math.abs(this.currX - this.startX);
    const rh = Math.abs(this.currY - this.startY);

    if (rw < 15 || rh < 15) {
      this.cancel();
      return;
    }

    // Recorta na resolução nativa da imagem capturada
    const scaleX = this.sourceImage.naturalWidth / this.canvasEl.width;
    const scaleY = this.sourceImage.naturalHeight / this.canvasEl.height;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = Math.round(rw * scaleX);
    cropCanvas.height = Math.round(rh * scaleY);
    const cropCtx = cropCanvas.getContext('2d');

    cropCtx.drawImage(
      this.sourceImage,
      Math.round(rx * scaleX),
      Math.round(ry * scaleY),
      cropCanvas.width,
      cropCanvas.height,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height
    );

    const croppedDataUrl = cropCanvas.toDataURL('image/png');
    const ctxData = this.pendingContext;
    this.close();

    if (this.onComplete) {
      this.onComplete(croppedDataUrl, ctxData);
    }
  }

  cancel() {
    this.close();
    if (this.onCancel) this.onCancel();
  }

  close() {
    this.isActive = false;
    this.isDrawing = false;
    this.overlayEl.classList.add('hidden');
  }
}

window.AreaSelector = AreaSelector;
