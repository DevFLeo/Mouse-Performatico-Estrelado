# 1. Arquitetura Técnica do Sistema — M.P.E (Mouse Performático Estrelado)

> **Repositório Oficial:** [https://github.com/DevFLeo/Mouse-Performatico-Estrelado](https://github.com/DevFLeo/Mouse-Performatico-Estrelado)  
> **Paradigma Arquitetural:** Híbrido Nativo Win32 (`user32.dll` Low-Level Hooks) + Desktop IPC Isolado + Motor de Projeção Vetorial 3D (Zero `localhost` / Zero Servidor HTTP).

---

## 1. Visão Geral de Engenharia

O **M.P.E (Mouse Performático Estrelado)** foi projetado sob três premissas inegociáveis de engenharia de sistemas:

1. **Latência Sub-Milissegundo e Consumo Zero em Repouso:** A interceptação do gatilho global `Shift + Ctrl + Alt + Botão Direito do Mouse` ocorre diretamente no subsistema `user32.dll` do Windows Kernel/User-Mode por meio de um binário nativo compilado em C# (`MpeHook.exe`) utilizando `SetWindowsHookEx(WH_MOUSE_LL)` e `GetAsyncKeyState`. Não há *polling* (loops de verificação contínua), garantindo **0.0% de uso de CPU** enquanto o sistema aguarda o comando em segundo plano.
2. **Execução 100% Local Sem `localhost`:** Diferente de aplicações híbridas convencionais que abrem servidores HTTP locais (ex: `localhost:3000`), o M.P.E opera exclusivamente via protocolo de sistema de arquivos (`file://`) aliado a canais binários de **IPC (Inter-Process Communication)** com isolamento de contexto (`contextIsolation: true`) e pipes padrão (`STDIN`/`STDOUT`) entre o processo principal e o daemon Win32.
3. **Persistência Híbrida (Portabilidade Raiz + Escopo por Máquina):** Todas as estrelas (pontos), cores, configurações do Telegram, nome cadastrado e tom de linguagem são gravados simultaneamente no arquivo portátil `./mpe.config.json` (na raiz do projeto) e no registro específico do *hostname* da máquina (`%APPDATA%\MPE\machine-<HOSTNAME>.json` e chave `machines[<HOSTNAME>]`).

---

## 2. Topologia de Pastas e Responsabilidade Técnica de Cada Diretório

```text
c:\Projetos\MousePerformaticoEstrelado\
├── MPE.exe                         # Executável Nativo Win32 (Entry-point GUI sem console)
├── mpe.config.json                 # Banco de dados JSON portátil (Pontos 3D, Perfil, Cores, Máquinas)
├── package.json                    # Manifesto de dependências e scripts de build
├── README.md                       # Documentação principal e Pitch do produto
├── PITCH.md                        # Pitch Executivo, Comercial e Técnico do M.P.E
├── 1-SISTEMA-ARQUITETURA.md        # [Este Documento] Especificação técnica profunda da arquitetura
├── 2-COMO-SALVAR-ATALHOS.md        # Manual técnico e prático de persistência de atalhos e ações
├── 3-COMO-MODIFICAR-PROJETO.md     # Guia de engenharia para extensão e manutenção do código
├── assets/                         # Recursos gráficos estáticos e binários de ícone
│   ├── icon.ico                    # Ícone multi-resolução Win32 embutido no cabeçalho PE do MPE.exe
│   ├── icon.png                    # Textura de ícone para System Tray e HUD
│   └── reference-astrolabe.jpg     # Artefato visual de referência geométrica do Astrolábio
├── Capturas_MPE/                   # Diretório padrão gerado automaticamente para armazenamento de Prints
├── scripts/                        # Automação de compilação e geração de artefatos nativos
│   └── build-native.ps1            # Pipeline de compilação C# (csc.exe) + gerador vetorial GDI+ de ícones
└── src/                            # Código-fonte modular dividido em 4 camadas isoladas
    ├── native/                     # Camada 1: Subsistema Nativo Windows (C# / P/Invoke Win32 API)
    │   ├── MpeHook.cs              # Daemon de Hook Global de Mouse/Teclado e automação de janela ativa
    │   ├── MpeLauncher.cs          # Bootstrapper nativo que gera o executável MPE.exe na raiz
    │   └── bin/
    │       └── MpeHook.exe         # Binário executável nativo de baixa latência
    ├── main/                       # Camada 2: Núcleo Orquestrador Desktop (Node.js / Electron Main)
    │   ├── main.js                 # Gerenciador de ciclo de vida, Single-Instance Lock, System Tray e IPC
    │   ├── configManager.js        # Motor de sincronização JSON (Raiz Portátil <-> %APPDATA% por Máquina)
    │   ├── hookBridge.js           # Ponte assíncrona baseada em Streams/Events com o processo MpeHook.exe
    │   ├── actionExecutor.js       # Executor de Capturas de Tela, Seleção de Texto, API/Desktop Telegram
    │   └── startupManager.js       # Manipulador direto do Registro do Windows (HKCU\...\Run)
    ├── preload/                    # Camada 3: Ponte de Segurança (Context Bridge)
    │   └── preload.js              # Exposição controlada da API `window.mpeApi` para o processo de renderização
    └── renderer/                   # Camada 4: Motor Gráfico 3D e Interface de Usuário (HUD)
        ├── index.html              # Estrutura DOM das camadas de Splash, Canvas 3D e Modais
        ├── styles/
        │   └── main.css            # Sistema de design Degradê Preto & Dourado, animações GPU e Glassmorphism
        └── js/
            ├── astrolabe3d.js      # Motor matemático 3D (Projeção perspectiva, matrizes Euler, anéis excêntricos)
            ├── areaSelector.js     # Motor de recorte retangular de tela em resolução nativa (DPI-aware)
            ├── i18n-tones.js       # Máquina de estados linguísticos (Amigável, Neutra/Interpessoal, Profissional)
            └── app.js              # Controlador de estado da UI, áudio procedural WebAudio e eventos IPC
```

---

## 3. Detalhamento Técnico Profundo por Camada

### 3.1. Camada Nativa Win32 (`src/native/`)

Por que uma camada nativa em C# puro compilada via `csc.exe`?
APIs de atalho globais convencionais (como `RegisterHotKey` da Win32 ou `globalShortcut` do Electron) aceitam apenas combinações de teclado (`Ctrl + Shift + Tecla`) e **não permitem interceptar cliques de mouse combinados com teclas modificadoras**.

* **[`src/native/MpeHook.cs`](file:///c:/Projetos/MousePerformaticoEstrelado/src/native/MpeHook.cs)**:
  * Registra um *hook* global de baixo nível no encadeamento do Windows via `SetWindowsHookEx(WH_MOUSE_LL, _proc, hMod, 0)` (constante `WH_MOUSE_LL = 14`).
  * Quando o evento `WM_RBUTTONDOWN` (`0x0204`) ocorre em qualquer coordenada do desktop, o callback consulta em tempo constante $O(1)$ o estado físico dos registradores de teclado via `GetAsyncKeyState`:
    * `VK_SHIFT` (`0x10`), `VK_CONTROL` (`0x11`) e `VK_MENU` (`0x12` / `ALT`).
  * Caso os três modificadores estejam ativos simultaneamente (`(GetAsyncKeyState(vk) & 0x8000) != 0`):
    1. Captura o `HWND` da janela que estava em primeiro plano (`GetForegroundWindow()`) imediatamente antes da abertura do HUD — permitindo que a função de **Seleção de Texto** saiba exatamente de qual janela extrair o texto selecionado.
    2. Emite o pacote `TRIGGER_HUD|<cursorX>|<cursorY>|<lastHwnd>` via `STDOUT` com `Flush()` imediato.
    3. Retorna `(IntPtr)1` no `HookCallback` tanto para `WM_RBUTTONDOWN` quanto para o `WM_RBUTTONUP` subsequente, **suprimindo o menu de contexto nativo do Windows** para que o clique direito não interfira no aplicativo que estava aberto por baixo.
  * Fornece ainda dois modos operacionais de automação de teclado (`keybd_event`):
    * `--COPY-SELECTION <hwnd>`: Restaura o foco brevemente à janela anterior e injeta `Ctrl + C` para capturar o texto grifado pelo usuário.
    * `--PASTE-AND-SEND`: Injeta `Ctrl + V` seguido de `VK_RETURN` (`Enter`) após a abertura de uma conversa no Telegram Desktop via protocolo `tg://`, automatizando o envio da captura de tela.

* **[`src/native/MpeLauncher.cs`](file:///c:/Projetos/MousePerformaticoEstrelado/src/native/MpeLauncher.cs)** $\rightarrow$ Compilado como **`MPE.exe`** na raiz:
  * Compilado com a flag `/target:winexe` e `/win32icon:assets/icon.ico`.
  * Atua como o binário executável autônomo na raiz do projeto. Não abre janela de prompt (`CreateNoWindow = true`, `UseShellExecute = false`) e repassa argumentos de inicialização (`--launch-ui` ou `--startup`) para o motor gráfico.

---

### 3.2. Camada Principal de Orquestração (`src/main/`)

* **[`src/main/main.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/main/main.js)**:
  * Habilita flags de aceleração de hardware (`enable-gpu-rasterization`, `enable-zero-copy`) e desativa caches de rede desnecessários.
  * Implementa trava de instância única (`app.requestSingleInstanceLock()`): se o M.P.E já estiver rodando silenciosamente na Bandeja do Sistema (System Tray) e o usuário executar `MPE.exe` novamente, a instância ativa intercepta o evento `second-instance` e exibe imediatamente a interface 3D com a saudação personalizada.
  * Cria uma `BrowserWindow` transparente (`transparent: true`, `frame: false`, `fullscreen: true`, `alwaysOnTop: true` em nível `screen-saver`) que se adapta dinamicamente ao monitor onde o cursor do mouse se encontra (`screen.getDisplayNearestPoint`).

* **[`src/main/configManager.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/main/configManager.js)**:
  * Implementa a arquitetura de **Persistência Dupla Sincronizada**:
    1. **Arquivo Portátil na Raiz ([`mpe.config.json`](file:///c:/Projetos/MousePerformaticoEstrelado/mpe.config.json)):** Armazena o array `points` (todos os pontos salvos no círculo 3D), `profile` (`userName`, `languageTone`), `theme` (cores do degradê Preto e Dourado), `telegram` e o dicionário `machines`.
    2. **Arquivo Local da Máquina (`%APPDATA%\mpe-mouse-performatico-estrelado\machine-<HOSTNAME>.json`):** Armazena configurações exclusivas do hardware atual identificadas por `os.hostname()`.
  * **Fluxo de Migração Automática:** Quando a pasta do projeto (ou o `mpe.config.json`) é levada para outra máquina, o `ConfigManager` detecta o novo `os.hostname()`, preserva 100% dos atalhos, cores e cadastro do arquivo raiz e cria um novo perfil de máquina acoplado.

* **[`src/main/actionExecutor.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/main/actionExecutor.js)**:
  * **Captura de Tela Nativa:** Utiliza `desktopCapturer.getSources` multiplicando as dimensões lógicas pelo `scaleFactor` do monitor (suporte total a telas Full HD, 2K e 4K com escala de DPI de 125%, 150%, 200%).
  * **Pipeline Duplo de Telegram:**
    1. **Via Protocolo Nativo (`tg://`):** Converte automaticamente entradas como `@usuario`, `https://t.me/usuario` ou `tg://resolve?domain=...`, grava o buffer PNG na Área de Transferência do Windows (`clipboard.writeImage`), abre a conversa diretamente no aplicativo Telegram Desktop e aciona a colagem + envio automático.
    2. **Via Telegram Bot API (HTTPS Nativo):** Caso o usuário preencha `botToken` e `chatId`, monta um pacote `multipart/form-data` binário puro via módulo nativo `https` (sem bibliotecas externas pesadas) e envia o arquivo PNG diretamente para `api.telegram.org/bot<TOKEN>/sendPhoto`.

* **[`src/main/startupManager.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/main/startupManager.js)**:
  * Gerencia a chave `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` sob o identificador `MPE_MousePerformaticoEstrelado` via `reg.exe`, garantindo que o M.P.E inicie junto com o Windows sem exigir privilégios de Administrador (escopo `CurrentUser`).

---

### 3.3. Camada de Renderização e Motor Matemático 3D (`src/renderer/`)

* **[`src/renderer/js/astrolabe3d.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/renderer/js/astrolabe3d.js)**:
  * Motor de renderização 3D construído sobre HTML5 Canvas 2D/WebGL-style projection com **zero dependências pesadas**, operando a 60–144 FPS constantes.
  * **Modelo Matemático de Projeção 3D:**
    Cada ponto orbital ou segmento de anel possui coordenadas tridimensionais normalizadas $(x, y, z) \in [-1, 1]^3$. A cada quadro (`requestAnimationFrame`), aplica-se a transformação de rotação orbital lateral ($\theta_{\text{wheel}}$) combinada com matrizes de rotação de Euler nos eixos $X$ (`tiltX`) e $Y$ (`tiltY`):
    $$x_1 = x \cos(\text{tiltY}) - z \sin(\text{tiltY}), \quad z_1 = z \cos(\text{tiltY}) + x \sin(\text{tiltY})$$
    $$y_2 = y \cos(\text{tiltX}) - z_1 \sin(\text{tiltX}), \quad z_2 = z_1 \cos(\text{tiltX}) + y \cos(\text{tiltX})$$
    A projeção perspectiva aplica distância focal $f = 2.9$:
    $$P(x, y, z) = \left( C_x + x_2 \cdot R \cdot \frac{f}{f + 0.55 z_2}, \; C_y + y_2 \cdot R \cdot \frac{f}{f + 0.55 z_2} \right)$$
  * **Fidelidade Visual à Imagem de Referência:**
    * Renderiza o anel duplo externo graduado com 72 subdivisões de grau, clusters de 5 barras de telemetria a cada $30^\circ$ e quartetos de pontos a cada $15^\circ$.
    * Renderiza as órbitas internas excêntricas (com centros deslocados e inclinações 3D independentes) e o **Nexus de Origem** (anel branco espesso envolto por um anel carmesim `#9E2A2B` e órbitas douradas).
    * Traça vetores em Dourado Imperial (`#E5B84B`) e Azul Celestial (`#5C73B8`) com setas direcionais (`▲`) e glifos matemáticos (`Π`, `Δ`, `h`, `C`) até cada ponto salvo, ordenados por profundidade ($Z$-sorting / *Painter's Algorithm*).

* **[`src/renderer/js/i18n-tones.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/renderer/js/i18n-tones.js)**:
  * Implementa os três registros de comunicação solicitados:
    * **Amigável (`amigavel`):** Acolhedor, próximo e entusiasta.
    * **Neutra / Interpessoal (`neutra`):** Inclusiva, impessoal, sem flexão de gênero binária, limpa e equilibrada.
    * **Profissional (`profissional`):** Vocabulário técnico de engenharia, telemetria e comando executivo.
