/**
 * Motor de Linguagem Adaptativa do M.P.E
 * Suporta os 3 registros exigidos:
 *  1. "amigavel"     -> Linguagem Amigável (calorosa, próxima e inspiradora)
 *  2. "neutra"       -> Linguagem Neutra / Interpessoal (inclusiva, sem marcação de gênero, equilibrada)
 *  3. "profissional" -> Linguagem Profissional (executiva, técnica e de alta precisão)
 */
window.MPE_TONES = {
  amigavel: {
    id: 'amigavel',
    label: 'Amigável (Calorosa & Próxima)',
    splashInit: 'M . P . E   Inicializando',
    splashSubInit: 'Alinhando suas estrelas e preparando seus atalhos favoritos...',
    splashWelcome: (name) => `Bem-vindo, ${name}`,
    splashWelcomeSub: (name) => `Que alegria ter você aqui, ${name}! Seu universo de produtividade está pronto.`,
    hudStatus: (name) => `Olá, ${name} • Arraste para girar o Círculo 3D ou clique em uma estrela ✨`,
    registerTitle: 'Boas-vindas ao M.P.E ✨',
    registerSubtitle: 'Como você gostaria de ser chamado(a) sempre que o seu mapa estelar inicializar?',
    registerPlaceholder: 'Digite seu nome ou apelido (ex: DevFLeo)',
    registerBtn: 'Salvar Meu Perfil e Entrar no Universo 3D',
    btnAddStar: '+ Salvar Novo Ponto',
    btnSettings: '⚙ Configurar Cores & Sistema',
    btnRecenter: '◎ Centralizar Órbita 3D',
    btnHide: 'Ocultar (Shift+Ctrl+Alt+Clique Direito)',
    toastExecuted: (title) => `Estrela "${title}" acionada com sucesso! ✨`,
    toastSaved: 'Suas configurações e estrelas foram salvas com carinho no JSON!'
  },

  neutra: {
    id: 'neutra',
    label: 'Neutra (Interpessoal & Inclusiva)',
    splashInit: 'M . P . E   Inicializando',
    splashSubInit: 'Sincronizando coordenadas orbitais e carregando pontos salvos...',
    splashWelcome: (name) => `Bem-vindo, ${name}`,
    splashWelcomeSub: (name) => `Perfil ${name} carregado. O ambiente interativo 3D está disponível para uso.`,
    hudStatus: (name) => `Perfil ativo: ${name} • Movimente para os lados para rotacionar o círculo 3D`,
    registerTitle: 'Configuração Inicial de Perfil — M.P.E',
    registerSubtitle: 'Defina a identificação que será exibida na inicialização e salva no arquivo portátil JSON.',
    registerPlaceholder: 'Identificação ou nome de preferência',
    registerBtn: 'Confirmar Identificação e Iniciar',
    btnAddStar: '+ Adicionar Ponto Orbital',
    btnSettings: '⚙ Preferências e Cores',
    btnRecenter: '◎ Restaurar Eixo 3D',
    btnHide: 'Minimizar para Segundo Plano',
    toastExecuted: (title) => `Ponto "${title}" executado com êxito.`,
    toastSaved: 'Configurações atualizadas e sincronizadas no arquivo mpe.config.json.'
  },

  profissional: {
    id: 'profissional',
    label: 'Profissional (Executiva & Técnica)',
    splashInit: 'M . P . E   Inicializando',
    splashSubInit: 'Calibrando matriz vetorial 3D, hooks Win32 e parâmetros de telemetria...',
    splashWelcome: (name) => `Bem-vindo, ${name}`,
    splashWelcomeSub: (name) => `Operador ${name} autenticado. Sistema M.P.E em regime de máxima performance.`,
    hudStatus: (name) => `OP: ${name} • Controle Orbital 3D Ativo [Rotação Lateral / Inclinação / Vetores]`,
    registerTitle: 'Credenciamento de Operador — M.P.E',
    registerSubtitle: 'Registre a assinatura nominal de operador para persistência em mpe.config.json.',
    registerPlaceholder: 'Nome do Operador / Engenheiro Responsável',
    registerBtn: 'Autenticar e Inicializar Sistema',
    btnAddStar: '+ Registrar Novo Vetor',
    btnSettings: '⚙ Parâmetros do Sistema',
    btnRecenter: '◎ Resetar Giroscópio 3D',
    btnHide: 'Suspender HUD (Background Hook Ativo)',
    toastExecuted: (title) => `Operação "${title}" concluída com sucesso.`,
    toastSaved: 'Parâmetros gravados em mpe.config.json e sincronizados com o registro da máquina.'
  }
};
