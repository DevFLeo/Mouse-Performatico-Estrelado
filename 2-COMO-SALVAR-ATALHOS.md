# 2. Manual Completo: Como Salvar, Configurar e Migrar Atalhos (Pontos Estelares)

> **Repositório Oficial:** [https://github.com/DevFLeo/Mouse-Performatico-Estrelado](https://github.com/DevFLeo/Mouse-Performatico-Estrelado)  
> Este documento detalha passo a passo como criar novos pontos no Círculo 3D, configurar automações de integração entre sistemas no Windows (Print de um sistema e envio direto para outro sistema, Seleção de Texto, Print + Telegram com caminho salvo, Executáveis, Scripts) e migrar seus atalhos entre máquinas usando o JSON da raiz.

---

## 1. Como Invocar o M.P.E Sobre Qualquer Sistema do Windows

Enquanto estiver utilizando qualquer programa ou sistema no Windows (ERP, navegador, editor de código, planilha, jogo, documento):

1. Pressione simultaneamente:
   $$\mathbf{Shift + Ctrl + Alt + \text{Botão Direito do Mouse}}$$
   *(ou o atalho complementar de teclado `Ctrl + Shift + Alt + M`, ou clique no ícone do M.P.E na Bandeja do Sistema do Windows, ou execute `MPE.exe`).*
2. O M.P.E detecta automaticamente em qual sistema você estava trabalhando (exibindo no topo: `Sistema Detectado: [Nome do Sistema]`) e abre o **Astrolábio 3D** sobre a tela.
3. **Para movimentar o Círculo 3D para os lados:**
   * **Arraste com o botão esquerdo do mouse** para a esquerda ou direita para girar o círculo estelar com inércia física.
   * **Gire a roda do mouse (Scroll Wheel)** para rotacionar a órbita 3D lateralmente.
   * **Use as setas do teclado (`←` / `→`)** para girar com precisão.

---

## 2. Como Salvar um Novo Ponto (Comando Programado) Pela Interface Gráfica

1. Na barra superior do HUD, clique no botão **`+ Salvar Novo Ponto`** *(ou clique no ponto central `01 7 - Novo Ponto / Config`)*.
2. Na janela **Salvar Ponto Estelar no Círculo 3D**, preencha:
   * **Título do Atalho / Ponto:** O nome exibido abaixo do ponto no círculo 3D (ex: `Print ERP -> Sistema`, `Print + Telegram`, `Texto -> Outro Sistema`).
   * **Código Estelar:** A coordenada sci-fi exibida acima do anel dourado (ex: `10 7`, `12 4`, `08 9`).
   * **Tipo de Ação Performática:** Escolha a automação desejada (detalhada na Seção 3 abaixo).
   * **Posição no Círculo 3D:**
     * **Órbita (`1`, `2` ou `3`):** Define em qual anel concêntrico do astrolábio o ponto ficará (`1 = Interna`, `2 = Média`, `3 = Externa`).
     * **Ângulo (`0` a `360`):** Define a posição ao redor do círculo.
     * **Profundidade 3D (`-45` a `+45`):** Define a elevação no eixo $Z$.
   * **Cor do Vetor e Glifo:** Escolha entre linha vetorial **Dourado Imperial** (com halo duplo) ou **Azul Celestial** (com seta direcional) e o símbolo geométrico (`Π`, `Δ`, `h`, `C`).
3. Clique em **`Salvar Ponto no JSON`**. O ponto passa a integrar imediatamente o Círculo 3D.

> **Para Editar ou Excluir um Ponto Existente:**  
> Clique com o **Botão Direito do Mouse diretamente em cima de qualquer ponto** no círculo 3D (ou passe o mouse sobre ele e clique em `Editar` na barra inferior).

---

## 3. Como Configurar Cada Tipo de Ação e Integração Entre Sistemas

### 3.1. Print do Sistema Atual $\rightarrow$ Enviar para Outro Sistema (`system_to_system_print` e `area_print_system`)
Permite tirar o print do sistema que você está usando agora (apenas a janela ativa daquele sistema ou a tela inteira, ou ainda recortar uma área) e enviá-lo automaticamente para qualquer outro sistema aberto no Windows, com um único clique no M.P.E.

* **Como configurar:**
  1. Selecione **`Print do Sistema Atual -> Enviar para Outro Sistema (Win32)`** (ou **`Recorte de Sistema -> Enviar para Outro Sistema (Win32)`**).
  2. Em **Escopo da Captura no Sistema de Origem**, escolha:
     * **`Apenas a Janela do Sistema Ativo (HWND)`:** Recorta automaticamente apenas a janela do software onde você apertou o comando do M.P.E.
     * **`Tela Inteira do Monitor`:** Captura todo o monitor.
  3. Em **Pasta para Salvar o Print (Caminho Salvo)**, defina onde o arquivo `.png` será gravado (ex: `./Capturas_MPE`).
  4. Em **Sistema de Destino**, clique no botão **`Detectar`** para listar todos os sistemas abertos no seu Windows naquele momento e escolher um da lista, ou digite o nome da janela/processo de destino (ex: `Telegram`, `WhatsApp`, `Discord`, `Slack`, `Teams`, `Paint`, `Word`, `Notepad`).
  5. Quando você acionar esse ponto no Círculo 3D, o M.P.E captura a imagem do primeiro sistema, salva na pasta, ativa a janela do segundo sistema, cola a imagem (`Ctrl + V`) e dispara o envio (`Enter`) automaticamente.

### 3.2. Print + Envio para Conversa no Telegram com Caminho Salvo (`print_telegram` e `area_print_telegram`)
1. Selecione **`Print + Enviar para Conversa no Telegram (Caminho Salvo)`** (ou a versão de recorte de área).
2. Defina a **Pasta para Salvar o Print**.
3. Em **Conversa / Caminho do Telegram**, informe:
   * **Mensagens Salvas:** `tg://resolve?domain=me`
   * **Usuário ou Grupo:** `@nome_do_usuario` ou `https://t.me/nome_do_usuario`
   * **Telefone:** `tg://resolve?phone=5511999999999`
   * **Caminho local do executável:** `C:\Users\SeuUsuario\AppData\Roaming\Telegram Desktop\Telegram.exe`
4. *(Opcional)* No menu **`Configurar Cores e Sistema`**, se você preencher um `Bot Token` e `Chat ID`, o envio também pode ser realizado diretamente via HTTPS em segundo plano.

### 3.3. Seleção de Texto no Sistema Atual e Transferência Entre Sistemas (`text_selection`, `text_to_system`, `text_telegram`)
1. Deixe um texto selecionado em qualquer sistema aberto no Windows.
2. Acione o M.P.E (`Shift + Ctrl + Alt + Botão Direito`) e clique no ponto configurado.
3. O subsistema nativo do M.P.E extrai automaticamente o texto selecionado da janela de origem e pode abrir o painel de edição/transferência ou colá-lo e enviá-lo diretamente no sistema de destino configurado.

### 3.4. Abrir Pasta / Executável (`open_path`), Abrir URL (`open_url`) e Comando (`command`)
* **`open_path`:** Abre qualquer executável `.exe`, documento ou pasta do Windows.
* **`open_url`:** Abre qualquer endereço web no navegador padrão.
* **`command`:** Executa comandos ou scripts locais do sistema.

---

## 4. Como Salvar Diretamente no JSON (`mpe.config.json`) e Migrar Entre Máquinas

Todos os pontos ficam salvos no arquivo **[`mpe.config.json`](file:///c:/Projetos/MousePerformaticoEstrelado/mpe.config.json)** na raiz do projeto.

### Exemplo de estrutura de um ponto de integração entre sistemas em `mpe.config.json`:

```json
{
  "id": "star-cross-system-01",
  "code": "04 7",
  "title": "Print Sistema -> Sistema",
  "description": "Captura o print do sistema atual e transfere automaticamente para outro sistema aberto no Windows.",
  "actionType": "system_to_system_print",
  "orbit": 2,
  "angle": 358,
  "elevation": -14,
  "vectorStyle": "blue",
  "glyph": "",
  "hasArrow": true,
  "params": {
    "captureScope": "active_window",
    "saveDir": "./Capturas_MPE",
    "targetSystem": "Telegram",
    "autoSendEnter": true
  }
}
```

### Migração Automática para Outra Máquina:
* Ao copiar a pasta do projeto (ou o arquivo `mpe.config.json` da raiz) para outra máquina e abrir o **`MPE.exe`**, o sistema lê automaticamente todos os pontos já salvos, suas cores e seu nome cadastrado (`"Bem-vindo, [Seu Nome]"`), registrando a nova máquina na seção `machines` do JSON e em `%APPDATA%`.
