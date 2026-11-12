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
  async captureScreenImage(cropToOriginWindow = false) {
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

    return {
      image: finalImage,
      displaySize: { width, height, scaleFactor }
    };
  }

  /**
   * Salva uma NativeImage em disco e grava no Clipboard do Windows
   */
  saveAndCopyImage(img, customSaveDir, prefix = 'MPE_Print') {
    const cfg = this.configManager.get();
    const rawFolder =
      customSaveDir ||
      (cfg.telegram && cfg.telegram.savedScreenshotsFolder) ||
      './Capturas_MPE';
    const targetDir = this.configManager.resolvePath(rawFolder);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '_',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('');

    const fileName = `${prefix}_${stamp}.png`;
    const filePath = path.join(targetDir, fileName);

    const pngBuffer = img.toPNG();
    fs.writeFileSync(filePath, pngBuffer);
    clipboard.writeImage(img);

    return { filePath, fileName, targetDir, pngBuffer };
  }

  /**
   * Transfere o conteudo (Print ou Texto ja no Clipboard) para qualquer outro Sistema no Windows
   * (Ex: Telegram, WhatsApp, Discord, Slack, Teams, Word, Paint, Bloco de Notas, ERP, Browser)
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

    const target = (targetSystem || '').trim();
    if (!target) {
      return { ok: false, message: 'Nenhum sistema de destino informado.' };
    }

    if (textMessage && !pngBuffer) {
      clipboard.writeText(textMessage);
    }

    // 1. Tenta localizar a janela do sistema aberto no Windows pelo titulo ou nome do processo
    if (this.hookBridge) {
      const delivered = await this.hookBridge.deliverToSystem(target, autoSendEnter);
      if (delivered && delivered.ok) {
        return {
          ok: true,
          targetSystem: delivered.matchedTitle || target,
          filePath: filePath || null
        };
      }
    }

    // 2. Se a janela ainda nao estava aberta, verifica se e protocolo (ex: tg://) ou executavel/caminho salvo
    if (target.includes('://')) {
      await shell.openExternal(target);
      if (this.hookBridge) {
        await this.hookBridge.pasteAndSendInActiveWindow(autoSendEnter);
      }
      return { ok: true, targetSystem: target, filePath: filePath || null };
    }

    const resolvedPath = this.configManager.resolvePath(target);
    if (fs.existsSync(resolvedPath)) {
      await shell.openPath(resolvedPath);
      if (this.hookBridge) {
        await this.hookBridge.pasteAndSendInActiveWindow(autoSendEnter);
      }
      return { ok: true, targetSystem: resolvedPath, filePath: filePath || null };
    }

    return {
      ok: true,
      targetSystem: `${target} (Conteudo pronto na Area de Transferencia)`,
      filePath: filePath || null
    };
  }

  /**
   * Envia imagem e/ou texto para o Telegram:
   * 1. Se houver Bot Token + Chat ID, envia silenciosamente via API HTTPS oficial do Telegram.
   * 2. Abre o caminho/conversa salva no Telegram Desktop (tg:// ou janela aberta) e cola/envia automaticamente.
   */
  async dispatchToTelegram({ pngBuffer, filePath, textMessage, customTarget }) {
    const cfg = this.configManager.get();
    const tg = cfg.telegram || {};
    const userName = (cfg.profile && cfg.profile.userName) || 'Operador M.P.E';
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
        console.warn('[M.P.E Telegram Bot] Erro no envio via API, usando integracao Desktop:', err.message);
      }
    }

    const targetChat = (customTarget || tg.savedChatPath || 'tg://resolve?domain=me').trim();

    if (targetChat) {
      let deepLink = targetChat;
      if (deepLink.startsWith('@')) {
        deepLink = `tg://resolve?domain=${deepLink.slice(1)}`;
      } else if (deepLink.startsWith('https://t.me/')) {
        const domain = deepLink.replace('https://t.me/', '').split('/')[0];
        deepLink = `tg://resolve?domain=${domain}`;
      }

      if (deepLink.startsWith('tg://') || deepLink.startsWith('http://') || deepLink.startsWith('https://')) {
        await shell.openExternal(deepLink);
      } else {
        const resolved = this.configManager.resolvePath(deepLink);
        if (fs.existsSync(resolved)) {
          await shell.openPath(resolved);
        } else if (this.hookBridge) {
          // Tenta focar diretamente na janela do Telegram ou sistema informado
          const res = await this.hookBridge.deliverToSystem(targetChat, tg.autoSend !== false);
          if (res && res.ok) {
            return { ok: true, botSent, targetChat: res.matchedTitle, filePath: filePath || null };
          }
        }
      }

      if (this.hookBridge && (tg.autoSend !== false)) {
        if (!pngBuffer && textMessage) {
          clipboard.writeText(textMessage);
        }
        await this.hookBridge.pasteAndSendInActiveWindow(true);
      }
    }

    return {
      ok: true,
      botSent,
      targetChat,
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
          message: `Print capturado de [${originTitle}], salvo em ${saved.fileName} e copiado para o Clipboard.`,
          filePath: saved.filePath
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
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.hide();
          await new Promise((r) => setTimeout(r, 120));
        }
        if (this.hookBridge) {
          await this.hookBridge.copySelectionFromLastWindow();
        }
        const selectedText = clipboard.readText() || '';
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

      case 'open_path': {
        const target = this.configManager.resolvePath(params.targetPath || './Capturas_MPE');
        if (!fs.existsSync(target) && target.toLowerCase().includes('capturas')) {
          fs.mkdirSync(target, { recursive: true });
        }
        await shell.openPath(target);
        return {
          ok: true,
          type: 'open_path',
          message: `Diretorio/Arquivo aberto: ${target}`
        };
      }

      case 'open_url': {
        const url = params.url || 'https://github.com/DevFLeo/Mouse-Performatico-Estrelado';
        await shell.openExternal(url);
        return {
          ok: true,
          type: 'open_url',
          message: `URL aberta no navegador: ${url}`
        };
      }

      case 'command': {
        const cmd = params.command || 'calc.exe';
        exec(cmd, { windowsHide: false });
        return {
          ok: true,
          type: 'command',
          message: `Comando executado: ${cmd}`
        };
      }

      case 'open_settings': {
        return {
          ok: true,
          type: 'open_settings',
          message: 'Abrindo Forjador de Estrelas e Configuracoes...'
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
        message: `Recorte salvo (${saved.fileName}) e enviado para o Telegram (${tgResult.targetChat}).`
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
        message: `Recorte salvo (${saved.fileName}) e transferido para [${delivery.targetSystem}].`
      };
    }

    return {
      ok: true,
      filePath: saved.filePath,
      message: `Recorte salvo em ${saved.fileName} e copiado para a Area de Transferencia.`
    };
  }
}

module.exports = ActionExecutor;
