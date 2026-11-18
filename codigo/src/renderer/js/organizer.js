/**
 * Modulo Organizador de Arquivos & Prints do M.P.E (Inspirado no Arquithon)
 * - Criterios: Tipo (dicionario completo de extensoes), Data, Nome e Tamanho
 * - Copiar (padrao) ou Mover (com confirmacao obrigatoria)
 * - Arrastar e soltar (Drag & Drop) de arquivos e pastas do Explorer
 * - Busca instantanea por Nome > Pasta > Conteudo
 * - Arvore expansivel (clique em qualquer lugar da linha da categoria)
 * - Menu de contexto (botao direito): Abrir no Explorer, Abrir Arquivo, Excluir Arquivo (individual)
 * - Relatorio pos-organizacao com "Reverter" e botao "Desfazer Ultima Organizacao"
 */
(function () {
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  class MpeOrganizerUI {
    constructor({ getConfig, saveConfig, showToast, openSettings, onTabChange }) {
      this.getConfig = getConfig;
      this.saveConfig = saveConfig;
      this.showToast = showToast;
      this.openSettings = openSettings;
      this.onTabChange = typeof onTabChange === 'function' ? onTabChange : null;

      this.activeTab = 'astrolabe';
      this.activeScope = 'arquivos';
      this.expandedCategories = new Set();
      this.contextTarget = null;
      this.confirmCallback = null;
      this.lastOrganizeScope = 'arquivos';
      this.searchTimer = null;

      this.els = {
        tabAstrolabe: document.getElementById('btn-tab-astrolabe'),
        tabOrganizer: document.getElementById('btn-tab-organizer'),
        workspace: document.getElementById('organizer-workspace'),
        scopeBtns: document.querySelectorAll('.org-scope-btn'),
        targetLabel: document.getElementById('org-target-label'),
        statsPill: document.getElementById('org-stats-pill'),
        btnPickFiles: document.getElementById('btn-org-pick-files'),
        btnPickFolder: document.getElementById('btn-org-pick-folder'),
        btnBackAstrolabe: document.getElementById('btn-org-back-astrolabe'),
        btnOpenArquivos: document.getElementById('btn-org-open-arquivos'),
        btnOpenPrints: document.getElementById('btn-org-open-prints'),
        btnUndo: document.getElementById('btn-org-undo'),
        btnSettings: document.getElementById('btn-org-settings'),
        criterionSelect: document.getElementById('org-criterion-select'),
        moveCheckbox: document.getElementById('org-move-checkbox'),
        searchInput: document.getElementById('org-search-input'),
        searchContentCheck: document.getElementById('org-search-content-checkbox'),
        btnRefresh: document.getElementById('btn-org-refresh'),
        treeList: document.getElementById('org-tree-list'),
        dragOverlay: document.getElementById('org-drag-overlay'),
        progressWrap: document.getElementById('org-progress-wrap'),
        progressLabel: document.getElementById('org-progress-label'),
        progressCount: document.getElementById('org-progress-count'),
        progressBar: document.getElementById('org-progress-bar'),
        ctxMenu: document.getElementById('org-context-menu'),
        ctxOpenFile: document.getElementById('ctx-open-file'),
        ctxOpenExplorer: document.getElementById('ctx-open-explorer'),
        ctxDeleteFile: document.getElementById('ctx-delete-file'),
        resModal: document.getElementById('modal-org-result'),
        resTitle: document.getElementById('org-res-title'),
        resSubtitle: document.getElementById('org-res-subtitle'),
        resList: document.getElementById('org-res-list'),
        btnResOk: document.getElementById('btn-org-res-ok'),
        btnResRevert: document.getElementById('btn-org-res-revert'),
        btnResOpen: document.getElementById('btn-org-res-open'),
        confirmModal: document.getElementById('modal-org-confirm'),
        confirmTitle: document.getElementById('org-confirm-title'),
        confirmDesc: document.getElementById('org-confirm-desc'),
        btnConfirmOk: document.getElementById('btn-org-confirm-ok'),
        btnConfirmCancel: document.getElementById('btn-org-confirm-cancel')
      };

      this.bindEvents();
    }

    bindEvents() {
      if (this.els.tabAstrolabe) {
        this.els.tabAstrolabe.addEventListener('click', () => this.setWorkspaceTab('astrolabe'));
      }
      if (this.els.tabOrganizer) {
        this.els.tabOrganizer.addEventListener('click', () => this.setWorkspaceTab('organizer'));
      }

      this.els.scopeBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.setScope(btn.dataset.scope || 'arquivos');
        });
      });

      if (this.els.btnPickFiles) {
        this.els.btnPickFiles.addEventListener('click', () => this.pickAndOrganizeFiles());
      }
      if (this.els.btnPickFolder) {
        this.els.btnPickFolder.addEventListener('click', () => this.pickAndOrganizeFolder());
      }
      if (this.els.btnBackAstrolabe) {
        this.els.btnBackAstrolabe.addEventListener('click', () => this.setWorkspaceTab('astrolabe'));
      }
      if (this.els.btnOpenArquivos) {
        this.els.btnOpenArquivos.addEventListener('click', () => {
          window.mpeApi.orgOpenExplorer({ scope: 'arquivos' });
        });
      }
      if (this.els.btnOpenPrints) {
        this.els.btnOpenPrints.addEventListener('click', () => {
          window.mpeApi.orgOpenExplorer({ scope: 'prints' });
        });
      }
      if (this.els.btnUndo) {
        this.els.btnUndo.addEventListener('click', () => this.handleRevert());
      }
      if (this.els.btnSettings && this.openSettings) {
        this.els.btnSettings.addEventListener('click', () => this.openSettings());
      }
      if (this.els.btnRefresh) {
        this.els.btnRefresh.addEventListener('click', () => this.refreshList());
      }

      if (this.els.criterionSelect) {
        this.els.criterionSelect.addEventListener('change', async () => {
          await this.updateOrganizerPref({ criterion: this.els.criterionSelect.value });
        });
      }

      if (this.els.searchContentCheck) {
        this.els.searchContentCheck.addEventListener('change', async () => {
          await this.updateOrganizerPref({ searchInContent: this.els.searchContentCheck.checked });
          this.refreshList();
        });
      }

      if (this.els.searchInput) {
        this.els.searchInput.addEventListener('input', () => {
          clearTimeout(this.searchTimer);
          this.searchTimer = setTimeout(() => this.refreshList(), 140);
        });
      }

      // Drag and drop em toda a janela do Organizador
      if (this.els.workspace) {
        let dragDepth = 0;
        this.els.workspace.addEventListener('dragenter', (e) => {
          e.preventDefault();
          dragDepth++;
          if (this.els.dragOverlay) this.els.dragOverlay.classList.remove('hidden');
        });
        this.els.workspace.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        });
        this.els.workspace.addEventListener('dragleave', (e) => {
          e.preventDefault();
          dragDepth = Math.max(0, dragDepth - 1);
          if (dragDepth === 0 && this.els.dragOverlay) {
            this.els.dragOverlay.classList.add('hidden');
          }
        });
        this.els.workspace.addEventListener('drop', (e) => {
          e.preventDefault();
          dragDepth = 0;
          if (this.els.dragOverlay) this.els.dragOverlay.classList.add('hidden');
          const fileList = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
          const paths = fileList
            .map((f) => (window.mpeApi.getDroppedFilePath ? window.mpeApi.getDroppedFilePath(f) : f.path || ''))
            .filter(Boolean);
          if (paths.length > 0) {
            this.organizeWithConfirmation(paths);
          } else {
            this.showToast('Nenhum arquivo valido detectado ao soltar.');
          }
        });
      }

      // Progresso de lotes
      if (window.mpeApi.onOrgProgress) {
        window.mpeApi.onOrgProgress(({ current, total, fileName }) => {
          if (!this.els.progressWrap) return;
          this.els.progressWrap.classList.remove('hidden');
          if (this.els.progressLabel) {
            this.els.progressLabel.textContent = `Organizando: ${fileName || ''}`;
          }
          if (this.els.progressCount) {
            this.els.progressCount.textContent = `${current} / ${total}`;
          }
          if (this.els.progressBar) {
            const pct = total > 0 ? Math.round((current / total) * 100) : 0;
            this.els.progressBar.style.width = `${pct}%`;
          }
        });
      }

      // Context menu (clique direito)
      window.addEventListener('click', (e) => {
        if (this.els.ctxMenu && !this.els.ctxMenu.contains(e.target)) {
          this.hideContextMenu();
        }
      });

      if (this.els.ctxOpenFile) {
        this.els.ctxOpenFile.addEventListener('click', () => {
          const t = this.contextTarget;
          this.hideContextMenu();
          if (t && t.kind === 'file') {
            window.mpeApi.orgOpenFile({ scope: t.scope, relPath: t.relPath });
          }
        });
      }

      if (this.els.ctxOpenExplorer) {
        this.els.ctxOpenExplorer.addEventListener('click', () => {
          const t = this.contextTarget;
          this.hideContextMenu();
          if (!t) return;
          window.mpeApi.orgOpenExplorer({
            scope: t.scope,
            relPath: t.relPath,
            select: t.kind === 'file'
          });
        });
      }

      if (this.els.ctxDeleteFile) {
        this.els.ctxDeleteFile.addEventListener('click', () => {
          const t = this.contextTarget;
          this.hideContextMenu();
          if (!t || t.kind !== 'file') return;
          this.openConfirmModal({
            title: 'Excluir Arquivo Definitivamente',
            desc: `Deseja excluir permanentemente "${t.name}"? Esta acao nao envia para a lixeira.`,
            okLabel: 'Excluir Definitivamente',
            onConfirm: async () => {
              const res = await window.mpeApi.orgDeleteFile({ scope: t.scope, relPath: t.relPath });
              if (res && res.ok) {
                this.showToast(`Arquivo excluido: ${t.name}`);
                this.refreshList();
              } else {
                this.showToast((res && res.error) || 'Nao foi possivel excluir o arquivo.');
              }
            }
          });
        });
      }

      // Modal Resultado
      if (this.els.btnResOk) {
        this.els.btnResOk.addEventListener('click', () => this.closeResultModal());
      }
      if (this.els.btnResOpen) {
        this.els.btnResOpen.addEventListener('click', () => {
          window.mpeApi.orgOpenExplorer({ scope: this.lastOrganizeScope || this.activeScope });
        });
      }
      if (this.els.btnResRevert) {
        this.els.btnResRevert.addEventListener('click', async () => {
          this.closeResultModal();
          await this.handleRevert();
        });
      }
      if (this.els.resModal) {
        this.els.resModal.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.closeResultModal();
          }
        });
      }

      // Modal Confirmacao
      if (this.els.btnConfirmCancel) {
        this.els.btnConfirmCancel.addEventListener('click', () => this.closeConfirmModal());
      }
      if (this.els.btnConfirmOk) {
        this.els.btnConfirmOk.addEventListener('click', async () => {
          const cb = this.confirmCallback;
          this.closeConfirmModal();
          if (typeof cb === 'function') await cb();
        });
      }

      // Atalhos de teclado estilo Arquithon: Ctrl+O e Ctrl+F
      window.addEventListener('keydown', (e) => {
        if (this.activeTab !== 'organizer') return;
        const openModals = document.querySelectorAll('.modal-backdrop:not(.hidden)');
        if (openModals.length > 0) return;

        if (e.ctrlKey && e.key.toLowerCase() === 'o') {
          e.preventDefault();
          this.pickAndOrganizeFiles();
        } else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          if (this.els.searchInput) {
            this.els.searchInput.focus();
            this.els.searchInput.select();
          }
        }
      });
    }

    applyConfig(cfg) {
      const org = (cfg && cfg.organizer) || {};
      if (this.els.criterionSelect && org.criterion) {
        this.els.criterionSelect.value = org.criterion;
      }
      if (this.els.moveCheckbox) {
        this.els.moveCheckbox.checked = Boolean(org.moveInsteadOfCopy);
      }
      if (this.els.searchContentCheck) {
        this.els.searchContentCheck.checked = org.searchInContent !== false;
      }

      // Aplica fonte e tema claro/escuro em tempo real (Arquithon)
      const scaleMap = { small: '0.88', medium: '1', large: '1.14' };
      document.documentElement.style.setProperty('--ui-font-scale', scaleMap[org.fontSize] || '1');
      document.body.classList.toggle('theme-light', org.uiMode === 'light');
    }

    async updateOrganizerPref(patch) {
      const cfg = this.getConfig ? this.getConfig() : null;
      if (!cfg) return;
      cfg.organizer = Object.assign({}, cfg.organizer || {}, patch);
      if (this.saveConfig) {
        await this.saveConfig(cfg);
      }
    }

    setWorkspaceTab(tab, persist = true) {
      this.activeTab = tab === 'organizer' ? 'organizer' : 'astrolabe';
      if (this.els.tabAstrolabe) {
        this.els.tabAstrolabe.classList.toggle('active', this.activeTab === 'astrolabe');
      }
      if (this.els.tabOrganizer) {
        this.els.tabOrganizer.classList.toggle('active', this.activeTab === 'organizer');
      }
      if (this.els.workspace) {
        this.els.workspace.classList.toggle('hidden', this.activeTab !== 'organizer');
      }
      document.body.classList.toggle('mode-organizer-open', this.activeTab === 'organizer');

      if (this.activeTab === 'organizer') {
        this.refreshList();
        this.refreshUndoButton();
      }
      if (persist) {
        const cfg = this.getConfig ? this.getConfig() : null;
        if (cfg && cfg.organizer && cfg.organizer.rememberWindowState === true) {
          this.updateOrganizerPref({ lastActiveTab: this.activeTab });
        }
      }
      if (this.onTabChange) {
        try {
          this.onTabChange(this.activeTab);
        } catch (_) {}
      }
    }

    setScope(scope) {
      this.activeScope = scope === 'prints' ? 'prints' : 'arquivos';
      this.els.scopeBtns.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.scope === this.activeScope);
      });
      if (this.els.targetLabel) {
        this.els.targetLabel.textContent = this.activeScope === 'prints' ? './prints' : './arquivos';
      }
      this.refreshList();
    }

    async pickAndOrganizeFiles() {
      const paths = await window.mpeApi.orgSelectFiles();
      if (paths && paths.length > 0) {
        this.organizeWithConfirmation(paths);
      }
    }

    async pickAndOrganizeFolder() {
      const paths = await window.mpeApi.orgSelectFolder();
      if (paths && paths.length > 0) {
        this.organizeWithConfirmation(paths);
      }
    }

    async quickOrganize({ scope = 'arquivos', criterion = 'type', pickMode = 'files' } = {}) {
      this.setWorkspaceTab('organizer', false);
      this.setScope(scope === 'prints' ? 'prints' : 'arquivos');
      if (this.els.criterionSelect && criterion) {
        this.els.criterionSelect.value = criterion;
      }
      if (pickMode === 'folder') {
        await this.pickAndOrganizeFolder();
      } else {
        await this.pickAndOrganizeFiles();
      }
    }

    organizeWithConfirmation(paths) {
      const moveInsteadOfCopy = Boolean(this.els.moveCheckbox && this.els.moveCheckbox.checked);
      if (moveInsteadOfCopy) {
        this.openConfirmModal({
          title: 'Mover Arquivos em Vez de Copiar',
          desc: `Os arquivos selecionados (${paths.length} item(ns)) serão REMOVIDOS da pasta de origem e movidos para ./${this.activeScope}/. Deseja continuar?`,
          okLabel: 'Mover Arquivos',
          onConfirm: () => this.executeOrganize(paths, true)
        });
      } else {
        this.executeOrganize(paths, false);
      }
    }

    async executeOrganize(paths, moveInsteadOfCopy) {
      const criterion = (this.els.criterionSelect && this.els.criterionSelect.value) || 'type';
      const targetScope = this.activeScope;
      this.lastOrganizeScope = targetScope;

      if (this.els.progressWrap) {
        this.els.progressWrap.classList.remove('hidden');
        if (this.els.progressBar) this.els.progressBar.style.width = '5%';
      }

      const res = await window.mpeApi.orgOrganize({
        paths,
        criterion,
        moveInsteadOfCopy,
        targetScope
      });

      if (this.els.progressWrap) {
        this.els.progressWrap.classList.add('hidden');
      }

      if (!res || !res.ok) {
        this.showToast((res && res.error) || 'Falha ao organizar arquivos.');
        return;
      }

      this.refreshUndoButton();
      this.refreshList();
      this.openResultModal(res);
    }

    async refreshUndoButton() {
      if (!this.els.btnUndo || !window.mpeApi.orgUndoInfo) return;
      const info = await window.mpeApi.orgUndoInfo();
      const available = Boolean(info && info.available);
      this.els.btnUndo.classList.toggle('hidden', !available);
      if (available) {
        this.els.btnUndo.textContent = `Desfazer Última Organização (${info.count})`;
      }
    }

    async handleRevert() {
      const res = await window.mpeApi.orgRevert();
      await this.refreshUndoButton();
      await this.refreshList();
      if (res && res.ok) {
        this.showToast(`Organizacao revertida (${res.revertedCount} arquivo(s)).`);
      } else {
        this.showToast((res && res.error) || 'Nada para desfazer.');
      }
    }

    async refreshList() {
      if (!this.els.treeList) return;
      const query = (this.els.searchInput && this.els.searchInput.value.trim()) || '';
      const searchInContent = Boolean(this.els.searchContentCheck && this.els.searchContentCheck.checked);

      const data = query
        ? await window.mpeApi.orgSearch({ scope: this.activeScope, query, searchInContent })
        : await window.mpeApi.orgScan({ scope: this.activeScope });

      if (!data || !data.ok) {
        this.els.treeList.innerHTML = '<div class="org-empty">Não foi possível ler a pasta selecionada.</div>';
        return;
      }

      if (this.els.statsPill) {
        const count = query && Array.isArray(data.searchResults) ? data.searchResults.length : data.totalFiles;
        this.els.statsPill.textContent = query
          ? `${count} resultado(s) de ${data.totalFiles}`
          : `${data.totalFiles} arquivo(s)`;
      }

      if (query && Array.isArray(data.searchResults)) {
        this.renderSearchResults(data.searchResults);
      } else {
        this.renderCategoryTree(data.categories || []);
      }
    }

    renderCategoryTree(categories) {
      if (!categories.length) {
        this.els.treeList.innerHTML =
          '<div class="org-empty">Pasta vazia. Arraste arquivos ou clique em Selecionar Arquivos (Ctrl+O).</div>';
        return;
      }

      const frag = document.createDocumentFragment();
      categories.forEach((cat) => {
        const catKey = `${this.activeScope}:${cat.name}`;
        const isOpen = this.expandedCategories.has(catKey) || categories.length <= 3;

        const block = document.createElement('div');
        block.className = 'org-cat-block';

        const header = document.createElement('div');
        header.className = `org-cat-header${isOpen ? ' open' : ''}`;
        header.innerHTML = `
          <span class="org-cat-arrow">${isOpen ? 'v' : '>'}</span>
          <span class="org-cat-name">${escapeHtml(cat.name)}</span>
          <span class="org-cat-meta">${cat.count} arquivo(s) | ${escapeHtml(cat.totalSizeFormatted)}</span>
        `;

        const list = document.createElement('div');
        list.className = `org-cat-files${isOpen ? '' : ' hidden'}`;

        // Clicar em qualquer ponto da linha da categoria expande/recolhe
        header.addEventListener('click', () => {
          const nowOpen = list.classList.toggle('hidden') === false;
          header.classList.toggle('open', nowOpen);
          const arrow = header.querySelector('.org-cat-arrow');
          if (arrow) arrow.textContent = nowOpen ? 'v' : '>';
          if (nowOpen) this.expandedCategories.add(catKey);
          else this.expandedCategories.delete(catKey);
        });

        header.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.showContextMenu(e.clientX, e.clientY, {
            kind: 'category',
            scope: this.activeScope,
            relPath: cat.name === 'Raiz' ? '' : cat.name,
            name: cat.name
          });
        });

        cat.files.forEach((f) => {
          list.appendChild(this.createFileRow(f, false));
        });

        block.appendChild(header);
        block.appendChild(list);
        frag.appendChild(block);
      });

      this.els.treeList.innerHTML = '';
      this.els.treeList.appendChild(frag);
    }

    renderSearchResults(results) {
      if (!results.length) {
        this.els.treeList.innerHTML = '<div class="org-empty">Nenhum arquivo encontrado para essa busca.</div>';
        return;
      }

      const matchLabels = {
        name: 'Nome',
        folder: 'Pasta',
        content: 'Conteudo'
      };

      const frag = document.createDocumentFragment();
      results.forEach((f) => {
        const row = this.createFileRow(f, true, matchLabels[f.matchType] || '');
        frag.appendChild(row);
      });

      this.els.treeList.innerHTML = '';
      this.els.treeList.appendChild(frag);
    }

    createFileRow(f, showCategory = false, matchBadge = '') {
      const row = document.createElement('div');
      row.className = 'org-file-row';

      const badgeHtml = matchBadge
        ? `<span class="org-match-badge match-${escapeHtml(f.matchType)}">${escapeHtml(matchBadge)}</span>`
        : '';
      const catHtml = showCategory
        ? `<span class="org-file-cat">${escapeHtml(f.category)}</span>`
        : '';
      const snippetHtml = f.snippet
        ? `<div class="org-file-snippet">...${escapeHtml(f.snippet)}...</div>`
        : '';

      row.innerHTML = `
        <div class="org-file-main">
          <div class="org-file-title-line">
            ${badgeHtml}
            <span class="org-file-name">${escapeHtml(f.name)}</span>
            ${catHtml}
          </div>
          ${snippetHtml}
        </div>
        <div class="org-file-meta">
          <span>${escapeHtml(f.sizeFormatted)}</span>
          <span>${escapeHtml(f.mtimeFormatted)}</span>
        </div>
      `;

      row.addEventListener('dblclick', () => {
        window.mpeApi.orgOpenFile({ scope: this.activeScope, relPath: f.relPath });
      });

      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showContextMenu(e.clientX, e.clientY, {
          kind: 'file',
          scope: this.activeScope,
          relPath: f.relPath,
          name: f.name
        });
      });

      return row;
    }

    showContextMenu(x, y, target) {
      this.contextTarget = target;
      const menu = this.els.ctxMenu;
      if (!menu) return;

      const isFile = target.kind === 'file';
      if (this.els.ctxOpenFile) this.els.ctxOpenFile.classList.toggle('hidden', !isFile);
      if (this.els.ctxDeleteFile) this.els.ctxDeleteFile.classList.toggle('hidden', !isFile);

      menu.classList.remove('hidden');
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = menu.getBoundingClientRect();
      const left = Math.min(x, vw - rect.width - 10);
      const top = Math.min(y, vh - rect.height - 10);
      menu.style.left = `${Math.max(8, left)}px`;
      menu.style.top = `${Math.max(8, top)}px`;
    }

    hideContextMenu() {
      if (this.els.ctxMenu) this.els.ctxMenu.classList.add('hidden');
      this.contextTarget = null;
    }

    openResultModal(res) {
      if (!this.els.resModal) return;
      const actionWord = res.moved ? 'movido(s)' : 'copiado(s)';
      if (this.els.resTitle) {
        this.els.resTitle.textContent = `${res.organizedCount} arquivo(s) ${actionWord}`;
      }
      if (this.els.resSubtitle) {
        this.els.resSubtitle.textContent = `Destino: ./${res.targetScope}/ | Critério: ${res.criterion}`;
      }
      if (this.els.resList) {
        if (!res.results || !res.results.length) {
          this.els.resList.innerHTML = '<div class="org-empty">Nenhum arquivo novo precisou ser processado.</div>';
        } else {
          this.els.resList.innerHTML = res.results
            .map((r) => {
              const renamed = r.renamedAs
                ? `<span class="org-renamed-badge">salvo como ${escapeHtml(r.renamedAs)}</span>`
                : '';
              return `
                <div class="org-res-item">
                  <div class="org-res-name">${escapeHtml(r.originalName)} ${renamed}</div>
                  <div class="org-res-cat">${escapeHtml(r.category)}</div>
                </div>
              `;
            })
            .join('');
        }
      }
      this.els.resModal.classList.remove('hidden');
      if (this.els.btnResOk) this.els.btnResOk.focus();
    }

    closeResultModal() {
      if (this.els.resModal) this.els.resModal.classList.add('hidden');
    }

    openConfirmModal({ title, desc, okLabel, onConfirm }) {
      if (!this.els.confirmModal) return;
      this.confirmCallback = onConfirm;
      if (this.els.confirmTitle) this.els.confirmTitle.textContent = title || 'Confirmar';
      if (this.els.confirmDesc) this.els.confirmDesc.textContent = desc || '';
      if (this.els.btnConfirmOk) this.els.btnConfirmOk.textContent = okLabel || 'Confirmar';
      this.els.confirmModal.classList.remove('hidden');
      if (this.els.btnConfirmCancel) this.els.btnConfirmCancel.focus();
    }

    closeConfirmModal() {
      if (this.els.confirmModal) this.els.confirmModal.classList.add('hidden');
      this.confirmCallback = null;
    }
  }

  window.MpeOrganizerUI = MpeOrganizerUI;
})();
