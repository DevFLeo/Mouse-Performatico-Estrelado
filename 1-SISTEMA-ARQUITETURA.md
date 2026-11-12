# 1. Arquitetura Técnica do Sistema — M.P.E (Mouse Performático Estrelado)

> **Repositório Oficial:** [https://github.com/DevFLeo/Mouse-Performatico-Estrelado](https://github.com/DevFLeo/Mouse-Performatico-Estrelado)  
> **Paradigma Arquitetural:** Subsistema de Integração Nativa Windows (`user32.dll` Low-Level Hooks + `EnumWindows` + `AttachThreadInput`) + Desktop IPC Isolado + Motor de Projeção Vetorial 3D (Zero `localhost` / Zero Servidor HTTP).

---

## 1. Visão Geral de Engenharia

O **M.P.E (Mouse Performático Estrelado)** foi projetado como uma camada de integração direta do sistema operacional Windows sob quatro premissas técnicas:

1. **Integração Direta Entre Sistemas no Windows (Cross-System Bridge):** O M.P.E opera sobre qualquer software em execução no Windows (ERPs, navegadores, IDEs, clientes de mensagem, editores gráficos). Ao pressionar `Shift + Ctrl + Alt + Botão Direito do Mouse`, o daemon nativo identifica o `HWND`, o processo e as coordenadas exatas da janela do **Sistema de Origem** e permite capturar um print (ou texto selecionado) daquele sistema e transferi-lo automaticamente (via ativação nativa de foco `AttachThreadInput` + `SetForegroundWindow` + colagem `Ctrl+V` + disparo `VK_RETURN`) para qualquer **Sistema de Destino** aberto no Windows.
2. **Latência Sub-Milissegundo e Consumo Zero em Repouso:** A interceptação do gatilho global `Shift + Ctrl + Alt + Botão Direito do Mouse` ocorre diretamente no subsistema `user32.dll` do Windows por meio do binário nativo compilado em C# (`MpeHook.exe`) utilizando `SetWindowsHookEx(WH_MOUSE_LL)` e `GetAsyncKeyState`. Não há *polling*, garantindo **0.0% de uso de CPU** em repouso.
3. **Execução 100% Executável Windows Sem `localhost`:** O M.P.E não abre servidores HTTP locais, portas TCP ou `localhost`. Toda a comunicação ocorre via protocolo local nativo, IPC binário isolado (`contextIsolation: true`) e pipes padrão (`STDIN`/`STDOUT`) entre o executável Windows e o subsistema Win32.
4. **Persistência Híbrida (Portabilidade Raiz + Escopo por Máquina):** Todas as estrelas (pontos), cores, configurações de destino entre sistemas, Telegram, nome cadastrado e tom de linguagem são gravados simultaneamente no arquivo portátil `./mpe.config.json` (na raiz do projeto) e no registro específico do *hostname* da máquina (`%APPDATA%\mpe-mouse-performatico-estrelado\machine-<HOSTNAME>.json` e chave `machines[<HOSTNAME>]`).

---

## 2. Topologia de Pastas e Responsabilidade Técnica de Cada Diretório

```text
c:\Projetos\MousePerformaticoEstrelado\
├── MPE.exe                         # Executavel Nativo Windows (Entry-point GUI Win32 sem console)
├── mpe.config.json                 # Banco de dados JSON portatil (Pontos 3D, Perfil, Cores, Maquinas)
├── package.json                    # Manifesto da aplicacao desktop e scripts de build nativo
├── README.md                       # Documentacao principal e Pitch do produto
├── PITCH.md                        # Pitch Executivo, Comercial e Tecnico do M.P.E
├── 1-SISTEMA-ARQUITETURA.md        # [Este Documento] Especificacao tecnica profunda da arquitetura
├── 2-COMO-SALVAR-ATALHOS.md        # Manual tecnico e pratico de persistencia de atalhos e integracao entre sistemas
├── 3-COMO-MODIFICAR-PROJETO.md     # Guia de engenharia para extensao e manutencao do codigo
├── assets/                         # Recursos graficos estaticos e binarios de icone
│   ├── icon.ico                    # Icone Win32 embutido no cabecalho PE do executavel MPE.exe
│   ├── icon.png                    # Textura de icone para System Tray e HUD
│   └── reference-astrolabe.jpg     # Artefato visual de referencia geometrica do Astrolabio
├── Capturas_MPE/                   # Diretorio padrao para armazenamento automatico de Prints
├── scripts/                        # Automacao de compilacao e geracao de artefatos nativos
│   └── build-native.ps1            # Pipeline de compilacao C# (csc.exe) + gerador vetorial GDI+ de icones
└── src/                            # Codigo-fonte modular dividido em 4 camadas isoladas
    ├── native/                     # Camada 1: Subsistema Nativo Windows (C# / P/Invoke Win32 API)
    │   ├── MpeHook.cs              # Daemon de Hook Global, EnumWindows e Ponte de Transferencia Entre Sistemas
    │   ├── MpeLauncher.cs          # Bootstrapper nativo que compila o executavel MPE.exe na raiz
    │   └── bin/
    │       └── MpeHook.exe         # Binario executavel nativo de integracao Win32
    ├── main/                       # Camada 2: Nucleo Orquestrador Desktop
    │   ├── main.js                 # Gerenciador de ciclo de vida, Single-Instance Lock, System Tray e IPC
    │   ├── configManager.js        # Motor de sincronizacao JSON (Raiz Portatil <-> %APPDATA% por Maquina)
    │   ├── hookBridge.js           # Ponte assincrona baseada em Streams/Events com o processo MpeHook.exe
    │   ├── actionExecutor.js       # Executor de Capturas de Sistemas, Selecao de Texto e Entrega Entre Sistemas
    │   └── startupManager.js       # Manipulador direto do Registro do Windows (HKCU\...\Run)
    ├── preload/                    # Camada 3: Ponte de Seguranca (Context Bridge)
    │   └── preload.js              # Exposicao controlada da API `window.mpeApi` para o motor 3D
    └── renderer/                   # Camada 4: Motor Grafico 3D e Interface de Usuario (HUD)
        ├── index.html              # Estrutura DOM das camadas de Splash, Canvas 3D e Modais
        ├── styles/
        │   └── main.css            # Sistema de design Degrade Preto e Dourado, animacoes GPU e Glassmorphism
        └── js/
            ├── astrolabe3d.js      # Motor matematico 3D (Projecao perspectiva, matrizes Euler, aneis excentricos)
            ├── areaSelector.js     # Motor de recorte retangular de tela em resolucao nativa (DPI-aware)
            ├── i18n-tones.js       # Maquina de estados linguisticos (Amigavel, Neutra/Interpessoal, Profissional)
            └── app.js              # Controlador de estado da UI, audio procedural WebAudio e eventos IPC
```

---

## 3. Detalhamento Técnico Profundo por Camada

### 3.1. Camada Nativa Win32 e Ponte Entre Sistemas (`src/native/`)

* **[`src/native/MpeHook.cs`](file:///c:/Projetos/MousePerformaticoEstrelado/src/native/MpeHook.cs)**:
  * **Interceptação Global de Mouse e Modificadores:** Registra `SetWindowsHookEx(WH_MOUSE_LL, _proc, hMod, 0)` (constante `WH_MOUSE_LL = 14`). Quando `WM_RBUTTONDOWN` (`0x0204`) ocorre enquanto `VK_SHIFT` (`0x10`), `VK_CONTROL` (`0x11`) e `VK_MENU` (`0x12`) estão pressionados:
    1. Captura o `HWND` do **Sistema de Origem** (`GetForegroundWindow()`), seu título (`GetWindowText`) e seu retângulo físico na tela (`GetWindowRect`).
    2. Emite `TRIGGER_HUD|<x>|<y>|<hwnd>|<left>,<top>,<right>,<bottom>|<windowTitle>` para o núcleo do M.P.E.
    3. Retorna `(IntPtr)1` para suprimir o menu de contexto nativo do Windows no sistema subjacente.
  * **Descoberta e Transferência Entre Sistemas (`EnumWindows` + `ForceActivateWindow`):**
    * `--LIST-WINDOWS`: Enumera todas as janelas visíveis de aplicações abertas no Windows, retornando um JSON com `hwnd`, `process` e `title`.
    * `--DELIVER-TO-SYSTEM <targetQuery> <autoSend>`: Localiza a janela do **Sistema de Destino** pelo nome do processo ou título da janela, acopla a fila de entrada de threads Win32 (`AttachThreadInput`), restaura a janela caso minimizada (`ShowWindow(SW_RESTORE)`), força o foco (`SetForegroundWindow`), injeta `Ctrl + V` para colar o Print ou Texto capturado do sistema de origem e dispara `VK_RETURN` (`Enter`).

* **[`src/native/MpeLauncher.cs`](file:///c:/Projetos/MousePerformaticoEstrelado/src/native/MpeLauncher.cs)** $\rightarrow$ Compilado como **[`MPE.exe`](file:///c:/Projetos/MousePerformaticoEstrelado/MPE.exe)** na raiz:
  * Executável nativo Windows (`/target:winexe`) que inicia o sistema sem abrir janelas de console ou servidores locais.

---

### 3.2. Camada Principal de Orquestração (`src/main/`)

* **[`src/main/actionExecutor.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/main/actionExecutor.js)**:
  * **Captura de Janela de Sistema Específica (`captureScope: "active_window"`):** Usa as coordenadas `lastWindowRect` obtidas pelo `MpeHook.exe` via `GetWindowRect` multiplicadas pelo `scaleFactor` do monitor para recortar exatamente a janela do sistema onde o usuário estava trabalhando (ou a tela inteira / área selecionada).
  * **Transferência Automática Entre Sistemas (`dispatchToTargetSystem`):** Salva o Print no diretório configurado, grava o bitmap no Clipboard do Windows (`clipboard.writeImage`) e aciona o `MpeHook.exe --DELIVER-TO-SYSTEM` para entregar a imagem diretamente no sistema de destino configurado no ponto estelar.

* **[`src/main/configManager.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/main/configManager.js)**:
  * Sincroniza em tempo real o arquivo portátil **[`mpe.config.json`](file:///c:/Projetos/MousePerformaticoEstrelado/mpe.config.json)** na raiz do projeto com o arquivo local da máquina em `%APPDATA%`.

* **[`src/main/startupManager.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/main/startupManager.js)**:
  * Registra ou remove a chave `MPE_MousePerformaticoEstrelado` em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` apontando para `"MPE.exe" --startup`.

---

### 3.3. Camada de Renderização e Motor Matemático 3D (`src/renderer/`)

* **[`src/renderer/js/astrolabe3d.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/renderer/js/astrolabe3d.js)**:
  * Renderiza a geometria tridimensional do Astrolábio em Degradê Preto e Dourado:
    $$x_1 = x \cos(\text{tiltY}) - z \sin(\text{tiltY}), \quad z_1 = z \cos(\text{tiltY}) + x \sin(\text{tiltY})$$
    $$y_2 = y \cos(\text{tiltX}) - z_1 \sin(\text{tiltX}), \quad z_2 = z_1 \cos(\text{tiltX}) + y \cos(\text{tiltX})$$
    $$P(x, y, z) = \left( C_x + x_2 \cdot R \cdot \frac{f}{f + 0.55 z_2}, \; C_y + y_2 \cdot R \cdot \frac{f}{f + 0.55 z_2} \right)$$
  * Permite girar o círculo 3D lateralmente com física inercial e selecionar cada ponto salvo.
