# Relatorio Geral e Tabela de Testes - M.P.E (Mouse Performatico Estrelado)

Data da execucao: 2026-11-12
Ambiente verificado: Windows 11 x64 (`DESKTOP-LTO8K3P`), Node.js v24.16.0, Electron v35.0.0, Mozilla `llamafile v0.10.6`, modelo `Qwen2.5-7B-Instruct-Q4_K_M.gguf` (4,70 GB totais em `codigo/models/`).

## 1. Resumo Executivo

| Suite | Modulo Testado | Comando / Executor | Total | Aprovados | Reprovados | Tempo Total |
| :--- | :--- | :--- | ---: | ---: | ---: | ---: |
| Suite A | Configuracoes, Migracoes e Estado Padrao | `npm test` (`codigo/scripts/run-tests.js`) | 3 | 3 | 0 | 22 ms |
| Suite B | Motor de I.A Local (`llamafile` + `LocalAiService` + `/boost` + `/` + Retry) | `npm test` (`codigo/scripts/run-tests.js`) | 9 | 9 | 0 | ~83,8 s |
| Suite C | Organizador de Arquivos e Undo (`FileOrganizer`) | `npm test` (`codigo/scripts/run-tests.js`) | 3 | 3 | 0 | 90 ms |
| Suite D | Motor de Execucao e Rotinas (`ActionExecutor`) | `npm test` (`codigo/scripts/run-tests.js`) | 2 | 2 | 0 | 371 ms |
| Suite E | Integridade Estatica, Binarios, AUMID e Regras `AGENTS.md` | `npm test` (`codigo/scripts/run-tests.js`) | 4 | 4 | 0 | 3.274 ms |
| Suite F | Fluxo E2E Electron, HUD, Guia `/boost`, Chat e Organizador | `npx electron . --self-test --user-data-dir=...` | 11 | 11 | 0 | ~9.100 ms |
| **TOTAL** | **Cobertura Completa do Sistema M.P.E** | **`npm test` + Electron `--self-test`** | **32** | **32** | **0** | **~96,7 s** |

---

## 2. Tabela Detalhada de Testes (Suites A - E: Node / Integracao / I.A Local)

| ID | Suite | Caso de Teste | Resultado Esperado | Resultado Obtido (Medido) | Tempo | Status |
| :--- | :--- | :--- | :--- | :--- | ---: | :--- |
| `CFG-01` | Config & Migracoes | Astrolabio definido como tela inicial padrao | `lastActiveTab = "astrolabe"` e `rememberWindowState = false` | `lastActiveTab=astrolabe, rememberWindowState=false` | 0 ms | PASS |
| `CFG-02` | Config & Migracoes | Migracao automatica de porta `8080` e provider `builtin` legado | Converter `builtin -> auto`, `8080 -> 18080` e injetar estrela `open_organizer` | `provider=auto, port=18080, estrelaOrganizador=true` | 11 ms | PASS |
| `CFG-03` | Config & Migracoes | Estrela "Organizar Arquivos" presente na configuracao ativa | Ponto `open_organizer` visivel no anel do Astrolabio | `id=star-02-7, code=02 7, title=Organizar Arquivos, orbit=3, angle=72` | 1 ms | PASS |
| `AI-01` | I.A Local (`llamafile`) | Binario `llamafile.exe` e modelo GGUF presentes e <= 15 GB | Detectar par `llamafile.exe` + `.gguf` com disco total <= 15 GB | `Qwen2.5-7B-Instruct-Q4_K_M.gguf + llamafile.exe (4.70 GB <= 15 GB)` | 2 ms | PASS |
| `AI-02` | I.A Local (`llamafile`) | `ping()` rejeita HTML 404 (protecao contra Apache/IIS na porta) | Retornar `fail` para HTTP 404 com corpo HTML | `Porta mock 52649 (HTML 404) rejeitada como 'fail'` | 23 ms | PASS |
| `AI-03` | I.A Local (`llamafile`) | `findFreePort()` ignora porta ocupada e escolhe porta livre | Evitar porta bloqueada e retornar porta disponivel verificada | `Ocupada=52651 -> Livre escolhida=18080` | 5 ms | PASS |
| `AI-04` | I.A Local (`llamafile`) | `cleanModelOutput()` remove blocos `<think>...</think>` | Remover blocos de raciocinio mantendo resposta limpa | `Output limpo: "Resposta final objetiva."` | 0 ms | PASS |
| `AI-05` | I.A Local (`llamafile`) | Comandos slash (`/ajuda`, `/status`), revisao offline e Obsidian | `/ajuda` retorna comandos; revisao < 50ms; pasta Obsidian classificada | `Help OK, Revisao="Este e um texto de teste sem ponto.", ObsidianFolder=Reunioes` | 2 ms | PASS |
| `AI-06` | I.A Local (`llamafile`) | Inferencia LLM real em `/v1/chat/completions` (`Qwen2.5-7B-Instruct`) | Subir `llamafile.exe`, responder `"do que a agua e feita?"` com `source=llm` | `source=llm, modelo=Qwen2.5-7B-Instruct-Q4_K_M.gguf, resposta="A agua e feita de oxigenio e hidrogenio."` | 83.042 ms | PASS |
| `AI-07` | I.A Local (`llamafile`) | Calculo de memoria/velocidade, 4 kits minimos e comando `/boost` | Validar modos `eco`/`balanced`/`turbo`, `stopAsync()`, RAM sistema e `lastLoadMs === 0` sem carga | `eco(ctx=2048), turbo(threads=6/12), kits=4, RAM=15.63GB` | 51 ms | PASS |
| `AI-08` | I.A Local (`llamafile`) | Roteador de comandos `/` (aliases, fuzzy Damerau-Levenshtein, `/status termo`, `/revise` doc e `/organizar`) | Corrigir `/ajud` e `/stauts`, buscar termo em `/status`, resolver doc em `/revise`, abrir organizador e definir `/tom` | `Aliases, fuzzy (/ajud, /stauts), /status termo, /revise referencia doc, /buscar, /organizar e /tom validados` | 63 ms | PASS |
| `AI-09` | I.A Local (`llamafile`) | Parametros de resposta (`top_p`, `repeat_penalty`, `/perfil`) + retry HTTP 503 sem fallback indevido | Aplicar `/param perfil criativo`, alias `repeticao`, retentar 503 -> 200 e enviar `top_p=0.95`, `repeat_penalty=1.18`, `max_tokens=1400`, tom `neutra` | `Retry 503->200 OK, payload top_p=0.95, repeat_penalty=1.18, max_tokens=1400` | 507 ms | PASS |
| `ORG-01` | Organizador de Arquivos | Organizacao por Tipo (Extensao) e renomeacao de duplicatas | Separar `.pdf`, `.png`, `.js` em categorias e renomear conflito | `3 categorias ok, conflito renomeado para contrato (2).pdf` | 35 ms | PASS |
| `ORG-02` | Organizador de Arquivos | Criterios Data, Nome (A-Z), Tamanho e busca textual em conteudo | Categorias corretas e busca encontrando termo dentro de `.txt` | `Criterios Date/Name/Size ok, searchScope encontrou 1 arquivo (matchType=content)` | 31 ms | PASS |
| `ORG-03` | Organizador de Arquivos | Mover arquivos, Desfazer (`revertLastBatch`), anti-auto-organizacao e traversal | Bloquear `codigo/` e `../`, mover e restaurar `nota.md` no Undo | `Protecao codigo/ e traversal ativos, move+undo restaurou nota.md corretamente` | 24 ms | PASS |
| `EXE-01` | Motor de Acoes | `open_organizer`, `organize_files_quick` e `open_url` (auto-HTTPS) | Retornar escopo/criterio corretos e normalizar URL sem protocolo | `open_organizer(prints), organize_files_quick(date), open_url(https://github.com)` | 2 ms | PASS |
| `EXE-02` | Motor de Acoes | Rotina sequencial `macro_sequence` e aliases amigaveis de `open_path` | Resolver alias `downloads`, ignorar recursao de macro e rodar etapas | `Alias downloads -> "C:\Users\ASUS\Downloads", macro executou 2 etapas validas sem loop` | 369 ms | PASS |
| `SYS-01` | Integridade & `AGENTS.md` | Verificacao de sintaxe Node (`node -c`) em todos os JS | Zero erros de sintaxe em `codigo/src/**` | `18 arquivos JS validados com node -c` | 3.252 ms | PASS |
| `SYS-02` | Integridade & `AGENTS.md` | Auditoria estrita de zero emojis no codigo e config | Zero caracteres `Extended_Pictographic` em 22 arquivos | `22 arquivos auditados com 0 emojis` | 19 ms | PASS |
| `SYS-03` | Integridade & `AGENTS.md` | `AppUserModelId`, `setAppDetails`, `IPropertyStore` e binarios Win32 | `DevFLeo.MousePerformaticoEstrelado`, `RelaunchCommand`, `.lnk` com AUMID + `.exe`/`.ico` | `AUMID + setAppDetails + IPropertyStore .lnk configurados; MPE.exe, MpeHook.exe e icon.ico presentes` | 1 ms | PASS |
| `SYS-04` | Integridade & `AGENTS.md` | Integridade do DOM do assistente interativo, topbar, guia `/boost`, `#side-ai-preset` e dock | Presenca de todos os 24 IDs obrigatorios em `index.html` | `Todos os 24 IDs estruturais, guia /boost e assistente presentes` | 2 ms | PASS |

---

## 3. Tabela Detalhada de Testes (Suite F: Electron E2E Visual & UI `--self-test`)

| ID | Etapa E2E (`main.js`) | Verificacao Executada | Resultado Observado / Evidencia | Status |
| :--- | :--- | :--- | :--- | :--- |
| `E2E-01` | Tela Inicial (`Splash Init`) | Renderizacao da tela de inicializacao e barra de progresso 0% -> 100% | Captura `prints/Verificacao/verify_1_init.png` sem erros de console | PASS |
| `E2E-02` | Boas-vindas (`Welcome`) | Transicao para fase de boas-vindas com identificacao do operador | Captura `prints/Verificacao/verify_2_welcome.png` valida | PASS |
| `E2E-03` | Astrolabio 3D Padrao | Abertura inicial obrigatoria na aba `Astrolabio`, estrelas e nova topbar | Estrela `02 7 ORGANIZAR ARQUIVOS` e botoes com icones SVG nitidos (`verify_3_astrolabe3d.png`) | PASS |
| `E2E-04` | Astrolabio 2D + Acao 2D | Alternancia 3D <-> 2D e execucao da Acao 2D no HUD | Modo `2D WIN32` ativo e dock atualizado (`verify_4_astrolabe2d.png`) | PASS |
| `E2E-05` | Assistente Interativo (`+ Automacao`) | Fluxo clicar no dock -> clicar no anel -> abrir wizard em 3 passos | `{"modalOpen":true,"angle":"56","orbit":"2"}` e wizard limpo (`verify_5_add_point.png`) | PASS |
| `E2E-06` | Modo Mover Pontos | Ativacao do modo arrastar estrelas com banner superior e conclusao | Banner ativo sem sobrepor o HUD (`verify_6_move_points.png`) | PASS |
| `E2E-07` | Modal Selecao de Texto | Abertura do modal com texto capturado e destino "Bloco de Notas" | Campos populados e botoes de transferencia prontos (`verify_7_text_selection.png`) | PASS |
| `E2E-08` | Mini Assistente AI Kataros | Revisao local offline e envio de nota para o Obsidian com mascot 3D | `{"previewOpen":true,"reviewText":"Este e um texto de teste...","statusAfter":"AI KATAROS"}` | PASS |
| `E2E-09` | Chat Lateral AI Kataros | Abertura do drawer e disparo de mensagem no chat | `statusDuring="PROCESSANDO"`, streaming iniciado (`verify_9_side_chat.png`) | PASS |
| `E2E-10` | Painel Organizador & Retorno | Troca de aba para Organizador, troca de escopo `prints` e listagem | `{"workspaceVisible":true,"treeCount":7}` com botao `Voltar ao Astrolabio` (`verify_10_organizer.png`) | PASS |
| `E2E-11` | Guia Rapido, `/boost` & Kits | Abertura de `#modal-guide`, medicao RAM `app.getAppMetrics()`, 4 kits e botoes UX | `{"guideOpen":true,"kitsCount":4,"perfTextLen":335}` (`verify_11_guide_boost.png`) | PASS |

---

## 4. Benchmark Real de Memoria & Velocidade (`/boost` ao Vivo)

Medido em runtime com `Qwen2.5-7B-Instruct-Q4_K_M.gguf` (4,36 GiB) + `llamafile.exe` (351 MB, porta `18080`, `i7-13620H`):

| Perfil `/boost` | Threads / Batch | Contexto / KV | Carga Modelo | RAM `llamafile` (WS / Privado) | Velocidade Prompt | Velocidade Geracao |
| :--- | :--- | :--- | ---: | ---: | ---: | ---: |
| `eco` (Economia) | `4 / 6` | `2048` (`q8_0`) | 4.938 ms | 4.486 MB WS / 365 MB priv. | 23,99 tok/s | 3,93 tok/s |
| `balanced` (Padrao) | `6 / 10` | `4096` (`q8_0`) | 4.239 ms | 4.555 MB WS / 463 MB priv. | 27,19 tok/s | 4,81 tok/s |
| `turbo` (`/boost`) | `6 / 12` (acima do normal) | `4096` (`q8_0`) | 4.243 ms | 4.562 MB WS / 477 MB priv. | 25,91 tok/s | 4,60 tok/s |

---

## 4. Como Reexecutar a Bateria de Testes

1. **Testes Unitarios, Integracao e I.A Local (`llamafile`):**
   ```powershell
   cd codigo
   npm test
   ```
2. **Teste Visual E2E Completo no Electron (perfil isolado para nao conflitar com instancia na bandeja):**
   ```powershell
   cd codigo
   npx electron . --self-test "--user-data-dir=$env:TEMP\mpe_selftest"
   ```
