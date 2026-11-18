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
  let organizerUI = null;
  let editingPointId = null;
  let inspectedPoint = null;
  let audioCtx = null;
  let originSystemName = 'Windows Desktop';
  let currentMode = 'executable-editor'; // 'executable-editor' (via MPE.exe) ou 'hud-only' (via Shift+Ctrl+Alt+Clique Direito)

  let consentStatus = {
    accepted: false,
    decidedAt: null,
    version: '1.0',
    permissions: {
      backgroundExecution: false,
      launchAppsAndLinks: false,
      pythonAutomation: false
    }
  };
  let miniState = {
    enabled: false,
    windowOpen: false,
    blockedByConsent: false,
    size: 68,
    scale: 1.0,
    fanRadius: 140
  };
  let isSelfTestMode = false;
  let splashDismissedByUser = false;
  let showConsentBlockedBanner = false;
  let pendingHudPayload = null;
  let lastRecordedSteps = [];
  let isRecordingPython = false;

  function setInterfaceMode(mode) {
    currentMode = mode === 'hud-only' ? 'hud-only' : 'executable-editor';
    if (currentMode === 'hud-only') {
      document.body.classList.add('mode-hud-only');
      document.body.classList.remove('mode-editor');
      // Fecha quaisquer modais de edicao abertos ao entrar em modo performance puro
      document.getElementById('modal-point').classList.add('hidden');
      document.getElementById('modal-settings').classList.add('hidden');
      if (organizerUI) organizerUI.setWorkspaceTab('astrolabe', false);
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
      goldDim: '#C89D3C',
      vectorAccent: '#8FA8FF',
      nexusRed: '#9E2A2B'
    },
    'solar-imperial': {
      preset: 'solar-imperial',
      bgPrimary: '#070402',
      bgSecondary: '#291B04',
      goldPrimary: '#F7C331',
      goldSecondary: '#FFF0A8',
      goldDim: '#D1A024',
      vectorAccent: '#F0A45D',
      nexusRed: '#C83E2B'
    },
    'cyber-cyan': {
      preset: 'cyber-cyan',
      bgPrimary: '#03060A',
      bgSecondary: '#081822',
      goldPrimary: '#E5B84B',
      goldSecondary: '#73F3FF',
      goldDim: '#C89D3C',
      vectorAccent: '#6CE3FF',
      nexusRed: '#E03C67'
    },
    'crimson-eclipse': {
      preset: 'crimson-eclipse',
      bgPrimary: '#050304',
      bgSecondary: '#1E090C',
      goldPrimary: '#D9A74A',
      goldSecondary: '#FFD584',
      goldDim: '#C89D3C',
      vectorAccent: '#F294A5',
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
    root.style.setProperty('--gold-stroke-dim', theme.goldDim || '#7A5B18');
    root.style.setProperty('--vector-stroke', theme.vectorAccent || '#5C73B8');
    root.style.setProperty('--nexus-red', theme.nexusRed || '#9E2A2B');
  }

  function applyLanguageToneUI() {
    const dict = getToneDict();
    const userName =
      (currentConfig && currentConfig.profile && currentConfig.profile.userName) || 'Operador';

    const statusEl = document.getElementById('hud-status-text');
    if (statusEl) {
      statusEl.textContent = dict.hudStatus(userName, originSystemName);
    }
    const setBtnLabel = (id, text) => {
      const el = document.getElementById(id);
      if (!el) return;
      const span = el.querySelector('span');
      if (span) span.textContent = text;
      else el.textContent = text;
    };
    setBtnLabel('btn-add-star', 'Novo Botão');
    setBtnLabel('btn-settings', dict.btnSettings || 'Configurações');
    setBtnLabel('btn-recenter', dict.btnRecenter || 'Centralizar');
    setBtnLabel('btn-hide-hud', dict.btnHide || 'Minimizar');

    const regTitle = document.getElementById('reg-modal-title');
    if (regTitle) regTitle.textContent = dict.registerTitle;
    const regSub = document.getElementById('reg-modal-subtitle');
    if (regSub) regSub.textContent = dict.registerSubtitle;
    const regInp = document.getElementById('reg-user-name');
    if (regInp) regInp.placeholder = dict.registerPlaceholder;
    const regBtn = document.getElementById('btn-save-register');
    if (regBtn) regBtn.textContent = dict.registerBtn;

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
  let safetyUnlockTimeout = null;
  let lastIntroStartTs = 0;
  let hasCompletedInitialIntro = false;

  function clearSplashTimers() {
    if (initInterval) {
      clearInterval(initInterval);
      initInterval = null;
    }
    if (welcomeTimeout) {
      clearTimeout(welcomeTimeout);
      welcomeTimeout = null;
    }
    if (welcomeHideTimeout) {
      clearTimeout(welcomeHideTimeout);
      welcomeHideTimeout = null;
    }
    if (safetyUnlockTimeout) {
      clearTimeout(safetyUnlockTimeout);
      safetyUnlockTimeout = null;
    }
  }

  function syncAstrolabeRunState() {
    if (!astrolabe) return;
    const splash = document.getElementById('splash-screen');
    const splashHidden = !splash || splash.classList.contains('hidden');
    const organizerOpen = organizerUI && organizerUI.activeTab === 'organizer';
    const consentModal = document.getElementById('modal-consent');
    const consentOpen = consentModal && !consentModal.classList.contains('hidden');

    if (document.hidden || organizerOpen || consentOpen || !splashHidden) {
      astrolabe.pause();
    } else {
      astrolabe.resume();
    }
  }

  function updateConsentUI() {
    const accepted = Boolean(consentStatus && consentStatus.accepted);
    const statusBtn = document.getElementById('btn-consent-status');
    if (statusBtn) {
      statusBtn.classList.toggle('hidden', accepted);
    }
    const banner = document.getElementById('consent-blocked-banner');
    if (banner) {
      banner.classList.toggle('hidden', accepted || !showConsentBlockedBanner);
    }
    const perms = (consentStatus && consentStatus.permissions) || {};
    const cbBg = document.getElementById('consent-toggle-bg');
    const cbApps = document.getElementById('consent-toggle-apps');
    const cbPy = document.getElementById('consent-toggle-python');
    if (cbBg && typeof perms.backgroundExecution === 'boolean' && accepted) cbBg.checked = perms.backgroundExecution;
    if (cbApps && typeof perms.launchAppsAndLinks === 'boolean' && accepted) cbApps.checked = perms.launchAppsAndLinks;
    if (cbPy && typeof perms.pythonAutomation === 'boolean' && accepted) cbPy.checked = perms.pythonAutomation;
  }

  function openConsentModal() {
    if (isSelfTestMode) return;
    const modal = document.getElementById('modal-consent');
    if (!modal) return;
    modal.classList.remove('hidden');
    syncAstrolabeRunState();
  }

  function maybePromptConsentAfterSplash() {
    if (isSelfTestMode || document.hidden) return;
    if (!consentStatus || consentStatus.accepted !== true) {
      openConsentModal();
    }
  }

  function handleBlockedResult(res) {
    if (res && res.blockedByConsent) {
      showConsentBlockedBanner = true;
      updateConsentUI();
      showToast(res.message || 'Aceite de primeiro acesso necessario.');
      return true;
    }
    return false;
  }

  function setupSelfTestObserver() {
    try {
      const search = (window.location && window.location.search) || '';
      if (search.includes('selfTest=1') || (window.mpeApi && window.mpeApi.isSelfTest)) {
        isSelfTestMode = true;
      }
    } catch (_) {}

    if (typeof MutationObserver !== 'function') return;

    const welcomeSub = document.getElementById('splash-welcome-sub');
    const splash = document.getElementById('splash-screen');

    if (welcomeSub) {
      const subObs = new MutationObserver(() => {
        if (
          welcomeSub.textContent &&
          welcomeSub.textContent.trim() === 'Sistema M.P.E sincronizado e pronto para integracao entre sistemas.'
        ) {
          isSelfTestMode = true;
          clearSplashTimers();
          const consentModal = document.getElementById('modal-consent');
          if (consentModal) consentModal.classList.add('hidden');
        }
      });
      subObs.observe(welcomeSub, { childList: true, characterData: true, subtree: true });
    }

    if (splash) {
      const splashObs = new MutationObserver(() => {
        if (
          splash.classList.contains('hidden') &&
          !hasCompletedInitialIntro &&
          !splashDismissedByUser
        ) {
          isSelfTestMode = true;
          clearSplashTimers();
          hasCompletedInitialIntro = true;
          const consentModal = document.getElementById('modal-consent');
          if (consentModal) consentModal.classList.add('hidden');
          syncAstrolabeRunState();
        }
      });
      splashObs.observe(splash, { attributes: true, attributeFilter: ['class'] });
    }
  }

  function forceUnlockToAstrolabe() {
    clearSplashTimers();

    hasCompletedInitialIntro = true;
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.classList.add('hidden');
      splash.classList.remove('fade-out');
    }
    maybePromptConsentAfterSplash();
    syncAstrolabeRunState();
  }

  function runInitializationSequence(force = false) {
    if (!force && hasCompletedInitialIntro) {
      forceUnlockToAstrolabe();
      return;
    }

    const now = Date.now();
    if (!force && initInterval && now - lastIntroStartTs < 1500) {
      return;
    }
    lastIntroStartTs = now;

    if (initInterval) clearInterval(initInterval);
    if (welcomeTimeout) clearTimeout(welcomeTimeout);
    if (welcomeHideTimeout) clearTimeout(welcomeHideTimeout);
    if (safetyUnlockTimeout) clearTimeout(safetyUnlockTimeout);

    const splash = document.getElementById('splash-screen');
    const phaseInit = document.getElementById('splash-phase-init');
    const phaseWelcome = document.getElementById('splash-phase-welcome');
    const progressBar = document.getElementById('splash-progress-bar');
    const percentValEl = document.getElementById('splash-percent-value');
    const percentRemEl = document.getElementById('splash-percent-remaining');
    const dict = getToneDict();

    splash.classList.remove('hidden', 'fade-out');
    phaseInit.classList.remove('hidden');
    phaseWelcome.classList.add('hidden');

    document.getElementById('splash-init-title').textContent = dict.splashInit;
    document.getElementById('splash-init-sub').textContent = dict.splashSubInit;
    progressBar.style.width = '0%';
    if (percentValEl) percentValEl.textContent = '0%';
    if (percentRemEl) percentRemEl.textContent = 'Faltam 100% para ativar o M.P.E';

    // Trava de seguranca: garante que nunca fique preso na tela de inicializacao
    safetyUnlockTimeout = setTimeout(() => {
      forceUnlockToAstrolabe();
    }, 2600);

    let progress = 0;
    initInterval = setInterval(() => {
      progress = Math.min(100, progress + 10);
      const remaining = Math.max(0, 100 - progress);

      progressBar.style.width = `${progress}%`;
      if (percentValEl) percentValEl.textContent = `${progress}%`;
      if (percentRemEl) {
        percentRemEl.textContent =
          remaining > 0
            ? `Faltam ${remaining}% para ativar o M.P.E`
            : '100% Concluido | Ativando Sistema!';
      }

      if (progress >= 100) {
        clearInterval(initInterval);
        initInterval = null;
        setTimeout(() => {
          onInitBarCompleted();
        }, 120);
      }
    }, 65);
  }

  function onInitBarCompleted() {
    hasCompletedInitialIntro = true;
    const userName =
      (currentConfig &&
        currentConfig.profile &&
        currentConfig.profile.userName &&
        currentConfig.profile.userName.trim()) ||
      'Leonardo';

    showWelcomePhase(userName);
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
        astrolabe.triggerIntroAnimation(true);
      }
      welcomeHideTimeout = setTimeout(() => {
        forceUnlockToAstrolabe();
      }, 450);
    }, 950);
  }

  function handlePointHover(point) {
    const defEl = document.getElementById('inspector-default');
    const detEl = document.getElementById('inspector-detail');

    if (!point) return;

    playUiSound('hover');
    inspectedPoint = point;
    defEl.classList.add('hidden');
    detEl.classList.remove('hidden');

    const pts = (currentConfig && Array.isArray(currentConfig.points)) ? currentConfig.points : [];
    const hotkeyIdx = pts.findIndex((p) => p && p.id === point.id);
    const inspCodeEl = document.getElementById('insp-code');
    inspCodeEl.textContent = hotkeyIdx >= 0
      ? `Atalho ${hotkeyIdx + 1}${point.hotkeyLetter ? ' | ' + point.hotkeyLetter : ''}`
      : (point.code || '00 1');
    inspCodeEl.title = point.code ? `Codigo estelar: ${point.code}` : '';
    document.getElementById('insp-title').textContent = point.title || 'Ponto Estelar';
    const hotkeyEl = document.getElementById('insp-hotkey');
    if (hotkeyEl) {
      if (hotkeyIdx >= 0 && hotkeyIdx < 9) {
        hotkeyEl.textContent = `Tecla ${hotkeyIdx + 1}`;
        hotkeyEl.classList.remove('hidden');
      } else {
        hotkeyEl.classList.add('hidden');
      }
    }
    document.getElementById('insp-desc').textContent =
      point.description || `Acao: ${point.actionType}`;
  }

  function syncDimensionButtons(mode) {
    const btn2d = document.getElementById('btn-mode-2d');
    const btn3d = document.getElementById('btn-mode-3d');
    const badge = document.getElementById('hud-mode-badge');
    if (btn2d) btn2d.classList.toggle('active', mode === '2d');
    if (btn3d) btn3d.classList.toggle('active', mode === '3d');
    if (badge) badge.textContent = mode === '2d' ? '2D WIN32' : '3D WIN32';
  }

  async function executeQuick2DAction() {
    playUiSound('execute');
    if (astrolabe) {
      astrolabe.setProjectionMode('2d', true);
      syncDimensionButtons('2d');
    }
    const res = await window.mpeApi.executePoint({
      id: 'quick-2d-action',
      title: 'Acao 2D Instantanea',
      actionType: 'action_2d_scan',
      params: {
        captureScope: 'active_window',
        saveDir:
          (currentConfig &&
            currentConfig.telegram &&
            currentConfig.telegram.savedScreenshotsFolder) ||
          './prints'
      }
    });
    if (res && res.message) {
      showToast(res.message);
    } else {
      showToast('Acao 2D executada no plano original!');
    }
  }

  async function handlePointExecute(point) {
    if (!point) return;
    playUiSound('execute');

    if (point.actionType === 'toggle_2d_3d') {
      if (astrolabe) {
        const nextMode = astrolabe.toggleProjectionMode();
        syncDimensionButtons(nextMode);
        showToast(
          nextMode === '2d'
            ? 'Modo 2D Ativado (Base Fiel da Imagem com Animacoes 2D)'
            : 'Modo 3D Ativado (Constelacao Orbital em Profundidade)'
        );
      }
      return;
    }

    if (point.actionType === 'action_2d_scan') {
      await executeQuick2DAction();
      return;
    }

    if (point.actionType === 'open_settings') {
      startAddPointFlow();
      return;
    }

    const res = await window.mpeApi.executePoint(point);
    if (handleBlockedResult(res)) {
      return;
    }
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

    if (res.type === 'request_named_print') {
      openNamedPrintModal(res);
      return;
    }

    if (res.type === 'text_selection') {
      const txtModal = document.getElementById('modal-text-selection');
      const txtArea = document.getElementById('captured-text-area');
      txtArea.value = res.selectedText || '';
      txtModal.classList.remove('hidden');
      txtArea.focus();

      try {
        window.mpeApi.listOpenWindows().then((winList) => {
          if (!Array.isArray(winList)) return;
          const dl = document.getElementById('target-system-suggestions');
          if (dl) {
            winList.forEach((w) => {
              if (w.title && !dl.querySelector(`option[value="${w.title.replace(/"/g, '')}"]`)) {
                const opt = document.createElement('option');
                opt.value = w.title;
                opt.textContent = `${w.process || 'Janela'} (${w.title})`;
                dl.appendChild(opt);
              }
            });
          }
        });
      } catch (_) {}

      if (res.selectedText) {
        showToast(`Texto capturado com sucesso (${res.selectedText.length} caracteres)!`);
      } else {
        showToast('Nenhum texto selecionado no sistema de origem. Digite ou cole o texto acima.');
      }
      return;
    }

    // Organizador de Arquivos integrado ao Astrolabio
    if (res.type === 'open_organizer') {
      if (organizerUI) {
        organizerUI.setScope(res.scope || 'arquivos');
        organizerUI.setWorkspaceTab('organizer', false);
      }
      showToast(res.message || 'Organizador de Arquivos aberto.');
      return;
    }

    if (res.type === 'organize_files_quick') {
      if (organizerUI) {
        await organizerUI.quickOrganize({
          scope: res.scope || 'arquivos',
          criterion: res.criterion || 'type',
          pickMode: res.pickMode || 'files'
        });
      }
      return;
    }

    // Acoes que abrem outra janela (pasta, URL, programa, projeto): recolhe o HUD para segundo plano
    if (
      ['open_path', 'open_url', 'command', 'launch_app_project'].includes(res.type) ||
      (res.type === 'send_link_chat' && res.hideHud)
    ) {
      if (astrolabe) astrolabe.pause();
      window.mpeApi.hideHud();
      return;
    }

    const dict = getToneDict();
    showToast(res.message || dict.toastExecuted(point.title));
  }

  let currentWizStep = 1;
  let wizTitleManuallyEdited = false;

  const GOAL_BY_ACTION = {
    system_to_system_print: 'print_app',
    print_telegram: 'print_app',
    area_print: 'area_crop',
    area_print_system: 'area_crop',
    area_print_telegram: 'area_crop',
    print: 'save_print',
    named_print: 'save_print',
    text_selection: 'text_move',
    text_to_system: 'text_move',
    text_telegram: 'text_move',
    open_organizer: 'organize',
    organize_files_quick: 'organize',
    open_path: 'open_thing',
    open_url: 'open_url',
    send_link_chat: 'send_link_chat',
    launch_app_project: 'launch_app_project',
    run_python_script: 'run_python_script',
    command: 'open_thing',
    macro_sequence: 'macro',
    toggle_2d_3d: 'hud_mode',
    action_2d_scan: 'hud_mode'
  };

  function setWizardStep(step) {
    currentWizStep = Math.max(1, Math.min(3, Number(step) || 1));
    [1, 2, 3].forEach((n) => {
      const pane = document.getElementById(`wiz-pane-${n}`);
      if (pane) pane.classList.toggle('hidden', n !== currentWizStep);
    });
    document.querySelectorAll('.wiz-step-pill').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.wizStep) === currentWizStep);
    });
    const prevBtn = document.getElementById('btn-wiz-prev');
    const nextBtn = document.getElementById('btn-wiz-next');
    if (prevBtn) prevBtn.classList.toggle('hidden', currentWizStep === 1);
    if (nextBtn) nextBtn.classList.toggle('hidden', currentWizStep === 3);
    if (currentWizStep === 3) {
      drawPositionMinimap();
    }
  }

  function suggestFriendlyTitle() {
    const type = document.getElementById('pt-action-type').value;
    const scope = document.getElementById('pt-capture-scope').value;
    const targetSys = document.getElementById('pt-target-system').value.trim();
    const targetPath = document.getElementById('pt-target-path').value.trim();
    const url = document.getElementById('pt-url').value.trim();
    const orgScope = (document.getElementById('pt-org-scope') && document.getElementById('pt-org-scope').value) || 'arquivos';

    switch (type) {
      case 'print_telegram':
        return 'Print -> Telegram';
      case 'area_print_telegram':
        return 'Recorte -> Telegram';
      case 'system_to_system_print':
        return targetSys && !targetSys.includes('|') ? `Print -> ${targetSys.slice(0, 18)}` : 'Print -> Outro App';
      case 'area_print_system':
        return targetSys && !targetSys.includes('|') ? `Recorte -> ${targetSys.slice(0, 16)}` : 'Recorte -> App';
      case 'print':
        return scope === 'fullscreen' ? 'Print da Tela' : 'Print da Janela';
      case 'named_print':
        return 'Print Nomeado';
      case 'area_print':
        return 'Recortar e Salvar';
      case 'text_selection':
        return 'Capturar Texto';
      case 'text_to_system':
        return targetSys && !targetSys.includes('|') ? `Texto -> ${targetSys.slice(0, 16)}` : 'Texto -> App';
      case 'text_telegram':
        return 'Texto -> Telegram';
      case 'open_organizer':
        return 'Organizar Arquivos';
      case 'organize_files_quick':
        return orgScope === 'prints' ? 'Organizar Prints' : 'Organizar na Hora';
      case 'open_path': {
        if (!targetPath) return 'Abrir Pasta / App';
        const seg = targetPath.split(/[\\/]/).filter(Boolean).pop() || targetPath;
        return `Abrir ${seg.replace(/\.exe$/i, '').slice(0, 18)}`;
      }
      case 'open_url': {
        if (!url) return 'Abrir Site';
        return `Site ${url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0].slice(0, 18)}`;
      }
      case 'send_link_chat': {
        const chEl = document.getElementById('pt-chat-channel');
        const ch = (chEl && chEl.value) || 'telegram_bot';
        return ch.includes('telegram') ? 'Link -> Telegram' : ch === 'whatsapp' ? 'Link -> WhatsApp' : 'Enviar Link Chat';
      }
      case 'launch_app_project': {
        const appN = (document.getElementById('pt-launch-app-name') && document.getElementById('pt-launch-app-name').value.trim()) || '';
        const proj = (document.getElementById('pt-launch-project-path') && document.getElementById('pt-launch-project-path').value.trim()) || '';
        if (appN.toLowerCase() === 'notepad') return 'Bloco de Notas';
        if (appN.toLowerCase() === 'vscode' || proj) return 'Projeto VS Code';
        return appN ? `Abrir ${appN.slice(0, 16)}` : 'Abrir Aplicativo';
      }
      case 'run_python_script': {
        const pySel = document.getElementById('pt-python-script-select');
        const label = pySel && pySel.options[pySel.selectedIndex] ? pySel.options[pySel.selectedIndex].text : '';
        return label && !label.startsWith('--') ? `Py: ${label.slice(0, 16)}` : 'Auto-Script Python';
      }
      case 'command':
        return 'Executar Programa';
      case 'macro_sequence':
        return 'Rotina Automática';
      case 'toggle_2d_3d':
        return 'Alternar 2D / 3D';
      case 'action_2d_scan':
        return 'Ação Rápida 2D';
      default:
        return 'Botão Automático';
    }
  }

  function updatePointLiveSummary() {
    const type = document.getElementById('pt-action-type').value;
    const scope = document.getElementById('pt-capture-scope').value;
    const targetSys = document.getElementById('pt-target-system').value.trim() || 'outro programa';
    const tgTarget = document.getElementById('pt-telegram-target').value.trim() || 'seu Telegram';
    const targetPath = document.getElementById('pt-target-path').value.trim() || 'pasta escolhida';
    const url = document.getElementById('pt-url').value.trim() || 'site informado';
    const scopeLabel =
      scope === 'fullscreen' ? 'a tela inteira' : scope === 'area' ? 'um pedaço recortado da tela' : 'a janela aberta';

    let text = 'Ao clicar neste botão no Astrolábio, o M.P.E executa a tarefa configurada.';
    switch (type) {
      case 'system_to_system_print':
        text = `Tira print de ${scopeLabel}, salva e cola direto no aplicativo "${targetSys}".`;
        break;
      case 'area_print_system':
        text = `Você risca um pedaço da tela e o M.P.E envia a imagem direto para "${targetSys}".`;
        break;
      case 'print_telegram':
        text = `Tira print de ${scopeLabel} e envia para o Telegram (${tgTarget}).`;
        break;
      case 'area_print_telegram':
        text = `Você recorta uma área da tela e o M.P.E envia para o Telegram (${tgTarget}).`;
        break;
      case 'print':
        text = `Tira print de ${scopeLabel}, salva na pasta de prints e copia para colar com Ctrl+V.`;
        break;
      case 'named_print':
        text = `Tira print de ${scopeLabel} e abre uma janelinha para você dar nome e categoria.`;
        break;
      case 'area_print':
        text = `Permite recortar qualquer pedaço da tela, salvar na pasta e copiar para colar.`;
        break;
      case 'text_selection':
        text = `Copia o texto selecionado na sua tela e abre opções rápidas de envio ou edição.`;
        break;
      case 'text_to_system':
        text = `Copia o texto selecionado e cola automaticamente no aplicativo "${targetSys}".`;
        break;
      case 'text_telegram':
        text = `Copia o texto selecionado e envia para o Telegram (${tgTarget}).`;
        break;
      case 'open_organizer':
        text = `Abre o painel do Organizador para você arrumar, buscar e desfazer pastas de arquivos.`;
        break;
      case 'organize_files_quick':
        text = `Abre a janela do Windows para você escolher arquivos e o M.P.E já organiza tudo em pastas.`;
        break;
      case 'open_path':
        text = `Abre imediatamente "${targetPath}" no seu computador com 1 clique.`;
        break;
      case 'open_url':
        text = `Abre o site "${url}" no seu navegador padrão.`;
        break;
      case 'send_link_chat': {
        const linkU = (document.getElementById('pt-chat-link-url') && document.getElementById('pt-chat-link-url').value.trim()) || 'link configurado';
        const ch = (document.getElementById('pt-chat-channel') && document.getElementById('pt-chat-channel').value) || 'telegram_bot';
        text = `Envia o link "${linkU}" via canal "${ch}".`;
        break;
      }
      case 'launch_app_project': {
        const tPath = (document.getElementById('pt-launch-target-path') && document.getElementById('pt-launch-target-path').value.trim()) || 'aplicativo';
        const pPath = (document.getElementById('pt-launch-project-path') && document.getElementById('pt-launch-project-path').value.trim()) || '';
        text = pPath
          ? `Abre "${tPath}" carregando o projeto "${pPath}".`
          : `Abre o aplicativo "${tPath}" com 1 clique.`;
        break;
      }
      case 'run_python_script': {
        const sPath = (document.getElementById('pt-python-script-path') && document.getElementById('pt-python-script-path').value.trim()) || 'auto-script Python';
        text = `Executa o auto-script Python "${sPath}".`;
        break;
      }
      case 'command':
        text = `Inicia o programa ou comando "${document.getElementById('pt-command').value.trim() || 'calc.exe'}".`;
        break;
      case 'macro_sequence': {
        const s1 = document.getElementById('pt-macro-step1');
        const s2 = document.getElementById('pt-macro-step2');
        const l1 = s1 && s1.options[s1.selectedIndex] ? s1.options[s1.selectedIndex].text : 'Etapa 1';
        const l2 = s2 && s2.options[s2.selectedIndex] ? s2.options[s2.selectedIndex].text : 'Etapa 2';
        text = `Executa em sequência: (1) ${l1} e logo depois (2) ${l2}.`;
        break;
      }
      case 'toggle_2d_3d':
        text = `Alterna a visualização do Astrolábio entre plano 2D e esfera 3D.`;
        break;
      case 'action_2d_scan':
        text = `Ativa o modo 2D e captura imediatamente a janela atual.`;
        break;
    }
    const sumEl = document.getElementById('pt-live-summary');
    if (sumEl) sumEl.textContent = text;

    const titleEl = document.getElementById('pt-title');
    if (titleEl && !wizTitleManuallyEdited && !editingPointId) {
      titleEl.value = suggestFriendlyTitle();
    }
  }

  function populatePythonScriptSelect(selectedId = '') {
    const sel = document.getElementById('pt-python-script-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Selecione um Auto-Script salvo --</option>';
    const scripts = (currentConfig && Array.isArray(currentConfig.autoScripts)) ? currentConfig.autoScripts : [];
    scripts.forEach((sc) => {
      const opt = document.createElement('option');
      opt.value = sc.id || '';
      opt.dataset.filePath = sc.filePath || '';
      opt.textContent = sc.name || sc.id || 'Script Python';
      if (selectedId && sc.id === selectedId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function updatePointModalFields() {
    const type = document.getElementById('pt-action-type').value;
    const grpScope = document.getElementById('group-capture-scope');
    const grpSave = document.getElementById('group-save-dir');
    const grpTargetSys = document.getElementById('group-target-system');
    const grpTg = document.getElementById('group-telegram-target');
    const grpPath = document.getElementById('group-target-path');
    const grpUrl = document.getElementById('group-url');
    const grpSendLink = document.getElementById('group-send-link-chat');
    const grpLaunchApp = document.getElementById('group-launch-app');
    const grpPyScript = document.getElementById('group-python-script');
    const grpCmd = document.getElementById('group-command');
    const grpOrg = document.getElementById('group-organizer-opts');
    const grpMacro = document.getElementById('group-macro-steps');

    grpScope.classList.toggle(
      'hidden',
      !['print', 'named_print', 'print_telegram', 'system_to_system_print', 'area_print', 'area_print_telegram', 'area_print_system'].includes(type)
    );
    grpSave.classList.toggle(
      'hidden',
      ![
        'print',
        'named_print',
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
    if (grpSendLink) grpSendLink.classList.toggle('hidden', type !== 'send_link_chat');
    if (grpLaunchApp) grpLaunchApp.classList.toggle('hidden', type !== 'launch_app_project');
    if (grpPyScript) grpPyScript.classList.toggle('hidden', type !== 'run_python_script');
    grpCmd.classList.toggle('hidden', type !== 'command');
    if (grpOrg) {
      grpOrg.classList.toggle('hidden', !['open_organizer', 'organize_files_quick'].includes(type));
    }
    if (grpMacro) {
      grpMacro.classList.toggle('hidden', type !== 'macro_sequence');
    }

    // Sincroniza cards visuais e botoes de escolha
    const goalKey = GOAL_BY_ACTION[type] || 'print_app';
    document.querySelectorAll('.wiz-goal-card').forEach((card) => {
      card.classList.toggle('selected', card.dataset.goal === goalKey);
    });

    const curScope = type.startsWith('area_') ? 'area' : document.getElementById('pt-capture-scope').value;
    document.querySelectorAll('#wiz-scope-choices .wiz-choice-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.scope === curScope);
    });

    document.querySelectorAll('#wiz-org-mode-choices .wiz-choice-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.orgAction === type);
    });

    const orbitVal = document.getElementById('pt-orbit').value;
    document.querySelectorAll('#wiz-orbit-choices .wiz-choice-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.orbit === orbitVal);
    });

    const curApp = document.getElementById('pt-target-system').value.trim().toLowerCase();
    document.querySelectorAll('.wiz-app-pill').forEach((pill) => {
      const pApp = (pill.dataset.app || '').toLowerCase();
      pill.classList.toggle('active', curApp === pApp || (pApp === 'telegram' && type.includes('telegram')));
    });

    updatePointLiveSummary();
  }

  function openPointModal(point) {
    const modal = document.getElementById('modal-point');
    const delBtn = document.getElementById('btn-delete-point');
    const heading = document.getElementById('point-modal-heading');
    const subtitle = document.getElementById('point-modal-subtitle');
    document.getElementById('pt-open-windows-list').classList.add('hidden');
    wizTitleManuallyEdited = Boolean(point);

    if (point) {
      editingPointId = point.id;
      heading.textContent = `Editar Botão: ${point.title || point.code || 'Automação'}`;
      if (subtitle) subtitle.textContent = 'Ajuste a tarefa, o destino ou a posição no círculo.';
      delBtn.classList.remove('hidden');

      document.getElementById('pt-title').value = point.title || '';
      setHotkeyLetterField(point.hotkeyLetter || '');
      document.getElementById('pt-code').value = point.code || '10 7';
      document.getElementById('pt-action-type').value = point.actionType || 'system_to_system_print';
      document.getElementById('pt-desc').value = point.description || '';
      document.getElementById('pt-orbit').value = String(point.orbit || 3);
      document.getElementById('pt-angle').value = String(point.angle || 0);
      document.getElementById('pt-elevation').value = String(point.elevation || 15);
      document.getElementById('pt-custom-radius').value =
        typeof point.customRadius === 'number' ? String(point.customRadius) : '';
      document.getElementById('pt-vector-style').value = point.vectorStyle || 'gold';
      document.getElementById('pt-glyph').value = point.glyph || '';
      if (document.getElementById('pt-show-in-mini')) {
        document.getElementById('pt-show-in-mini').checked = point.showInMini === true;
      }

      const p = point.params || {};
      const defaultScope = (point.actionType || '').startsWith('area_') ? 'area' : (p.captureScope || 'active_window');
      document.getElementById('pt-capture-scope').value = defaultScope;
      document.getElementById('pt-save-dir').value =
        p.saveDir ||
        (currentConfig.telegram && currentConfig.telegram.savedScreenshotsFolder) ||
        './prints';
      document.getElementById('pt-target-system').value = p.targetSystem || 'Telegram';
      document.getElementById('pt-telegram-target').value =
        p.telegramTarget ||
        (currentConfig.telegram && currentConfig.telegram.savedChatPath) ||
        'Eu | Você | Leonardo';
      document.getElementById('pt-target-path').value = p.targetPath || '';
      document.getElementById('pt-url').value = p.url || '';
      document.getElementById('pt-command').value = p.command || '';

      if (document.getElementById('pt-chat-link-url')) {
        document.getElementById('pt-chat-link-url').value = p.linkUrl || p.url || '';
        document.getElementById('pt-chat-channel').value = p.deliveryChannel || 'telegram_bot';
        document.getElementById('pt-chat-target-system').value = p.targetSystem || p.telegramTarget || '';
        document.getElementById('pt-chat-bot-token').value = p.botToken || '';
        document.getElementById('pt-chat-id').value = p.chatId || '';
        document.getElementById('pt-chat-webhook-url').value = p.webhookUrl || '';
        document.getElementById('pt-chat-message-template').value = p.messageTemplate || 'Link: {url}';
        document.getElementById('pt-chat-auto-enter').checked = p.autoSendEnter !== false;
      }
      if (document.getElementById('pt-launch-app-name')) {
        document.getElementById('pt-launch-app-name').value = p.appName || '';
        document.getElementById('pt-launch-target-path').value = p.targetPath || '';
        document.getElementById('pt-launch-project-path').value = p.projectPath || '';
        document.getElementById('pt-launch-args').value = Array.isArray(p.args) ? p.args.join(' ') : (p.args || '');
      }
      populatePythonScriptSelect(p.scriptId || '');
      if (document.getElementById('pt-python-script-path')) {
        document.getElementById('pt-python-script-path').value = p.scriptPath || '';
      }

      const autoEnterEl = document.getElementById('pt-auto-enter');
      if (autoEnterEl) autoEnterEl.checked = p.autoSendEnter !== false;
      const orgScopeEl = document.getElementById('pt-org-scope');
      if (orgScopeEl) orgScopeEl.value = p.targetScope || 'arquivos';
      const orgCritEl = document.getElementById('pt-org-criterion');
      if (orgCritEl) orgCritEl.value = p.criterion || 'type';
      if (Array.isArray(p.steps) && p.steps.length >= 2) {
        const s1 = document.getElementById('pt-macro-step1');
        const s2 = document.getElementById('pt-macro-step2');
        if (s1 && p.steps[0].actionType) s1.value = p.steps[0].actionType;
        if (s2 && p.steps[1].actionType) s2.value = p.steps[1].actionType;
      }
      setWizardStep(2);
    } else {
      editingPointId = null;
      heading.textContent = 'Criar Botão Automático no Astrolábio';
      if (subtitle) subtitle.textContent = 'Siga os 3 passos simples - sem precisar programar nada.';
      delBtn.classList.add('hidden');

      const nextNum = (currentConfig.points ? currentConfig.points.length : 9) + 1;
      document.getElementById('pt-action-type').value = 'system_to_system_print';
      document.getElementById('pt-capture-scope').value = 'active_window';
      document.getElementById('pt-title').value = 'Print -> Telegram';
      setHotkeyLetterField('');
      document.getElementById('pt-code').value = `${String(nextNum).padStart(2, '0')} 7`;
      document.getElementById('pt-desc').value = '';
      document.getElementById('pt-orbit').value = '3';
      document.getElementById('pt-angle').value = String((nextNum * 37) % 360);
      document.getElementById('pt-elevation').value = String(((nextNum % 3) - 1) * 18);
      document.getElementById('pt-custom-radius').value = '';
      document.getElementById('pt-vector-style').value = 'gold';
      document.getElementById('pt-glyph').value = 'Π';
      if (document.getElementById('pt-show-in-mini')) {
        document.getElementById('pt-show-in-mini').checked = false;
      }

      document.getElementById('pt-save-dir').value =
        (currentConfig.telegram && currentConfig.telegram.savedScreenshotsFolder) ||
        './prints';
      document.getElementById('pt-target-system').value = 'Telegram';
      document.getElementById('pt-telegram-target').value =
        (currentConfig.telegram && currentConfig.telegram.savedChatPath) ||
        'Eu | Você | Leonardo';
      document.getElementById('pt-target-path').value = '';
      document.getElementById('pt-url').value = '';
      document.getElementById('pt-command').value = '';
      if (document.getElementById('pt-chat-link-url')) {
        document.getElementById('pt-chat-link-url').value = '';
        document.getElementById('pt-chat-channel').value = 'telegram_bot';
        document.getElementById('pt-chat-target-system').value = 'Telegram';
        document.getElementById('pt-chat-bot-token').value = '';
        document.getElementById('pt-chat-id').value = '';
        document.getElementById('pt-chat-webhook-url').value = '';
        document.getElementById('pt-chat-message-template').value = 'Link: {url}';
        document.getElementById('pt-chat-auto-enter').checked = true;
      }
      if (document.getElementById('pt-launch-app-name')) {
        document.getElementById('pt-launch-app-name').value = 'notepad';
        document.getElementById('pt-launch-target-path').value = 'notepad.exe';
        document.getElementById('pt-launch-project-path').value = '';
        document.getElementById('pt-launch-args').value = '';
      }
      populatePythonScriptSelect('');
      if (document.getElementById('pt-python-script-path')) {
        document.getElementById('pt-python-script-path').value = '';
      }
      const autoEnterEl = document.getElementById('pt-auto-enter');
      if (autoEnterEl) autoEnterEl.checked = true;
      setWizardStep(1);
    }

    updatePointModalFields();
    modal.classList.remove('hidden');
    drawPositionMinimap();
  }

  /**
   * Mini-mapa circular dentro do Forjador de Estrelas: mostra todos os pontos existentes
   * (dourado) e o ponto sendo editado (ciano). Clique/arraste nele para escolher a posicao.
   */
  function drawPositionMinimap() {
    const cv = document.getElementById('pt-minimap-canvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const w = cv.width;
    const h = cv.height;
    const cx = w / 2;
    const cy = h / 2;
    const R = w / 2 - 6;
    const radii = { 1: 0.165, 2: 0.725, 3: 0.855 };

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(229, 184, 75, 0.55)';
    ctx.lineWidth = 1;
    [1, 2, 3].forEach((o) => {
      ctx.beginPath();
      ctx.arc(cx, cy, R * radii[o], 0, Math.PI * 2);
      ctx.setLineDash(o === 1 ? [2, 3] : []);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#E5B84B';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    const toXY = (angle, orbit, customR) => {
      const r = typeof customR === 'number' && customR > 0.08 ? customR : radii[orbit] || 0.855;
      const rad = ((angle - 90) * Math.PI) / 180;
      return { x: cx + Math.cos(rad) * r * R, y: cy + Math.sin(rad) * r * R };
    };

    (currentConfig.points || []).forEach((p) => {
      if (p.id === editingPointId) return;
      const pos = toXY(Number(p.angle) || 0, Number(p.orbit) || 3, p.customRadius);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(229, 184, 75, 0.75)';
      ctx.fill();
    });

    const angle = Number(document.getElementById('pt-angle').value) || 0;
    const orbit = Number(document.getElementById('pt-orbit').value) || 3;
    const crRaw = document.getElementById('pt-custom-radius').value;
    const cr = crRaw ? Number(crRaw) : undefined;
    const me = toXY(angle, orbit, cr);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(me.x, me.y);
    ctx.strokeStyle = 'rgba(115, 243, 255, 0.6)';
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(me.x, me.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#73F3FF';
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function applyPickedCoords(coords) {
    document.getElementById('pt-angle').value = String(coords.angle);
    document.getElementById('pt-orbit').value = String(coords.orbit);
    document.getElementById('pt-custom-radius').value = String(coords.customRadius);
    document.querySelectorAll('#wiz-orbit-choices .wiz-choice-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.orbit) === Number(coords.orbit));
    });
    drawPositionMinimap();
  }

  function showPlacementBanner(text) {
    const banner = document.getElementById('placement-banner');
    document.getElementById('placement-banner-text').textContent = text;
    banner.classList.remove('hidden');
  }

  function hidePlacementBanner() {
    document.getElementById('placement-banner').classList.add('hidden');
  }

  function setMovePointsUI(enabled) {
    document.getElementById('btn-toggle-move-points').classList.toggle('active', enabled);
    const topBtn = document.getElementById('btn-move-stars-top');
    if (topBtn) topBtn.classList.toggle('primary', enabled);
    if (enabled) {
      showPlacementBanner(
        'MODO MOVER PONTOS: Clique e arraste qualquer estrela para muda-la de lugar. Ao soltar, a nova posicao e salva automaticamente.'
      );
    } else {
      hidePlacementBanner();
    }
  }

  /**
   * Fluxo "Adicionar Ponto": 1) usuario clica no circulo onde quer o ponto, 2) abre o Forjador
   * ja com angulo/orbita preenchidos para configurar a acao (Print, Telegram, Recorte, etc.).
   */
  function startAddPointFlow() {
    if (currentMode === 'hud-only') {
      showToast('Para adicionar ou editar pontos, abra pelo icone executavel MPE.exe.');
      return;
    }
    if (astrolabe.isMovePointsMode) {
      astrolabe.setMovePointsMode(false);
    }
    showPlacementBanner(
      'ADICIONAR PONTO: Clique no lugar do Circulo onde o novo ponto deve ficar. Depois voce escolhe a acao dele.'
    );
    astrolabe.startPickingLocation((coords) => {
      hidePlacementBanner();
      openPointModal(null);
      applyPickedCoords(coords);
      showToast(`Posicao escolhida: ${coords.angle} graus, Orbita ${coords.orbit}. Agora configure a acao do ponto.`);
    });
  }

  function buildPointPayloadFromForm() {
    const title =
      document.getElementById('pt-title').value.trim() ||
      suggestFriendlyTitle() ||
      'Novo Atalho Estelar';
    const code = document.getElementById('pt-code').value.trim() || '10 7';
    const actionType = document.getElementById('pt-action-type').value;
    const summaryFallback =
      (document.getElementById('pt-live-summary') &&
        document.getElementById('pt-live-summary').textContent.trim()) ||
      `Comando programado: ${title}`;
    const description = document.getElementById('pt-desc').value.trim() || summaryFallback;
    const orbit = Number(document.getElementById('pt-orbit').value) || 3;
    const angle = Number(document.getElementById('pt-angle').value) || 0;
    const elevation = Number(document.getElementById('pt-elevation').value) || 0;
    const vectorStyle = document.getElementById('pt-vector-style').value;
    const glyph = document.getElementById('pt-glyph').value;
    const customRadiusRaw = document.getElementById('pt-custom-radius').value;
    const customRadius = customRadiusRaw ? Number(customRadiusRaw) : undefined;

    const autoEnterEl = document.getElementById('pt-auto-enter');
    const orgScopeEl = document.getElementById('pt-org-scope');
    const orgCritEl = document.getElementById('pt-org-criterion');
    const step1El = document.getElementById('pt-macro-step1');
    const step2El = document.getElementById('pt-macro-step2');

    const params = {
      captureScope: document.getElementById('pt-capture-scope').value || 'active_window',
      saveDir: document.getElementById('pt-save-dir').value.trim() || './prints',
      targetSystem: document.getElementById('pt-target-system').value.trim() || 'Telegram',
      telegramTarget:
        document.getElementById('pt-telegram-target').value.trim() || 'Eu | Você | Leonardo',
      targetPath: document.getElementById('pt-target-path').value.trim(),
      url: document.getElementById('pt-url').value.trim(),
      command: document.getElementById('pt-command').value.trim(),
      autoSendEnter: autoEnterEl ? autoEnterEl.checked : true
    };

    if (actionType === 'open_organizer' || actionType === 'organize_files_quick') {
      params.targetScope = (orgScopeEl && orgScopeEl.value) || 'arquivos';
      params.criterion = (orgCritEl && orgCritEl.value) || 'type';
      params.pickMode = 'files';
    }

    if (actionType === 'macro_sequence') {
      params.steps = [
        { actionType: (step1El && step1El.value) || 'print' },
        { actionType: (step2El && step2El.value) || 'open_organizer' }
      ];
    }

    if (actionType === 'send_link_chat') {
      const chLink = document.getElementById('pt-chat-link-url');
      const chSel = document.getElementById('pt-chat-channel');
      const chSys = document.getElementById('pt-chat-target-system');
      const chTok = document.getElementById('pt-chat-bot-token');
      const chId = document.getElementById('pt-chat-id');
      const chWh = document.getElementById('pt-chat-webhook-url');
      const chTpl = document.getElementById('pt-chat-message-template');
      const chEnt = document.getElementById('pt-chat-auto-enter');
      params.linkUrl = (chLink && chLink.value.trim()) || params.url || '';
      params.deliveryChannel = (chSel && chSel.value) || 'telegram_bot';
      params.targetSystem = (chSys && chSys.value.trim()) || params.targetSystem;
      params.telegramTarget = (chSys && chSys.value.trim()) || params.telegramTarget;
      params.botToken = (chTok && chTok.value.trim()) || '';
      params.chatId = (chId && chId.value.trim()) || '';
      params.webhookUrl = (chWh && chWh.value.trim()) || '';
      params.messageTemplate = (chTpl && chTpl.value.trim()) || 'Link: {url}';
      params.autoSendEnter = chEnt ? chEnt.checked : true;
    }

    if (actionType === 'launch_app_project') {
      const appN = document.getElementById('pt-launch-app-name');
      const tPath = document.getElementById('pt-launch-target-path');
      const pPath = document.getElementById('pt-launch-project-path');
      const argsEl = document.getElementById('pt-launch-args');
      params.appName = (appN && appN.value.trim()) || '';
      params.targetPath = (tPath && tPath.value.trim()) || params.targetPath || '';
      params.projectPath = (pPath && pPath.value.trim()) || '';
      params.args = (argsEl && argsEl.value.trim()) || '';
    }

    if (actionType === 'run_python_script') {
      const pySel = document.getElementById('pt-python-script-select');
      const pyPath = document.getElementById('pt-python-script-path');
      const selOpt = pySel && pySel.options[pySel.selectedIndex];
      params.scriptId = (pySel && pySel.value) || '';
      params.scriptPath =
        (pyPath && pyPath.value.trim()) ||
        (selOpt && selOpt.dataset && selOpt.dataset.filePath) ||
        '';
    }

    return {
      id: editingPointId || `star-${Date.now()}`,
      code,
      title,
      description,
      actionType,
      orbit,
      angle,
      elevation,
      ...(typeof customRadius === 'number' && !Number.isNaN(customRadius) ? { customRadius } : {}),
      vectorStyle,
      glyph,
      hasArrow: vectorStyle === 'blue',
      showInMini: Boolean(document.getElementById('pt-show-in-mini') && document.getElementById('pt-show-in-mini').checked),
      hotkeyLetter: readHotkeyLetterField(),
      params
    };
  }

  function readHotkeyLetterField() {
    const el = document.getElementById('pt-hotkey-letter');
    const letter = el ? String(el.value || '').trim().toUpperCase() : '';
    return /^[A-Z]$/.test(letter) ? letter : '';
  }

  function setHotkeyLetterField(letter) {
    const el = document.getElementById('pt-hotkey-letter');
    if (el) el.value = letter || '';
  }

  function findPointByHotkeyLetter(letter) {
    const pts = (currentConfig && Array.isArray(currentConfig.points)) ? currentConfig.points : [];
    return pts.find((p) => p && p.hotkeyLetter === letter) || null;
  }

  async function savePointFromModal() {
    const pointObj = buildPointPayloadFromForm();
    if (pointObj.hotkeyLetter) {
      const owner = findPointByHotkeyLetter(pointObj.hotkeyLetter);
      if (owner && owner.id !== pointObj.id) {
        showToast(`A letra ${pointObj.hotkeyLetter} ja esta no atalho "${owner.title || owner.code}". Escolha outra.`);
        const letterEl = document.getElementById('pt-hotkey-letter');
        if (letterEl) letterEl.focus();
        return;
      }
    }
    if (pointObj.actionType === 'open_url' && !(pointObj.params && pointObj.params.url)) {
      showToast('Informe o endereco do site (URL) antes de salvar.');
      setWizardStep(2);
      const urlEl = document.getElementById('pt-url');
      if (urlEl) urlEl.focus();
      return;
    }
    if (pointObj.actionType === 'open_path' && !(pointObj.params && pointObj.params.targetPath)) {
      showToast('Escolha uma pasta ou programa antes de salvar.');
      setWizardStep(2);
      const pathEl = document.getElementById('pt-target-path');
      if (pathEl) pathEl.focus();
      return;
    }

    const points = Array.isArray(currentConfig.points) ? [...currentConfig.points] : [];
    const existingIdx = points.findIndex((p) => p.id === pointObj.id);
    if (existingIdx >= 0) {
      points[existingIdx] = pointObj;
    } else {
      points.push(pointObj);
    }

    currentConfig.points = points;
    currentConfig = await window.mpeApi.saveConfig(currentConfig);
    applySyncedConfig(currentConfig);

    document.getElementById('modal-point').classList.add('hidden');
    showToast(getToneDict().toastSaved);
  }

  async function deletePointFromModal() {
    if (!editingPointId) return;
    currentConfig.points = (currentConfig.points || []).filter((p) => p.id !== editingPointId);
    currentConfig = await window.mpeApi.saveConfig(currentConfig);
    applySyncedConfig(currentConfig);
    document.getElementById('modal-point').classList.add('hidden');
    showToast('Ponto removido do mapa estelar.');
  }

  function formatGuidePointSub(pt) {
    const p = (pt && pt.params) || {};
    if (p.targetSystem && ['system_to_system_print', 'area_print_system', 'text_to_system'].includes(pt.actionType)) {
      return `Destino: ${p.targetSystem}`;
    }
    if (p.telegramTarget && ['print_telegram', 'area_print_telegram', 'text_telegram'].includes(pt.actionType)) {
      return `Telegram: ${p.telegramTarget}`;
    }
    if (p.targetPath && pt.actionType === 'open_path') {
      return `Caminho: ${p.targetPath}`;
    }
    if (p.url && pt.actionType === 'open_url') {
      return `URL: ${p.url}`;
    }
    if (pt.actionType === 'send_link_chat') {
      return `Chat (${p.deliveryChannel || 'bot'}): ${p.linkUrl || p.url || ''}`;
    }
    if (pt.actionType === 'launch_app_project') {
      return p.projectPath ? `Projeto: ${p.projectPath}` : `App: ${p.targetPath || p.appName || ''}`;
    }
    if (pt.actionType === 'run_python_script') {
      return `Python: ${p.scriptPath || p.scriptId || 'auto-script'}`;
    }
    return pt.description || pt.actionType || '';
  }

  function syncMiniControls(stateObj) {
    const st = stateObj || miniState || {};
    if (typeof st.enabled === 'boolean') miniState.enabled = st.enabled;
    if (typeof st.windowOpen === 'boolean') miniState.windowOpen = st.windowOpen;
    if (typeof st.blockedByConsent === 'boolean') miniState.blockedByConsent = st.blockedByConsent;
    if (typeof st.size === 'number') miniState.size = st.size;
    if (typeof st.scale === 'number') miniState.scale = st.scale;

    const btn = document.getElementById('btn-toggle-mini-astrolabe');
    const pill = document.getElementById('mini-astrolabe-status');
    const sizeRange = document.getElementById('mini-size-range');
    const sizeVal = document.getElementById('mini-size-value');
    const scaleRange = document.getElementById('mini-scale-range');
    const scaleVal = document.getElementById('mini-scale-value');

    const blocked = Boolean(miniState.blockedByConsent || (consentStatus && !consentStatus.accepted));
    const isActive = Boolean(miniState.enabled) && !blocked;

    if (btn) {
      btn.textContent = isActive ? 'Desativar Mini Astrolábio' : 'Ativar Mini Astrolábio';
    }
    if (pill) {
      pill.classList.remove('active', 'blocked');
      if (blocked && (miniState.preferenceEnabled !== undefined ? miniState.preferenceEnabled : miniState.enabled)) {
        pill.textContent = 'Bloqueado';
        pill.classList.add('blocked');
      } else if (isActive) {
        pill.textContent = 'Ativo';
        pill.classList.add('active');
      } else {
        pill.textContent = 'Inativo';
      }
    }
    if (sizeRange) sizeRange.value = String(miniState.size || 68);
    if (sizeVal) sizeVal.textContent = `${Math.round(miniState.size || 68)}px`;
    if (scaleRange) scaleRange.value = String(Number(miniState.scale || 1.0).toFixed(2));
    if (scaleVal) scaleVal.textContent = `${Number(miniState.scale || 1.0).toFixed(2)}x`;
  }

  function renderCentralSlotsPanel() {
    const listEl = document.getElementById('slots-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const pts = (currentConfig && Array.isArray(currentConfig.points)) ? currentConfig.points : [];
    if (pts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'org-empty';
      empty.textContent = 'Nenhum slot configurado ainda.';
      listEl.appendChild(empty);
      return;
    }

    pts.forEach((pt, idx) => {
      const row = document.createElement('div');
      row.className = 'slot-row';
      row.dataset.slotIndex = String(idx);

      const badge = document.createElement('span');
      badge.className = 'slot-num-badge';
      badge.textContent = String(idx + 1);

      const meta = document.createElement('div');
      meta.className = 'slot-meta';
      const titleEl = document.createElement('div');
      titleEl.className = 'slot-title';
      titleEl.textContent = pt.title || `Slot ${idx + 1}`;
      const subEl = document.createElement('div');
      subEl.className = 'slot-sub';
      subEl.textContent = formatGuidePointSub(pt);
      meta.appendChild(titleEl);
      meta.appendChild(subEl);

      const actions = document.createElement('div');
      actions.className = 'slot-actions';

      const execBtn = document.createElement('button');
      execBtn.type = 'button';
      execBtn.className = 'slot-mini-btn slot-exec-btn';
      execBtn.title = `Executar Slot ${idx + 1}`;
      execBtn.textContent = 'Ir';
      execBtn.addEventListener('click', () => handlePointExecute(pt));

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'slot-mini-btn slot-edit-btn';
      editBtn.title = `Editar Slot ${idx + 1}`;
      editBtn.textContent = 'Ed';
      editBtn.addEventListener('click', () => openPointModal(pt));

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'slot-mini-btn slot-reorder-btn';
      upBtn.dataset.reorderDir = 'up';
      upBtn.dataset.index = String(idx);
      upBtn.disabled = idx === 0;
      upBtn.title = 'Subir ordem';
      upBtn.textContent = 'Subir';
      upBtn.addEventListener('click', () => handleReorderSlot(idx, idx - 1));

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'slot-mini-btn slot-reorder-btn';
      downBtn.dataset.reorderDir = 'down';
      downBtn.dataset.index = String(idx);
      downBtn.disabled = idx === pts.length - 1;
      downBtn.title = 'Descer ordem';
      downBtn.textContent = 'Descer';
      downBtn.addEventListener('click', () => handleReorderSlot(idx, idx + 1));

      actions.appendChild(execBtn);
      actions.appendChild(editBtn);
      actions.appendChild(upBtn);
      actions.appendChild(downBtn);

      row.appendChild(badge);
      row.appendChild(meta);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  async function handleReorderSlot(fromIndex, toIndex) {
    if (!window.mpeApi || typeof window.mpeApi.reorderPoint !== 'function') return;
    const res = await window.mpeApi.reorderPoint(fromIndex, toIndex);
    if (res && res.ok && res.config) {
      applySyncedConfig(res.config);
      showToast(`Slot movido de ${fromIndex + 1} para ${toIndex + 1}.`);
    } else if (res && res.error) {
      showToast(res.error);
    }
  }

  function renderPythonScriptsList() {
    const listEl = document.getElementById('py-scripts-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const scripts = (currentConfig && Array.isArray(currentConfig.autoScripts)) ? currentConfig.autoScripts : [];
    if (scripts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'org-empty';
      empty.textContent = 'Nenhum auto-script Python salvo ainda.';
      listEl.appendChild(empty);
      return;
    }

    scripts.forEach((sc) => {
      const row = document.createElement('div');
      row.className = 'py-script-row';

      const top = document.createElement('div');
      top.className = 'py-script-top';

      const info = document.createElement('div');
      const nameEl = document.createElement('div');
      nameEl.className = 'py-script-name';
      nameEl.textContent = sc.name || sc.id;
      const metaEl = document.createElement('div');
      metaEl.className = 'py-script-meta';
      const stepCount = Array.isArray(sc.steps) ? sc.steps.length : 0;
      const lastRun = sc.lastRunAt ? ` | Ultima exec.: ${sc.lastRunAt}` : '';
      metaEl.textContent = `${stepCount} clique(s) | ${sc.filePath || ''}${lastRun}`;
      info.appendChild(nameEl);
      info.appendChild(metaEl);

      const topBtns = document.createElement('div');
      topBtns.className = 'slot-actions';

      const runBtn = document.createElement('button');
      runBtn.type = 'button';
      runBtn.id = `btn-py-run-${sc.id}`;
      runBtn.className = 'hud-btn primary small';
      runBtn.textContent = 'Executar';
      runBtn.addEventListener('click', async () => {
        const res = await window.mpeApi.runPythonScript(sc.id, { dryRun: false });
        if (handleBlockedResult(res)) return;
        if (res && res.unavailable) {
          showToast(res.message || 'Modulo de Auto-Script Python disponivel na etapa M5.');
          return;
        }
        if (res && res.ok) {
          showToast(`Script "${sc.name}" executado (codigo ${res.exitCode ?? 0}).`);
        } else {
          showToast((res && res.message) || 'Falha ao executar script Python.');
        }
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.id = `btn-py-delete-${sc.id}`;
      delBtn.className = 'hud-btn danger small';
      delBtn.textContent = 'Excluir';
      delBtn.addEventListener('click', async () => {
        const res = await window.mpeApi.deletePythonScript(sc.id);
        if (handleBlockedResult(res)) return;
        if (res && res.unavailable) {
          showToast(res.message || 'Modulo de Auto-Script Python disponivel na etapa M5.');
          return;
        }
        if (res && res.ok) {
          showToast(`Script "${sc.name}" removido.`);
          currentConfig = await window.mpeApi.getConfig();
          applySyncedConfig(currentConfig);
        } else {
          showToast((res && res.message) || 'Nao foi possivel excluir o script.');
        }
      });

      topBtns.appendChild(runBtn);
      topBtns.appendChild(delBtn);
      top.appendChild(info);
      top.appendChild(topBtns);

      const schedRow = document.createElement('div');
      schedRow.className = 'py-schedule-row';
      const sched = sc.schedule || {};

      const chkLabel = document.createElement('label');
      chkLabel.className = 'org-check';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = Boolean(sched.enabled);
      const chkSpan = document.createElement('span');
      chkSpan.textContent = 'Agendar';
      chkLabel.appendChild(chk);
      chkLabel.appendChild(chkSpan);

      const timeInput = document.createElement('input');
      timeInput.type = 'time';
      timeInput.className = 'field-input py-time-input';
      timeInput.value = sched.timeHHMM || '09:00';

      const modeSelect = document.createElement('select');
      modeSelect.className = 'field-input py-mode-select';
      const optDaily = document.createElement('option');
      optDaily.value = 'daily';
      optDaily.textContent = 'Diario';
      const optOnce = document.createElement('option');
      optOnce.value = 'once';
      optOnce.textContent = 'Uma vez';
      modeSelect.appendChild(optDaily);
      modeSelect.appendChild(optOnce);
      modeSelect.value = sched.mode === 'once' ? 'once' : 'daily';

      const schedBtn = document.createElement('button');
      schedBtn.type = 'button';
      schedBtn.id = `btn-py-schedule-${sc.id}`;
      schedBtn.className = 'hud-btn small';
      schedBtn.textContent = 'Salvar Horario';
      schedBtn.addEventListener('click', async () => {
        const res = await window.mpeApi.schedulePythonScript(sc.id, {
          enabled: chk.checked,
          timeHHMM: timeInput.value || '09:00',
          mode: modeSelect.value || 'daily'
        });
        if (handleBlockedResult(res)) return;
        if (res && res.unavailable) {
          showToast(res.message || 'Modulo de Auto-Script Python disponivel na etapa M5.');
          return;
        }
        if (res && res.ok) {
          showToast(
            chk.checked
              ? `Agendado para ${timeInput.value || '09:00'} (${modeSelect.value}).`
              : 'Agendamento desativado.'
          );
          currentConfig = await window.mpeApi.getConfig();
          applySyncedConfig(currentConfig);
        } else {
          showToast((res && res.message) || 'Erro ao agendar script.');
        }
      });

      schedRow.appendChild(chkLabel);
      schedRow.appendChild(timeInput);
      schedRow.appendChild(modeSelect);
      schedRow.appendChild(schedBtn);

      row.appendChild(top);
      row.appendChild(schedRow);
      listEl.appendChild(row);
    });
  }

  function applySyncedConfig(cfg) {
    if (!cfg) return;
    currentConfig = cfg;
    applyThemeVariables(cfg.theme);
    applyLanguageToneUI();
    if (astrolabe) astrolabe.setConfig(cfg);
    if (organizerUI) organizerUI.applyConfig(cfg);
    renderGuideHotkeys();
    renderCentralSlotsPanel();
    if (cfg.miniAstrolabe) syncMiniControls(cfg.miniAstrolabe);
    if (cfg.consent) {
      consentStatus = cfg.consent;
      updateConsentUI();
    }
    renderPythonScriptsList();
    populatePythonScriptSelect();
  }

  function renderGuideHotkeys() {
    const grid = document.getElementById('guide-hotkeys-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const pts = (currentConfig && Array.isArray(currentConfig.points)) ? currentConfig.points.slice(0, 9) : [];
    if (pts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'guide-hotkeys-empty';
      empty.textContent = 'Nenhuma estrela configurada ainda.';
      grid.appendChild(empty);
      return;
    }

    pts.forEach((pt, idx) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'guide-hotkey-card';
      card.title = pt.description || pt.title || '';

      const kbd = document.createElement('kbd');
      kbd.className = 'hotkey-num';
      kbd.textContent = String(idx + 1);

      const meta = document.createElement('div');
      meta.className = 'guide-hotkey-meta';

      const top = document.createElement('div');
      top.className = 'guide-hotkey-top';

      const codeEl = document.createElement('span');
      codeEl.className = 'hotkey-code';
      codeEl.textContent = pt.code || '00 1';

      const titleEl = document.createElement('span');
      titleEl.className = 'hotkey-title';
      titleEl.textContent = pt.title || 'Ponto Estelar';

      const subEl = document.createElement('div');
      subEl.className = 'hotkey-sub';
      subEl.textContent = formatGuidePointSub(pt);

      top.appendChild(codeEl);
      top.appendChild(titleEl);
      meta.appendChild(top);
      meta.appendChild(subEl);
      card.appendChild(kbd);
      card.appendChild(meta);

      card.addEventListener('click', () => {
        const guideModal = document.getElementById('modal-guide');
        if (guideModal) guideModal.classList.add('hidden');
        handlePointExecute(pt);
      });

      grid.appendChild(card);
    });
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
    document.getElementById('cfg-tg-chat').value = tg.savedChatPath || 'Eu | Você | Leonardo';
    document.getElementById('cfg-tg-folder').value = tg.savedScreenshotsFolder || './prints';
    document.getElementById('cfg-tg-token').value = tg.botToken || '';
    document.getElementById('cfg-tg-chatid').value = tg.chatId || '';

    const cap = cfg.captures || {};
    document.getElementById('cfg-cap-org-mode').value = cap.organizationMode || 'system_date';
    document.getElementById('cfg-cap-pattern').value =
      cap.namingPattern || '{prefix}_{system}_{date}_{time}';
    document.getElementById('cfg-cap-prefix').value = cap.defaultPrefix || 'MPE';
    document.getElementById('cfg-docs-folder').value = cap.documentsFolder || './arquivos';

    const org = cfg.organizer || {};
    const orgFontEl = document.getElementById('cfg-org-fontsize');
    if (orgFontEl) orgFontEl.value = org.fontSize || 'medium';
    const orgUiEl = document.getElementById('cfg-org-uimode');
    if (orgUiEl) orgUiEl.value = org.uiMode || 'dark';
    const orgCritEl = document.getElementById('cfg-org-criterion');
    if (orgCritEl) orgCritEl.value = org.criterion || 'type';
    const orgMoveEl = document.getElementById('cfg-org-move-default');
    if (orgMoveEl) orgMoveEl.checked = Boolean(org.moveInsteadOfCopy);
    const orgSearchEl = document.getElementById('cfg-org-search-content');
    if (orgSearchEl) orgSearchEl.checked = org.searchInContent !== false;
    const orgRemEl = document.getElementById('cfg-org-remember-state');
    if (orgRemEl) orgRemEl.checked = org.rememberWindowState === true;

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
        document.getElementById('cfg-tg-chat').value.trim() || 'Eu | Você | Leonardo',
      savedScreenshotsFolder:
        document.getElementById('cfg-tg-folder').value.trim() || './prints',
      botToken: document.getElementById('cfg-tg-token').value.trim(),
      chatId: document.getElementById('cfg-tg-chatid').value.trim()
    });

    currentConfig.captures = Object.assign({}, currentConfig.captures, {
      organizationMode: document.getElementById('cfg-cap-org-mode').value || 'system_date',
      namingPattern:
        document.getElementById('cfg-cap-pattern').value.trim() || '{prefix}_{system}_{date}_{time}',
      defaultPrefix: document.getElementById('cfg-cap-prefix').value.trim() || 'MPE',
      documentsFolder: document.getElementById('cfg-docs-folder').value.trim() || './arquivos'
    });

    currentConfig.organizer = Object.assign({}, currentConfig.organizer, {
      fontSize: (document.getElementById('cfg-org-fontsize') && document.getElementById('cfg-org-fontsize').value) || 'medium',
      uiMode: (document.getElementById('cfg-org-uimode') && document.getElementById('cfg-org-uimode').value) || 'dark',
      criterion: (document.getElementById('cfg-org-criterion') && document.getElementById('cfg-org-criterion').value) || 'type',
      moveInsteadOfCopy: Boolean(document.getElementById('cfg-org-move-default') && document.getElementById('cfg-org-move-default').checked),
      searchInContent: document.getElementById('cfg-org-search-content') ? document.getElementById('cfg-org-search-content').checked : true,
      rememberWindowState: document.getElementById('cfg-org-remember-state') ? document.getElementById('cfg-org-remember-state').checked : false
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
    if (organizerUI) organizerUI.applyConfig(currentConfig);

    document.getElementById('modal-settings').classList.add('hidden');
    showToast(getToneDict().toastSaved);
  }

  function initFloatingHudControls() {
    const STORAGE_KEY = 'mpe_hud_layout_state';
    const defaults = {
      topbar: { floating: false, x: 14, y: 12, lateral: false, cascade: false, scale: 1, customW: 204 },
      dock: { floating: false, x: 20, y: 20, lateral: false, cascade: false, scale: 1, customW: 168 }
    };

    let saved = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw) || {};
    } catch (_) {}

    const state = {
      topbar: Object.assign({}, defaults.topbar, saved.topbar || {}),
      dock: Object.assign({}, defaults.dock, saved.dock || {})
    };

    const persistState = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (_) {}
    };

    function applyPanelState(el, st, btnPos, btnCascade) {
      if (!el) return;
      el.classList.toggle('is-floating-custom', Boolean(st.floating));
      el.classList.toggle('dock-lateral', Boolean(st.lateral));
      el.classList.toggle('cascade-mode', Boolean(st.cascade));

      if (st.floating) {
        const clampedX = Math.max(4, Math.min(window.innerWidth - 58, Number(st.x) || 14));
        const clampedY = Math.max(4, Math.min(window.innerHeight - 58, Number(st.y) || 12));
        st.x = clampedX;
        st.y = clampedY;
        el.style.setProperty('--float-x', `${clampedX}px`);
        el.style.setProperty('--float-y', `${clampedY}px`);
      } else {
        el.style.removeProperty('--float-x');
        el.style.removeProperty('--float-y');
      }

      const scale = Math.max(0.75, Math.min(1.25, Number(st.scale) || 1));
      st.scale = scale;
      el.style.setProperty('--float-scale', String(scale));
      if (st.customW) {
        el.style.setProperty('--custom-w', `${Math.round(st.customW)}px`);
      }

      if (btnPos) btnPos.classList.toggle('active', Boolean(st.lateral));
      if (btnCascade) btnCascade.classList.toggle('active', Boolean(st.cascade));
    }

    function wireFloatingPanel({ element, dragHandle, resizer, st, defaultState, btnPos, btnCascade }) {
      if (!element) return;
      applyPanelState(element, st, btnPos, btnCascade);

      let justDragged = false;
      if (dragHandle) {
        dragHandle.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const rect = element.getBoundingClientRect();
          let moved = false;

          const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (!moved && Math.hypot(dx, dy) > 5) {
              moved = true;
            }
            if (!moved) return;

            st.floating = true;
            st.x = Math.round(Math.max(4, Math.min(window.innerWidth - 58, rect.left + dx)));
            st.y = Math.round(Math.max(4, Math.min(window.innerHeight - 58, rect.top + dy)));
            applyPanelState(element, st, btnPos, btnCascade);
          };

          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (moved) {
              justDragged = true;
              setTimeout(() => { justDragged = false; }, 120);
              persistState();
            }
          };

          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });

        dragHandle.addEventListener('dblclick', (e) => {
          e.preventDefault();
          Object.assign(st, defaultState);
          applyPanelState(element, st, btnPos, btnCascade);
          persistState();
          showToast('Posição e tamanho restaurados.');
        });
      }

      if (resizer) {
        resizer.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const startScale = Number(st.scale) || 1;
          const startW = element.offsetWidth || st.customW || 204;

          const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (st.lateral) {
              st.customW = Math.round(Math.max(160, Math.min(360, startW + dx)));
              st.scale = Number(Math.max(0.75, Math.min(1.25, startScale + dy * 0.002)).toFixed(3));
            } else {
              st.scale = Number(Math.max(0.75, Math.min(1.25, startScale + (dx + dy) * 0.0022)).toFixed(3));
            }
            applyPanelState(element, st, btnPos, btnCascade);
          };

          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            persistState();
          };

          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });
      }

      if (btnPos) {
        btnPos.addEventListener('click', () => {
          if (justDragged) return;
          const rect = element.getBoundingClientRect();
          st.lateral = !st.lateral;
          if (st.lateral) {
            st.floating = true;
            const onRight = rect.left > window.innerWidth * 0.5;
            st.x = onRight ? Math.max(12, window.innerWidth - (st.customW || 204) - 14) : 14;
            st.y = Math.max(14, Math.min(window.innerHeight - 360, Math.round(rect.top) || 14));
          } else {
            st.floating = false;
          }
          applyPanelState(element, st, btnPos, btnCascade);
          persistState();
          showToast(st.lateral ? 'Modo Lateral ativado (arraste para flutuar).' : 'Modo Topo ativado.');
        });
      }

      if (btnCascade) {
        btnCascade.addEventListener('click', () => {
          if (justDragged) return;
          st.cascade = !st.cascade;
          applyPanelState(element, st, btnPos, btnCascade);
          persistState();
          showToast(
            st.cascade
              ? 'Modo Cascata ativado: passe o mouse sobre o ícone.'
              : 'Modo Cascata desativado.'
          );
        });
      }
    }

    const topbarEl = document.getElementById('hud-topbar');
    const topbarDrag = document.getElementById('hud-brand-trigger');
    const topbarResizer = document.getElementById('hud-topbar-resizer');
    const btnTopbarPos = document.getElementById('btn-topbar-pos');
    const btnCascade = document.getElementById('btn-cascade-mode');

    wireFloatingPanel({
      element: topbarEl,
      dragHandle: topbarDrag,
      resizer: topbarResizer,
      st: state.topbar,
      defaultState: defaults.topbar,
      btnPos: btnTopbarPos,
      btnCascade
    });

    const dockEl = document.getElementById('floating-dimension-dock');
    const dockDrag = document.getElementById('dock-brand-trigger');
    const dockResizer = document.getElementById('hud-dock-resizer');
    const btnDockCascade = document.getElementById('btn-dock-cascade');

    wireFloatingPanel({
      element: dockEl,
      dragHandle: dockDrag,
      resizer: dockResizer,
      st: state.dock,
      defaultState: defaults.dock,
      btnPos: null,
      btnCascade: btnDockCascade
    });

    window.addEventListener('resize', () => {
      applyPanelState(topbarEl, state.topbar, btnTopbarPos, btnCascade);
      applyPanelState(dockEl, state.dock, null, btnDockCascade);
    });
  }

  async function init() {
    let handleHudSummoned = null;
    setupSelfTestObserver();

    if (window.mpeApi && window.mpeApi.onHudSummoned) {
      window.mpeApi.onHudSummoned((payload) => {
        if (handleHudSummoned) {
          handleHudSummoned(payload);
        } else {
          pendingHudPayload = payload || {};
        }
      });
    }
    if (window.mpeApi && window.mpeApi.onConfigUpdated) {
      window.mpeApi.onConfigUpdated((evt) => {
        const cfg = evt && evt.config ? evt.config : evt;
        if (cfg) applySyncedConfig(cfg);
      });
    }
    if (window.mpeApi && window.mpeApi.onConsentUpdated) {
      window.mpeApi.onConsentUpdated((c) => {
        if (c) {
          consentStatus = c;
          if (c.accepted) showConsentBlockedBanner = false;
          updateConsentUI();
          syncMiniControls(miniState);
        }
      });
    }
    if (window.mpeApi && window.mpeApi.onMiniStateChanged) {
      window.mpeApi.onMiniStateChanged((st) => {
        if (st) syncMiniControls(st);
      });
    }
    if (window.mpeApi && window.mpeApi.onPythonRecordingState) {
      window.mpeApi.onPythonRecordingState((st) => {
        if (!st) return;
        isRecordingPython = Boolean(st.active);
        const ind = document.getElementById('py-recording-indicator');
        const cnt = document.getElementById('py-recording-count');
        const prev = document.getElementById('py-recording-steps-preview');
        const startBtn = document.getElementById('btn-py-record-start');
        const stopBtn = document.getElementById('btn-py-record-stop');
        if (ind) ind.classList.toggle('hidden', !isRecordingPython);
        if (startBtn) startBtn.classList.toggle('hidden', isRecordingPython);
        if (stopBtn) stopBtn.classList.toggle('hidden', !isRecordingPython);
        if (cnt) cnt.textContent = `${Number(st.stepCount) || 0} clique(s)`;
        if (prev && st.lastStep) {
          prev.classList.remove('hidden');
          prev.textContent = `Ultimo clique: (${st.lastStep.x}, ${st.lastStep.y}) [${st.lastStep.button || 'left'}] +${st.lastStep.waitMs || 0}ms`;
        }
      });
    }
    if (window.mpeApi && window.mpeApi.onPythonScriptExecuted) {
      window.mpeApi.onPythonScriptExecuted(async (ev) => {
        if (!ev) return;
        showToast(`Auto-script executado (${ev.trigger || 'manual'}, codigo ${ev.exitCode ?? 0}).`);
        try {
          const fresh = await window.mpeApi.getConfig();
          if (fresh) applySyncedConfig(fresh);
        } catch (_) {}
      });
    }

    initFloatingHudControls();
    if (!document.hidden) {
      // Inicia imediatamente a contagem 0% -> 100% sem bloquear a abertura
      runInitializationSequence();
    }

    currentConfig = await window.mpeApi.getConfig();
    if (window.mpeApi.getConsentStatus) {
      try {
        consentStatus = (await window.mpeApi.getConsentStatus()) || consentStatus;
      } catch (_) {}
    }
    if (window.mpeApi.getMiniAstrolabeState) {
      try {
        const st = await window.mpeApi.getMiniAstrolabeState();
        if (st) miniState = Object.assign({}, miniState, st);
      } catch (_) {}
    }

    if (currentConfig.originSystem && currentConfig.originSystem.windowTitle) {
      originSystemName = currentConfig.originSystem.windowTitle;
    }

    applyThemeVariables(currentConfig.theme);
    applyLanguageToneUI();
    updateConsentUI();

    if (window.MpeOrganizerUI) {
      organizerUI = new window.MpeOrganizerUI({
        getConfig: () => currentConfig,
        saveConfig: async (cfg) => {
          currentConfig = await window.mpeApi.saveConfig(cfg);
          if (organizerUI) organizerUI.applyConfig(currentConfig);
          return currentConfig;
        },
        showToast,
        openSettings: openSettingsModal,
        onTabChange: (tab) => {
          if (tab === 'organizer') {
            if (astrolabe) astrolabe.pause();
          } else {
            syncAstrolabeRunState();
          }
        }
      });
      organizerUI.applyConfig(currentConfig);
      if (
        currentMode !== 'hud-only' &&
        currentConfig.organizer &&
        currentConfig.organizer.rememberWindowState === true &&
        currentConfig.organizer.lastActiveTab === 'organizer'
      ) {
        organizerUI.setWorkspaceTab('organizer', false);
      } else {
        organizerUI.setWorkspaceTab('astrolabe', false);
      }
    }

    const canvas = document.getElementById('astrolabe-canvas');
    astrolabe = new window.Astrolabe3D(canvas, {
      startPaused: true,
      onPointHover: handlePointHover,
      onPointClick: handlePointExecute,
      onModeChange: (newMode) => {
        syncDimensionButtons(newMode);
      },
      onNexusAction: (newMode) => {
        playUiSound('execute');
        syncDimensionButtons(newMode);
        showToast(
          newMode === '2d'
            ? 'Modo 2D Ativado (Base da Imagem + Pulso 2D)'
            : 'Modo 3D Ativado (Orbital Profundo)'
        );
      },
      onPointEdit: (pt) => {
        if (currentMode === 'hud-only') {
          showToast('Modo Performance: Para editar pontos, abra pelo icone executavel MPE.exe.');
          return;
        }
        openPointModal(pt);
      },
      onPointMoved: async (pt) => {
        if (currentMode === 'hud-only') {
          // Desfaz o movimento: edicao apenas pelo executavel
          currentConfig = await window.mpeApi.getConfig();
          astrolabe.setConfig(currentConfig);
          showToast('Para mudar pontos de lugar, abra pelo icone executavel MPE.exe.');
          return;
        }
        const points = (currentConfig.points || []).map((p) =>
          p.id === pt.id
            ? Object.assign({}, p, {
                angle: pt.angle,
                orbit: pt.orbit,
                customRadius: pt.customRadius
              })
            : p
        );
        currentConfig.points = points;
        currentConfig = await window.mpeApi.saveConfig(currentConfig);
        applySyncedConfig(currentConfig);
        showToast(`Ponto [${pt.code}] movido para ${pt.angle} graus (Orbita ${pt.orbit}) e salvo.`);
      }
    });
    applySyncedConfig(currentConfig);
    syncMiniControls(miniState);
    syncDimensionButtons(astrolabe.projectionMode);
    syncAstrolabeRunState();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (astrolabe) astrolabe.pause();
      } else {
        syncAstrolabeRunState();
      }
    });
    window.addEventListener('pagehide', () => {
      if (astrolabe) astrolabe.pause();
    });
    window.addEventListener('beforeunload', () => {
      if (astrolabe) astrolabe.destroy();
    });

    // 1-Clique Organizador, Consentimento, Mini Astrolabio & Auto-Script Python
    const btnMainOrg1Click = document.getElementById('btn-main-organize-1click');
    if (btnMainOrg1Click) {
      btnMainOrg1Click.addEventListener('click', () => {
        if (organizerUI) organizerUI.setWorkspaceTab('organizer', false);
      });
    }
    const btnMainOrgQuick = document.getElementById('btn-main-organize-quick');
    if (btnMainOrgQuick) {
      btnMainOrgQuick.addEventListener('click', async () => {
        if (organizerUI) {
          await organizerUI.quickOrganize({
            scope: 'arquivos',
            criterion: (currentConfig && currentConfig.organizer && currentConfig.organizer.criterion) || 'type',
            pickMode: 'files'
          });
        }
      });
    }
    const btnToggleSlotsPanel = document.getElementById('btn-toggle-slots-panel');
    if (btnToggleSlotsPanel) {
      btnToggleSlotsPanel.addEventListener('click', () => {
        const panel = document.getElementById('central-slots-panel');
        if (!panel) return;
        const collapsed = panel.classList.toggle('collapsed');
        btnToggleSlotsPanel.textContent = collapsed ? 'Expandir' : 'Recolher';
      });
    }

    const btnConsentStatus = document.getElementById('btn-consent-status');
    if (btnConsentStatus) btnConsentStatus.addEventListener('click', openConsentModal);
    const btnReopenConsent = document.getElementById('btn-reopen-consent');
    if (btnReopenConsent) btnReopenConsent.addEventListener('click', openConsentModal);
    const btnDismissConsent = document.getElementById('btn-dismiss-consent-banner');
    if (btnDismissConsent) {
      btnDismissConsent.addEventListener('click', () => {
        showConsentBlockedBanner = false;
        updateConsentUI();
      });
    }
    const btnConsentAccept = document.getElementById('btn-consent-accept');
    if (btnConsentAccept) {
      btnConsentAccept.addEventListener('click', async () => {
        const cbBg = document.getElementById('consent-toggle-bg');
        const cbApps = document.getElementById('consent-toggle-apps');
        const cbPy = document.getElementById('consent-toggle-python');
        const perms = {
          backgroundExecution: cbBg ? cbBg.checked : true,
          launchAppsAndLinks: cbApps ? cbApps.checked : true,
          pythonAutomation: cbPy ? cbPy.checked : true
        };
        const res = await window.mpeApi.setConsentDecision(true, perms);
        if (res && res.consent) consentStatus = res.consent;
        else consentStatus = { accepted: true, permissions: perms };
        showConsentBlockedBanner = false;
        document.getElementById('modal-consent').classList.add('hidden');
        updateConsentUI();
        if (window.mpeApi.getMiniAstrolabeState) {
          try {
            const st = await window.mpeApi.getMiniAstrolabeState();
            if (st) syncMiniControls(st);
          } catch (_) {}
        }
        syncAstrolabeRunState();
        showToast('Permissoes ativadas e salvas.');
      });
    }
    const btnConsentDecline = document.getElementById('btn-consent-decline');
    if (btnConsentDecline) {
      btnConsentDecline.addEventListener('click', async () => {
        const res = await window.mpeApi.setConsentDecision(false, {
          backgroundExecution: false,
          launchAppsAndLinks: false,
          pythonAutomation: false
        });
        if (res && res.consent) consentStatus = res.consent;
        else consentStatus = { accepted: false, permissions: {} };
        showConsentBlockedBanner = true;
        document.getElementById('modal-consent').classList.add('hidden');
        updateConsentUI();
        syncMiniControls(miniState);
        syncAstrolabeRunState();
        showToast('Execucao em segundo plano e automacoes permanecem bloqueadas ate o aceite.');
      });
    }

    const btnToggleMini = document.getElementById('btn-toggle-mini-astrolabe');
    if (btnToggleMini) {
      btnToggleMini.addEventListener('click', async () => {
        if (!window.mpeApi.toggleMiniAstrolabe) return;
        const nextEnabled = !miniState.enabled;
        const res = await window.mpeApi.toggleMiniAstrolabe(nextEnabled);
        if (handleBlockedResult(res)) return;
        if (res) {
          syncMiniControls(res.miniAstrolabe || { enabled: Boolean(res.enabled) });
          showToast(res.enabled ? 'Mini Astrolabio ativado.' : 'Mini Astrolabio desativado.');
        }
      });
    }
    const miniSizeRange = document.getElementById('mini-size-range');
    if (miniSizeRange) {
      miniSizeRange.addEventListener('change', async () => {
        const size = Number(miniSizeRange.value) || 68;
        const res = await window.mpeApi.updateMiniAstrolabeLayout({ size });
        if (handleBlockedResult(res)) return;
        if (res && res.miniAstrolabe) syncMiniControls(res.miniAstrolabe);
      });
      miniSizeRange.addEventListener('input', () => {
        const valEl = document.getElementById('mini-size-value');
        if (valEl) valEl.textContent = `${miniSizeRange.value}px`;
      });
    }
    const miniScaleRange = document.getElementById('mini-scale-range');
    if (miniScaleRange) {
      miniScaleRange.addEventListener('change', async () => {
        const scale = Number(miniScaleRange.value) || 1.0;
        const res = await window.mpeApi.updateMiniAstrolabeLayout({ scale });
        if (handleBlockedResult(res)) return;
        if (res && res.miniAstrolabe) syncMiniControls(res.miniAstrolabe);
      });
      miniScaleRange.addEventListener('input', () => {
        const valEl = document.getElementById('mini-scale-value');
        if (valEl) valEl.textContent = `${Number(miniScaleRange.value).toFixed(2)}x`;
      });
    }

    const btnOpenPyScripts = document.getElementById('btn-open-python-scripts');
    if (btnOpenPyScripts) {
      btnOpenPyScripts.addEventListener('click', () => {
        renderPythonScriptsList();
        const pyModal = document.getElementById('modal-python-scripts');
        if (pyModal) pyModal.classList.remove('hidden');
      });
    }
    const btnClosePyScripts = document.getElementById('btn-close-python-scripts');
    if (btnClosePyScripts) {
      btnClosePyScripts.addEventListener('click', () => {
        document.getElementById('modal-python-scripts').classList.add('hidden');
      });
    }
    const btnPyRecStart = document.getElementById('btn-py-record-start');
    const btnPyRecStop = document.getElementById('btn-py-record-stop');
    const btnPySave = document.getElementById('btn-py-save-script');
    if (btnPyRecStart) {
      btnPyRecStart.addEventListener('click', async () => {
        const name = (document.getElementById('py-script-name') && document.getElementById('py-script-name').value.trim()) || 'Meu Auto Script';
        const res = await window.mpeApi.startPythonRecording({ name });
        if (handleBlockedResult(res)) return;
        if (res && res.unavailable) {
          showToast(res.message || 'Modulo de Auto-Script Python disponivel na etapa M5.');
          return;
        }
        if (res && res.ok) {
          isRecordingPython = true;
          lastRecordedSteps = [];
          const ind = document.getElementById('py-recording-indicator');
          if (ind) ind.classList.remove('hidden');
          btnPyRecStart.classList.add('hidden');
          if (btnPyRecStop) btnPyRecStop.classList.remove('hidden');
          if (btnPySave) btnPySave.disabled = true;
          showToast('Gravacao de cliques iniciada. Clique na tela e depois em Parar Gravacao.');
        } else {
          showToast((res && res.message) || 'Nao foi possivel iniciar a gravacao.');
        }
      });
    }
    if (btnPyRecStop) {
      btnPyRecStop.addEventListener('click', async () => {
        const name = (document.getElementById('py-script-name') && document.getElementById('py-script-name').value.trim()) || 'Meu Auto Script';
        const res = await window.mpeApi.stopPythonRecording({ name });
        isRecordingPython = false;
        const ind = document.getElementById('py-recording-indicator');
        if (ind) ind.classList.add('hidden');
        if (btnPyRecStart) btnPyRecStart.classList.remove('hidden');
        btnPyRecStop.classList.add('hidden');
        if (handleBlockedResult(res)) return;
        if (res && res.unavailable) {
          showToast(res.message || 'Modulo de Auto-Script Python disponivel na etapa M5.');
          return;
        }
        if (res && res.ok) {
          lastRecordedSteps = Array.isArray(res.steps) ? res.steps : [];
          if (btnPySave) btnPySave.disabled = lastRecordedSteps.length === 0;
          const prev = document.getElementById('py-recording-steps-preview');
          if (prev) {
            prev.classList.remove('hidden');
            prev.textContent = `${lastRecordedSteps.length} clique(s) gravado(s). Clique em Salvar Script .py.`;
          }
          if (res.script) {
            currentConfig = await window.mpeApi.getConfig();
            applySyncedConfig(currentConfig);
          }
        } else {
          showToast((res && res.message) || 'Erro ao parar gravacao.');
        }
      });
    }
    if (btnPySave) {
      btnPySave.addEventListener('click', async () => {
        const name = (document.getElementById('py-script-name') && document.getElementById('py-script-name').value.trim()) || `AutoScript_${Date.now()}`;
        const res = await window.mpeApi.savePythonScript({ name, steps: lastRecordedSteps });
        if (handleBlockedResult(res)) return;
        if (res && res.unavailable) {
          showToast(res.message || 'Modulo de Auto-Script Python disponivel na etapa M5.');
          return;
        }
        if (res && res.ok) {
          btnPySave.disabled = true;
          lastRecordedSteps = [];
          currentConfig = await window.mpeApi.getConfig();
          applySyncedConfig(currentConfig);
          showToast(`Script Python "${name}" salvo com sucesso.`);
        } else {
          showToast((res && res.message) || 'Nao foi possivel salvar o script.');
        }
      });
    }

    // Adicionar Ponto (Dock + Topo), Guia, Mover Pontos e Organizar Arquivos
    const dockOrgBtn = document.getElementById('btn-dock-organizer');
    if (dockOrgBtn) {
      dockOrgBtn.addEventListener('click', () => {
        if (organizerUI) organizerUI.setWorkspaceTab('organizer', false);
      });
    }

    function openGuideModal() {
      renderGuideHotkeys();
      const modal = document.getElementById('modal-guide');
      if (modal) modal.classList.remove('hidden');
    }

    const btnOpenGuide = document.getElementById('btn-open-guide');
    if (btnOpenGuide) btnOpenGuide.addEventListener('click', openGuideModal);
    const inspDefault = document.getElementById('inspector-default');
    if (inspDefault) inspDefault.addEventListener('click', openGuideModal);
    const btnCloseGuide = document.getElementById('btn-close-guide');
    if (btnCloseGuide) {
      btnCloseGuide.addEventListener('click', () => {
        document.getElementById('modal-guide').classList.add('hidden');
      });
    }
    const btnGuideRepairShortcut = document.getElementById('btn-guide-repair-shortcut');
    if (btnGuideRepairShortcut) {
      btnGuideRepairShortcut.addEventListener('click', async () => {
        if (window.mpeApi.ensureShortcuts) {
          await window.mpeApi.ensureShortcuts();
          showToast('Atalho do Windows atualizado! Fixe o M.P.E pela Barra de Tarefas ou Menu Iniciar.');
        }
      });
    }
    document.getElementById('btn-dock-add-point').addEventListener('click', startAddPointFlow);
    const toggleMove = () => {
      if (currentMode === 'hud-only') {
        showToast('Para mudar pontos de lugar, abra pelo icone executavel MPE.exe.');
        return;
      }
      astrolabe.cancelPickingLocation();
      const enabled = astrolabe.toggleMovePointsMode();
      setMovePointsUI(enabled);
    };
    document.getElementById('btn-toggle-move-points').addEventListener('click', toggleMove);
    document.getElementById('btn-move-stars-top').addEventListener('click', toggleMove);
    document.getElementById('btn-cancel-placement').addEventListener('click', () => {
      astrolabe.cancelPickingLocation();
      astrolabe.setMovePointsMode(false);
      setMovePointsUI(false);
    });

    // Escolher posicao dentro do Forjador: clicando no Circulo grande
    document.getElementById('btn-pick-on-circle').addEventListener('click', () => {
      const modal = document.getElementById('modal-point');
      modal.classList.add('hidden');
      showPlacementBanner('Clique no Circulo onde este ponto deve ficar.');
      astrolabe.startPickingLocation((coords) => {
        hidePlacementBanner();
        modal.classList.remove('hidden');
        applyPickedCoords(coords);
      });
    });

    // Escolher posicao no mini-mapa (clique ou arraste)
    const minimap = document.getElementById('pt-minimap-canvas');
    let minimapDragging = false;
    const pickFromMinimap = (e) => {
      const rect = minimap.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * minimap.width;
      const y = ((e.clientY - rect.top) / rect.height) * minimap.height;
      const cx = minimap.width / 2;
      const cy = minimap.height / 2;
      const R = minimap.width / 2 - 6;
      const dist = Math.min(0.9, Math.max(0.12, Math.hypot(x - cx, y - cy) / R));
      let deg = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
      if (deg < 0) deg += 360;
      applyPickedCoords({
        angle: Math.round(deg) % 360,
        orbit: dist < 0.34 ? 1 : dist < 0.79 ? 2 : 3,
        customRadius: Number(dist.toFixed(3))
      });
    };
    minimap.addEventListener('mousedown', (e) => {
      minimapDragging = true;
      pickFromMinimap(e);
    });
    minimap.addEventListener('mousemove', (e) => {
      if (minimapDragging) pickFromMinimap(e);
    });
    window.addEventListener('mouseup', () => {
      minimapDragging = false;
    });
    ['pt-angle', 'pt-orbit'].forEach((id) => {
      document.getElementById(id).addEventListener('input', () => {
        // Ao digitar manualmente, volta a usar o raio padrao da orbita escolhida
        document.getElementById('pt-custom-radius').value = '';
        drawPositionMinimap();
      });
    });

    document.getElementById('btn-mode-2d').addEventListener('click', () => {
      playUiSound('hover');
      astrolabe.setProjectionMode('2d', true);
      syncDimensionButtons('2d');
      showToast('Modo 2D Ativado (Base Original da Imagem)');
    });
    document.getElementById('btn-mode-3d').addEventListener('click', () => {
      playUiSound('hover');
      astrolabe.setProjectionMode('3d', true);
      syncDimensionButtons('3d');
      showToast('Modo 3D Ativado (Constelacao Orbital)');
    });
    document.getElementById('btn-action-2d').addEventListener('click', () => {
      executeQuick2DAction();
    });

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
        if (handleBlockedResult(res)) return;
        if (res && res.type === 'request_named_print') {
          openNamedPrintModal(res);
          return;
        }
        if (res && res.message) {
          showToast(res.message);
        }
      },
      () => {
        showToast('Selecao de area cancelada.');
      }
    );

    const btnNamedPrint = document.getElementById('btn-named-print');
    if (btnNamedPrint) {
      btnNamedPrint.addEventListener('click', () => {
        handlePointExecute({
          id: 'quick-named-print',
          title: 'Print Nomeado',
          actionType: 'named_print',
          params: {
            captureScope: 'active_window',
            saveDir:
              (currentConfig &&
                currentConfig.telegram &&
                currentConfig.telegram.savedScreenshotsFolder) ||
              './prints'
          }
        });
      });
    }

    document.getElementById('btn-add-star').addEventListener('click', startAddPointFlow);
    document.getElementById('btn-open-register').addEventListener('click', () => {
      const regInput = document.getElementById('reg-user-name');
      regInput.value =
        (currentConfig && currentConfig.profile && currentConfig.profile.userName) || '';
      document.getElementById('modal-register').classList.remove('hidden');
      regInput.focus();
    });
    document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
    document.getElementById('btn-recenter').addEventListener('click', () => astrolabe.resetView());
    document.getElementById('btn-replay-intro').addEventListener('click', () => runInitializationSequence(true));
    document.getElementById('btn-hide-hud').addEventListener('click', () => {
      if (astrolabe) astrolabe.pause();
      window.mpeApi.hideHud();
    });

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
      splashDismissedByUser = true;
      forceUnlockToAstrolabe();
    });

    document.getElementById('pt-action-type').addEventListener('change', updatePointModalFields);
    document.getElementById('btn-cancel-point').addEventListener('click', () => {
      document.getElementById('modal-point').classList.add('hidden');
    });
    document.getElementById('btn-save-point').addEventListener('click', savePointFromModal);
    document.getElementById('btn-delete-point').addEventListener('click', deletePointFromModal);

    // Assistente Interativo (3 Passos, Cartoes Visuais, Modelos Prontos e Resumo Vivo)
    const GOAL_DEFAULTS = {
      print_app: { actionType: 'system_to_system_print', scope: 'active_window' },
      area_crop: { actionType: 'area_print', scope: 'area' },
      save_print: { actionType: 'named_print', scope: 'active_window' },
      text_move: { actionType: 'text_to_system', scope: 'active_window' },
      organize: { actionType: 'open_organizer', scope: 'active_window' },
      open_thing: { actionType: 'open_path', scope: 'active_window' },
      open_url: { actionType: 'open_url', scope: 'active_window' },
      send_link_chat: { actionType: 'send_link_chat', scope: 'active_window' },
      launch_app_project: { actionType: 'launch_app_project', scope: 'active_window' },
      run_python_script: { actionType: 'run_python_script', scope: 'active_window' },
      macro: { actionType: 'macro_sequence', scope: 'active_window' },
      hud_mode: { actionType: 'toggle_2d_3d', scope: 'active_window' }
    };

    const WIZ_PRESETS = {
      org_open: {
        actionType: 'open_organizer',
        title: 'Organizar Arquivos',
        orgScope: 'arquivos',
        orgCrit: 'type',
        glyph: 'C',
        vectorStyle: 'gold'
      },
      notepad_slot: {
        actionType: 'launch_app_project',
        title: 'Bloco de Notas',
        appName: 'notepad',
        launchTargetPath: 'notepad.exe',
        launchProjectPath: '',
        glyph: 'h',
        vectorStyle: 'gold'
      },
      vscode_slot: {
        actionType: 'launch_app_project',
        title: 'Projeto VS Code',
        appName: 'vscode',
        launchTargetPath: 'code',
        launchProjectPath: 'c:\\Projetos\\MousePerformaticoEstrelado',
        glyph: 'C',
        vectorStyle: 'blue'
      },
      open_url_preset: {
        actionType: 'open_url',
        title: 'Abrir Link',
        url: 'https://www.google.com',
        glyph: 'C',
        vectorStyle: 'blue'
      },
      send_link_preset: {
        actionType: 'send_link_chat',
        title: 'Enviar Link Chat',
        chatLinkUrl: 'https://www.google.com',
        chatChannel: 'telegram_bot',
        glyph: 'Π',
        vectorStyle: 'blue'
      },
      py_script_preset: {
        actionType: 'run_python_script',
        title: 'Auto-Script Python',
        glyph: 'Δ',
        vectorStyle: 'gold'
      },
      print_tg: {
        actionType: 'print_telegram',
        title: 'Print -> Telegram',
        scope: 'active_window',
        targetSystem: 'Telegram',
        glyph: 'Π',
        vectorStyle: 'blue'
      },
      print_wpp: {
        actionType: 'system_to_system_print',
        title: 'Print -> WhatsApp',
        scope: 'active_window',
        targetSystem: 'WhatsApp',
        glyph: 'Π',
        vectorStyle: 'blue'
      },
      crop_paint: {
        actionType: 'area_print_system',
        title: 'Recorte -> Paint',
        scope: 'area',
        targetSystem: 'Paint',
        glyph: 'Δ',
        vectorStyle: 'gold'
      },
      named_ai: {
        actionType: 'named_print',
        title: 'Print Nomeado',
        scope: 'active_window',
        glyph: 'h',
        vectorStyle: 'gold'
      },
      open_downloads: {
        actionType: 'open_path',
        title: 'Abrir Downloads',
        targetPath: 'downloads',
        glyph: 'C',
        vectorStyle: 'gold'
      },
      toggle_3d: {
        actionType: 'toggle_2d_3d',
        title: 'Alternar 2D / 3D',
        glyph: 'Δ',
        vectorStyle: 'gold'
      }
    };

    document.querySelectorAll('.wiz-step-pill').forEach((btn) => {
      btn.addEventListener('click', () => setWizardStep(btn.dataset.wizStep));
    });
    const btnWizPrev = document.getElementById('btn-wiz-prev');
    if (btnWizPrev) btnWizPrev.addEventListener('click', () => setWizardStep(currentWizStep - 1));
    const btnWizNext = document.getElementById('btn-wiz-next');
    if (btnWizNext) btnWizNext.addEventListener('click', () => setWizardStep(currentWizStep + 1));

    document.querySelectorAll('.wiz-goal-card').forEach((card) => {
      card.addEventListener('click', () => {
        const def = GOAL_DEFAULTS[card.dataset.goal];
        if (!def) return;
        document.getElementById('pt-action-type').value = def.actionType;
        document.getElementById('pt-capture-scope').value = def.scope;
        updatePointModalFields();
        setWizardStep(2);
      });
    });

    document.querySelectorAll('.wiz-preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const p = WIZ_PRESETS[chip.dataset.preset];
        if (!p) return;
        document.getElementById('pt-action-type').value = p.actionType;
        if (p.scope) document.getElementById('pt-capture-scope').value = p.scope;
        if (p.targetSystem) document.getElementById('pt-target-system').value = p.targetSystem;
        if (p.targetPath) document.getElementById('pt-target-path').value = p.targetPath;
        if (p.orgScope && document.getElementById('pt-org-scope')) {
          document.getElementById('pt-org-scope').value = p.orgScope;
        }
        if (p.orgCrit && document.getElementById('pt-org-criterion')) {
          document.getElementById('pt-org-criterion').value = p.orgCrit;
        }
        if (p.url && document.getElementById('pt-url')) {
          document.getElementById('pt-url').value = p.url;
        }
        if (p.appName && document.getElementById('pt-launch-app-name')) {
          document.getElementById('pt-launch-app-name').value = p.appName;
        }
        if (p.launchTargetPath !== undefined && document.getElementById('pt-launch-target-path')) {
          document.getElementById('pt-launch-target-path').value = p.launchTargetPath;
        }
        if (p.launchProjectPath !== undefined && document.getElementById('pt-launch-project-path')) {
          document.getElementById('pt-launch-project-path').value = p.launchProjectPath;
        }
        if (p.chatLinkUrl && document.getElementById('pt-chat-link-url')) {
          document.getElementById('pt-chat-link-url').value = p.chatLinkUrl;
        }
        if (p.chatChannel && document.getElementById('pt-chat-channel')) {
          document.getElementById('pt-chat-channel').value = p.chatChannel;
        }
        if (p.glyph) document.getElementById('pt-glyph').value = p.glyph;
        if (p.vectorStyle) document.getElementById('pt-vector-style').value = p.vectorStyle;
        wizTitleManuallyEdited = false;
        document.getElementById('pt-title').value = p.title;
        updatePointModalFields();
        setWizardStep(3);
        showToast(`Modelo "${p.title}" carregado. Escolha a posição e salve.`);
      });
    });

    document.querySelectorAll('#wiz-scope-choices .wiz-choice-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const chosen = btn.dataset.scope;
        const typeEl = document.getElementById('pt-action-type');
        const curType = typeEl.value;
        document.getElementById('pt-capture-scope').value = chosen;
        if (chosen === 'area') {
          if (curType === 'print' || curType === 'named_print') typeEl.value = 'area_print';
          else if (curType === 'print_telegram') typeEl.value = 'area_print_telegram';
          else if (curType === 'system_to_system_print') typeEl.value = 'area_print_system';
        } else {
          if (curType === 'area_print') typeEl.value = 'print';
          else if (curType === 'area_print_telegram') typeEl.value = 'print_telegram';
          else if (curType === 'area_print_system') typeEl.value = 'system_to_system_print';
        }
        updatePointModalFields();
      });
    });

    document.querySelectorAll('.wiz-app-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const appName = pill.dataset.app || 'Telegram';
        document.getElementById('pt-target-system').value = appName;
        const typeEl = document.getElementById('pt-action-type');
        const curType = typeEl.value;
        if (!['system_to_system_print', 'area_print_system', 'text_to_system', 'print_telegram', 'area_print_telegram', 'text_telegram'].includes(curType)) {
          typeEl.value = 'system_to_system_print';
        }
        updatePointModalFields();
      });
    });

    document.querySelectorAll('.wiz-path-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        document.getElementById('pt-action-type').value = 'open_path';
        document.getElementById('pt-target-path').value = pill.dataset.path || '';
        updatePointModalFields();
      });
    });

    const btnBrowseOpenFolder = document.getElementById('btn-browse-open-folder');
    if (btnBrowseOpenFolder) {
      btnBrowseOpenFolder.addEventListener('click', async () => {
        const folder = await window.mpeApi.selectFolder();
        if (folder) {
          document.getElementById('pt-action-type').value = 'open_path';
          document.getElementById('pt-target-path').value = folder;
          updatePointModalFields();
        }
      });
    }

    document.querySelectorAll('.wiz-url-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        document.getElementById('pt-action-type').value = 'open_url';
        document.getElementById('pt-url').value = pill.dataset.url || '';
        updatePointModalFields();
      });
    });

    document.querySelectorAll('#wiz-org-mode-choices .wiz-choice-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('pt-action-type').value = btn.dataset.orgAction || 'open_organizer';
        updatePointModalFields();
      });
    });

    document.querySelectorAll('#wiz-orbit-choices .wiz-choice-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('pt-orbit').value = btn.dataset.orbit || '3';
        document.getElementById('pt-custom-radius').value = '';
        drawPositionMinimap();
        updatePointModalFields();
      });
    });

    const ptTitleEl = document.getElementById('pt-title');
    if (ptTitleEl) {
      ptTitleEl.addEventListener('input', () => {
        wizTitleManuallyEdited = ptTitleEl.value.trim().length > 0;
      });
    }

    [
      'pt-target-system',
      'pt-telegram-target',
      'pt-target-path',
      'pt-url',
      'pt-command',
      'pt-capture-scope',
      'pt-org-scope',
      'pt-org-criterion',
      'pt-macro-step1',
      'pt-macro-step2',
      'pt-chat-link-url',
      'pt-chat-channel',
      'pt-chat-target-system',
      'pt-launch-app-name',
      'pt-launch-target-path',
      'pt-launch-project-path',
      'pt-python-script-select',
      'pt-python-script-path'
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', updatePointLiveSummary);
        el.addEventListener('change', updatePointLiveSummary);
      }
    });

    document.querySelectorAll('.wiz-launch-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.appPreset;
        document.getElementById('pt-action-type').value = 'launch_app_project';
        if (preset === 'notepad') {
          document.getElementById('pt-launch-app-name').value = 'notepad';
          document.getElementById('pt-launch-target-path').value = 'notepad.exe';
          document.getElementById('pt-launch-project-path').value = '';
        } else if (preset === 'vscode') {
          document.getElementById('pt-launch-app-name').value = 'vscode';
          document.getElementById('pt-launch-target-path').value = 'code';
          if (!document.getElementById('pt-launch-project-path').value.trim()) {
            document.getElementById('pt-launch-project-path').value = 'c:\\Projetos\\MousePerformaticoEstrelado';
          }
        }
        updatePointModalFields();
      });
    });

    const btnBrowseLaunchProject = document.getElementById('btn-browse-launch-project');
    if (btnBrowseLaunchProject) {
      btnBrowseLaunchProject.addEventListener('click', async () => {
        const folder = await window.mpeApi.selectFolder();
        if (folder) {
          document.getElementById('pt-launch-project-path').value = folder;
          updatePointLiveSummary();
        }
      });
    }

    const ptPySelect = document.getElementById('pt-python-script-select');
    if (ptPySelect) {
      ptPySelect.addEventListener('change', () => {
        const opt = ptPySelect.options[ptPySelect.selectedIndex];
        const fp = (opt && opt.dataset && opt.dataset.filePath) || '';
        const pathEl = document.getElementById('pt-python-script-path');
        if (pathEl && fp) pathEl.value = fp;
        updatePointLiveSummary();
      });
    }

    const btnTestPoint = document.getElementById('btn-test-point');
    if (btnTestPoint) {
      btnTestPoint.addEventListener('click', async () => {
        const previewPoint = buildPointPayloadFromForm();
        showToast(`Testando "${previewPoint.title}"...`);
        await handlePointExecute(previewPoint);
      });
    }

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

    const btnBrowseDocs = document.getElementById('btn-cfg-browse-docs');
    if (btnBrowseDocs) {
      btnBrowseDocs.addEventListener('click', async () => {
        const folder = await window.mpeApi.selectFolder();
        if (folder) document.getElementById('cfg-docs-folder').value = folder;
      });
    }

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

    document.querySelectorAll('.system-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        document.getElementById('captured-target-system').value = pill.dataset.target || '';
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
        document.getElementById('captured-target-system').value.trim() || 'Bloco de Notas';
      showToast(`Abrindo [${targetSys}] e transferindo conteudo...`);
      document.getElementById('modal-text-selection').classList.add('hidden');
      const res = await window.mpeApi.sendToTargetSystem({
        text: txt,
        targetSystem: targetSys,
        autoSendEnter: true
      });
      if (handleBlockedResult(res)) return;
      if (res && res.ok) {
        showToast(`Conteudo transferido com sucesso para [${res.targetSystem || targetSys}]!`);
      } else {
        showToast(`Conteudo pronto na Area de Transferencia para [${targetSys}].`);
      }
    });
    document.getElementById('btn-send-captured-telegram').addEventListener('click', async () => {
      const txt = document.getElementById('captured-text-area').value;
      const target =
        currentConfig.telegram && currentConfig.telegram.savedChatPath
          ? currentConfig.telegram.savedChatPath
          : 'Eu | Você | Leonardo';
      showToast(`Enviando para o Telegram [${target}]...`);
      document.getElementById('modal-text-selection').classList.add('hidden');
      const res = await window.mpeApi.sendTextToTelegram({ text: txt, target });
      if (handleBlockedResult(res)) return;
      if (res && res.ok) {
        showToast(`Texto transferido com sucesso para o Telegram (${res.targetChat || target})!`);
      } else {
        showToast('Texto pronto na Area de Transferencia.');
      }
    });

    let pendingNamedPrint = null;

    function openNamedPrintModal(payload) {
      pendingNamedPrint = payload || null;
      const modal = document.getElementById('modal-named-print');
      if (!modal || !payload) return;
      const preview = document.getElementById('named-print-preview');
      if (preview) preview.src = payload.imageDataUrl || '';
      const originEl = document.getElementById('named-print-origin');
      if (originEl) {
        originEl.textContent = `Origem: ${payload.originSystem || 'Sistema Ativo'} — Defina o nome e categoria antes de salvar.`;
      }
      const nameInput = document.getElementById('named-print-name');
      const catSelect = document.getElementById('named-print-category');
      const notesInput = document.getElementById('named-print-notes');

      if (nameInput) nameInput.value = '';
      if (catSelect) catSelect.value = payload.suggestedCategory || 'Geral';
      if (notesInput) notesInput.value = '';
      modal.classList.remove('hidden');
      if (nameInput) nameInput.focus();
    }

    async function confirmNamedPrintSave() {
      if (!pendingNamedPrint) return;
      const nameVal = document.getElementById('named-print-name').value.trim() || `Print_${Date.now()}`;
      const category = document.getElementById('named-print-category').value || 'Geral';
      const notes = document.getElementById('named-print-notes').value.trim();

      const res = await window.mpeApi.saveNamedPrint({
        dataUrl: pendingNamedPrint.imageDataUrl,
        customName: nameVal,
        category,
        notes,
        saveDir:
          pendingNamedPrint.saveDir ||
          (pendingNamedPrint.point && pendingNamedPrint.point.params && pendingNamedPrint.point.params.saveDir),
        originSystem: pendingNamedPrint.originSystem
      });

      document.getElementById('modal-named-print').classList.add('hidden');
      pendingNamedPrint = null;

      if (res && res.message) showToast(res.message);
      else showToast('Print nomeado salvo!');
    }

    const btnCancelNamed = document.getElementById('btn-cancel-named-print');
    if (btnCancelNamed) {
      btnCancelNamed.addEventListener('click', () => {
        pendingNamedPrint = null;
        document.getElementById('modal-named-print').classList.add('hidden');
      });
    }
    const btnSaveNamed = document.getElementById('btn-save-named-print');
    if (btnSaveNamed) btnSaveNamed.addEventListener('click', confirmNamedPrintSave);
    const namedInputEl = document.getElementById('named-print-name');
    if (namedInputEl) {
      namedInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmNamedPrintSave();
        }
      });
    }

    function handleEscapeKey() {
      if (areaSelector && areaSelector.isActive) {
        areaSelector.cancel();
        return;
      }
      if (astrolabe && (astrolabe.isPickingLocation || astrolabe.isMovePointsMode)) {
        astrolabe.cancelPickingLocation();
        astrolabe.setMovePointsMode(false);
        setMovePointsUI(false);
        return;
      }
      const openModals = document.querySelectorAll('.modal-backdrop:not(.hidden)');
      if (openModals.length > 0) {
        openModals.forEach((m) => m.classList.add('hidden'));
        syncAstrolabeRunState();
        return;
      }
      if (organizerUI && organizerUI.activeTab === 'organizer') {
        organizerUI.setWorkspaceTab('astrolabe', false);
        return;
      }
      // Pausa o motor grafico para consumir 0% de CPU/GPU e minimiza para segundo plano sem fechar o projeto
      if (astrolabe) astrolabe.pause();
      window.mpeApi.hideHud();
    }

    // Interface simples: opcoes avancadas (tom, perfil, centralizar, intro) ficam escondidas ate pedir.
    const advancedBtn = document.getElementById('btn-toggle-advanced');
    if (advancedBtn) {
      advancedBtn.addEventListener('click', () => {
        const on = document.body.classList.toggle('show-advanced');
        advancedBtn.textContent = on ? 'Menos opções' : 'Mais opções';
        advancedBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
      });
    }

    window.addEventListener('keydown', (e) => {
      const activeTag = (document.activeElement && document.activeElement.tagName) || '';
      const isTypingField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag);
      const splashVisible = !document.getElementById('splash-screen').classList.contains('hidden');

      if (e.key === 'Escape') {
        e.preventDefault();
        handleEscapeKey();
      } else if (e.key === 'F1' || (e.key === '?' && !isTypingField)) {
        const guideModal = document.getElementById('modal-guide');
        const otherModalOpen = document.querySelector('.modal-backdrop:not(.hidden):not(#modal-guide)');
        if (!splashVisible && guideModal && !otherModalOpen) {
          e.preventDefault();
          if (guideModal.classList.contains('hidden')) {
            openGuideModal();
          } else {
            guideModal.classList.add('hidden');
          }
        }
      } else if (e.key === 'Tab') {
        const openModals = document.querySelectorAll('.modal-backdrop:not(.hidden)');
        if (openModals.length === 0 && astrolabe) {
          e.preventDefault();
          const nextMode = astrolabe.toggleProjectionMode();
          syncDimensionButtons(nextMode);
          showToast(nextMode === '2d' ? 'Modo 2D Ativado' : 'Modo 3D Ativado');
        }
      } else if (e.key === 'ArrowLeft' && !isTypingField) {
        if (astrolabe) astrolabe.wheelVelocity -= 0.012;
      } else if (e.key === 'ArrowRight' && !isTypingField) {
        if (astrolabe) astrolabe.wheelVelocity += 0.012;
      } else if (/^[1-9]$/.test(e.key) && !isTypingField) {
        const openModals = document.querySelectorAll('.modal-backdrop:not(.hidden)');
        if (openModals.length === 0 && !splashVisible && currentConfig && Array.isArray(currentConfig.points)) {
          const idx = parseInt(e.key, 10) - 1;
          if (currentConfig.points[idx]) {
            handlePointExecute(currentConfig.points[idx]);
          }
        }
      } else if (/^[a-zA-Z]$/.test(e.key) && !isTypingField && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const openModals = document.querySelectorAll('.modal-backdrop:not(.hidden)');
        if (openModals.length === 0 && !splashVisible) {
          const pt = findPointByHotkeyLetter(e.key.toUpperCase());
          if (pt) {
            e.preventDefault();
            handlePointExecute(pt);
          }
        }
      }
    });

    if (window.mpeApi.onEscapePressed) {
      window.mpeApi.onEscapePressed(() => {
        handleEscapeKey();
      });
    }

    handleHudSummoned = (payload) => {
      // Quando o HUD Astrolabio 3D/2D e convocado:
      if (payload && payload.mode) {
        setInterfaceMode(payload.mode);
      }
      if (payload && payload.originSystem && payload.originSystem.windowTitle) {
        originSystemName = payload.originSystem.windowTitle;
      }
      if (payload && payload.config) {
        applySyncedConfig(payload.config);
      }
      if (organizerUI && payload && payload.mode !== 'hud-only') {
        const wantOrg =
          currentConfig &&
          currentConfig.organizer &&
          currentConfig.organizer.rememberWindowState === true &&
          currentConfig.organizer.lastActiveTab === 'organizer';
        organizerUI.setWorkspaceTab(wantOrg ? 'organizer' : 'astrolabe', false);
      } else if (organizerUI && payload && payload.mode === 'hud-only') {
        organizerUI.setWorkspaceTab('astrolabe', false);
      }
      if (payload && payload.source === 'tray-intro') {
        runInitializationSequence(true);
      } else if (payload && payload.playIntro && !hasCompletedInitialIntro) {
        runInitializationSequence();
      } else {
        forceUnlockToAstrolabe();
        if (astrolabe && !(organizerUI && organizerUI.activeTab === 'organizer')) {
          astrolabe.triggerIntroAnimation(true);
        }
      }
      if (astrolabe && !(organizerUI && organizerUI.activeTab === 'organizer')) {
        astrolabe.resume();
      }
    };

    if (pendingHudPayload) {
      const buffered = pendingHudPayload;
      pendingHudPayload = null;
      handleHudSummoned(buffered);
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
