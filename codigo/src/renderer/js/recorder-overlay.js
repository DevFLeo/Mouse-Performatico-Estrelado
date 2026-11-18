(function initRecorderOverlay() {
  const pillEl = document.getElementById('recorder-pill');
  const dotEl = pillEl ? pillEl.querySelector('.rec-dot') : null;
  const statusEl = document.getElementById('rec-status-text');
  const badgeEl = document.getElementById('rec-step-badge');
  const stopBtn = document.getElementById('btn-stop-recording');

  let stopping = false;

  function formatClickCount(count) {
    const safe = Number.isFinite(Number(count)) ? Math.max(0, Math.round(Number(count))) : 0;
    return safe === 1 ? '1 clique' : `${safe} cliques`;
  }

  function applyTheme(cfg) {
    const theme = cfg && cfg.theme;
    if (!theme || typeof theme !== 'object') return;
    const rootStyle = document.documentElement.style;
    if (theme.goldPrimary) rootStyle.setProperty('--gold-primary', String(theme.goldPrimary));
    if (theme.goldSecondary) rootStyle.setProperty('--gold-secondary', String(theme.goldSecondary));
    if (theme.nexusRed) rootStyle.setProperty('--nexus-red', String(theme.nexusRed));
  }

  function updateState(state) {
    const payload = state && typeof state === 'object' ? state : {};
    const active = payload.active !== false;
    const stepCount = Number.isFinite(Number(payload.stepCount)) ? Number(payload.stepCount) : 0;

    if (badgeEl) {
      badgeEl.textContent = formatClickCount(stepCount);
    }

    if (active) {
      stopping = false;
      if (statusEl) statusEl.textContent = 'Gravando...';
      if (dotEl) dotEl.classList.remove('is-idle');
      if (stopBtn) {
        stopBtn.disabled = false;
        stopBtn.textContent = 'Parar (ESC)';
      }
    } else {
      if (statusEl) statusEl.textContent = 'Encerrado';
      if (dotEl) dotEl.classList.add('is-idle');
      if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.textContent = 'Encerrado';
      }
    }
  }

  async function requestStop(source) {
    if (stopping) return;
    stopping = true;
    if (stopBtn) {
      stopBtn.disabled = true;
      stopBtn.textContent = 'Parando...';
    }
    if (!window.mpeApi || typeof window.mpeApi.stopPythonRecording !== 'function') {
      return;
    }
    try {
      const res = await window.mpeApi.stopPythonRecording({ source: source || 'overlay' });
      if (res && res.ok === false) {
        stopping = false;
        if (stopBtn) {
          stopBtn.disabled = false;
          stopBtn.textContent = 'Parar (ESC)';
        }
      }
    } catch (_) {
      stopping = false;
      if (stopBtn) {
        stopBtn.disabled = false;
        stopBtn.textContent = 'Parar (ESC)';
      }
    }
  }

  if (window.mpeApi) {
    if (typeof window.mpeApi.onPythonRecordingState === 'function') {
      window.mpeApi.onPythonRecordingState(updateState);
    }
    if (typeof window.mpeApi.getConfig === 'function') {
      window.mpeApi.getConfig().then(applyTheme).catch(() => {});
    }
    if (typeof window.mpeApi.onConfigUpdated === 'function') {
      window.mpeApi.onConfigUpdated((payload) => {
        if (payload && payload.config) applyTheme(payload.config);
      });
    }
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      requestStop('overlay');
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e && e.key === 'Escape') {
      e.preventDefault();
      requestStop('overlay-esc');
    }
  });
})();
