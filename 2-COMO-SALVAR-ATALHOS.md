# 2. Manual Completo: Como Salvar, Configurar e Migrar Atalhos (Pontos Estelares)

> **Repositório Oficial:** [https://github.com/DevFLeo/Mouse-Performatico-Estrelado](https://github.com/DevFLeo/Mouse-Performatico-Estrelado)  
> Este documento detalha passo a passo como criar novos pontos no Círculo 3D, configurar automações (Print, Seleção de Texto, Print + Telegram com caminho salvo, Executáveis, Scripts) e migrar seus atalhos entre máquinas usando o JSON da raiz.

---

## 1. Como Invocar o M.P.E a Qualquer Momento

Com o M.P.E aberto ou em execução silenciosa na Bandeja do Sistema (System Tray):

1. Pressione simultaneamente:
   $$\mathbf{Shift + Ctrl + Alt + \text{Botão Direito do Mouse}}$$
   *(ou o atalho complementar de teclado `Ctrl + Shift + Alt + M`, ou clique no ícone dourado do M.P.E perto do relógio do Windows, ou execute `MPE.exe`).*
2. O **Astrolábio 3D** surgirá instantaneamente sobre a sua tela.
3. **Para movimentar o Círculo 3D para os lados:**
   * **Arraste com o botão esquerdo do mouse** para a esquerda ou direita para girar o círculo estelar com inércia física.
   * **Gire a roda do mouse (Scroll Wheel)** para rotacionar a órbita 3D lateralmente.
   * **Use as setas do teclado (`←` / `→`)** para girar com precisão.

---

## 2. Como Salvar um Novo Ponto (Atalho) Pela Interface Gráfica

1. Na barra superior do HUD, clique no botão dourado **`+ Salvar Novo Ponto`** *(ou clique na estrela central `01 7 - Novo Ponto / Config`)*.
2. A janela **Forjador de Estrelas** será aberta. Preencha os campos:
   * **Título do Atalho / Ponto:** O nome que aparecerá abaixo da estrela no círculo 3D (ex: `Print + Telegram Equipe`, `Abrir VS Code`, `Texto p/ Telegram`).
   * **Código Estelar:** A coordenada sci-fi exibida acima do anel dourado (ex: `10 7`, `12 4`, `08 9`), mantendo a estética idêntica à imagem original.
   * **Tipo de Ação Performática:** Escolha uma das 9 automações nativas (detalhadas na Seção 3 abaixo).
   * **Posição no Círculo 3D:**
     * **Órbita (`1`, `2` ou `3`):** Define em qual anel concêntrico do astrolábio o ponto ficará (`1 = Interna`, `2 = Média`, `3 = Externa`).
     * **Ângulo (`0°` a `360°`):** Define a posição ao redor do círculo.
     * **Profundidade 3D (`-45` a `+45`):** Define a elevação no eixo $Z$ (faz o ponto flutuar mais à frente ou mais ao fundo quando você gira o círculo 3D para os lados).
   * **Cor do Vetor e Glifo:** Escolha entre linha vetorial **Dourado Imperial** (com halo duplo) ou **Azul Celestial** (com seta direcional `▲`) e o símbolo geométrico (`Π`, `Δ`, `h`, `C`).
3. Clique em **`💾 Salvar Ponto no JSON`**. O ponto aparece imediatamente no Círculo 3D e já está salvo de forma permanente!

> **Dica Rápida para Editar ou Excluir um Ponto Existente:**  
> Basta clicar com o **Botão Direito do Mouse diretamente em cima de qualquer estrela** no círculo 3D (ou passar o mouse sobre ela e clicar em `✎ Editar` na barra inferior).

---

## 3. Como Configurar Cada Tipo de Ação Especial

### 3.1. 📸 Print + Envio para Conversa no Telegram com Caminho Salvo
Permite tirar um print da tela inteira (`print_telegram`) ou selecionar um recorte retangular (`area_print_telegram`), salvar automaticamente o arquivo `.png` na sua pasta escolhida e enviá-lo direto para uma conversa específica do Telegram.

* **Como configurar:**
  1. Selecione **`📸 Print Tela Inteira + Enviar p/ Conversa no Telegram`** (ou **`✂️ Selecionar Área (Print) + Enviar p/ Conversa no Telegram`**).
  2. Em **Pasta para Salvar o Print (Caminho Salvo)**, clique em `Pasta...` para escolher qualquer diretório da sua máquina (ex: `C:\Users\SeuUsuario\Pictures\Prints_MPE` ou mantenha `./Capturas_MPE` para salvar dentro da pasta do projeto).
  3. Em **Conversa / Caminho do Telegram**, você pode informar qualquer um dos formatos abaixo:
     * **Mensagens Salvas (Saved Messages do próprio Telegram):** `tg://resolve?domain=me`
     * **Nome de usuário de um contato ou grupo:** `@nome_do_usuario` ou `https://t.me/nome_do_usuario`
     * **Telefone do contato:** `tg://resolve?phone=5511999999999`
     * **Caminho do executável local do Telegram:** `C:\Users\SeuUsuario\AppData\Roaming\Telegram Desktop\Telegram.exe`
  4. *(Opcional — Envio Silencioso via Bot API)*: No menu **`⚙ Configurar & Cores`**, se você preencher um `Bot Token` e `Chat ID`, o M.P.E enviará a imagem diretamente em background via HTTPS sem nem precisar tirar o foco da sua tela! Caso não preencha o Bot Token, o M.P.E copia a imagem para a Área de Transferência, abre automaticamente a conversa salva no seu Telegram Desktop e cola/envia a imagem para você.

### 3.2. 🖼️ Print Instantâneo ou 📐 Recorte de Área
* **`Print Instantâneo` (`print`):** Oculta o HUD em milissegundos, captura a tela inteira na resolução nativa do monitor, salva o arquivo `.png` com data/hora na pasta configurada e copia a imagem para o seu `Ctrl + V` (Clipboard).
* **`Recorte de Área` (`area_print`):** Congela a tela e permite desenhar um retângulo dourado sobre a região exata que você deseja recortar. Ao soltar o mouse, salva o recorte na pasta configurada e copia para a Área de Transferência.

### 3.3. 📝 Seleção de Texto Inteligente e 💬 Texto $\rightarrow$ Telegram
* **Como funciona:**
  1. Enquanto estiver lendo um PDF, navegador ou editor de código, basta deixar um trecho de texto grifado/selecionado.
  2. Acione o M.P.E (`Shift + Ctrl + Alt + Botão Direito`) e clique na estrela **`Seleção de Texto`** (`08 1`) ou **`Texto → Telegram`** (`07 7`).
  3. O daemon nativo do M.P.E captura automaticamente o texto que estava selecionado na janela anterior:
     * Na opção **Seleção de Texto**, abre o painel rápido onde você pode editar o texto, copiar ou disparar para o Telegram.
     * Na opção **Texto → Telegram**, envia o trecho selecionado diretamente para a conversa salva no Telegram.

### 3.4. 📁 Abrir Pasta / Executável, 🌐 Abrir URL e ⚡ Comando
* **`Abrir Pasta / Aplicativo` (`open_path`):** Clique em `Arquivo...` para selecionar qualquer `.exe`, documento, projeto ou diretório do Windows.
* **`Abrir Site / URL` (`open_url`):** Abre instantaneamente qualquer endereço web no navegador padrão.
* **`Executar Comando` (`command`):** Dispara scripts PowerShell, `.bat`, comandos `code .`, `calc.exe`, etc.

---

## 4. Como Salvar ou Editar Diretamente no JSON (`mpe.config.json`) e Migrar de Máquina

Todos os atalhos ficam salvos de forma legível e portátil no arquivo **[`mpe.config.json`](file:///c:/Projetos/MousePerformaticoEstrelado/mpe.config.json)** na raiz do projeto.

### Exemplo de estrutura de um ponto salvo dentro de `mpe.config.json`:

```json
{
  "id": "star-custom-01",
  "code": "11 7",
  "title": "Print + Telegram Dev",
  "description": "Salva print na pasta de projetos e envia para o grupo de desenvolvimento",
  "actionType": "print_telegram",
  "orbit": 3,
  "angle": 140,
  "elevation": 20,
  "vectorStyle": "gold",
  "glyph": "Π",
  "hasArrow": false,
  "params": {
    "captureMode": "fullscreen",
    "saveDir": "./Capturas_MPE",
    "telegramTarget": "@meu_grupo_dev",
    "copyToClipboard": true
  }
}
```

### Como Migrar para Outra Máquina sem Perder Nada:
1. O M.P.E utiliza **Persistência Híbrida**:
   * **Configurações por Máquina:** Ficam registradas em `machines["NOME-DO-PC"]` e em `%APPDATA%`, guardando preferências locais como o status de inicialização do Windows daquela máquina.
   * **Atalhos, Cadastro e Cores Portáteis:** Ficam na raiz em `mpe.config.json`.
2. Quando você for para outro computador (ou fizer `git clone` / copiar a pasta do projeto com o seu `mpe.config.json`), basta abrir o **`MPE.exe`**: ele lerá automaticamente o `mpe.config.json` da raiz, reconhecerá seu nome de cadastro (`"Bem-vindo, [Seu Nome]"`), suas cores do degradê Preto & Dourado e todas as suas estrelas salvas!
