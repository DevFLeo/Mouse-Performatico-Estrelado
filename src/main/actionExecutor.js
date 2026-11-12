const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const { desktopCapturer, screen, clipboard, nativeImage, shell } = require('electron');

/**
 * Motor de Execução de Ações Estelares do M.P.E
 * Suporta:
 *  - Print de Tela Inteira (Salva em disco + Clipboard)
 *  - Print de Área Selecionada (Recorte interativo + Salva + Clipboard)
 *  - Print + Envio Automático para Conversa Salva no Telegram (Desktop tg:// e/ou Bot API)
 *  - Seleção de Texto Inteligente (Captura texto selecionado da janela anterior)
 *  - Texto Selecionado -> Telegram
 *  - Abertura de Pastas, Executáveis, Scripts e URLs
 */
class ActionExecutor {
  constructor(configManager, hookBridge) {
    this.configManager = configManager;
    this.hookBridge = hookBridge;
  }

  /**
   * Captura a tela principal em alta resolução como NativeImage
   */
  async captureScreenImage() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;
    const scaleFactor = primaryDisplay.scaleFactor || 1;

    const thumbWidth = Math.floor(width * scaleFactor);
    const thumbHeight = Math.floor(height * scaleFactor);

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbWidth, height: thumbHeight }
    });

    if (!sources || sources.length === 0) {
      throw new Error('Nenhuma fonte de vídeo encontrada para captura.');
    }

    return {
      image: sources[0].thumbnail,
      displaySize: { width, height, scaleFactor }
    };
  }

  /**
   * Salva uma NativeImage em disco e copia para o Clipboard
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
   * Envia imagem e/ou texto para o Telegram:
   * 1. Se houver Bot Token + Chat ID, envia silenciosamente via API HTTPS oficial do Telegram.
   * 2. Abre o caminho/conversa salva no Telegram Desktop (tg:// ou caminho local) com a imagem já no Clipboard e dispara colagem.
   */
  async dispatchToTelegram({ pngBuffer, filePath, textMessage, customTarget }) {
    const cfg = this.configManager.get();
    const tg = cfg.telegram || {};
    const userName = (cfg.profile && cfg.profile.userName) || 'Operador M.P.E';
    const dateStr = new Date().toLocaleString('pt-BR');

    const caption =
      textMessage ||
      (tg.captionTemplate || '✨ [M.P.E] Captura enviada por {user} em {date}')
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
        console.warn('[M.P.E Telegram Bot] Erro no envio via API, usando fallback Desktop:', err.message);
      }
    }

    const targetChat = (customTarget || tg.savedChatPath || 'tg://resolve?domain=me').trim();

    if (targetChat) {
      let deepLink = targetChat;
      // Converte @usuario ou https://t.me/usuario automaticamente para o protocolo nativo tg://
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
        } else {
          await shell.openExternal('tg://resolve?domain=me');
        }
      }

      // Se estamos enviando um print ou texto para o Telegram Desktop, cola automaticamente na conversa aberta
      if (this.hookBridge && (tg.autoSend !== false)) {
        if (!pngBuffer && textMessage) {
          clipboard.writeText(textMessage);
        }
        await this.hookBridge.pasteAndSendInActiveWindow();
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

    switch (type) {
      case 'print': {
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.setOpacity(0);
          await new Promise((r) => setTimeout(r, 140));
        }
        const { image } = await this.captureScreenImage();
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.setOpacity(1);
        }
        const saved = this.saveAndCopyImage(image, params.saveDir, 'MPE_Print');
        return {
          ok: true,
          type: 'print',
          message: `Print salvo em ${saved.fileName} e copiado para a Área de Transferência!`,
          filePath: saved.filePath,
          previewDataUrl: image.resize({ width: 480 }).toDataURL()
        };
      }

      case 'print_telegram': {
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.setOpacity(0);
          await new Promise((r) => setTimeout(r, 140));
        }
        const { image } = await this.captureScreenImage();
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.setOpacity(1);
        }
        const saved = this.saveAndCopyImage(image, params.saveDir, 'MPE_Telegram');
        const tgResult = await this.dispatchToTelegram({
          pngBuffer: saved.pngBuffer,
          filePath: saved.filePath,
          customTarget: params.telegramTarget
        });
        return {
          ok: true,
          type: 'print_telegram',
          message: `Print salvo (${saved.fileName}) e enviado para o Telegram (${tgResult.targetChat})!`,
          filePath: saved.filePath,
          previewDataUrl: image.resize({ width: 480 }).toDataURL()
        };
      }

      case 'area_print':
      case 'area_print_telegram': {
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.setOpacity(0);
          await new Promise((r) => setTimeout(r, 140));
        }
        const { image, displaySize } = await this.captureScreenImage();
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.setOpacity(1);
        }
        return {
          ok: true,
          type: 'request_area_crop',
          nextAction: type === 'area_print_telegram' ? 'telegram' : 'save_only',
          point,
          fullScreenDataUrl: image.toDataURL(),
          displaySize
        };
      }

      case 'text_selection': {
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.hide();
          await new Promise((r) => setTimeout(r, 100));
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
            ? 'Texto selecionado capturado com sucesso!'
            : 'Área de transferência lida (selecione um texto antes de acionar ou digite abaixo).'
        };
      }

      case 'text_telegram': {
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.hide();
          await new Promise((r) => setTimeout(r, 100));
        }
        if (this.hookBridge) {
          await this.hookBridge.copySelectionFromLastWindow();
        }
        const selectedText = clipboard.readText() || '✨ Mensagem rápida enviada via M.P.E';
        await this.dispatchToTelegram({
          textMessage: selectedText,
          customTarget: params.telegramTarget
        });
        return {
          ok: true,
          type: 'text_telegram',
          selectedText,
          message: 'Texto selecionado enviado para a conversa salva no Telegram!'
        };
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
          message: `Diretório/Arquivo aberto: ${target}`
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
          message: 'Abrindo Forjador de Estrelas e Configurações...'
        };
      }

      default:
        return {
          ok: false,
          message: `Tipo de ação desconhecido: ${type}`
        };
    }
  }

  /**
   * Finaliza o recorte de área (Area Crop) e opcionalmente envia para o Telegram
   */
  async completeAreaCrop({ dataUrl, saveDir, sendToTelegram, telegramTarget }) {
    const img = nativeImage.createFromDataURL(dataUrl);
    const saved = this.saveAndCopyImage(
      img,
      saveDir,
      sendToTelegram ? 'MPE_Recorte_TG' : 'MPE_Recorte'
    );

    if (sendToTelegram) {
      const tgResult = await this.dispatchToTelegram({
        pngBuffer: saved.pngBuffer,
        filePath: saved.filePath,
        customTarget: telegramTarget
      });
      return {
        ok: true,
        filePath: saved.filePath,
        message: `Recorte salvo (${saved.fileName}) e enviado para o Telegram (${tgResult.targetChat})!`
      };
    }

    return {
      ok: true,
      filePath: saved.filePath,
      message: `Recorte salvo em ${saved.fileName} e copiado para a Área de Transferência!`
    };
  }
}

module.exports = ActionExecutor;
