---
name: jaylog-html-report
description: Gera relatórios visuais e interativos do Jaylog em HTML autocontido (um único arquivo que abre offline no navegador, com ECharts embutido), como panorama de erros de um serviço, saúde de máquinas (CPU, memória, disco), versão visual do relatório de incidentes ou comparativo entre serviços. Abre numa visão geral que uma pessoa leiga entende (resumo em linguagem simples, KPIs, alertas com o que fazer, marcos e tabelas) e tem uma aba de análise com gráficos e filtros, cada gráfico com um "Como ler" que explica como usar e interpretar. Na análise, o leitor filtra por período, instância, nível ou erro, clica nos gráficos para cruzar os dados, vê correlações entre problemas (matriz, grafo de relações, sankey) e abre um painel de detalhes de cada item. O layout, os componentes e as cores (baseadas no OpenTelemetry, validadas para daltonismo e com tema claro e escuro) são sempre os mesmos. Use sempre que o usuário pedir relatório visual, dashboard, painel, gráficos, "em HTML", "com gráfico", "interativo", para visualizar, explorar ou plotar dados do Jaylog, ou uma versão visual de um relatório, mesmo sem citar "HTML" nem "Jaylog".
---

# Relatórios visuais e interativos do Jaylog em HTML

Você monta um **spec em JSON** com os dados e as seções, e o script `scripts/build.mjs` gera o HTML
a partir do template padrão. A divisão existe por três motivos:

- **Padronização.** Se o modelo escrevesse HTML a cada vez, cada relatório sairia com um layout
  diferente. Com o template, todos têm as mesmas abas, barra de filtros, cartões, cores, painel
  de detalhes, botão de tema, e "Como ler" e "Tabela" em todo gráfico.
- **Interatividade sem servidor.** Os registros vão uma vez para dentro do arquivo (`datasets`) e o
  navegador recalcula KPIs, gráficos e tabelas a cada filtro ou clique. Um relatório que só mostra
  números prontos é um markdown com cores; o valor está em o leitor poder perguntar "e só na VM01?",
  "e depois do deploy?", "esse erro anda junto com qual?".
- **Funciona offline.** O ECharts e os dados ficam dentro do arquivo (cerca de 1,2 MB). Ele abre
  sem internet e atrás do proxy corporativo, onde um gráfico que carrega a biblioteca de um CDN
  apareceria em branco.

Os caminhos abaixo são relativos ao diretório base desta skill. O script precisa só do Node 18+,
que o MCP do Jaylog já exige. Se as tools do Jaylog não estiverem disponíveis, avise que o MCP não
está configurado ou autenticado (`npx -y github:Gpocas/jaylog-mcp login`, com `JAYLOG_URL`
definida) e pare. Não invente dados.

## Duas abas, dois leitores

- **Visão geral** (abre primeiro): para quem quer saber em 1 minuto *o que aconteceu, se é grave e
  o que fazer*, inclusive quem não é técnico. Só resumo em destaque, KPIs, alertas com "O que
  fazer", marcos do período, tabelas curtas e o texto final. Sem gráficos nem filtros: os números
  são do relatório inteiro e não mudam.
- **Análise detalhada**: para quem vai investigar. Gráficos, filtros, cruzamentos e o painel de
  detalhes. Cada gráfico tem um botão "? Como ler" com o que ele mostra, como usar e como
  interpretar.

O template separa sozinho: `chart` vai para a análise e o resto para a visão geral. Alertas, KPIs,
marcos e linhas de tabela com `filter`/`target` são a ponte: um clique leva para a análise já
filtrada no ponto certo.

## O que o leitor consegue fazer na análise

Vale saber, para montar o spec de forma que tudo isso funcione e para explicar ao usuário:

- **Filtrar** por período (atalhos e intervalo), instância, nível, erro… na barra fixa do topo.
  Tudo que tem `query` responde junto e os números sempre batem entre si.
- **Clicar para cruzar**: barra, dia, célula do heatmap, bloco do sankey ou linha de tabela viram
  filtro. Arrastar no gráfico de dias escolhe um período.
- **Ver correlações**: matriz "quais erros variam juntos", grafo de relações (onde cada erro
  acontece + ligações tracejadas entre erros que sobem juntos), sankey do caminho do volume e
  marcos de `events` (deploy, incidente) em todo gráfico de tempo.
- **Abrir detalhes** de qualquer valor (chip de filtro, nó do grafo, célula de correlação): total,
  participação, evolução, quebra por cada dimensão e "varia junto com".
- **Ir do alerta à evidência**: alertas e KPIs com `filter`/`target` aplicam o recorte e rolam até
  o gráfico certo.
- Compartilhar a visão filtrada (o recorte fica no endereço), baixar PNG, ver a tabela de qualquer
  gráfico, alternar o tema. Gráficos e números animam ao aparecer e ao mudar de recorte, e as
  animações somem com "reduzir movimento" do sistema.

## 1. Escolher o relatório

Identifique qual dos tipos abaixo atende o pedido. Se faltar o recorte (qual serviço, qual máquina,
qual período), pergunte numa única pergunta de múltipla escolha (`AskUserQuestion`, se disponível),
oferecendo os favoritos (`list-favorite-services`) como atalho.

| Tipo | Pergunta que responde | Seções típicas |
|---|---|---|
| **Panorama de um serviço** | "Como está o serviço X?" | *Visão geral:* resumo → KPIs → alertas → marcos → principais erros → issues → o que fazer. *Análise:* erros por dia e nível → erros por instância → correlação entre erros → mapa de relações → heatmap dia × hora → recursos da instância mais afetada |
| **Saúde de máquinas** | "Como estão as máquinas / a VM01?" | *Visão geral:* resumo → KPIs → alertas → tabela de instâncias (agora e pico) → o que fazer. *Análise:* CPU e memória ao longo do tempo das máquinas com alerta → grafo máquina ↔ serviços |
| **Incidentes (visual)** | Versão visual do `jaylog-incident-report` | *Visão geral:* resumo → KPIs por categoria → alertas → tabelas de serviços parados, agendamentos não cumpridos, máquinas no limite e issues. *Análise:* erros por serviço → sankey serviço → máquina → nível |
| **Comparativo de serviços** | "Quais serviços mais erram?" | *Visão geral:* resumo → KPIs → tabela de serviços. *Análise:* erros por serviço (barra horizontal) → evolução diária com série por serviço → correlação entre serviços |

Esses são pontos de partida. Tire as seções que não têm dado e acrescente o que o pedido exigir.

## 2. Coletar os dados

Faça em paralelo as chamadas que não dependem uma da outra. Nunca conte à mão nem cole logs
brutos no spec.

### O dataset principal: gere com `jaylog-mcp dataset`

Para relatórios de erro, o dataset vem de um comando do próprio pacote do MCP. Ele busca os logs
direto na API, com a mesma credencial do `login`, e escreve o arquivo pronto. Você **não lê nem copia
as linhas**: só o resumo que ele imprime.

```bash
npx -y github:Gpocas/jaylog-mcp dataset --service <id> --days 45 \
  --event "2026-10-21T15:00=Deploy v2.3" \
  --out reports/panorama-<servico>-AAAA-MM-DD.dataset.json
```

- `--service`: id (UUID) do serviço, que vem de `list-favorite-services`, `list-services` ou
  `search-services-by-owner`. Para comparativo, passe vários ids separados por vírgula: as linhas
  ganham o campo `service`.
- `--days` (≤ 45) ou `--from`/`--to` (AAAA-MM-DD); `--tz` (padrão: o fuso da máquina);
  `--levels` (padrão `CRITICAL,EXCEPTION,ERROR`; use `CRITICAL,EXCEPTION` se pediram só os graves).
- `--event "data=rótulo"` (repetível): deploys e mudanças de versão (de `list-hosts` ou do que o
  usuário contou). O resumo traz o antes e o depois de cada um.
- Se o comando disser que `JAYLOG_URL` não está definida, use o mesmo valor da configuração do MCP
  (`claude mcp get jaylog`, ou o `.mcp.json` do projeto) na frente do comando:
  `JAYLOG_URL=<valor> npx …`. Se não autenticar, peça para rodar o `login`. Não invente a URL.

O que o comando garante, igual em todo relatório:
- uma linha por dia × hora × instância × nível × mensagem agrupada, com `date`, `hour` e `weekday`
  no fuso escolhido e os dias sem erro dentro do período (`time_range`);
- mensagens agrupadas pela primeira linha, com ids, números longos, datas, horas e caminhos
  temporários trocados por marcadores, mais o tipo da exceção do traceback (`… · KeyError`);
- **e-mail, CPF, CNPJ, tokens, senhas e JWT sempre mascarados**, nas linhas e nos exemplos;
- `details.error` com 2 exemplos completos (mascarados) e primeira/última vez de cada erro
  principal, que viram o painel de detalhes sozinhos;
- busca em janelas que se dividem quando a resposta parece cortada pelo servidor, e conferência com
  o histórico consolidado (`coverage`).

No spec, aponte para o arquivo (o caminho é relativo ao spec) e use o `spec_snippet` impresso para
`filters`, `labels` e `events`:

```json
"datasets": { "erros": { "from_file": "panorama-<servico>-AAAA-MM-DD.dataset.json" } }
```

**Escreva os textos a partir do resumo impresso** (`summary`), sem recontar:
- `total`, `by_level`, `by_instance` (ou `by_service`) → KPIs e "Em resumo";
- `trend` (média por dia dos últimos dias contra a de antes) e `events[].all_errors` /
  `biggest_changes` → "subiu desde…", "5× mais frequente";
- `top_errors` (volume, níveis, instâncias, primeiro/último dia, tendência) → alertas e tabelas;
- `peak_days`, `hotspots_weekday_hour` e `correlated_errors` → o `help.read` dos gráficos de dias,
  heatmap e correlação.

**Cobertura.** O Jaylog guarda só os ~1000 logs mais recentes por instância. Se `coverage.partial`
vier `true` (o build também avisa), diga na `description` dos gráficos e numa linha do resumo que
os detalhes cobrem bem os dias a partir de `coverage.first_complete_day`. Para o total do período
inteiro, use o `get-error-history` (por exemplo, num KPI estático).

Se o comando não estiver disponível (MCP antigo, sem `npx`), monte o dataset com um script seguindo
as mesmas regras acima, e mascare os dados sensíveis você mesmo.

### Dados que entram como seção estática

- **`get-error-summary`** (`service`, `days` ≤ 45): total e erros por instância. O `coverage` do
  dataset já faz a conferência; use esta tool quando precisar do total por instância do período
  inteiro.
- **`get-error-history`** (`service`, `from`/`to`): série diária por nível, completa nos 45 dias.
  Útil para um gráfico estático do período inteiro quando a cobertura do dataset for parcial.
- **`get-resource-usage`** (`service` ou `hostname`, `hours` ≤ 48): alertas prontos e a situação
  atual de cada instância. Os `alerts` viram itens da seção `alerts` (crítico para CPU/memória/disco
  no limite, atenção para crescimento de memória, info para falta de amostras); o resto vira tabela
  e `details.instance` (fatos do painel de detalhes).
- **`get-host-metrics`** (`service`, `hostname`, `username`, `bucket_minutes`): série de recursos
  para gráfico `line` estático. Até cerca de 300 pontos (48 h com 10 min = 288). Use os `*_avg`.
- **`list-issues`**, **`list-hosts`**, **`get-latest-logs`**: issues abertas (tabela estática com
  `filter_field: "error"` quando der para ligar a issue a uma mensagem), versões em produção e
  liveness. Deploys e mudanças de versão viram `events`.

## 3. Montar o spec

O formato completo, com um exemplo por componente, está em `references/spec.md`. Um relatório
completo de exemplo está em `assets/example-spec.json`. Regras que mantêm o relatório legível:

- **A visão geral é para leigos.** Comece com um `text` de `variant: "summary"` (2 a 3 frases,
  `status` da situação geral): o que aconteceu, desde quando, onde e se é grave, com os números em
  **negrito**. Depois de 3 a 5 KPIs com `hint` em linguagem simples ("Os que costumam parar o
  processo"), os alertas, do mais grave para o menos grave, **cada um com `action`** ("O que
  fazer"). Em seguida, uma `timeline` com 3 a 6 marcos (o que mudou e quando), tabelas curtas
  (`limit` 5 a 10) e, por último, um `text` "O que fazer agora".
- **Escreva como para alguém de fora da TI.** Na visão geral, troque jargão por efeito: "falha
  grave que costuma parar o robô" em vez de "CRITICAL", "notas sem CNPJ" em vez de "KeyError
  'cnpj'" (a mensagem técnica fica na tabela). Títulos de seção em forma de pergunta respondida:
  "O que precisa de atenção", "Erros que mais aconteceram". Um número sozinho é KPI, não gráfico.
- **Ligue ao dataset sempre que der.** KPIs, gráficos e tabelas com `query` respondem aos filtros;
  os estáticos não. Declare `filters` para período e para as 2 a 4 dimensões que o leitor vai querer
  cortar (instância, nível, erro, serviço).
- **Todo alerta leva à evidência.** Dê `filter` (e `target`, com `id` na seção) a alertas e KPIs que
  tenham dado por trás. Ex.: "KeyError 6× mais frequente" → `filter: { error: … }`, `target` no
  gráfico por dia.
- **Mostre correlações, mas como pista.** Use `correlation` quando houver 3 ou mais tipos de erro, e
  `graph` com `correlate` para juntar "onde acontece" com "o que anda junto". Marque deploys em
  `events`. Na leitura, chame correlação de indício, não de causa.
- **Um gráfico, uma pergunta.** O título diz o que se vê ("Erros por dia e nível"). A descrição,
  numa frase, diz o que é cada marca ("Cada barra é um dia").
- **Todo gráfico com `help.read`.** É o "Como interpretar" do diálogo "Como ler": 2 a 4 frases
  simples com o que notar *neste* gráfico, citando datas, nomes e números que aparecem na tela
  ("Depois da linha tracejada (versão 2.3) as barras ficam bem mais altas"). O "o que mostra" e o
  "como usar" o template gera sozinho; só sobrescreva se houver algo específico. Tire os números
  do `summary` do dataset; se precisar de outro recorte, calcule com um script sobre o arquivo.
- **Escolha a forma pela pergunta:**
  - evolução contínua (CPU, memória) → `line`;
  - contagem por dia → `bar` com `dates`;
  - composição por nível → `bar` com `stacked` e `palette: "severity"`;
  - comparar instâncias ou serviços → `bar` com `horizontal` (a ordem já sai da maior para a menor);
  - concentração em duas dimensões (dia × hora) → `heatmap`;
  - quais problemas variam juntos → `correlation`;
  - como entidades se ligam (instância ↔ erro, serviço ↔ máquina ↔ issue) → `graph`;
  - por onde o volume passa (serviço → instância → nível → erro) → `sankey`.
  Não ponha `graph` e `sankey` com os mesmos campos no mesmo relatório: escolha um.
- **Uma unidade por gráfico.** Percentual e bytes nunca no mesmo gráfico. Sem eixo duplo: faça dois
  gráficos.
- **No máximo 6 séries.** Com `query`, o template já agrupa o excedente em "Outros". A cor e a
  posição seguem a entidade (total no dataset inteiro), não o ranking do recorte.
- **Limites como referência.** Em percentuais de recurso, use `thresholds` de 80 (warning) e
  90 (critical), e `y_min: 0`, `y_max: 100`.
- **Status é reservado.** `good`/`warning`/`serious`/`critical` só aparecem em KPIs, alertas,
  limites, nós de grafo e colunas de status, sempre com rótulo. As cores e a validação estão em
  `references/palette.md`. Não troque cores por relatório.
- **Sem dado não é zero.** Use `null` em séries estáticas sem medição. Se uma seção inteira ficar
  sem dado, troque-a por uma seção `text` dizendo o que faltou, em vez de mostrar um gráfico vazio.
- **Dados sensíveis.** Mensagens de log podem ter CPF, CNPJ, e-mails, tokens e senhas. O
  `jaylog-mcp dataset` já mascara o dataset e os exemplos; tudo que **você** escrever no spec
  (alertas, resumo, `details` extras) precisa do mesmo cuidado, porque o HTML costuma ser repassado.
- **Termine com "O que fazer agora".** Uma seção `text` com 1 ou 2 parágrafos (`**Fato:**`,
  `**Hipótese:**`) e os próximos passos em `bullets`. Separe fato de hipótese.

## 4. Gerar

Salve o dataset, o spec e o HTML em `./reports/`, com o mesmo nome base (`.dataset.json`,
`.spec.json`, `.html`). Assim o relatório pode ser regenerado depois de um ajuste:

```bash
node <skill>/scripts/build.mjs reports/<nome>.spec.json reports/<nome>.html
```

Nomes: `panorama-<servico>-AAAA-MM-DD`, `maquinas-<hostname|todas>-AAAA-MM-DD`,
`incidentes-AAAA-MM-DD`, `comparativo-servicos-AAAA-MM-DD`, em minúsculas e sem acentos nem espaços.

Se o build listar problemas, corrija o spec e rode de novo. Ele aponta o campo exato (inclusive
campos de `query` que não existem no dataset). Os avisos não impedem a geração, mas normalmente
indicam que vale agregar mais.

## 5. Conferir e entregar

- Se você tiver como ver a página (ferramenta de screenshot ou navegador), abra e olhe as duas
  abas: sobreposição de rótulos, gráfico vazio, número estranho, grafo embolado (diminua `limit`).
  Clique num alerta e confira se ele leva ao gráfico certo, já filtrado. O build valida a
  estrutura, não o conteúdo.
- Releia a visão geral como se você não soubesse nada do sistema: dá para entender o que
  aconteceu e o que fazer sem abrir a análise?
- Informe o caminho do arquivo e ofereça abrir. No Linux use `xdg-open <arquivo>`, no macOS
  `open <arquivo>`, no Windows `start "" <arquivo>` e no WSL `explorer.exe "$(wslpath -w <arquivo>)"`.
- No chat, resuma em 3 a 5 linhas o que o relatório mostra (o principal problema e o próximo
  passo) e diga em uma linha como usar ("a visão geral resume; na aba Análise detalhada cada
  gráfico tem um botão Como ler").
  Não repita o relatório inteiro.

## Cuidados

- Não edite o HTML gerado nem crie um template por relatório. Se faltar um componente, ele deve
  entrar no `assets/template.html` e no `build.mjs`, para valer para todos os relatórios.
- O arquivo tem cerca de 1,2 MB por causa do ECharts embutido, mais o tamanho do dataset. Isso é
  esperado; acima de 20 000 linhas de dataset, agregue mais.
- O ECharts (Apache-2.0) fica em `assets/vendor/`, com `ECHARTS-LICENSE` e `ECHARTS-NOTICE`. Para
  atualizar, substitua o `echarts.min.js` pelo da versão nova do pacote `echarts` no npm, confira
  o hash do pacote e regenere o exemplo para testar (filtros, arrastar período, grafo e sankey).
