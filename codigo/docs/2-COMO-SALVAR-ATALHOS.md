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

---

## 4. Como Usar o Modo 2D (Base Original da Imagem) e Executar a Ação 2D

* **Alternância Instantânea 2D / 3D:**
  * No dock inferior direito (**`Modo 2D` | `Modo 3D` | `Acao 2D`**), clique em **`Modo 2D`** (ou pressione a tecla **`Tab`**, ou clique diretamente sobre o **Nexus Central** branco/dourado do Astrolábio) para alinhar o sistema exatamente na geometria plana 2D da imagem de referência, com varredura de radar animada, feixes de energia nos vetores e retículas giratórias.
* **Executar a Ação 2D:**
  * Clique no botão **`Acao 2D`** no dock (ou cadastre um ponto com o tipo `Acao 2D: Varredura Astrolabio 2D + Captura Instantanea`) para disparar a onda de choque 2D em todos os vetores, capturar instantaneamente o sistema ativo via GDI+ nativo (`MpeHook.exe --CAPTURE-NOW`), salvar em `./Capturas_MPE/MPE_Acao2D_*.png` e copiar para a Área de Transferência.
  * Todos os pontos estelares do mapa (`08 7`, `04 7`, `08 1`, `09 7`, `07 7`, `06 7`, `05 7`, `09 4`, `01 7`) funcionam integralmente tanto no **Modo 2D** quanto no **Modo 3D**.


---

## 5. Adicionar Pontos e Mudar Pontos de Lugar (Somente pelo MPE.exe)

> Edicao de pontos so funciona no Modo Editor (abrindo pelo icone `MPE.exe`). No modo atalho (`Shift + Ctrl + Alt + Botao Direito`) os botoes de edicao ficam ocultos.

### Adicionar um ponto novo
1. Clique em **`+ Adicionar Ponto`** (dock inferior direito) ou **`+ Salvar Novo Ponto`** (barra superior).
2. Aparece o aviso **ADICIONAR PONTO**. Um marcador ciano segue o mouse mostrando angulo e orbita.
3. **Clique no lugar do circulo** onde o ponto deve ficar.
4. O **Forjador de Estrelas** abre com a posicao ja preenchida. Escolha:
   - **Tipo de Acao** (Print, Print + Telegram, Recorte, Texto, Abrir Pasta, URL, Comando, Acao 2D, Alternar 2D/3D).
   - **Destino** (padrao: `Eu | Você | Leonardo`).
   - Titulo, codigo, cor do vetor e glifo.
5. Clique em **`Salvar Ponto no JSON`**. O ponto aparece no circulo na hora e fica salvo em `mpe.config.json`.

### Ajustar a posicao dentro do Forjador
- **Mini-mapa circular**: clique ou arraste o marcador ciano. Os pontos dourados sao os pontos que ja existem.
- **`Escolher Clicando no Circulo Grande`**: fecha o Forjador por um momento, voce clica no circulo e ele volta com a nova posicao.
- Tambem da para digitar **Orbita**, **Angulo (0-360)** e **Profundidade 3D** direto nos campos.

### Mudar pontos que ja existem de lugar
- Clique em **`Mover Pontos`** (dock ou barra superior). O botao fica ciano.
- **Arraste qualquer estrela** para o novo lugar. Ao soltar, a posicao e salva automaticamente.
- Atalho sem ativar o modo: segure **Shift** e arraste uma estrela.
- Para sair: clique em **`Concluir / Voltar`**, clique de novo em **`Mover Pontos`** ou aperte **ESC**.

### Editar ou excluir um ponto
- **Clique direito** sobre a estrela (sem arrastar) abre o Forjador daquele ponto, com o botao **`Excluir Ponto`**.
