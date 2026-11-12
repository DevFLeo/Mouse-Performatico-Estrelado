# M.P.E — Mouse Performático Estrelado (3D Astrolabe HUD para Windows)

> **Repositório Oficial:** [https://github.com/DevFLeo/Mouse-Performatico-Estrelado](https://github.com/DevFLeo/Mouse-Performatico-Estrelado)  
> **Gatilho Global Nativo:** `Shift + Ctrl + Alt + Botão Direito do Mouse`  
> **Executável Principal:** `MPE.exe` (Aplicativo Nativo Windows • Zero `localhost` • Ponte Entre Sistemas Win32 • Iniciar com o Windows • JSON Portátil na Raiz)

![Referencia Astrolabio M.P.E](assets/reference-astrolabe.jpg)

---

## O que é o M.P.E?

O **M.P.E (Mouse Performático Estrelado)** é um aplicativo executável para Windows que opera como um subsistema de integração direta entre aplicações. Ao pressionar **`Shift + Ctrl + Alt + Botão Direito do Mouse`** sobre qualquer programa aberto, o sistema apresenta um **Astrolábio Orbital 3D Interativo** em **Degradê Preto e Dourado**.

* **Integração Direta Entre Sistemas do Windows:** Permite capturar prints ou textos selecionados de um sistema aberto (apenas a janela ativa daquele sistema, área recortada ou tela inteira) e enviar automaticamente para outro sistema aberto no Windows (Telegram, WhatsApp, Discord, Slack, Teams, editores, ERPs) com um único comando programado.
* **Círculo 3D Interativo:** Movimente o círculo para os lados arrastando o mouse, usando o Scroll ou as setas do teclado, com inclinação de perspectiva 3D e física inercial.
* **Pontos Estelares Configuráveis:** Cada ponto do mapa (`08 7`, `04 7`, `08 1`, `09 7`...) é um comando programado salvo por você. Adicione, edite ou exclua pontos a qualquer momento.
* **Tela de Inicialização Cinematográfica:** Exibe **`"M . P . E   Inicializando"`** seguido de **`"Bem-vindo, [Nome definido no cadastro e salvo no JSON]"`**.
* **3 Modos de Linguagem em Tempo Real:**
  1. **Amigável** (Calorosa e próxima)
  2. **Neutra (Interpessoal)** (Inclusiva e equilibrada)
  3. **Profissional** (Executiva e técnica)
* **Portabilidade Inteligente:** Salva configurações por máquina (`%APPDATA%` + ID da máquina) e sincroniza tudo no arquivo **`mpe.config.json`** na raiz do projeto para migração imediata entre computadores.

---

## Documentação Técnica Detalhada (Os 3 Markdowns Principais + Pitch)

1. **[1-SISTEMA-ARQUITETURA.md](1-SISTEMA-ARQUITETURA.md)** — Detalhamento técnico profundo do que cada pasta, binário Win32 (`MpeHook.exe`, `MPE.exe`), ponte entre sistemas (`EnumWindows`, `AttachThreadInput`), pipeline IPC e cálculo de projeção 3D significa.
2. **[2-COMO-SALVAR-ATALHOS.md](2-COMO-SALVAR-ATALHOS.md)** — Guia completo passo a passo de como criar, editar e salvar novos pontos estelares, configurar transferência de Print de um sistema para outro, Seleção de Texto, Telegram e migrar entre máquinas via JSON.
3. **[3-COMO-MODIFICAR-PROJETO.md](3-COMO-MODIFICAR-PROJETO.md)** — Guia de engenharia sobre como modificar ou alterar o projeto, adicionar novas ações, customizar o motor 3D e recompilar os executáveis nativos.
4. **[PITCH.md](PITCH.md)** — O Pitch Executivo, Comercial e Técnico do M.P.E.

---

## Como Executar no Windows

1. **Pelo Executável Nativo (`MPE.exe`):**
   Dê duplo clique diretamente em **`MPE.exe`** na raiz do projeto (`c:\Projetos\MousePerformaticoEstrelado\MPE.exe`).
2. **Para acionar o Astrolábio 3D sobre qualquer sistema:**
   Pressione **`Shift + Ctrl + Alt + Botão Direito do Mouse`** (ou `Ctrl + Shift + Alt + M`, ou clique no ícone do M.P.E na Bandeja do Sistema do Windows).
