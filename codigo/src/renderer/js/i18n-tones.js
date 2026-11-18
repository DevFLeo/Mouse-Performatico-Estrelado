/**
 * Motor de Linguagem Adaptativa do M.P.E (Zero Emojis)
 * Suporta os 3 registros exigidos:
 *  1. "amigavel"     -> Linguagem Amigavel (calorosa, proxima e inspiradora)
 *  2. "neutra"       -> Linguagem Neutra / Interpessoal (inclusiva, sem marcacao de genero, equilibrada)
 *  3. "profissional" -> Linguagem Profissional (executiva, tecnica e de alta precisao)
 */
window.MPE_TONES = {
  amigavel: {
    id: 'amigavel',
    label: 'Amigável',
    splashInit: 'M . P . E',
    splashSubInit: 'Sincronizando sistemas...',
    splashWelcome: (name) => `Bem-vindo, ${name}`,
    splashWelcomeSub: (name) => `Sistema sincronizado para ${name}.`,
    hudStatus: (name, sys) => `${name} | [${sys}]`,
    registerTitle: 'Boas-vindas ao M.P.E',
    registerSubtitle: 'Como gostaria de ser chamado?',
    registerPlaceholder: 'Seu nome',
    registerBtn: 'Salvar Perfil',
    btnAddStar: '+ Ponto',
    btnSettings: 'Configurações',
    btnRecenter: 'Centralizar',
    btnHide: 'Fechar (ESC)',
    toastExecuted: (title) => `Ponto "${title}" executado.`,
    toastSaved: 'Configurações salvas.'
  },

  neutra: {
    id: 'neutra',
    label: 'Neutra',
    splashInit: 'M . P . E',
    splashSubInit: 'Sincronizando sistemas...',
    splashWelcome: (name) => `Bem-vindo, ${name}`,
    splashWelcomeSub: (name) => `Sistema ativo para ${name}.`,
    hudStatus: (name, sys) => `${name} | [${sys}]`,
    registerTitle: 'Perfil M.P.E',
    registerSubtitle: 'Identificação de usuário.',
    registerPlaceholder: 'Nome de preferência',
    registerBtn: 'Salvar Perfil',
    btnAddStar: '+ Ponto',
    btnSettings: 'Configurações',
    btnRecenter: 'Centralizar',
    btnHide: 'Fechar (ESC)',
    toastExecuted: (title) => `Ponto "${title}" executado.`,
    toastSaved: 'Configurações salvas.'
  },

  profissional: {
    id: 'profissional',
    label: 'Profissional',
    splashInit: 'M . P . E',
    splashSubInit: 'Sincronizando sistemas...',
    splashWelcome: (name) => `Bem-vindo, ${name}`,
    splashWelcomeSub: (name) => `Operador ${name} autenticado.`,
    hudStatus: (name, sys) => `OP: ${name} | [${sys}]`,
    registerTitle: 'Credenciamento - M.P.E',
    registerSubtitle: 'Identificação do operador.',
    registerPlaceholder: 'Nome do operador',
    registerBtn: 'Autenticar',
    btnAddStar: '+ Ponto',
    btnSettings: 'Configurações',
    btnRecenter: 'Centralizar',
    btnHide: 'Fechar (ESC)',
    toastExecuted: (title) => `Operação "${title}" concluída.`,
    toastSaved: 'Configurações salvas.'
  }
};
