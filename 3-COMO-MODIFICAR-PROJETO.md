# 3. Guia de Engenharia: Como Modificar, Estender e Alterar o Projeto M.P.E

> **Repositório Oficial:** [https://github.com/DevFLeo/Mouse-Performatico-Estrelado](https://github.com/DevFLeo/Mouse-Performatico-Estrelado)  
> Este guia foi elaborado para que qualquer desenvolvedor ou engenheiro possa modificar facilmente a geometria 3D, criar novos tipos de automação, alterar o gatilho global de mouse/teclado ou recompilar os executáveis nativos `.exe`.

---

## 1. Como Executar e Recompilar o Projeto

### 1.1. Executar diretamento pelo Executável Nativo
* Basta dar **duplo clique em [`MPE.exe`](file:///c:/Projetos/MousePerformaticoEstrelado/MPE.exe)** na raiz do projeto.

### 1.2. Executar em Modo de Desenvolvimento
No terminal PowerShell na raiz do projeto (`c:\Projetos\MousePerformaticoEstrelado`):
```powershell
npm start
```

### 1.3. Recompilar os Binários Nativos (`MPE.exe` e `MpeHook.exe`)
Sempre que você alterar os arquivos C# em `src/native/MpeHook.cs` ou `src/native/MpeLauncher.cs` (ou o gerador de ícones), execute:
```powershell
npm run build:native
```
> **Nota Técnica:** O script [`scripts/build-native.ps1`](file:///c:/Projetos/MousePerformaticoEstrelado/scripts/build-native.ps1) utiliza o compilador nativo do Windows (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`), presente nativamente em todas as instalações do Windows 10 e Windows 11, sem exigir instalação pesada do Visual Studio.

---

## 2. Como Alterar o Gatilho Global (`Shift + Ctrl + Alt + Botão Direito`)

O gatilho global é processado em **[`src/native/MpeHook.cs`](file:///c:/Projetos/MousePerformaticoEstrelado/src/native/MpeHook.cs)** dentro do método `HookCallback`:

```csharp
if (msg == WM_RBUTTONDOWN)
{
    bool shift = IsKeyDown(VK_SHIFT);
    bool ctrl = IsKeyDown(VK_CONTROL);
    bool alt = IsKeyDown(VK_MENU);

    if (shift && ctrl && alt)
    {
        // Emite TRIGGER_HUD para o processo principal
    }
}
```

* **Para alterar para o Botão do Meio do Mouse (Scroll Click):**
  Substitua `WM_RBUTTONDOWN` (`0x0204`) por `WM_MBUTTONDOWN` (`0x0207`).
* **Para exigir apenas `Ctrl + Alt + Botão Direito`:**
  Altere a condição para `if (ctrl && alt)` e execute `npm run build:native`.
* **Para alterar o atalho complementar de teclado:**
  Edite a propriedade `"fallbackKeyboardShortcut"` no arquivo [`mpe.config.json`](file:///c:/Projetos/MousePerformaticoEstrelado/mpe.config.json) (ex: `"CommandOrControl+Shift+Space"`).

---

## 3. Como Criar um Novo Tipo de Ação para os Pontos Estelares

Para adicionar uma nova automação (por exemplo, `"enviar_discord"` ou `"gravar_audio"`), siga estes 3 passos simples:

### Passo 1: Adicionar o executor em [`src/main/actionExecutor.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/main/actionExecutor.js)
Dentro do `switch (type)` do método `executePoint(point, mainWindow)`, adicione um novo `case`:
```javascript
case 'minha_nova_acao': {
  // Sua lógica Node.js / Win32 aqui
  return {
    ok: true,
    type: 'minha_nova_acao',
    message: 'Minha nova ação performática foi executada com sucesso!'
  };
}
```

### Passo 2: Adicionar a opção no seletor HTML em [`src/renderer/index.html`](file:///c:/Projetos/MousePerformaticoEstrelado/src/renderer/index.html)
Localize o `<select id="pt-action-type">` no modal Forjador de Estrelas e insira:
```html
<option value="minha_nova_acao">🚀 Minha Nova Ação Personalizada</option>
```

### Passo 3: Mapear campos extras (se necessário) em [`src/renderer/js/app.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/renderer/js/app.js)
Na função `updatePointModalFields()`, defina quais campos de formulário devem ser exibidos quando `minha_nova_acao` for selecionada.

---

## 4. Como Modificar o Motor 3D e os Anéis do Astrolábio

Toda a geometria 3D, física de rotação circular lateral e renderização de vetores estão encapsuladas em **[`src/renderer/js/astrolabe3d.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/renderer/js/astrolabe3d.js)**:

1. **Adicionar ou Modificar Órbitas 3D:**
   No método `render()`, chamadas a `this.draw3DRing(...)` desenham cada anel no espaço tridimensional:
   ```javascript
   this.draw3DRing(
     ctx,
     0.78,   // Raio normalizado (0.0 a 1.0)
     -0.02,  // Excentricidade X (deslocamento do centro)
     -0.01,  // Excentricidade Y
     0.06,   // Profundidade Z
     0.14,   // Inclinação 3D no eixo X (radianos)
     -0.08,  // Inclinação 3D no eixo Y (radianos)
     this.theme.goldPrimary,
     1.75,   // Espessura da linha
     140     // Resolução poligonal
   );
   ```
2. **Ajustar a Física de Rotação Lateral (Inércia do Círculo):**
   No método `animate()`, a variável `this.wheelVelocity` controla a velocidade angular e o amortecimento (`0.94` quando o giro automático está desligado).
3. **Alterar a Perspectiva 3D (Campo de Visão / FOV):**
   No método `project3D(x, y, z, radiusBase)`, altere a constante `const fov = 2.9;` (valores menores aumentam o efeito de profundidade dramática 3D; valores maiores tornam a projeção mais ortográfica).

---

## 5. Como Modificar Cores, Degradês e os Tons de Linguagem

### 5.1. Criar Novos Presets de Degradê (Preto & Dourado ou Outras Paletas)
Em **[`src/renderer/js/app.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/renderer/js/app.js)**, localize o objeto `THEME_PRESETS` para adicionar ou modificar paletas de cores, ou altere diretamente pela interface gráfica clicando em **`⚙ Configurar & Cores`**.

### 5.2. Editar Frases da Tela de Inicialização e os 3 Modos de Linguagem
Em **[`src/renderer/js/i18n-tones.js`](file:///c:/Projetos/MousePerformaticoEstrelado/src/renderer/js/i18n-tones.js)**, você encontra o dicionário completo dos 3 modos:
* `window.MPE_TONES.amigavel`
* `window.MPE_TONES.neutra`
* `window.MPE_TONES.profissional`

Para alterar o texto da animação inicial (`"M . P . E  Inicializando"` ou `"Bem-vindo, ${name}"`), basta editar as chaves `splashInit` e `splashWelcome` naquele arquivo.
