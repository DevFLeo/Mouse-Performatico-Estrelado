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

  function forceUnlockToAstrolabe() {
    if (initInterval) {
      clearInterval(initInterval);
      initInterval = null;
    }
    if (welcomeTimeout) clearTimeout(welcomeTimeout);
    if (welcomeHideTimeout) clearTimeout(welcomeHideTimeout);
    if (safetyUnlockTimeout) clearTimeout(safetyUnlockTimeout);

    hasCompletedInitialIntro = true;
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.classList.add('hidden');
      splash.classList.remove('fade-out');
    }
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
            : '100% Concluido • Ativando Sistema!';
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
    const hotkeyTag = hotkeyIdx >= 0 && hotkeyIdx < 9 ? ` [Tecla ${hotkeyIdx + 1}]` : '';
    document.getElementById('insp-code').textContent = point.code || '00 1';
    document.getElementById('insp-title').textContent = `${point.title || 'Ponto Estelar'}${hotkeyTag}`;
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

    // Acoes que abrem outra janela (pasta, URL, programa): recolhe o HUD para segundo plano
    if (['open_path', 'open_url', 'command'].includes(res.type)) {
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
    open_url: 'open_thing',
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
        return 'Print Nomeado (I.A)';
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
        text = `Tira print de ${scopeLabel} e abre uma janelinha para você dar nome, pasta e salvar na I.A.`;
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

  function updatePointModalFields() {
    const type = document.getElementById('pt-action-type').value;
    const grpScope = document.getElementById('group-capture-scope');
    const grpSave = document.getElementById('group-save-dir');
    const grpTargetSys = document.getElementById('group-target-system');
    const grpTg = document.getElementById('group-telegram-target');
    const grpPath = document.getElementById('group-target-path');
    const grpUrl = document.getElementById('group-url');
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
      if (subtitle) subtitle.textContent = 'Siga os 3 passos simples — sem precisar programar nada.';
      delBtn.classList.add('hidden');

      const nextNum = (currentConfig.points ? currentConfig.points.length : 9) + 1;
      document.getElementById('pt-action-type').value = 'system_to_system_print';
      document.getElementById('pt-capture-scope').value = 'active_window';
      document.getElementById('pt-title').value = 'Print -> Telegram';
      document.getElementById('pt-code').value = `${String(nextNum).padStart(2, '0')} 7`;
      document.getElementById('pt-desc').value = '';
      document.getElementById('pt-orbit').value = '3';
      document.getElementById('pt-angle').value = String((nextNum * 37) % 360);
      document.getElementById('pt-elevation').value = String(((nextNum % 3) - 1) * 18);
      document.getElementById('pt-custom-radius').value = '';
      document.getElementById('pt-vector-style').value = 'gold';
      document.getElementById('pt-glyph').value = 'Π';

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
      params
    };
  }

  async function savePointFromModal() {
    const pointObj = buildPointPayloadFromForm();
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
    document.getElementById('cfg-cap-auto-index').checked = cap.autoIndexNamedPrints !== false;

    const obs = cfg.obsidian || {};
    document.getElementById('cfg-obsidian-vault').value = obs.vaultPath || './arquivos/Obsidian_Vault';
    document.getElementById('cfg-obsidian-folder').value = obs.defaultFolder || 'Notas';

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

    const ai = cfg.ai || {};
    document.getElementById('cfg-ai-provider').value = ai.provider || 'auto';
    const boostEl = document.getElementById('cfg-ai-boost');
    if (boostEl) boostEl.value = ai.boostMode || 'balanced';

    const th = cfg.theme || {};
    document.getElementById('clr-gold-primary').value = th.goldPrimary || '#E5B84B';
    document.getElementById('clr-gold-secondary').value = th.goldSecondary || '#FFE08A';
    document.getElementById('clr-bg-primary').value = th.bgPrimary || '#040406';
    document.getElementById('clr-bg-secondary').value = th.bgSecondary || '#171206';
    document.getElementById('clr-vector-accent').value = th.vectorAccent || '#5C73B8';
    document.getElementById('clr-nexus-red').value = th.nexusRed || '#9E2A2B';

    document.getElementById('info-machine-name').textContent =
      (cfg.currentMachine && cfg.currentMachine.hostname) || 'LOCAL-PC';

    const perfSummaryEl = document.getElementById('info-perf-summary');
    if (perfSummaryEl && window.mpeApi.getPerfProfile) {
      window.mpeApi.getPerfProfile().then((p) => {
        if (!p) return;
        perfSummaryEl.textContent = `RAM Livre: ${p.hardware.freeRamGb}/${p.hardware.totalRamGb} GB | HUD ~${p.memory.totalMpeBaseMb} MB | LLM ~${p.memory.totalMpeWithLlmGb} GB | ${p.speed.genTokPerSec} tok/s`;
      }).catch(() => {});
    }

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
      documentsFolder: document.getElementById('cfg-docs-folder').value.trim() || './arquivos',
      autoIndexNamedPrints: document.getElementById('cfg-cap-auto-index').checked
    });

    currentConfig.obsidian = Object.assign({}, currentConfig.obsidian, {
      vaultPath:
        document.getElementById('cfg-obsidian-vault').value.trim() || './arquivos/Obsidian_Vault',
      defaultFolder:
        document.getElementById('cfg-obsidian-folder').value.trim() || 'Notas'
    });

    currentConfig.organizer = Object.assign({}, currentConfig.organizer, {
      fontSize: (document.getElementById('cfg-org-fontsize') && document.getElementById('cfg-org-fontsize').value) || 'medium',
      uiMode: (document.getElementById('cfg-org-uimode') && document.getElementById('cfg-org-uimode').value) || 'dark',
      criterion: (document.getElementById('cfg-org-criterion') && document.getElementById('cfg-org-criterion').value) || 'type',
      moveInsteadOfCopy: Boolean(document.getElementById('cfg-org-move-default') && document.getElementById('cfg-org-move-default').checked),
      searchInContent: document.getElementById('cfg-org-search-content') ? document.getElementById('cfg-org-search-content').checked : true,
      rememberWindowState: document.getElementById('cfg-org-remember-state') ? document.getElementById('cfg-org-remember-state').checked : false
    });

    const prevBoostMode = (currentConfig.ai && currentConfig.ai.boostMode) || 'balanced';
    const boostSel = document.getElementById('cfg-ai-boost');
    const nextBoostMode = boostSel ? boostSel.value : prevBoostMode;
    currentConfig.ai = Object.assign({}, currentConfig.ai, {
      provider: document.getElementById('cfg-ai-provider').value,
      boostMode: nextBoostMode
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
    if (nextBoostMode !== prevBoostMode && window.mpeApi.setBoostMode) {
      await window.mpeApi.setBoostMode(nextBoostMode);
    }
    applyThemeVariables(currentConfig.theme);
    applyLanguageToneUI();
    astrolabe.setConfig(currentConfig);
    if (organizerUI) organizerUI.applyConfig(currentConfig);

    document.getElementById('modal-settings').classList.add('hidden');
    showToast(getToneDict().toastSaved);
  }

  async function init() {
    // Inicia imediatamente a contagem 0% -> 100% sem bloquear a abertura
    runInitializationSequence();

    currentConfig = await window.mpeApi.getConfig();
    if (currentConfig.originSystem && currentConfig.originSystem.windowTitle) {
      originSystemName = currentConfig.originSystem.windowTitle;
    }

    applyThemeVariables(currentConfig.theme);
    applyLanguageToneUI();

    if (window.MpeOrganizerUI) {
      organizerUI = new window.MpeOrganizerUI({
        getConfig: () => currentConfig,
        saveConfig: async (cfg) => {
          currentConfig = await window.mpeApi.saveConfig(cfg);
          if (organizerUI) organizerUI.applyConfig(currentConfig);
          return currentConfig;
        },
        showToast,
        openSettings: openSettingsModal
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
        astrolabe.setConfig(currentConfig);
        showToast(`Ponto [${pt.code}] movido para ${pt.angle} graus (Orbita ${pt.orbit}) e salvo.`);
      }
    });
    astrolabe.setConfig(currentConfig);
    syncDimensionButtons(astrolabe.projectionMode);

    // Adicionar Ponto (Dock + Topo), AI Kataros, Guia /boost, Mover Pontos e Organizar Arquivos
    const dockOrgBtn = document.getElementById('btn-dock-organizer');
    if (dockOrgBtn) {
      dockOrgBtn.addEventListener('click', () => {
        if (organizerUI) organizerUI.setWorkspaceTab('organizer', false);
      });
    }
    const dockKatarosBtn = document.getElementById('btn-dock-kataros');
    if (dockKatarosBtn) {
      dockKatarosBtn.addEventListener('click', () => {
        if (window.mpeApi.openMiniAssistant) window.mpeApi.openMiniAssistant();
      });
    }

    function renderGuidePerf(profile) {
      if (!profile) return;
      document.querySelectorAll('.boost-pill').forEach((b) => {
        b.classList.toggle('active', b.dataset.boost === profile.boostMode);
      });
      const perfEl = document.getElementById('guide-perf-metrics');
      if (perfEl) {
        const speedTag = profile.speed.measured ? 'medido' : 'estimado';
        const baseTag = profile.memory.electronMeasured ? 'medido' : 'est.';
        perfEl.innerHTML =
          `<div><strong>CPU:</strong> ${profile.hardware.cpuModel} (${profile.hardware.logicalCores} threads)</div>` +
          `<div><strong>RAM:</strong> ${profile.hardware.freeRamGb} GB livres de ${profile.hardware.totalRamGb} GB | <strong>Disco I.A:</strong> ${profile.model.diskModelsGb || 0} GB</div>` +
          `<div><strong>M.P.E Base (${baseTag}):</strong> ${profile.memory.totalMpeBaseMb} MB WS / ${profile.memory.electronPrivateMb + profile.memory.hookMb} MB priv. (0% CPU minimizado)</div>` +
          `<div><strong>LLM (${profile.model.name}):</strong> ~${profile.memory.llmEstimatedMb} MB (${profile.tuning.threads} gen / ${profile.tuning.threadsBatch} batch, KV ${profile.tuning.kvType.toUpperCase()} ctx ${profile.tuning.contextSize})</div>` +
          `<div><strong>Velocidade (${speedTag}):</strong> Regras ~${profile.speed.builtinMs} ms | LLM ~${profile.speed.promptTokPerSec} tok/s prompt / ~${profile.speed.genTokPerSec} tok/s resposta</div>`;
      }
      const kitsGrid = document.getElementById('guide-kits-grid');
      if (kitsGrid && Array.isArray(profile.kits)) {
        kitsGrid.innerHTML = profile.kits
          .map((k) => {
            const isRec = profile.recommendedKit && profile.recommendedKit.id === k.id;
            return (
              `<div class="kit-card${isRec ? ' recommended' : ''}">` +
              `<div class="kit-card-title">${k.name}${isRec ? '<span class="kit-card-tag">IDEAL P/ ESTE PC</span>' : ''}</div>` +
              `<div><strong>RAM:</strong> ${k.ram}</div>` +
              `<div><strong>CPU/GPU:</strong> ${k.cpu} | ${k.gpu}</div>` +
              `<div><strong>Disco/Vel.:</strong> ${k.disk} | ${k.speed}</div>` +
              `</div>`
            );
          })
          .join('');
      }
    }

    async function openGuideModal() {
      const modal = document.getElementById('modal-guide');
      if (!modal) return;
      modal.classList.remove('hidden');
      if (window.mpeApi.getPerfProfile) {
        try {
          renderGuidePerf(await window.mpeApi.getPerfProfile());
        } catch (_) {}
      }
    }

    const btnOpenGuide = document.getElementById('btn-open-guide');
    if (btnOpenGuide) btnOpenGuide.addEventListener('click', openGuideModal);
    const btnCfgOpenGuide = document.getElementById('btn-cfg-open-guide');
    if (btnCfgOpenGuide) {
      btnCfgOpenGuide.addEventListener('click', () => {
        document.getElementById('modal-settings').classList.add('hidden');
        openGuideModal();
      });
    }
    const btnCloseGuide = document.getElementById('btn-close-guide');
    if (btnCloseGuide) {
      btnCloseGuide.addEventListener('click', () => {
        document.getElementById('modal-guide').classList.add('hidden');
      });
    }
    const btnGuideOpenChat = document.getElementById('btn-guide-open-chat');
    if (btnGuideOpenChat) {
      btnGuideOpenChat.addEventListener('click', () => {
        document.getElementById('modal-guide').classList.add('hidden');
        if (window.mpeApi.openMiniAssistant) window.mpeApi.openMiniAssistant({ openChat: true });
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
    document.querySelectorAll('.boost-pill').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.boost || 'balanced';
        if (!window.mpeApi.setBoostMode) return;
        showToast(`Aplicando perfil ${mode}...`);
        const prof = await window.mpeApi.setBoostMode(mode);
        renderGuidePerf(prof);
        showToast(`Perfil ${prof.boostLabel} ativo!`);
      });
    });
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
        title: 'Print Nomeado (I.A)',
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
      'pt-macro-step2'
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', updatePointLiveSummary);
        el.addEventListener('change', updatePointLiveSummary);
      }
    });

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

    document.getElementById('btn-cfg-browse-obsidian').addEventListener('click', async () => {
      const folder = await window.mpeApi.selectFolder();
      if (folder) document.getElementById('cfg-obsidian-vault').value = folder;
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
      const saveAiCheck = document.getElementById('named-print-save-ai');

      if (nameInput) nameInput.value = '';
      if (catSelect) catSelect.value = payload.suggestedCategory || 'Geral';
      if (notesInput) notesInput.value = '';
      if (saveAiCheck) {
        const capCfg = (currentConfig && currentConfig.captures) || {};
        saveAiCheck.checked = capCfg.autoIndexNamedPrints !== false;
      }
      modal.classList.remove('hidden');
      syncMiniWindowSize();
      if (nameInput) nameInput.focus();
    }

    function openSaveAiFileModal({ title = '', category = 'Auto', text = '', filePath = '' } = {}) {
      const modal = document.getElementById('modal-save-ai-file');
      if (!modal) return;
      const titleInput = document.getElementById('ai-doc-title');
      const catSelect = document.getElementById('ai-doc-category');
      const fpInput = document.getElementById('ai-doc-filepath');
      const contentArea = document.getElementById('ai-doc-content');

      if (titleInput) titleInput.value = title || '';
      if (catSelect) catSelect.value = category || 'Auto';
      if (fpInput) fpInput.value = filePath || '';
      if (contentArea) contentArea.value = text || '';

      modal.classList.remove('hidden');
      syncMiniWindowSize();
      if (titleInput) titleInput.focus();
    }

    async function confirmNamedPrintSave() {
      if (!pendingNamedPrint) return;
      const nameVal = document.getElementById('named-print-name').value.trim() || `Print_${Date.now()}`;
      const category = document.getElementById('named-print-category').value || 'Geral';
      const notes = document.getElementById('named-print-notes').value.trim();
      const saveToAiLocal = document.getElementById('named-print-save-ai').checked;

      const res = await window.mpeApi.saveNamedPrint({
        dataUrl: pendingNamedPrint.imageDataUrl,
        customName: nameVal,
        category,
        notes,
        saveDir:
          pendingNamedPrint.saveDir ||
          (pendingNamedPrint.point && pendingNamedPrint.point.params && pendingNamedPrint.point.params.saveDir),
        originSystem: pendingNamedPrint.originSystem,
        saveToAiLocal
      });

      document.getElementById('modal-named-print').classList.add('hidden');
      pendingNamedPrint = null;
      syncMiniWindowSize();

      if (res && res.message) showToast(res.message);
      else showToast('Print nomeado salvo!');
    }

    const btnCancelNamed = document.getElementById('btn-cancel-named-print');
    if (btnCancelNamed) {
      btnCancelNamed.addEventListener('click', () => {
        pendingNamedPrint = null;
        document.getElementById('modal-named-print').classList.add('hidden');
        syncMiniWindowSize();
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

    const btnPickAiDocFile = document.getElementById('btn-ai-doc-pick-file');
    if (btnPickAiDocFile) {
      btnPickAiDocFile.addEventListener('click', async () => {
        const picked = window.mpeApi.selectDocumentFile
          ? await window.mpeApi.selectDocumentFile()
          : await window.mpeApi.selectFile();
        if (picked) {
          document.getElementById('ai-doc-filepath').value = picked;
          const titleEl = document.getElementById('ai-doc-title');
          if (titleEl && !titleEl.value.trim()) {
            const base = picked.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
            titleEl.value = base;
          }
        }
      });
    }
    const btnClearAiDocFile = document.getElementById('btn-ai-doc-clear-file');
    if (btnClearAiDocFile) {
      btnClearAiDocFile.addEventListener('click', () => {
        document.getElementById('ai-doc-filepath').value = '';
      });
    }
    const btnCancelAiDoc = document.getElementById('btn-cancel-ai-doc');
    if (btnCancelAiDoc) {
      btnCancelAiDoc.addEventListener('click', () => {
        document.getElementById('modal-save-ai-file').classList.add('hidden');
        syncMiniWindowSize();
      });
    }
    const btnConfirmAiDoc = document.getElementById('btn-confirm-ai-doc');
    if (btnConfirmAiDoc) {
      btnConfirmAiDoc.addEventListener('click', async () => {
        const title = document.getElementById('ai-doc-title').value.trim();
        const category = document.getElementById('ai-doc-category').value || 'Auto';
        const sourceFilePath = document.getElementById('ai-doc-filepath').value.trim();
        const text = document.getElementById('ai-doc-content').value.trim();

        if (!sourceFilePath && !text) {
          showToast('Selecione um arquivo ou informe o conteudo para salvar na I.A local.');
          return;
        }

        const runSave = () =>
          window.mpeApi.saveDocumentFile({ title, category, text, sourceFilePath });
        const inMini = document.body.classList.contains('mode-mini-assistant');
        const res =
          inMini && katarosMascot
            ? await katarosMascot.runWithProcessing(runSave, { minDurationMs: 1500, subText: 'ARQUIVO' })
            : await runSave();

        document.getElementById('modal-save-ai-file').classList.add('hidden');
        syncMiniWindowSize();

        if (res && res.ok && res.document) {
          showToast(`Salvo na I.A Local: ${res.document.relPath}`);
        } else {
          showToast((res && res.error) || 'Falha ao salvar arquivo na I.A Local.');
        }
      });
    }

    function handleEscapeKey() {
      const miniOverlay = document.getElementById('mini-assistant-overlay');
      const inMini = miniOverlay && !miniOverlay.classList.contains('hidden');
      if (inMini) {
        const openMiniModals = document.querySelectorAll('.modal-backdrop:not(.hidden)');
        if (openMiniModals.length > 0) {
          openMiniModals.forEach((m) => m.classList.add('hidden'));
          syncMiniWindowSize();
          return;
        }
      }
      const sideDrawer = document.getElementById('side-chat-drawer');
      if (sideDrawer && !sideDrawer.classList.contains('hidden')) {
        sideDrawer.classList.add('hidden');
        syncMiniWindowSize();
        return;
      }
      if (inMini) {
        miniOverlay.classList.add('hidden');
        document.body.classList.remove('mode-mini-assistant');
        if (katarosMascot) katarosMascot.pause();
        if (astrolabe) astrolabe.pause();
        window.mpeApi.hideHud();
        return;
      }
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

    // =========================================================================
    // MINI ASSISTENTE FLUTUANTE (AI KATAROS 3D) & CHAT LATERAL LOCAL
    // =========================================================================
    let lastReviewedText = '';
    let lastReviewSourceText = '';
    let katarosMascot = null;

    if (window.KatarosMascot3D) {
      const mCanvas = document.getElementById('kataros-mascot-canvas');
      if (mCanvas) {
        katarosMascot = new window.KatarosMascot3D(
          mCanvas,
          document.getElementById('kataros-node-status'),
          document.getElementById('kataros-node-sub'),
          document.getElementById('kataros-mascot-node')
        );
      }
    }

    async function runMiniAiReview(textToReview) {
      const textarea = document.getElementById('mini-ai-textarea');
      const text = typeof textToReview === 'string' ? textToReview : textarea.value;
      if (!text || !text.trim()) {
        showToast('Digite ou cole algum texto para a AI Kataros revisar.');
        return;
      }

      const previewBox = document.getElementById('mini-review-preview');
      const previewContent = document.getElementById('mini-review-text');
      const summarySpan = document.getElementById('mini-review-summary');

      summarySpan.textContent = 'Analisando gramatica, estilo e clareza...';
      previewBox.classList.remove('hidden');

      try {
        const res = await window.mpeApi.reviewText({ text });
        if (res && res.ok) {
          lastReviewedText = res.reviewedText;
          lastReviewSourceText = textarea.value;
          summarySpan.textContent = `Revisao Local: ${res.correctionsCount || 0} sugestoes | ${res.readabilityScore || 'Concluido'}`;
          previewContent.textContent = res.reviewedText;

          // Sugere pasta e tags automaticamente se os campos estiverem vazios
          const folderInput = document.getElementById('mini-note-folder');
          const titleInput = document.getElementById('mini-note-title');
          const tagsInput = document.getElementById('mini-note-tags');

          if (!folderInput.value || !titleInput.value) {
            const cls = await window.mpeApi.classifyObsidian({ text });
            if (cls && cls.suggestedFolder && !folderInput.value) {
              folderInput.value = cls.suggestedFolder;
            }
            if (cls && cls.suggestedTitle && !titleInput.value) {
              titleInput.value = cls.suggestedTitle;
            }
            if (cls && cls.suggestedTags && cls.suggestedTags.length && !tagsInput.value) {
              tagsInput.value = cls.suggestedTags.map((t) => `#${t}`).join(', ');
            }
          }
        } else {
          summarySpan.textContent = 'Erro ao processar revisao.';
        }
      } catch (err) {
        summarySpan.textContent = 'Falha na revisao local.';
      }
      syncMiniWindowSize();
    }

    function syncMiniWindowSize() {
      if (!document.body.classList.contains('mode-mini-assistant')) return;
      const card = document.getElementById('mini-sci-hud-card');
      const sideDrawer = document.getElementById('side-chat-drawer');
      if (!card || !window.mpeApi.miniResize) return;
      const rect = card.getBoundingClientRect();
      document.documentElement.style.setProperty('--mini-card-h', `${Math.ceil(rect.height)}px`);
      const drawerOpen = sideDrawer && !sideDrawer.classList.contains('hidden');
      const hasOpenModal = document.querySelectorAll('.modal-backdrop:not(.hidden)').length > 0;
      const width = Math.max(Math.ceil(rect.width), card.scrollWidth, hasOpenModal ? 590 : 0) + 16;
      const height = Math.max(
        Math.ceil(rect.height) + 16 + (drawerOpen ? 474 : 0),
        hasOpenModal ? 560 : 0
      );
      window.mpeApi.miniResize({ width, height });
    }

    function setupMiniAssistant() {
      const overlay = document.getElementById('mini-assistant-overlay');
      const textarea = document.getElementById('mini-ai-textarea');
      const sideDrawer = document.getElementById('side-chat-drawer');
      const sendTargetSelect = document.getElementById('mini-send-target');
      const metaFields = document.getElementById('mini-meta-fields');

      function updateSendTargetUI() {
        const target = sendTargetSelect ? sendTargetSelect.value : 'obsidian';
        if (metaFields) {
          metaFields.classList.toggle('hidden', target !== 'obsidian' && target !== 'ai_local');
        }
        syncMiniWindowSize();
      }
      if (sendTargetSelect) {
        sendTargetSelect.addEventListener('change', updateSendTargetUI);
        updateSendTargetUI();
      }

      // Ao colar no textarea, executa automaticamente a mini revisao instantanea
      textarea.addEventListener('paste', () => {
        setTimeout(() => {
          runMiniAiReview();
        }, 120);
      });

      document.getElementById('btn-mini-paste').addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            textarea.value = text;
            runMiniAiReview(text);
          } else {
            showToast('Area de transferencia vazia.');
          }
        } catch (_) {
          showToast('Clique no campo e aperte Ctrl+V.');
        }
      });

      document.getElementById('btn-mini-review').addEventListener('click', () => {
        runMiniAiReview();
      });

      document.getElementById('btn-mini-copy').addEventListener('click', async () => {
        const text =
          lastReviewedText && textarea.value === lastReviewSourceText
            ? lastReviewedText
            : textarea.value;
        if (!text) {
          showToast('Nenhum texto para copiar.');
          return;
        }
        await window.mpeApi.copyToClipboard(text);
        showToast('Texto copiado com sucesso!');
      });

      document.getElementById('btn-mini-apply-review').addEventListener('click', () => {
        if (lastReviewedText) {
          textarea.value = lastReviewedText;
          lastReviewSourceText = lastReviewedText;
          showToast('Texto substituido pela versao revisada.');
        }
      });

      const btnMiniSaveFile = document.getElementById('btn-mini-save-file');
      if (btnMiniSaveFile) {
        btnMiniSaveFile.addEventListener('click', () => {
          const text =
            lastReviewedText && textarea.value === lastReviewSourceText
              ? lastReviewedText
              : textarea.value;
          const title = document.getElementById('mini-note-title').value.trim();
          openSaveAiFileModal({ title, category: 'Auto', text });
        });
      }

      const sendBtn = document.getElementById('btn-mini-send');
      let sendingBusy = false;
      sendBtn.addEventListener('click', async () => {
        if (sendingBusy) return;
        const text =
          lastReviewedText && textarea.value === lastReviewSourceText
            ? lastReviewedText
            : textarea.value;
        const destination = sendTargetSelect ? sendTargetSelect.value : 'obsidian';

        if (destination === 'ai_local') {
          const title = document.getElementById('mini-note-title').value.trim();
          openSaveAiFileModal({ title, category: 'Auto', text });
          return;
        }

        if (!text || !text.trim()) {
          showToast('Escreva ou cole um texto antes de enviar.');
          return;
        }

        sendingBusy = true;
        sendBtn.disabled = true;

        try {
          if (destination === 'obsidian') {
            const title = document.getElementById('mini-note-title').value.trim();
            const folder = document.getElementById('mini-note-folder').value.trim();
            const tagsRaw = document.getElementById('mini-note-tags').value.trim();
            const tags = tagsRaw ? tagsRaw.split(/[, ]+/).filter(Boolean) : [];

            const runObsidian = () => window.mpeApi.saveToObsidian({ title, text, folder, tags });
            const res = katarosMascot
              ? await katarosMascot.runWithProcessing(runObsidian, { minDurationMs: 1600, subText: 'OBSIDIAN' })
              : await runObsidian();

            if (res && res.ok) {
              showToast(`Nota salva no Obsidian: ${res.fileName} em [${res.folder}]!`);
            } else {
              showToast(`Erro ao salvar no Obsidian: ${(res && res.error) || 'Cofre inacessivel'}`);
            }
          } else if (destination === 'notepad') {
            if (katarosMascot) {
              await katarosMascot.runWithProcessing(async () => {}, {
                minDurationMs: 1600,
                subText: 'BLOCO DE NOTAS'
              });
            }
            const res = await window.mpeApi.sendToTargetSystem({
              text,
              targetSystem: 'Bloco de Notas',
              autoSendEnter: false,
              keepOpen: true
            });
            if (res && res.ok) {
              showToast(`Enviado para [${res.targetSystem || 'Bloco de Notas'}]!`);
            } else {
              showToast('Texto pronto na Area de Transferencia para o Bloco de Notas.');
            }
          } else if (destination === 'telegram') {
            const tgTarget =
              (currentConfig && currentConfig.telegram && currentConfig.telegram.savedChatPath) ||
              'Eu | Você | Leonardo';
            if (katarosMascot) {
              await katarosMascot.runWithProcessing(async () => {}, {
                minDurationMs: 1600,
                subText: 'TELEGRAM'
              });
            }
            const res = await window.mpeApi.sendTextToTelegram({
              text,
              target: tgTarget,
              keepOpen: true
            });
            if (res && res.ok) {
              showToast(`Enviado para o Telegram (${res.targetChat || tgTarget})!`);
            } else {
              showToast('Texto pronto na Area de Transferencia para o Telegram.');
            }
          }
        } catch (err) {
          showToast(`Falha ao enviar: ${err.message || 'erro desconhecido'}`);
        } finally {
          sendingBusy = false;
          sendBtn.disabled = false;
        }
      });

      document.getElementById('btn-mini-chat-toggle').addEventListener('click', () => {
        sideDrawer.classList.toggle('hidden');
        syncMiniWindowSize();
      });

      // Arrasto da janela compacta pelo cabecalho ou pelo no circular
      const dragHandles = [document.getElementById('mini-drag-handle'), document.querySelector('.mini-node-ring')];
      dragHandles.forEach((handle) => {
        if (!handle) return;
        handle.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || e.target.closest('button, input, textarea')) return;
          e.preventDefault();
          handle.setPointerCapture(e.pointerId);
          if (window.mpeApi.miniDragStart) window.mpeApi.miniDragStart();
        });
        const endDrag = () => {
          if (window.mpeApi.miniDragEnd) window.mpeApi.miniDragEnd();
        };
        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);
        handle.addEventListener('lostpointercapture', endDrag);
      });

      // Janela acompanha o tamanho real do card (textarea, revisao, chat)
      const card = document.getElementById('mini-sci-hud-card');
      if (card && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => syncMiniWindowSize()).observe(card);
      }

      document.getElementById('btn-mini-close').addEventListener('click', () => {
        overlay.classList.add('hidden');
        sideDrawer.classList.add('hidden');
        document.body.classList.remove('mode-mini-assistant');
        if (katarosMascot) katarosMascot.pause();
        if (astrolabe) astrolabe.pause();
        window.mpeApi.hideHud();
      });

      // Chat Lateral Local
      document.getElementById('btn-close-side-chat').addEventListener('click', () => {
        sideDrawer.classList.add('hidden');
        syncMiniWindowSize();
      });

      document.getElementById('btn-side-chat-clear').addEventListener('click', () => {
        if (window.mpeApi.aiChat) window.mpeApi.aiChat({ message: '/limpar' }).catch(() => {});
        lastSideResponse = '';
        const msgs = document.getElementById('side-chat-messages');
        msgs.innerHTML = `
          <div class="side-msg assistant">
            <div class="side-msg-header">AI KATAROS <span class="side-msg-time">Agora</span></div>
            <div class="side-msg-content">Historico limpo. Envie /ajuda para ver os comandos da AI Kataros.</div>
          </div>
        `;
      });

      let lastSideResponse = '';
      let chatBusy = false;
      let activeRequest = null;

      // Streaming: tokens chegam do processo principal e sao anexados a bolha ativa
      if (window.mpeApi.onAiChatChunk) {
        window.mpeApi.onAiChatChunk(({ requestId, delta }) => {
          if (!activeRequest || activeRequest.id !== requestId) return;
          if (!activeRequest.started) {
            activeRequest.started = true;
            activeRequest.content.textContent = '';
          }
          activeRequest.content.textContent += delta;
          const msgsBox = document.getElementById('side-chat-messages');
          msgsBox.scrollTop = msgsBox.scrollHeight;
        });
      }
      if (window.mpeApi.onAiChatStatus) {
        window.mpeApi.onAiChatStatus(({ requestId, status }) => {
          if (!activeRequest || activeRequest.id !== requestId || activeRequest.started) return;
          if (status) activeRequest.content.textContent = status;
        });
      }

      const statusEl = document.getElementById('side-ai-status');
      const STATUS_LABEL = {
        online: 'Motor online',
        external: 'Servidor local conectado',
        starting: 'Carregando modelo...',
        offline: 'Motor desligado',
        error: 'Erro no motor'
      };
      async function refreshAiStatus(warmUp) {
        if (!statusEl || !window.mpeApi.aiStatus) return;
        try {
          const s = await window.mpeApi.aiStatus({ warmUp });
          let label = STATUS_LABEL[s.engine] || s.engine;
          if (s.provider !== 'auto' && s.provider !== 'llamafile') label = `${s.provider} (${s.engine})`;
          if (!s.modelFound && !s.ready && s.engine === 'offline') label = 'Sem modelo em models/ - envie /status';
          if (s.modelName && (s.engine === 'online' || s.engine === 'starting')) label += ` | ${s.modelName.replace(/\.llamafile(\.exe)?$/i, '')}`;
          statusEl.textContent = `${label} | ${s.facts} fatos | ${s.examples} exemplos | ${s.documents || 0} docs`;
          statusEl.className = `side-ai-status ${s.ready ? 'online' : s.engine === 'starting' ? 'starting' : 'offline'}`;
        } catch (_) {
          statusEl.textContent = 'Motor indisponivel';
        }
      }

      let statusTimer = null;
      const drawerObserver = new MutationObserver(() => {
        const open = !sideDrawer.classList.contains('hidden');
        if (open && !statusTimer) {
          refreshAiStatus(true);
          statusTimer = setInterval(() => refreshAiStatus(false), 3000);
          setTimeout(() => document.getElementById('side-chat-input').focus(), 50);
        } else if (!open && statusTimer) {
          clearInterval(statusTimer);
          statusTimer = null;
        }
      });
      drawerObserver.observe(sideDrawer, { attributes: true, attributeFilter: ['class'] });

      async function sendSideChatMessage() {
        const input = document.getElementById('side-chat-input');
        const prompt = input.value.trim();
        if (!prompt || chatBusy) return;

        input.value = '';
        chatBusy = true;
        const sendBtn = document.getElementById('btn-side-chat-send');
        sendBtn.disabled = true;
        const msgs = document.getElementById('side-chat-messages');

        const userDiv = document.createElement('div');
        userDiv.className = 'side-msg user';
        userDiv.innerHTML = `
          <div class="side-msg-header">VOCÊ <span class="side-msg-time">Agora</span></div>
          <div class="side-msg-content">${escapeHtml(prompt)}</div>
        `;
        msgs.appendChild(userDiv);

        const astDiv = document.createElement('div');
        astDiv.className = 'side-msg assistant';
        astDiv.innerHTML = `
          <div class="side-msg-header">AI KATAROS <span class="side-msg-time">Processando...</span></div>
          <div class="side-msg-content">Processando...</div>
        `;
        msgs.appendChild(astDiv);
        msgs.scrollTop = msgs.scrollHeight;

        const mode = document.getElementById('side-ai-mode').value;
        const tone = document.getElementById('side-ai-tone').value;
        const requestId = `r${Date.now()}${Math.random().toString(16).slice(2, 6)}`;
        const contentEl = astDiv.querySelector('.side-msg-content');
        activeRequest = { id: requestId, content: contentEl, started: false };

        try {
          const runChat = () => window.mpeApi.aiChat({ message: prompt, mode, tone, requestId });
          const res = katarosMascot
            ? await katarosMascot.runWithProcessing(runChat, { minDurationMs: 1500, subText: 'CHAT' })
            : await runChat();
          const finalText = (res && res.text) || 'Sem resposta.';
          // Quando houve streaming o texto ja esta na tela; garante a versao final completa
          contentEl.textContent = finalText;
          if (res && (res.source === 'llm' || res.source === 'builtin')) lastSideResponse = finalText;
          astDiv.querySelector('.side-msg-time').textContent =
            res && res.source === 'llm'
              ? 'Modelo local'
              : res && res.source === 'command'
              ? 'Comando'
              : 'AI Kataros';
          if (!res || !res.ok) astDiv.classList.add('error');
        } catch (err) {
          contentEl.textContent = 'Erro de conexao com o motor de I.A local.';
          astDiv.classList.add('error');
        }
        activeRequest = null;
        chatBusy = false;
        sendBtn.disabled = false;
        msgs.scrollTop = msgs.scrollHeight;
        refreshAiStatus(false);
        input.focus();
      }

      document.getElementById('btn-side-chat-send').addEventListener('click', sendSideChatMessage);
      document.querySelectorAll('.side-cmd-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const inp = document.getElementById('side-chat-input');
          if (!inp) return;
          inp.value = chip.dataset.cmd || '';
          if (chip.dataset.send === '1') {
            sendSideChatMessage();
          } else {
            inp.focus();
          }
        });
      });
      document.getElementById('side-chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendSideChatMessage();
        }
      });

      const btnSideChatSaveFile = document.getElementById('btn-side-chat-save-file');
      if (btnSideChatSaveFile) {
        btnSideChatSaveFile.addEventListener('click', () => {
          const draft = document.getElementById('side-chat-input').value.trim();
          const content = lastSideResponse || draft || document.getElementById('mini-ai-textarea').value.trim();
          openSaveAiFileModal({
            title: content ? '' : 'Documento_IA',
            category: 'Auto',
            text: content
          });
        });
      }

      document.getElementById('btn-side-chat-to-obsidian').addEventListener('click', async () => {
        if (!lastSideResponse) {
          showToast('Nenhuma resposta recente para salvar no Obsidian.');
          return;
        }
        showToast('Catalogando nota no Obsidian...');
        const res = await window.mpeApi.saveToObsidian({
          title: 'Conversa MPE AI',
          text: lastSideResponse,
          folder: 'Notas/IA'
        });
        if (res && res.ok) {
          showToast(`Salvo no Obsidian: ${res.fileName}`);
        } else {
          showToast('Erro ao salvar resposta no Obsidian.');
        }
      });

      function escapeHtml(str) {
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }
    }

    setupMiniAssistant();

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleEscapeKey();
      } else if (e.key === 'Tab') {
        const openModals = document.querySelectorAll('.modal-backdrop:not(.hidden)');
        if (openModals.length === 0 && astrolabe) {
          e.preventDefault();
          const nextMode = astrolabe.toggleProjectionMode();
          syncDimensionButtons(nextMode);
          showToast(nextMode === '2d' ? 'Modo 2D Ativado' : 'Modo 3D Ativado');
        }
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
      // Quando o HUD Astrolabio 3D/2D e convocado:
      const miniOverlay = document.getElementById('mini-assistant-overlay');
      if (miniOverlay) miniOverlay.classList.add('hidden');
      const sideDrawer = document.getElementById('side-chat-drawer');
      if (sideDrawer) sideDrawer.classList.add('hidden');
      document.body.classList.remove('mode-mini-assistant');
      if (katarosMascot) katarosMascot.pause();

      if (astrolabe) astrolabe.resume();
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
        if (organizerUI) organizerUI.applyConfig(currentConfig);
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
        if (astrolabe) {
          astrolabe.triggerIntroAnimation(true);
        }
      }
    });

    if (window.mpeApi.onMiniAssistantSummoned) {
      window.mpeApi.onMiniAssistantSummoned((payload) => {
        // Quando convocado via Shift + Ctrl + Botao Direito:
        // Exibe exclusivamente o Mini Assistente Flutuante (Lower Third Sci-Fi)
        if (astrolabe) astrolabe.pause();
        const splash = document.getElementById('splash-screen');
        if (splash) splash.classList.add('hidden');
        const modalPt = document.getElementById('modal-point');
        if (modalPt) modalPt.classList.add('hidden');
        const modalSet = document.getElementById('modal-settings');
        if (modalSet) modalSet.classList.add('hidden');
        const modalTxt = document.getElementById('modal-text-selection');
        if (modalTxt) modalTxt.classList.add('hidden');

        document.body.classList.add('mode-mini-assistant');
        const miniOverlay = document.getElementById('mini-assistant-overlay');
        if (miniOverlay) miniOverlay.classList.remove('hidden');
        const miniDrawer = document.getElementById('side-chat-drawer');
        if (miniDrawer) {
          miniDrawer.classList.toggle('hidden', !(payload && payload.openChat));
        }
        if (katarosMascot) {
          katarosMascot.setProcessing(false);
          katarosMascot.resume();
        }
        requestAnimationFrame(() => syncMiniWindowSize());

        const txtArea = (payload && payload.openChat)
          ? document.getElementById('side-chat-input')
          : document.getElementById('mini-ai-textarea');
        if (txtArea) {
          txtArea.focus();
        }

        if (payload && payload.config) {
          currentConfig = payload.config;
          if (currentConfig.obsidian && currentConfig.obsidian.defaultFolder) {
            document.getElementById('mini-note-folder').value = currentConfig.obsidian.defaultFolder;
          }
        }
      });
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
