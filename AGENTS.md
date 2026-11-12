# Diretrizes de Engenharia e Design do M.P.E (Mouse Performatico Estrelado)

## 1. Invariantes de Estilo e Comunicacao
- Proibicao estrita de emojis em qualquer arquivo de codigo, logs, interfaces visuais (HTML/CSS/JS) ou mensagens de console.
- Textos da interface (HUD, tooltips, modais e banners) devem ser concisos, diretos e objetivos, sem explicacoes redundantes ou porcentagens duplicadas.

## 2. Identidade Nativa no Windows e Barra de Tarefas
- Chamar explicitamente `app.setAppUserModelId('DevFLeo.MousePerformaticoEstrelado')` de forma sincrona no topo de `main.js` antes de criar janelas.
- Garantir a presenca de um atalho oficial `.lnk` em `%APPDATA%\Microsoft\Windows\Start Menu\Programs\`, apontando para `MPE.exe` com `assets/icon.ico`. Isso garante que ao fixar o aplicativo na Barra de Tarefas, o Windows mantenha o icone dourado do M.P.E em vez do icone generico do Electron.

## 3. Foco Nativo Win32 e Captura de Texto Entre Janelas
- Processos em segundo plano do Windows sofrem bloqueio de foco (`LockSetForegroundWindow`). Para ativar confiavelmente a janela do sistema de origem antes de enviar `Ctrl+C` ou `Ctrl+V`, execute a simulacao do pulso da tecla `Alt` (`VK_MENU`), seguida de `AttachThreadInput` e `SetForegroundWindow`.
- Sempre desarmar modificadores (`Shift`, `Menu/Alt`, `Control`) com `KEYEVENTF_KEYUP` antes de despachar combinacoes de teclas.
- Manter rastreamento continuo da janela ativa via `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` para garantir que o identificador da janela (`HWND`) nunca fique zerado.

## 4. Integracao Proativa com Sistemas de Destino
- Ao transferir texto ou prints para um sistema (ex: "Bloco de Notas", "Telegram", "Paint", "Word"), se a janela nao estiver aberta no momento, o executor deve disparar o executavel correspondente e aguardar via polling a janela surgir para colar o conteudo, em vez de falhar silenciosamente.

## 5. Roteamento de Atalhos Duplos de Mouse no Hook Win32
- Diferenciar no hook de mouse de baixo nivel (`WH_MOUSE_LL`):
  - `Shift + Ctrl + Alt + Botao Direito`: Convocacao do Astrolabio Circular 3D/2D com pulso estelar de abertura reforçado.
  - `Shift + Ctrl + Botao Direito` (sem Alt): Convocacao do Mini Assistente Flutuante (Lower Third Sci-Fi).
- Ambos devem emitir identificadores distintos (`TRIGGER_HUD|` e `TRIGGER_MINI|`) com captura previa de janela e coordenadas `(x, y)` sem lag.

## 6. Mini Assistente Flutuante (Lower Third Sci-Fi) e I.A Local
- Layout inspirado em lower thirds holograficos: no circular esquerdo com ECG/telemetria animada + capsula chanfrada horizontal.
- Garantia de persistencia visual: a janela e o widget permanecem sobrepostos na tela mesmo apos interacao ou digitacao, fechando exclusivamente quando o usuario apertar a tecla ESC (`mpe:escape-pressed`) ou o botao fechar.
- I.A Local Offline com motor embutido de regras gramaticais (~2ms de latencia) e suporte opcional a Ollama / LM Studio.
- Gravacao direta em Markdown (`.md`) no cofre do Obsidian com metadados YAML (`title`, `date`, `folder`, `tags`, `source`).
