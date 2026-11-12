/**
 * Controlador Principal de Interface do M.P.E (Mouse Performatico Estrelado)
 * Orquestra:
 *  - Sequencia de Inicializacao ("M . P . E Inicializando" -> "Bem-vindo, [Nome]")
 *  - Cadastro de Usuario e Persistencia Hibrida (mpe.config.json + Maquina)
 *  - Alternancia em tempo real entre Linguagem Amigavel, Neutra (Interpessoal) e Profissional
 *  - Integracao Direta Win32 entre Sistemas (Capturar em um sistema -> Enviar para outro sistema)
 */
(function () {
  let currentConfig = null;
  let astrolabe = null;
  let areaSelector = null;
  let editingPointId = null;
  let inspectedPoint = null;
  let audioCtx = null;
  let originSystemName = 'Windows Desktop';
  let currentMode = 'executable-editor'; // 'executable-editor' (via MPE.exe) ou 'hud-only' (via Shift+Ctrl+Alt+Clique Direito)

  function setInterfaceMode(mode) {
    currentMode = mode === 'hud-only' ? 'hud-only' : 'executable-editor';
    if (currentMode === 'hud-only') {
      document.body.classList.add('mode-hud-only');
      document.body.classList.remove('mode-editor');
      // Fecha quaisquer modais de edicao abertos ao entrar em modo performance puro
      document.getElementById('modal-point').classList.add('hidden');
      document.getElementById('modal-settings').classList.add('hidden');
    } else {
      document.body.classList.remove('mode-hud-only');
      document.body.classList.add('mode-editor');
    }
  }

  const THEME_PRESETS = {
    'gold-obsidian': {
      preset: 'gold-obsidian',
      bgPrimary: '#040406',
      bgSecondary: '#171206',
      goldPrimary: '#E5B84B',
      goldSecondary: '#FFE08A',
      goldDim: '#7A5B18',
      vectorAccent: '#5C73B8',
      nexusRed: '#9E2A2B'
    },
    'solar-imperial': {
      preset: 'solar-imperial',
      bgPrimary: '#070402',
      bgSecondary: '#291B04',
      goldPrimary: '#F7C331',
      goldSecondary: '#FFF0A8',
      goldDim: '#9A6B10',
      vectorAccent: '#D9822B',
      nexusRed: '#C83E2B'
    },
    'cyber-cyan': {
      preset: 'cyber-cyan',
      bgPrimary: '#03060A',
      bgSecondary: '#081822',
      goldPrimary: '#E5B84B',
      goldSecondary: '#73F3FF',
      goldDim: '#5B4A1E',
      vectorAccent: '#25B8D9',
      nexusRed: '#E03C67'
    },
    'crimson-eclipse': {
      preset: 'crimson-eclipse',
      bgPrimary: '#050304',
      bgSecondary: '#1E090C',
      goldPrimary: '#D9A74A',
      goldSecondary: '#FFD584',
      goldDim: '#6B421A',
      vectorAccent: '#B84A5C',
      nexusRed: '#E63946'
    }
  };

  function playUiSound(type = 'hover') {
    if (currentConfig && currentConfig.system && currentConfig.system.soundEffects === false) {
      return;
    }
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      const now = audioCtx.currentTime;
      if (type === 'hover') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(680, now + 0.045);
        gain.gain.setValueAtTime(0.025, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.055);
      } else if (type === 'execute') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.16);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.19);
      } else if (type === 'welcome') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(330, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.35);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.42);
      }
    } catch (_) {}
  }

  function getToneDict() {
    const toneKey =
      (currentConfig && currentConfig.profile && currentConfig.profile.languageTone) || 'amigavel';
    return window.MPE_TONES[toneKey] || window.MPE_TONES.amigavel;
  }

  function applyThemeVariables(theme) {
    if (!theme) return;
    const root = document.documentElement;
    root.style.setProperty('--bg-primary', theme.bgPrimary || '#040406');
    root.style.setProperty('--bg-secondary', theme.bgSecondary || '#171206');
    root.style.setProperty('--gold-primary', theme.goldPrimary || '#E5B84B');
    root.style.setProperty('--gold-secondary', theme.goldSecondary || '#FFE08A');
    root.style.setProperty('--gold-dim', theme.goldDim || '#7A5B18');
    root.style.setProperty('--vector-accent', theme.vectorAccent || '#5C73B8');
    root.style.setProperty('--nexus-red', theme.nexusRed || '#9E2A2B');
  }

  function applyLanguageToneUI() {
    const dict = getToneDict();
    const userName =
      (currentConfig && currentConfig.profile && currentConfig.profile.userName) || 'Operador';

    document.getElementById('hud-status-text').textContent = dict.hudStatus(
      userName,
      originSystemName
    );
    document.getElementById('btn-add-star').textContent = dict.btnAddStar;
    document.getElementById('btn-settings').textContent = dict.btnSettings;
    document.getElementById('btn-recenter').textContent = dict.btnRecenter;
    document.getElementById('btn-hide-hud').textContent = dict.btnHide;

    document.getElementById('reg-modal-title').textContent = dict.registerTitle;
    document.getElementById('reg-modal-subtitle').textContent = dict.registerSubtitle;
    document.getElementById('reg-user-name').placeholder = dict.registerPlaceholder;
    document.getElementById('btn-save-register').textContent = dict.registerBtn;

    const activeTone = dict.id;
    document.querySelectorAll('.tone-pill').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tone === activeTone);
    });
  }

  let toastTimer = null;
  function showToast(msg) {
    const toast = document.getElementById('hud-toast');
    const text = document.getElementById('hud-toast-text');
    text.textContent = msg;
    toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 3800);
  }

  let initInterval = null;
  let welcomeTimeout = null;
  let welcomeHideTimeout = null;

  function runInitializationSequence() {
    if (initInterval) clearInterval(initInterval);
    if (welcomeTimeout) clearTimeout(welcomeTimeout);
    if (welcomeHideTimeout) clearTimeout(welcomeHideTimeout);

    const splash = document.getElementById('splash-screen');
    const phaseInit = document.getElementById('splash-phase-init');
    const phaseWelcome = document.getElementById('splash-phase-welcome');
    const progressBar = document.getElementById('splash-progress-bar');
    const dict = getToneDict();

    splash.classList.remove('hidden', 'fade-out');
    phaseInit.classList.remove('hidden');
    phaseWelcome.classList.add('hidden');

    document.getElementById('splash-init-title').textContent = dict.splashInit;
    document.getElementById('splash-init-sub').textContent = dict.splashSubInit;
    progressBar.style.width = '0%';

    let progress = 0;
    initInterval = setInterval(() => {
      progress += 14;
      progressBar.style.width = `${Math.min(100, progress)}%`;
      if (progress >= 100) {
        clearInterval(initInterval);
        initInterval = null;
        onInitBarCompleted();
      }
    }, 95);
  }

  function onInitBarCompleted() {
    const hasName =
      currentConfig &&
      currentConfig.profile &&
      currentConfig.profile.userName &&
      currentConfig.profile.userName.trim().length > 0;

    if (!hasName) {
      // Oculta a tela de splash e abre o modal de cadastro em primeiro plano (z-index: 200)
      const splash = document.getElementById('splash-screen');
      splash.classList.add('hidden');
      const regModal = document.getElementById('modal-register');
      regModal.classList.remove('hidden');
      setTimeout(() => {
        document.getElementById('reg-user-name').focus();
      }, 50);
    } else {
      showWelcomePhase(currentConfig.profile.userName.trim());
    }
  }

  function showWelcomePhase(userName) {
    if (welcomeTimeout) clearTimeout(welcomeTimeout);
    if (welcomeHideTimeout) clearTimeout(welcomeHideTimeout);

    const splash = document.getElementById('splash-screen');
    const phaseInit = document.getElementById('splash-phase-init');
    const phaseWelcome = document.getElementById('splash-phase-welcome');
    const dict = getToneDict();

    splash.classList.remove('hidden', 'fade-out');
    phaseInit.classList.add('hidden');
    phaseWelcome.classList.remove('hidden');

    document.getElementById('splash-welcome-title').textContent = dict.splashWelcome(userName);
    document.getElementById('splash-welcome-sub').textContent = dict.splashWelcomeSub(userName);
    playUiSound('welcome');

    welcomeTimeout = setTimeout(() => {
      splash.classList.add('fade-out');
      if (astrolabe) {
        astrolabe.triggerIntroAnimation();
      }
      welcomeHideTimeout = setTimeout(() => {
        splash.classList.add('hidden');
      }, 650);
    }, 1500);
  }

  function handlePointHover(point) {
    const defEl = document.getElementById('inspector-default');
    const detEl = document.getElementById('inspector-detail');

    if (!point) return;

    playUiSound('hover');
    inspectedPoint = point;
    defEl.classList.add('hidden');
    detEl.classList.remove('hidden');

    document.getElementById('insp-code').textContent = point.code || '00 1';
    document.getElementById('insp-title').textContent = point.title || 'Ponto Estelar';
    document.getElementById('insp-desc').textContent =
      point.description || `Acao: ${point.actionType}`;
  }

  async function handlePointExecute(point) {
    if (!point) return;
    playUiSound('execute');

    if (point.actionType === 'open_settings') {
      if (currentMode === 'hud-only') {
        showToast('Para editar ou criar pontos, entre pelo icone executavel MPE.exe.');
        return;
      }
      openPointModal(null);
      return;
    }

    const res = await window.mpeApi.executePoint(point);
    if (!res || !res.ok) {
      showToast((res && res.message) || 'Erro ao executar ponto.');
      return;
    }

    if (res.type === 'request_area_crop') {
      areaSelector.open(res.fullScreenDataUrl, {
        nextAction: res.nextAction,
        point: res.point
      });
      return;
    }

    if (res.type === 'text_selection') {
      const txtModal = document.getElementById('modal-text-selection');
      const txtArea = document.getElementById('captured-text-area');
      txtArea.value = res.selectedText || '';
      txtModal.classList.remove('hidden');
      txtArea.focus();
      showToast(res.message);
      return;
    }

    const dict = getToneDict();
    showToast(res.message || dict.toastExecuted(point.title));
  }

  function updatePointModalFields() {
    const type = document.getElementById('pt-action-type').value;
    const grpScope = document.getElementById('group-capture-scope');
    const grpSave = document.getElementById('group-save-dir');
    const grpTargetSys = document.getElementById('group-target-system');
    const grpTg = document.getElementById('group-telegram-target');
    const grpPath = document.getElementById('group-target-path');
    const grpUrl = document.getElementById('group-url');
    const grpCmd = document.getElementById('group-command');

    grpScope.classList.toggle(
      'hidden',
      !['print', 'print_telegram', 'system_to_system_print'].includes(type)
    );
    grpSave.classList.toggle(
      'hidden',
      ![
        'print',
        'print_telegram',
        'system_to_system_print',
        'area_print',
        'area_print_telegram',
        'area_print_system'
      ].includes(type)
    );
    grpTargetSys.classList.toggle(
      'hidden',
      !['system_to_system_print', 'area_print_system', 'text_to_system'].includes(type)
    );
    grpTg.classList.toggle(
      'hidden',
      !['print_telegram', 'area_print_telegram', 'text_telegram'].includes(type)
    );
    grpPath.classList.toggle('hidden', type !== 'open_path');
    grpUrl.classList.toggle('hidden', type !== 'open_url');
    grpCmd.classList.toggle('hidden', type !== 'command');
  }

  function openPointModal(point) {
    const modal = document.getElementById('modal-point');
    const delBtn = document.getElementById('btn-delete-point');
    const heading = document.getElementById('point-modal-heading');
    document.getElementById('pt-open-windows-list').classList.add('hidden');

    if (point) {
      editingPointId = point.id;
      heading.textContent = `Editar Ponto Estelar [${point.code}]`;
      delBtn.classList.remove('hidden');

      document.getElementById('pt-title').value = point.title || '';
      document.getElementById('pt-code').value = point.code || '10 7';
      document.getElementById('pt-action-type').value = point.actionType || 'system_to_system_print';
      document.getElementById('pt-desc').value = point.description || '';
      document.getElementById('pt-orbit').value = String(point.orbit || 3);
      document.getElementById('pt-angle').value = String(point.angle || 0);
      document.getElementById('pt-elevation').value = String(point.elevation || 15);
      document.getElementById('pt-vector-style').value = point.vectorStyle || 'gold';
      document.getElementById('pt-glyph').value = point.glyph || '';

      const p = point.params || {};
      document.getElementById('pt-capture-scope').value = p.captureScope || 'active_window';
      document.getElementById('pt-save-dir').value =
        p.saveDir ||
        (currentConfig.telegram && currentConfig.telegram.savedScreenshotsFolder) ||
        './Capturas_MPE';
      document.getElementById('pt-target-system').value = p.targetSystem || 'Telegram';
      document.getElementById('pt-telegram-target').value =
        p.telegramTarget ||
        (currentConfig.telegram && currentConfig.telegram.savedChatPath) ||
        'tg://resolve?domain=me';
      document.getElementById('pt-target-path').value = p.targetPath || '';
      document.getElementById('pt-url').value = p.url || '';
      document.getElementById('pt-command').value = p.command || '';
    } else {
      editingPointId = null;
      heading.textContent = 'Salvar Novo Ponto Estelar no Circulo 3D';
      delBtn.classList.add('hidden');

      const nextNum = (currentConfig.points ? currentConfig.points.length : 9) + 1;
      document.getElementById('pt-title').value = '';
      document.getElementById('pt-code').value = `${String(nextNum).padStart(2, '0')} 7`;
      document.getElementById('pt-action-type').value = 'system_to_system_print';
      document.getElementById('pt-capture-scope').value = 'active_window';
      document.getElementById('pt-desc').value = '';
      document.getElementById('pt-orbit').value = '3';
      document.getElementById('pt-angle').value = String((nextNum * 37) % 360);
      document.getElementById('pt-elevation').value = String(((nextNum % 3) - 1) * 18);
      document.getElementById('pt-vector-style').value = 'gold';
      document.getElementById('pt-glyph').value = 'Π';

      document.getElementById('pt-save-dir').value =
        (currentConfig.telegram && currentConfig.telegram.savedScreenshotsFolder) ||
        './Capturas_MPE';
      document.getElementById('pt-target-system').value = 'Telegram';
      document.getElementById('pt-telegram-target').value =
        (currentConfig.telegram && currentConfig.telegram.savedChatPath) ||
        'tg://resolve?domain=me';
      document.getElementById('pt-target-path').value = '';
      document.getElementById('pt-url').value = '';
      document.getElementById('pt-command').value = '';
    }

    updatePointModalFields();
    modal.classList.remove('hidden');
  }

  async function savePointFromModal() {
    const title = document.getElementById('pt-title').value.trim() || 'Novo Atalho Estelar';
    const code = document.getElementById('pt-code').value.trim() || '10 7';
    const actionType = document.getElementById('pt-action-type').value;
    const description =
      document.getElementById('pt-desc').value.trim() || `Comando programado: ${title}`;
    const orbit = Number(document.getElementById('pt-orbit').value) || 3;
    const angle = Number(document.getElementById('pt-angle').value) || 0;
    const elevation = Number(document.getElementById('pt-elevation').value) || 0;
    const vectorStyle = document.getElementById('pt-vector-style').value;
    const glyph = document.getElementById('pt-glyph').value;

    const pointObj = {
      id: editingPointId || `star-${Date.now()}`,
      code,
      title,
      description,
      actionType,
      orbit,
      angle,
      elevation,
      vectorStyle,
      glyph,
      hasArrow: vectorStyle === 'blue',
      params: {
        captureScope: document.getElementById('pt-capture-scope').value || 'active_window',
        saveDir: document.getElementById('pt-save-dir').value.trim() || './Capturas_MPE',
        targetSystem: document.getElementById('pt-target-system').value.trim() || 'Telegram',
        telegramTarget:
          document.getElementById('pt-telegram-target').value.trim() || 'tg://resolve?domain=me',
        targetPath: document.getElementById('pt-target-path').value.trim(),
        url: document.getElementById('pt-url').value.trim(),
        command: document.getElementById('pt-command').value.trim(),
        autoSendEnter: true
      }
    };

    const points = Array.isArray(currentConfig.points) ? [...currentConfig.points] : [];
    const existingIdx = points.findIndex((p) => p.id === pointObj.id);
    if (existingIdx >= 0) {
      points[existingIdx] = pointObj;
    } else {
      points.push(pointObj);
    }

    currentConfig.points = points;
    currentConfig = await window.mpeApi.saveConfig(currentConfig);
    astrolabe.setConfig(currentConfig);

    document.getElementById('modal-point').classList.add('hidden');
    showToast(getToneDict().toastSaved);
  }

  async function deletePointFromModal() {
    if (!editingPointId) return;
    currentConfig.points = (currentConfig.points || []).filter((p) => p.id !== editingPointId);
    currentConfig = await window.mpeApi.saveConfig(currentConfig);
    astrolabe.setConfig(currentConfig);
    document.getElementById('modal-point').classList.add('hidden');
    showToast('Ponto removido do mapa estelar.');
  }

  function openSettingsModal() {
    const cfg = currentConfig;
    document.getElementById('cfg-user-name').value = (cfg.profile && cfg.profile.userName) || '';
    document.getElementById('cfg-language-tone').value =
      (cfg.profile && cfg.profile.languageTone) || 'amigavel';
    document.getElementById('cfg-start-windows').checked = Boolean(
      cfg.system && cfg.system.startWithWindows
    );
    document.getElementById('cfg-auto-orbit').checked =
      cfg.system && cfg.system.autoOrbit !== false;
    document.getElementById('cfg-sensitivity').value = String(
      (cfg.system && cfg.system.sensitivity3D) || 1.0
    );

    const tg = cfg.telegram || {};
    document.getElementById('cfg-tg-chat').value = tg.savedChatPath || 'tg://resolve?domain=me';
    document.getElementById('cfg-tg-folder').value = tg.savedScreenshotsFolder || './Capturas_MPE';
    document.getElementById('cfg-tg-token').value = tg.botToken || '';
    document.getElementById('cfg-tg-chatid').value = tg.chatId || '';

    const th = cfg.theme || {};
    document.getElementById('clr-gold-primary').value = th.goldPrimary || '#E5B84B';
    document.getElementById('clr-gold-secondary').value = th.goldSecondary || '#FFE08A';
    document.getElementById('clr-bg-primary').value = th.bgPrimary || '#040406';
    document.getElementById('clr-bg-secondary').value = th.bgSecondary || '#171206';
    document.getElementById('clr-vector-accent').value = th.vectorAccent || '#5C73B8';
    document.getElementById('clr-nexus-red').value = th.nexusRed || '#9E2A2B';

    document.getElementById('info-machine-name').textContent =
      (cfg.currentMachine && cfg.currentMachine.hostname) || 'LOCAL-PC';

    document.getElementById('modal-settings').classList.remove('hidden');
  }

  async function saveSettingsFromModal() {
    currentConfig.profile = Object.assign({}, currentConfig.profile, {
      userName: document.getElementById('cfg-user-name').value.trim() || 'Operador',
      isRegistered: true,
      languageTone: document.getElementById('cfg-language-tone').value
    });

    currentConfig.system = Object.assign({}, currentConfig.system, {
      startWithWindows: document.getElementById('cfg-start-windows').checked,
      autoOrbit: document.getElementById('cfg-auto-orbit').checked,
      sensitivity3D: Number(document.getElementById('cfg-sensitivity').value) || 1.0
    });

    currentConfig.telegram = Object.assign({}, currentConfig.telegram, {
      savedChatPath:
        document.getElementById('cfg-tg-chat').value.trim() || 'tg://resolve?domain=me',
      savedScreenshotsFolder:
        document.getElementById('cfg-tg-folder').value.trim() || './Capturas_MPE',
      botToken: document.getElementById('cfg-tg-token').value.trim(),
      chatId: document.getElementById('cfg-tg-chatid').value.trim()
    });

    currentConfig.theme = Object.assign({}, currentConfig.theme, {
      goldPrimary: document.getElementById('clr-gold-primary').value,
      goldSecondary: document.getElementById('clr-gold-secondary').value,
      bgPrimary: document.getElementById('clr-bg-primary').value,
      bgSecondary: document.getElementById('clr-bg-secondary').value,
      vectorAccent: document.getElementById('clr-vector-accent').value,
      nexusRed: document.getElementById('clr-nexus-red').value
    });

    currentConfig = await window.mpeApi.saveConfig(currentConfig);
    applyThemeVariables(currentConfig.theme);
    applyLanguageToneUI();
    astrolabe.setConfig(currentConfig);

    document.getElementById('modal-settings').classList.add('hidden');
    showToast(getToneDict().toastSaved);
  }

  async function init() {
    currentConfig = await window.mpeApi.getConfig();
    if (currentConfig.originSystem && currentConfig.originSystem.windowTitle) {
      originSystemName = currentConfig.originSystem.windowTitle;
    }

    applyThemeVariables(currentConfig.theme);
    applyLanguageToneUI();

    const canvas = document.getElementById('astrolabe-canvas');
    astrolabe = new window.Astrolabe3D(canvas, {
      onPointHover: handlePointHover,
      onPointClick: handlePointExecute,
      onPointEdit: (pt) => {
        if (currentMode === 'hud-only') {
          showToast('Modo Performance: Para editar pontos, abra pelo icone executavel MPE.exe.');
          return;
        }
        openPointModal(pt);
      }
    });
    astrolabe.setConfig(currentConfig);

    areaSelector = new window.AreaSelector(
      document.getElementById('area-selector-overlay'),
      document.getElementById('area-selector-canvas'),
      async (croppedDataUrl, ctxData) => {
        const pt = (ctxData && ctxData.point) || {};
        const params = pt.params || {};
        const nextAction = (ctxData && ctxData.nextAction) || 'save_only';
        const res = await window.mpeApi.completeAreaCrop({
          dataUrl: croppedDataUrl,
          saveDir: params.saveDir,
          nextAction,
          telegramTarget: params.telegramTarget,
          targetSystem: params.targetSystem,
          autoSendEnter: params.autoSendEnter !== false
        });
        if (res && res.message) {
          showToast(res.message);
        }
      },
      () => {
        showToast('Selecao de area cancelada.');
      }
    );

    document.getElementById('btn-add-star').addEventListener('click', () => openPointModal(null));
    document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
    document.getElementById('btn-recenter').addEventListener('click', () => astrolabe.resetView());
    document.getElementById('btn-replay-intro').addEventListener('click', runInitializationSequence);
    document.getElementById('btn-hide-hud').addEventListener('click', () => window.mpeApi.hideHud());

    document.querySelectorAll('.tone-pill').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tone = btn.dataset.tone;
        currentConfig.profile.languageTone = tone;
        currentConfig = await window.mpeApi.saveConfig(currentConfig);
        applyLanguageToneUI();
        showToast(`Linguagem alterada para: ${window.MPE_TONES[tone].label}`);
      });
    });

    document.getElementById('btn-insp-exec').addEventListener('click', () => {
      if (inspectedPoint) handlePointExecute(inspectedPoint);
    });
    document.getElementById('btn-insp-edit').addEventListener('click', () => {
      if (inspectedPoint) openPointModal(inspectedPoint);
    });

    document.querySelectorAll('.tone-card').forEach((card) => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.tone-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;

        const chosenTone = card.dataset.toneCard;
        currentConfig.profile.languageTone = chosenTone;
        applyLanguageToneUI();
      });
    });

    async function submitRegistration() {
      const nameInput = document.getElementById('reg-user-name').value.trim() || 'DevFLeo';
      const selectedRadio = document.querySelector('input[name="reg-tone"]:checked');
      const tone = selectedRadio ? selectedRadio.value : 'amigavel';

      currentConfig.profile = {
        userName: nameInput,
        isRegistered: true,
        languageTone: tone,
        lastUpdated: new Date().toISOString()
      };

      currentConfig = await window.mpeApi.saveConfig(currentConfig);
      applyLanguageToneUI();
      document.getElementById('modal-register').classList.add('hidden');
      showWelcomePhase(nameInput);
    }

    document.getElementById('btn-save-register').addEventListener('click', submitRegistration);
    document.getElementById('reg-user-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitRegistration();
      }
    });

    document.getElementById('splash-screen').addEventListener('click', () => {
      if (initInterval) {
        clearInterval(initInterval);
        initInterval = null;
        onInitBarCompleted();
      }
    });

    document.getElementById('pt-action-type').addEventListener('change', updatePointModalFields);
    document.getElementById('btn-cancel-point').addEventListener('click', () => {
      document.getElementById('modal-point').classList.add('hidden');
    });
    document.getElementById('btn-save-point').addEventListener('click', savePointFromModal);
    document.getElementById('btn-delete-point').addEventListener('click', deletePointFromModal);

    document.getElementById('btn-browse-save-dir').addEventListener('click', async () => {
      const folder = await window.mpeApi.selectFolder();
      if (folder) document.getElementById('pt-save-dir').value = folder;
    });

    document.getElementById('btn-browse-file').addEventListener('click', async () => {
      const file = await window.mpeApi.selectFile();
      if (file) document.getElementById('pt-target-path').value = file;
    });

    // Detector em tempo real de Sistemas/Janelas abertas no Windows
    document.getElementById('btn-detect-systems').addEventListener('click', async () => {
      const wins = await window.mpeApi.listOpenWindows();
      const selectEl = document.getElementById('pt-open-windows-list');
      selectEl.innerHTML = '<option value="">-- Selecione um Sistema Aberto Agora --</option>';
      for (const w of wins) {
        const opt = document.createElement('option');
        opt.value = w.process || w.title;
        opt.textContent = `[${w.process}] ${w.title}`;
        selectEl.appendChild(opt);
      }
      selectEl.classList.remove('hidden');
    });

    document.getElementById('pt-open-windows-list').addEventListener('change', (e) => {
      if (e.target.value) {
        document.getElementById('pt-target-system').value = e.target.value;
      }
    });

    document.getElementById('btn-cancel-settings').addEventListener('click', () => {
      document.getElementById('modal-settings').classList.add('hidden');
    });
    document.getElementById('btn-save-settings').addEventListener('click', saveSettingsFromModal);
    document.getElementById('btn-cfg-browse-folder').addEventListener('click', async () => {
      const folder = await window.mpeApi.selectFolder();
      if (folder) document.getElementById('cfg-tg-folder').value = folder;
    });

    document.querySelectorAll('.preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const p = THEME_PRESETS[chip.dataset.preset];
        if (!p) return;
        document.getElementById('clr-gold-primary').value = p.goldPrimary;
        document.getElementById('clr-gold-secondary').value = p.goldSecondary;
        document.getElementById('clr-bg-primary').value = p.bgPrimary;
        document.getElementById('clr-bg-secondary').value = p.bgSecondary;
        document.getElementById('clr-vector-accent').value = p.vectorAccent;
        document.getElementById('clr-nexus-red').value = p.nexusRed;
      });
    });

    document.getElementById('btn-close-text-modal').addEventListener('click', () => {
      document.getElementById('modal-text-selection').classList.add('hidden');
    });
    document.getElementById('btn-copy-captured-text').addEventListener('click', async () => {
      const txt = document.getElementById('captured-text-area').value;
      await window.mpeApi.copyToClipboard(txt);
      showToast('Texto copiado para a Area de Transferencia!');
    });
    document.getElementById('btn-send-captured-system').addEventListener('click', async () => {
      const txt = document.getElementById('captured-text-area').value;
      const targetSys =
        document.getElementById('captured-target-system').value.trim() || 'Notepad';
      await window.mpeApi.sendToTargetSystem({
        text: txt,
        targetSystem: targetSys,
        autoSendEnter: true
      });
      document.getElementById('modal-text-selection').classList.add('hidden');
      showToast(`Texto transferido para o sistema [${targetSys}]!`);
    });
    document.getElementById('btn-send-captured-telegram').addEventListener('click', async () => {
      const txt = document.getElementById('captured-text-area').value;
      const target =
        currentConfig.telegram && currentConfig.telegram.savedChatPath
          ? currentConfig.telegram.savedChatPath
          : 'tg://resolve?domain=me';
      await window.mpeApi.sendTextToTelegram({ text: txt, target });
      document.getElementById('modal-text-selection').classList.add('hidden');
      showToast('Texto enviado para a conversa salva no Telegram!');
    });

    function handleEscapeKey() {
      if (areaSelector && areaSelector.isActive) {
        areaSelector.cancel();
        return;
      }
      const openModals = document.querySelectorAll('.modal-backdrop:not(.hidden)');
      if (openModals.length > 0) {
        openModals.forEach((m) => m.classList.add('hidden'));
      }
      // Minimiza a janela do HUD para segundo plano sem fechar o projeto
      window.mpeApi.hideHud();
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleEscapeKey();
      } else if (e.key === 'ArrowLeft') {
        astrolabe.wheelVelocity -= 0.012;
      } else if (e.key === 'ArrowRight') {
        astrolabe.wheelVelocity += 0.012;
      } else if (/^[1-9]$/.test(e.key)) {
        const openModals = document.querySelectorAll('.modal-backdrop:not(.hidden)');
        const splashVisible = !document.getElementById('splash-screen').classList.contains('hidden');
        if (openModals.length === 0 && !splashVisible && currentConfig && Array.isArray(currentConfig.points)) {
          const idx = parseInt(e.key, 10) - 1;
          if (currentConfig.points[idx]) {
            handlePointExecute(currentConfig.points[idx]);
          }
        }
      }
    });

    if (window.mpeApi.onEscapePressed) {
      window.mpeApi.onEscapePressed(() => {
        handleEscapeKey();
      });
    }

    window.mpeApi.onHudSummoned((payload) => {
      if (payload && payload.mode) {
        setInterfaceMode(payload.mode);
      }
      if (payload && payload.originSystem && payload.originSystem.windowTitle) {
        originSystemName = payload.originSystem.windowTitle;
      }
      if (payload && payload.config) {
        currentConfig = payload.config;
        applyThemeVariables(currentConfig.theme);
        applyLanguageToneUI();
        astrolabe.setConfig(currentConfig);
      }
      if (payload && payload.playIntro) {
        runInitializationSequence();
      } else {
        document.getElementById('splash-screen').classList.add('hidden');
        astrolabe.triggerIntroAnimation();
      }
    });

    runInitializationSequence();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
