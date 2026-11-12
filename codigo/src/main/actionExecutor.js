const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const { desktopCapturer, screen, clipboard, nativeImage, shell } = require('electron');

/**
 * Motor de Execucao de Acoes Performaticas e Integracao Entre Sistemas (M.P.E)
 * Suporta:
 *  - Print de um Sistema de Origem e envio automatico para outro Sistema de Destino no Windows
 *  - Print + Envio para Conversa Salva no Telegram (Desktop tg:// e/ou Bot API)
 *  - Recorte de Area Interativo + Envio para Sistema de Destino ou Telegram
 *  - Captura de Selecao de Texto no Sistema de Origem + Transferencia para Outro Sistema
 *  - Abertura de Pastas, Executaveis, Scripts e URLs
 */
class ActionExecutor {
  constructor(configManager, hookBridge) {
    this.configManager = configManager;
    this.hookBridge = hookBridge;
  }

  /**
   * Captura a tela ou a janela exata do Sistema de Origem em alta resolucao.
   * Prioriza o snapshot pre-capturado pelo daemon Win32 no instante exato do atalho (Zero Flicker).
   */
  async captureScreenImage(cropToOriginWindow = false, mainWindow = null) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;
    const scaleFactor = primaryDisplay.scaleFactor || 1;

    if (this.hookBridge) {
      const candidatePath = cropToOriginWindow
        ? this.hookBridge.lastWinSnapPath || this.hookBridge.lastFullSnapPath
        : this.hookBridge.lastFullSnapPath;

      if (candidatePath && fs.existsSync(candidatePath)) {
        try {
          const stat = fs.statSync(candidatePath);
          // Se o snapshot foi capturado recentemente, utiliza-o em 0ms sem piscar a tela
          if (Date.now() - stat.mtimeMs < 120000) {
            const preImg = nativeImage.createFromPath(candidatePath);
            if (!preImg.isEmpty()) {
              return {
                image: preImg,
                displaySize: { width, height, scaleFactor },
                fromPreCapture: true
              };
            }
          }
        } catch (_) {}
      }
    }

    const thumbWidth = Math.floor(width * scaleFactor);
    const thumbHeight = Math.floor(height * scaleFactor);

    // Captura nativa ultra-rapida via GDI+ (MpeHook.exe --CAPTURE-NOW)
    if (this.hookBridge && typeof this.hookBridge.captureScreenFast === 'function') {
      const fastTmpPath = path.join(
        this.configManager.dataDir || path.join(this.configManager.codeDir || this.configManager.rootDir, 'data'),
        '.cache',
        '_fast_capture_cache.png'
      );
      const dir = path.dirname(fastTmpPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const okFast = await this.hookBridge.captureScreenFast(fastTmpPath);
      if (okFast && fs.existsSync(fastTmpPath)) {
        let fastImg = nativeImage.createFromPath(fastTmpPath);
        if (!fastImg.isEmpty()) {
          if (cropToOriginWindow && this.hookBridge.lastWindowRect) {
            const rect = this.hookBridge.lastWindowRect;
            if (rect.width > 80 && rect.height > 80) {
              try {
                const cropped = fastImg.crop({
                  x: Math.max(0, Math.floor(rect.left)),
                  y: Math.max(0, Math.floor(rect.top)),
                  width: Math.min(fastImg.getSize().width, Math.floor(rect.width)),
                  height: Math.min(fastImg.getSize().height, Math.floor(rect.height))
                });
                if (!cropped.isEmpty()) {
                  fastImg = cropped;
                }
              } catch (_) {}
            }
          }
          return {
            image: fastImg,
            displaySize: { width, height, scaleFactor },
            fromNativeGdi: true
          };
        }
      }
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbWidth, height: thumbHeight }
    });

    if (!sources || sources.length === 0) {
      throw new Error('Nenhuma fonte de video encontrada para captura.');
    }

    let finalImage = sources[0].thumbnail;

    // Se solicitado capturar especificamente a janela do Sistema de Origem
    if (cropToOriginWindow && this.hookBridge && this.hookBridge.lastWindowRect) {
      const rect = this.hookBridge.lastWindowRect;
      const cx = Math.max(0, Math.floor(rect.left * scaleFactor));
      const cy = Math.max(0, Math.floor(rect.top * scaleFactor));
      const cw = Math.min(thumbWidth - cx, Math.floor(rect.width * scaleFactor));
      const ch = Math.min(thumbHeight - cy, Math.floor(rect.height * scaleFactor));

      if (cw > 60 && ch > 60) {
        try {
          finalImage = finalImage.crop({ x: cx, y: cy, width: cw, height: ch });
        } catch (_) {}
      }
    }

    if (finalImage.isEmpty() && mainWindow && mainWindow.webContents) {
      try {
        finalImage = await mainWindow.webContents.capturePage();
      } catch (_) {}
    }

    return {
      image: finalImage,
      displaySize: { width, height, scaleFactor }
    };
  }

  sanitizeSegment(str, fallback = 'Geral') {
    const cleaned = String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\/\\:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    return cleaned ? cleaned.slice(0, 48) : fallback;
  }

  /**
   * Salva uma NativeImage em disco com organizacao parametrizada (sistema, data, categoria, nome customizado)
   * e grava no Clipboard do Windows.
   */
  saveAndCopyImage(img, customSaveDir, optionsOrPrefix = 'MPE_Print') {
    const opts =
      typeof optionsOrPrefix === 'string'
        ? { prefix: optionsOrPrefix }
        : Object.assign({}, optionsOrPrefix || {});

    const cfg = this.configManager.get();
    const capCfg = cfg.captures || {};
    const rawFolder =
      customSaveDir ||
      (cfg.telegram && cfg.telegram.savedScreenshotsFolder) ||
      './prints';
    const baseDir = this.configManager.resolvePath(rawFolder);

    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const monthStr = `${yyyy}-${mm}`;
    const timeStr = `${hh}${mi}${ss}`;

    const rawOrigin =
      opts.originSystem ||
      (this.hookBridge && this.hookBridge.lastWindowTitle) ||
      'Sistema';
    const cleanOrigin = this.sanitizeSegment(
      String(rawOrigin).split(' - ').pop() || rawOrigin,
      'Sistema'
    ).slice(0, 28);

    const orgMode = opts.organizationMode || capCfg.organizationMode || 'system_date';
    const cleanCategory = opts.category
      ? this.sanitizeSegment(opts.category, capCfg.defaultCategory || 'Geral')
      : '';

    let subPath = '';
    if (cleanCategory) {
      if (orgMode === 'date') subPath = path.join(dateStr, cleanCategory);
      else if (orgMode === 'flat') subPath = cleanCategory;
      else subPath = path.join(cleanCategory, monthStr);
    } else if (orgMode === 'system_date') {
      subPath = path.join(cleanOrigin, monthStr);
    } else if (orgMode === 'date') {
      subPath = dateStr;
    } else if (orgMode === 'system') {
      subPath = cleanOrigin;
    } else if (orgMode === 'category') {
      subPath = path.join(this.sanitizeSegment(capCfg.defaultCategory || 'Geral', 'Geral'), monthStr);
    }

    const targetDir = subPath ? path.join(baseDir, subPath) : baseDir;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let baseName = '';
    if (opts.customName && String(opts.customName).trim()) {
      baseName = this.sanitizeSegment(opts.customName, `Print_${dateStr}_${timeStr}`).slice(0, 72);
    } else {
      const prefix = opts.prefix || capCfg.defaultPrefix || 'MPE';
      const pattern = capCfg.namingPattern || '{prefix}_{system}_{date}_{time}';
      baseName = pattern
        .replace(/\{prefix\}/gi, this.sanitizeSegment(prefix, 'MPE'))
        .replace(/\{system\}/gi, cleanOrigin)
        .replace(/\{category\}/gi, cleanCategory || this.sanitizeSegment(capCfg.defaultCategory || 'Geral', 'Geral'))
        .replace(/\{date\}/gi, `${yyyy}${mm}${dd}`)
        .replace(/\{time\}/gi, timeStr)
        .replace(/\{name\}/gi, cleanOrigin);
      baseName = this.sanitizeSegment(baseName, `${prefix}_${yyyy}${mm}${dd}_${timeStr}`);
    }

    let fileName = `${baseName}.png`;
    let filePath = path.join(targetDir, fileName);
    if (fs.existsSync(filePath)) {
      fileName = `${baseName}_${timeStr}.png`;
      filePath = path.join(targetDir, fileName);
    }

    const pngBuffer = img.toPNG();
    fs.writeFileSync(filePath, pngBuffer);
    clipboard.writeImage(img);

    const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');

    return {
      filePath,
      fileName,
      relativePath,
      targetDir,
      category: cleanCategory || capCfg.defaultCategory || 'Geral',
      originSystem: cleanOrigin,
      pngBuffer
    };
  }

  /**
   * Transfere o conteudo (Print ou Texto ja no Clipboard) para qualquer outro Sistema no Windows
   * Se o sistema informado nao estiver aberto, o M.P.E inicia o executavel/protocolo e aguarda a janela abrir para colar.
   */
  async dispatchToTargetSystem({ targetSystem, autoSendEnter = true, isTelegram = false, pngBuffer, filePath, textMessage }) {
    if (isTelegram) {
      return await this.dispatchToTelegram({
        pngBuffer,
        filePath,
        textMessage,
        customTarget: targetSystem
      });
    }

    const rawTarget = (targetSystem || '').trim();
    if (!rawTarget) {
      return { ok: false, message: 'Nenhum sistema de destino informado.' };
    }

    if (textMessage && !pngBuffer) {
      clipboard.writeText(textMessage);
    }

    // 1. Tenta localizar a janela do sistema se ele ja estiver aberto no Windows
    if (this.hookBridge) {
      const delivered = await this.hookBridge.deliverToSystem(rawTarget, autoSendEnter);
      if (delivered && delivered.ok) {
        return {
          ok: true,
          targetSystem: delivered.matchedTitle || rawTarget,
          filePath: filePath || null,
          mode: 'focused_and_delivered'
        };
      }
    }

    // 2. Se a janela ainda nao estava aberta, descobre o comando / executavel para abrir o sistema
    const targetLower = rawTarget.toLowerCase();
    let exeToLaunch = null;
    let searchTitleAfterLaunch = rawTarget;
    let isProtocol = false;

    const ALIASES = {
      'bloco de notas': { cmd: 'notepad.exe', query: 'notepad', label: 'Bloco de Notas' },
      'bloco de nota': { cmd: 'notepad.exe', query: 'notepad', label: 'Bloco de Notas' },
      'notepad': { cmd: 'notepad.exe', query: 'notepad', label: 'Bloco de Notas' },
      'notas': { cmd: 'notepad.exe', query: 'notepad', label: 'Bloco de Notas' },
      'paint': { cmd: 'mspaint.exe', query: 'paint', label: 'Paint' },
      'mspaint': { cmd: 'mspaint.exe', query: 'paint', label: 'Paint' },
      'calculadora': { cmd: 'calc.exe', query: 'calcul', label: 'Calculadora' },
      'calc': { cmd: 'calc.exe', query: 'calcul', label: 'Calculadora' },
      'word': { cmd: 'winword.exe', query: 'word', label: 'Microsoft Word' },
      'winword': { cmd: 'winword.exe', query: 'word', label: 'Microsoft Word' },
      'excel': { cmd: 'excel.exe', query: 'excel', label: 'Microsoft Excel' },
      'powerpoint': { cmd: 'powerpnt.exe', query: 'powerpoint', label: 'PowerPoint' },
      'chrome': { cmd: 'chrome.exe', query: 'chrome', label: 'Google Chrome' },
      'google chrome': { cmd: 'chrome.exe', query: 'chrome', label: 'Google Chrome' },
      'edge': { cmd: 'msedge.exe', query: 'edge', label: 'Microsoft Edge' },
      'msedge': { cmd: 'msedge.exe', query: 'edge', label: 'Microsoft Edge' },
      'microsoft edge': { cmd: 'msedge.exe', query: 'edge', label: 'Microsoft Edge' },
      'cmd': { cmd: 'cmd.exe', query: 'cmd', label: 'Prompt de Comando' },
      'prompt': { cmd: 'cmd.exe', query: 'cmd', label: 'Prompt de Comando' },
      'powershell': { cmd: 'powershell.exe', query: 'powershell', label: 'PowerShell' },
      'terminal': { cmd: 'wt.exe', fallbackCmd: 'cmd.exe', query: 'terminal', label: 'Windows Terminal' },
      'vscode': { cmd: 'code.cmd', fallbackCmd: 'code.exe', query: 'visual studio code', label: 'VS Code' },
      'code': { cmd: 'code.cmd', fallbackCmd: 'code.exe', query: 'visual studio code', label: 'VS Code' },
      'explorer': { cmd: 'explorer.exe', query: 'explorer', label: 'Explorador de Arquivos' },
      'telegram': { protocol: 'tg://', cmd: 'Telegram.exe', query: 'telegram', label: 'Telegram' },
      'tg': { protocol: 'tg://', cmd: 'Telegram.exe', query: 'telegram', label: 'Telegram' },
      'whatsapp': { protocol: 'whatsapp://', query: 'whatsapp', label: 'WhatsApp' },
      'discord': { protocol: 'discord://', query: 'discord', label: 'Discord' }
    };

    let alias = ALIASES[targetLower];
    if (!alias) {
      for (const [k, v] of Object.entries(ALIASES)) {
        if (targetLower.includes(k)) {
          alias = v;
          break;
        }
      }
    }

    if (alias) {
      if (alias.protocol) {
        try {
          await shell.openExternal(alias.protocol);
        } catch (_) {}
        searchTitleAfterLaunch = alias.query;
        isProtocol = true;
      }
      if (alias.cmd) {
        exeToLaunch = alias.cmd;
        searchTitleAfterLaunch = alias.query;
      }
    } else if (rawTarget.includes('://')) {
      try {
        await shell.openExternal(rawTarget);
      } catch (_) {}
      isProtocol = true;
    } else {
      const resolvedPath = this.configManager.resolvePath(rawTarget);
      if (fs.existsSync(resolvedPath)) {
        try {
          await shell.openPath(resolvedPath);
        } catch (_) {}
        searchTitleAfterLaunch = path.basename(resolvedPath, path.extname(resolvedPath));
      } else {
        exeToLaunch = rawTarget.endsWith('.exe') ? rawTarget : `${rawTarget}.exe`;
      }
    }

    if (exeToLaunch) {
      try {
        const child = exec(`start "" "${exeToLaunch}"`, { windowsHide: false });
        child.unref();
      } catch (_) {
        try {
          const child2 = exec(`start "" ${rawTarget}`, { windowsHide: false });
          child2.unref();
        } catch (_) {}
      }
    }

    // 3. Aguarda dinamicamente a janela do aplicativo abrir, foca e cola
    const query = searchTitleAfterLaunch || rawTarget;
    let launchedAndDelivered = false;
    let finalTitle = (alias && alias.label) || rawTarget;

    if (this.hookBridge) {
      for (let i = 0; i < 14; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const res = await this.hookBridge.deliverToSystem(query, autoSendEnter);
        if (res && res.ok) {
          launchedAndDelivered = true;
          finalTitle = res.matchedTitle || finalTitle;
          break;
        }
      }
    }

    if (!launchedAndDelivered && this.hookBridge) {
      await this.hookBridge.pasteAndSendInActiveWindow(autoSendEnter);
    }

    return {
      ok: true,
      targetSystem: finalTitle,
      filePath: filePath || null,
      mode: launchedAndDelivered ? 'launched_and_delivered' : 'clipboard_ready'
    };
  }

  /**
   * Envia imagem e/ou texto para o Telegram:
   * 1. Se houver Bot Token + Chat ID, envia silenciosamente via API HTTPS oficial do Telegram.
   * 2. Desperta o Telegram Desktop (processo local ou tg://) e transfere o conteudo com foco e disparo automatico.
   */
  async dispatchToTelegram({ pngBuffer, filePath, textMessage, customTarget }) {
    const cfg = this.configManager.get();
    const tg = cfg.telegram || {};
    const userName = (cfg.profile && cfg.profile.userName) || 'Leonardo';
    const dateStr = new Date().toLocaleString('pt-BR');

    const caption =
      textMessage ||
      (tg.captionTemplate || '[M.P.E] Captura enviada por {user} em {date}')
        .replace('{user}', userName)
        .replace('{date}', dateStr);

    let botSent = false;
    if (tg.botToken && tg.chatId) {
      try {
        if (pngBuffer) {
          await this.sendTelegramBotPhoto(tg.botToken, tg.chatId, pngBuffer, caption);
        } else {
          await this.sendTelegramBotMessage(tg.botToken, tg.chatId, caption);
        }
        botSent = true;
      } catch (err) {
        console.warn('[M.P.E Telegram Bot] Erro no envio via API:', err.message);
      }
    }

    const targetChat = (customTarget || tg.savedChatPath || 'Eu | Você | Leonardo').trim();

    if (textMessage && !pngBuffer) {
      clipboard.writeText(textMessage);
    }

    // 1. Tenta focar diretamente na janela existente do Telegram Desktop
    if (this.hookBridge) {
      const res = await this.hookBridge.deliverToSystem(targetChat, tg.autoSend !== false);
      if (res && res.ok) {
        return {
          ok: true,
          botSent,
          targetChat: `${targetChat} (${res.matchedTitle || 'Telegram'})`,
          filePath: filePath || null
        };
      }
    }

    // 2. Se a janela nao estiver visivel, desperta o Telegram
    const tgAppPaths = [
      path.join(process.env.APPDATA || '', 'Telegram Desktop', 'Telegram.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Telegram Desktop', 'Telegram.exe'),
      'C:\\Program Files\\Telegram Desktop\\Telegram.exe'
    ];
    let launchedExe = false;
    for (const p of tgAppPaths) {
      if (fs.existsSync(p)) {
        try {
          const child = exec(`"${p}"`, { windowsHide: false });
          child.unref();
          launchedExe = true;
          break;
        } catch (_) {}
      }
    }

    let deepLink = targetChat;
    if (deepLink.startsWith('@')) {
      deepLink = `tg://resolve?domain=${deepLink.slice(1)}`;
    } else if (deepLink.startsWith('https://t.me/')) {
      const domain = deepLink.replace('https://t.me/', '').split('/')[0];
      deepLink = `tg://resolve?domain=${domain}`;
    }

    if (!launchedExe && (deepLink.startsWith('tg://') || deepLink.startsWith('http://') || deepLink.startsWith('https://'))) {
      try {
        await shell.openExternal(deepLink);
      } catch (_) {}
    } else if (!launchedExe) {
      try {
        await shell.openExternal('tg://');
      } catch (_) {}
    }

    // 3. Aguarda dinamicamente o Telegram se tornar visivel e envia
    let delivered = false;
    if (this.hookBridge) {
      for (let i = 0; i < 14; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const res = await this.hookBridge.deliverToSystem('telegram', tg.autoSend !== false);
        if (res && res.ok) {
          delivered = true;
          break;
        }
      }
    }

    if (!delivered && this.hookBridge && tg.autoSend !== false) {
      await this.hookBridge.pasteAndSendInActiveWindow(true);
    }

    return {
      ok: true,
      botSent,
      targetChat: `${targetChat} (Telegram Desktop)`,
      filePath: filePath || null
    };
  }

  sendTelegramBotMessage(botToken, chatId, text) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({ chat_id: chatId, text });
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${botToken}/sendMessage`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        },
        (res) => {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
            else reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  sendTelegramBotPhoto(botToken, chatId, pngBuffer, caption) {
    return new Promise((resolve, reject) => {
      const boundary = '----MpeAstrolabeBoundary' + Date.now().toString(16);
      const parts = [];

      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`
        )
      );
      if (caption) {
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`
          )
        );
      }
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="mpe_capture.png"\r\nContent-Type: image/png\r\n\r\n`
        )
      );
      parts.push(pngBuffer);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

      const bodyBuffer = Buffer.concat(parts);

      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${botToken}/sendPhoto`,
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': bodyBuffer.length
          }
        },
        (res) => {
          let resp = '';
          res.on('data', (d) => (resp += d));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(resp);
            else reject(new Error(`HTTP ${res.statusCode}: ${resp}`));
          });
        }
      );
      req.on('error', reject);
      req.write(bodyBuffer);
      req.end();
    });
  }

  /**
   * Executa um ponto estelar salvo pelo seu objeto `point`
   */
  async executePoint(point, mainWindow) {
    const type = point.actionType || 'print';
    const params = point.params || {};
    const originTitle = (this.hookBridge && this.hookBridge.lastWindowTitle) || 'Sistema Atual';

    switch (type) {
      case 'action_2d_scan': {
        const cropWin = params.captureScope === 'active_window';
        const { image } = await this.captureScreenImage(cropWin, mainWindow);
        const saved = this.saveAndCopyImage(image, params.saveDir, 'MPE_Acao2D');
        return {
          ok: true,
          type: 'action_2d_scan',
          filePath: saved.filePath,
          fileName: saved.fileName,
          message: `Acao 2D executada em [${originTitle}]! Salvo em ${saved.fileName} e copiado para a Area de Transferencia.`
        };
      }

      case 'print': {
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.hide();
          await new Promise((r) => setTimeout(r, 150));
        }
        const cropWin = params.captureScope === 'active_window';
        const { image } = await this.captureScreenImage(cropWin);
        const saved = this.saveAndCopyImage(image, params.saveDir, 'MPE_Print');
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
        return {
          ok: true,
          type: 'print',
          message: `Print capturado de [${originTitle}], salvo em ${saved.relativePath} e copiado para o Clipboard.`,
          filePath: saved.filePath
        };
      }

      case 'named_print': {
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.hide();
          await new Promise((r) => setTimeout(r, 150));
        }
        if (params.captureScope === 'area') {
          const { image, displaySize } = await this.captureScreenImage(false);
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
          return {
            ok: true,
            type: 'request_area_crop',
            nextAction: 'named_print',
            point,
            fullScreenDataUrl: image.toDataURL(),
            displaySize
          };
        }
        const cropWin = params.captureScope === 'active_window';
        const { image } = await this.captureScreenImage(cropWin);
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
        const cfg = this.configManager.get();
        return {
          ok: true,
          type: 'request_named_print',
          point,
          imageDataUrl: image.toDataURL(),
          originSystem: originTitle,
          suggestedCategory: params.category || (cfg.captures && cfg.captures.defaultCategory) || 'Geral',
          saveDir: params.saveDir
        };
      }

      case 'system_to_system_print': {
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.hide();
          await new Promise((r) => setTimeout(r, 150));
        }
        const cropWin = params.captureScope === 'active_window';
        const { image } = await this.captureScreenImage(cropWin);
        const saved = this.saveAndCopyImage(image, params.saveDir, 'MPE_CrossSystem');

        const targetSys = params.targetSystem || params.telegramTarget || 'Telegram';
        const autoSend = params.autoSendEnter !== false;

        const delivery = await this.dispatchToTargetSystem({
          targetSystem: targetSys,
          autoSendEnter: autoSend,
          isTelegram: targetSys.toLowerCase().includes('tg://') || targetSys.startsWith('@'),
          pngBuffer: saved.pngBuffer,
          filePath: saved.filePath
        });

        return {
          ok: true,
          type: 'system_to_system_print',
          message: `Print de [${originTitle}] transferido para [${delivery.targetSystem || targetSys}] (${saved.fileName}).`,
          filePath: saved.filePath
        };
      }

      case 'print_telegram': {
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.hide();
          await new Promise((r) => setTimeout(r, 150));
        }
        const cropWin = params.captureScope === 'active_window';
        const { image } = await this.captureScreenImage(cropWin);
        const saved = this.saveAndCopyImage(image, params.saveDir, 'MPE_Telegram');
        const tgResult = await this.dispatchToTelegram({
          pngBuffer: saved.pngBuffer,
          filePath: saved.filePath,
          customTarget: params.telegramTarget
        });
        return {
          ok: true,
          type: 'print_telegram',
          message: `Print de [${originTitle}] salvo (${saved.fileName}) e enviado para o Telegram (${tgResult.targetChat}).`,
          filePath: saved.filePath
        };
      }

      case 'area_print':
      case 'area_print_telegram':
      case 'area_print_system': {
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.hide();
          await new Promise((r) => setTimeout(r, 150));
        }
        const { image, displaySize } = await this.captureScreenImage(false);
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
        return {
          ok: true,
          type: 'request_area_crop',
          nextAction:
            type === 'area_print_telegram'
              ? 'telegram'
              : type === 'area_print_system'
              ? 'system'
              : 'save_only',
          point,
          fullScreenDataUrl: image.toDataURL(),
          displaySize
        };
      }

      case 'text_selection': {
        const prevClipboard = clipboard.readText();
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.hide();
          await new Promise((r) => setTimeout(r, 160));
        }
        if (this.hookBridge) {
          const originHwnd = this.hookBridge.lastHwnd || '0';
          await this.hookBridge.copySelectionFromLastWindow(originHwnd);
        }
        await new Promise((r) => setTimeout(r, 180));
        let selectedText = clipboard.readText() || '';
        if (!selectedText && prevClipboard) {
          selectedText = prevClipboard;
        }
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
        return {
          ok: true,
          type: 'text_selection',
          selectedText,
          message: selectedText
            ? `Texto capturado do sistema [${originTitle}].`
            : 'Area de transferencia lida (selecione um texto no sistema de origem ou digite abaixo).'
        };
      }

      case 'text_telegram':
      case 'text_to_system': {
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.hide();
          await new Promise((r) => setTimeout(r, 120));
        }
        if (this.hookBridge) {
          await this.hookBridge.copySelectionFromLastWindow();
        }
        const selectedText = clipboard.readText() || '[M.P.E] Mensagem rapida';
        if (type === 'text_to_system' && params.targetSystem) {
          const delivery = await this.dispatchToTargetSystem({
            targetSystem: params.targetSystem,
            autoSendEnter: params.autoSendEnter !== false,
            isTelegram: false,
            textMessage: selectedText
          });
          return {
            ok: true,
            type: 'text_to_system',
            selectedText,
            message: `Texto de [${originTitle}] enviado para [${delivery.targetSystem}].`
          };
        } else {
          await this.dispatchToTelegram({
            textMessage: selectedText,
            customTarget: params.telegramTarget
          });
          return {
            ok: true,
            type: 'text_telegram',
            selectedText,
            message: `Texto de [${originTitle}] enviado para a conversa salva no Telegram.`
          };
        }
      }

      case 'open_organizer': {
        return {
          ok: true,
          type: 'open_organizer',
          scope: params.targetScope === 'prints' ? 'prints' : 'arquivos',
          message: 'Abrindo Organizador de Arquivos e Prints...'
        };
      }

      case 'organize_files_quick': {
        return {
          ok: true,
          type: 'organize_files_quick',
          scope: params.targetScope === 'prints' ? 'prints' : 'arquivos',
          criterion: params.criterion || 'type',
          pickMode: params.pickMode || 'files',
          message: 'Selecione os arquivos para organizar...'
        };
      }

      case 'macro_sequence': {
        const steps = Array.isArray(params.steps) ? params.steps.filter((s) => s && s.actionType) : [];
        if (!steps.length) {
          return {
            ok: false,
            message: 'Nenhuma etapa configurada nesta rotina.'
          };
        }
        const results = [];
        for (const step of steps) {
          if (step.actionType === 'macro_sequence') continue;
          const r = await this.executePoint(
            {
              id: `${point.id || 'macro'}-step`,
              title: step.title || point.title,
              actionType: step.actionType,
              params: Object.assign({}, params, step.params || {})
            },
            mainWindow
          );
          results.push(r);
          if (r && ['request_area_crop', 'request_named_print', 'text_selection', 'open_organizer', 'organize_files_quick'].includes(r.type)) {
            return r;
          }
          await new Promise((res) => setTimeout(res, 180));
        }
        const summary = results.map((r) => r && r.message).filter(Boolean).join(' | ');
        return {
          ok: true,
          type: 'macro_sequence',
          message: summary || `Rotina "${point.title}" executada com sucesso (${results.length} etapas).`
        };
      }

      case 'open_path': {
        const rawTarget = params.targetPath || './prints';
        const specialAliases = {
          downloads: path.join(require('os').homedir(), 'Downloads'),
          documentos: path.join(require('os').homedir(), 'Documents'),
          desktop: path.join(require('os').homedir(), 'Desktop'),
          prints: './prints',
          arquivos: './arquivos'
        };
        const resolvedAlias = specialAliases[String(rawTarget).trim().toLowerCase()] || rawTarget;
        const target = this.configManager.resolvePath(resolvedAlias);
        if (!fs.existsSync(target) && (target.toLowerCase().includes('prints') || target.toLowerCase().includes('arquivos'))) {
          fs.mkdirSync(target, { recursive: true });
        }
        await shell.openPath(target);
        return {
          ok: true,
          type: 'open_path',
          message: `Pasta ou arquivo aberto: ${target}`
        };
      }

      case 'open_url': {
        let url = (params.url || 'https://github.com/DevFLeo/Mouse-Performatico-Estrelado').trim();
        if (url && !/^https?:\/\//i.test(url)) {
          url = `https://${url}`;
        }
        await shell.openExternal(url);
        return {
          ok: true,
          type: 'open_url',
          message: `Site aberto no navegador: ${url}`
        };
      }

      case 'command': {
        const cmd = params.command || 'calc.exe';
        exec(cmd, { windowsHide: false });
        return {
          ok: true,
          type: 'command',
          message: `Programa executado: ${cmd}`
        };
      }

      case 'open_settings': {
        return {
          ok: true,
          type: 'open_settings',
          message: 'Abrindo Configuracoes...'
        };
      }

      default:
        return {
          ok: false,
          message: `Tipo de acao desconhecido: ${type}`
        };
    }
  }

  /**
   * Finaliza o recorte de area (Area Crop) e transfere para o Sistema de Destino ou Telegram
   */
  async completeAreaCrop({ dataUrl, saveDir, nextAction, telegramTarget, targetSystem, autoSendEnter, mainWindow }) {
    if (nextAction === 'named_print') {
      const originTitle = (this.hookBridge && this.hookBridge.lastWindowTitle) || 'Sistema Atual';
      const cfg = this.configManager.get();
      return {
        ok: true,
        type: 'request_named_print',
        imageDataUrl: dataUrl,
        originSystem: originTitle,
        suggestedCategory: (cfg.captures && cfg.captures.defaultCategory) || 'Geral',
        saveDir
      };
    }

    const img = nativeImage.createFromDataURL(dataUrl);
    const saved = this.saveAndCopyImage(
      img,
      saveDir,
      nextAction === 'telegram' || nextAction === 'system' ? 'MPE_Recorte_Transfer' : 'MPE_Recorte'
    );

    if (nextAction === 'telegram') {
      if (mainWindow && mainWindow.isVisible()) {
        mainWindow.hide();
      }
      const tgResult = await this.dispatchToTelegram({
        pngBuffer: saved.pngBuffer,
        filePath: saved.filePath,
        customTarget: telegramTarget
      });
      return {
        ok: true,
        filePath: saved.filePath,
        message: `Recorte salvo (${saved.relativePath}) e enviado para o Telegram (${tgResult.targetChat}).`
      };
    }

    if (nextAction === 'system') {
      if (mainWindow && mainWindow.isVisible()) {
        mainWindow.hide();
      }
      const delivery = await this.dispatchToTargetSystem({
        targetSystem: targetSystem || telegramTarget || 'Telegram',
        autoSendEnter: autoSendEnter !== false,
        isTelegram: false,
        pngBuffer: saved.pngBuffer,
        filePath: saved.filePath
      });
      return {
        ok: true,
        filePath: saved.filePath,
        message: `Recorte salvo (${saved.relativePath}) e transferido para [${delivery.targetSystem}].`
      };
    }

    return {
      ok: true,
      filePath: saved.filePath,
      message: `Recorte salvo em ${saved.relativePath} e copiado para a Area de Transferencia.`
    };
  }

  /**
   * Salva um Print Nomeado com categoria/subpasta e indexacao opcional na I.A Local.
   */
  saveNamedPrint({
    dataUrl,
    customName,
    category,
    notes,
    saveDir,
    originSystem,
    saveToAiLocal = false,
    localAiService = null
  }) {
    const img = nativeImage.createFromDataURL(dataUrl);
    const saved = this.saveAndCopyImage(img, saveDir, {
      customName: customName || 'Print_Nomeado',
      category: category || 'Geral',
      originSystem
    });

    let aiDocResult = null;
    const cfg = this.configManager.get();
    const shouldIndex =
      Boolean(saveToAiLocal) ||
      Boolean(notes && notes.trim()) ||
      Boolean(cfg.captures && cfg.captures.autoIndexNamedPrints && saveToAiLocal !== false);

    if (shouldIndex && localAiService && typeof localAiService.saveDocumentFile === 'function') {
      const textBody = [
        `Print Nomeado: ${saved.fileName}`,
        `Categoria: ${saved.category}`,
        `Sistema de Origem: ${originSystem || saved.originSystem}`,
        `Arquivo de Imagem: ${saved.filePath}`,
        notes && notes.trim() ? `\nAnotacoes / Dados Capturados:\n${notes.trim()}` : ''
      ]
        .filter(Boolean)
        .join('\n');

      aiDocResult = localAiService.saveDocumentFile({
        title: customName || saved.fileName.replace(/\.png$/i, ''),
        category: saved.category,
        text: textBody,
        linkedImagePath: saved.filePath,
        tags: ['print', saved.category.toLowerCase()]
      });
    }

    return {
      ok: true,
      filePath: saved.filePath,
      fileName: saved.fileName,
      relativePath: saved.relativePath,
      aiDocument: aiDocResult && aiDocResult.document ? aiDocResult.document : null,
      message: aiDocResult && aiDocResult.ok
        ? `Print salvo em ${saved.relativePath} e indexado na I.A Local (${aiDocResult.document.relPath}).`
        : `Print salvo em ${saved.relativePath} e copiado para a Area de Transferencia.`
    };
  }
}

module.exports = ActionExecutor;
