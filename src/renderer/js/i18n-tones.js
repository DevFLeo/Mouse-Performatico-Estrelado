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
    splashInit: 'M . P . E   Inicializando',
    splashSubInit: 'Alinhando suas estrelas e preparando a integracao com os seus sistemas...',
    splashWelcome: (name) => `Bem-vindo, ${name}`,
    splashWelcomeSub: (name) => `Que bom ter voce aqui, ${name}. Seu sistema de produtividade 3D esta pronto.`,
    hudStatus: (name, sys) => `Ola, ${name} | Sistema Detectado: [${sys}] | Arraste para girar o Circulo 3D`,
    registerTitle: 'Boas-vindas ao M.P.E',
    registerSubtitle: 'Como voce gostaria de ser chamado sempre que o seu mapa estelar inicializar?',
    registerPlaceholder: 'Digite seu nome ou identificacao (ex: DevFLeo)',
    registerBtn: 'Salvar Meu Perfil e Entrar no Universo 3D',
    btnAddStar: '+ Salvar Novo Ponto',
    btnSettings: 'Configurar Cores e Sistema',
    btnRecenter: 'Centralizar 3D',
    btnHide: 'Ocultar HUD',
    toastExecuted: (title) => `Ponto "${title}" acionado com sucesso!`,
    toastSaved: 'Suas configuracoes e pontos foram salvos no JSON!'
  },

  neutra: {
    id: 'neutra',
    label: 'Neutra (Interpessoal)',
    splashInit: 'M . P . E   Inicializando',
    splashSubInit: 'Sincronizando coordenadas orbitais e integracao nativa do Windows...',
    splashWelcome: (name) => `Bem-vindo, ${name}`,
    splashWelcomeSub: (name) => `Perfil ${name} carregado. O ambiente interativo 3D esta disponivel para uso.`,
    hudStatus: (name, sys) => `Perfil: ${name} | Origem: [${sys}] | Movimente para os lados para girar o circulo 3D`,
    registerTitle: 'Configuracao Inicial de Perfil — M.P.E',
    registerSubtitle: 'Defina a identificacao que sera exibida na inicializacao e salva no arquivo portatil JSON.',
    registerPlaceholder: 'Identificacao ou nome de preferencia',
    registerBtn: 'Confirmar Identificacao e Iniciar',
    btnAddStar: '+ Adicionar Ponto Orbital',
    btnSettings: 'Preferencias e Cores',
    btnRecenter: 'Restaurar Eixo 3D',
    btnHide: 'Minimizar para Segundo Plano',
    toastExecuted: (title) => `Ponto "${title}" executado com exito.`,
    toastSaved: 'Configuracoes atualizadas e sincronizadas no arquivo mpe.config.json.'
  },

  profissional: {
    id: 'profissional',
    label: 'Profissional',
    splashInit: 'M . P . E   Inicializando',
    splashSubInit: 'Calibrando matriz vetorial 3D, hooks Win32 e ponte de transferencia entre sistemas...',
    splashWelcome: (name) => `Bem-vindo, ${name}`,
    splashWelcomeSub: (name) => `Operador ${name} autenticado. Sistema M.P.E em regime de maxima performance.`,
    hudStatus: (name, sys) => `OP: ${name} | HWND Origem: [${sys}] | Controle Orbital 3D Ativo`,
    registerTitle: 'Credenciamento de Operador — M.P.E',
    registerSubtitle: 'Registre a assinatura nominal de operador para persistencia em mpe.config.json.',
    registerPlaceholder: 'Nome do Operador Responsavel',
    registerBtn: 'Autenticar e Inicializar Sistema',
    btnAddStar: '+ Registrar Novo Vetor',
    btnSettings: 'Parametros do Sistema',
    btnRecenter: 'Resetar Giroscopio 3D',
    btnHide: 'Suspender HUD',
    toastExecuted: (title) => `Operacao "${title}" concluida com sucesso.`,
    toastSaved: 'Parametros gravados em mpe.config.json e sincronizados com o registro da maquina.'
  }
};
