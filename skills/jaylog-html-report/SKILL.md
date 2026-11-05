---
name: jaylog-html-report
description: Gera relatórios visuais e interativos do Jaylog em HTML autocontido (um único arquivo que abre offline no navegador, com ECharts embutido), como panorama de erros de um serviço, saúde de máquinas (CPU, memória, disco), versão visual do relatório de incidentes ou comparativo entre serviços. O leitor filtra por período, instância, nível ou erro, clica nos gráficos para cruzar os dados, vê correlações entre problemas (matriz, grafo de relações, sankey) e abre um painel de detalhes de cada item. O layout, os componentes e as cores (baseadas no OpenTelemetry, validadas para daltonismo e com tema claro e escuro) são sempre os mesmos. Use sempre que o usuário pedir relatório visual, dashboard, painel, gráficos, "em HTML", "com gráfico", "interativo", para visualizar, explorar ou plotar dados do Jaylog, ou uma versão visual de um relatório, mesmo sem citar "HTML" nem "Jaylog".
---

# Relatórios visuais e interativos do Jaylog em HTML

Você monta um **spec em JSON** com os dados e as seções, e o script `scripts/build.mjs` gera o HTML
a partir do template padrão. A divisão existe por três motivos:

- **Padronização.** Se o modelo escrevesse HTML a cada vez, cada relatório sairia com um layout
  diferente. Com o template, todos têm o mesmo cabeçalho, barra de filtros, cartões, cores, painel
  de detalhes, botão de tema e tabela "Ver dados" em todo gráfico.
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

## O que o leitor consegue fazer

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
| **Panorama de um serviço** | "Como está o serviço X?" | KPIs → alertas → erros por dia e nível → erros por instância → correlação entre erros → mapa de relações → heatmap dia × hora → recursos da instância mais afetada → principais erros → issues → leitura |
| **Saúde de máquinas** | "Como estão as máquinas / a VM01?" | KPIs → alertas → tabela de instâncias (agora e pico) → CPU e memória ao longo do tempo das máquinas com alerta → grafo máquina ↔ serviços → leitura |
| **Incidentes (visual)** | Versão visual do `jaylog-incident-report` | KPIs por categoria → erros por serviço → sankey serviço → máquina → nível → serviços parados → agendamentos não cumpridos → máquinas no limite → issues |
| **Comparativo de serviços** | "Quais serviços mais erram?" | KPIs → erros por serviço (barra horizontal) → evolução diária com série por serviço → correlação entre serviços → tabela |

Esses são pontos de partida. Tire as seções que não têm dado e acrescente o que o pedido exigir.

## 2. Coletar os dados

Faça em paralelo as chamadas que não dependem uma da outra. Para agregar muitos registros, escreva
um script curto (Node ou Python) em vez de contar à mão. Conta de cabeça em centenas de linhas erra.

### O dataset principal (o que deixa o relatório interativo)

Para relatórios de erro, monte **um dataset** a partir do `list-logs` (filtre por `service` e
`log_timestamp_from`/`to`, e por `log_level` se o volume for grande), agregando com um script:

- uma linha por **dia × hora × instância × nível × mensagem agrupada**, com a contagem em `count`;
- `date` (`AAAA-MM-DD`), `hour` (`"14h"`) e `weekday` (`"seg"`…) **no fuso local** (diga o fuso na
  `description` do heatmap);
- `instance` como `host · usuário`; `level` em `ERROR`/`EXCEPTION`/`CRITICAL`;
- `error` = mensagem agrupada: primeira linha da mensagem, com ids, números, datas, caminhos de
  arquivo temporário e e-mails trocados por nada ou por um marcador, para que ocorrências do mesmo
  erro caiam no mesmo grupo. Corte em ~90 caracteres.
- Para comparativo de serviços, inclua `service` (nome) em vez de, ou além de, `instance`.

Isso cabe em poucos milhares de linhas e alimenta KPIs, barras, heatmap, correlação, grafo, sankey,
tabelas e o painel de detalhes de uma vez. Confira os totais do dataset com o `get-error-summary`:
se o `list-logs` não trouxer tudo, diga na `description` que os gráficos cobrem só os logs obtidos.

### Dados que entram como seção estática

- **`get-error-summary`** (`service`, `days` ≤ 45): total e erros por instância, para conferir o
  dataset. Quando houver instância com `possibly_pruned: true`, escreva na `description` que os
  números por instância cobrem só os logs mais recentes.
- **`get-error-history`** (`service`, `from`/`to`): série diária por nível. Útil quando o volume é
  grande demais para o `list-logs`; aí monte o dataset por dia × nível só com ela (sem instância e
  mensagem), preenchendo com 0 os dias sem erro.
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

- **Comece pelo que se responde em 5 segundos.** De 2 a 6 KPIs no topo, e depois os alertas, do
  mais grave para o menos grave. Um número sozinho é KPI, não gráfico.
- **Ligue ao dataset sempre que der.** KPIs, gráficos e tabelas com `query` respondem aos filtros;
  os estáticos não. Declare `filters` para período e para as 2 a 4 dimensões que o leitor vai querer
  cortar (instância, nível, erro, serviço).
- **Todo alerta leva à evidência.** Dê `filter` (e `target`, com `id` na seção) a alertas e KPIs que
  tenham dado por trás. Ex.: "KeyError 6× mais frequente" → `filter: { error: … }`, `target` no
  gráfico por dia.
- **Mostre correlações, mas como pista.** Use `correlation` quando houver 3 ou mais tipos de erro, e
  `graph` com `correlate` para juntar "onde acontece" com "o que anda junto". Marque deploys em
  `events`. Na leitura, chame correlação de indício, não de causa.
- **Um gráfico, uma pergunta.** O título diz o que se vê ("Erros por dia e nível"). A descrição
  diz de onde vem o dado e o que notar ("O volume sobe a partir de 21/10").
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
- **Dados sensíveis.** Mensagens de log podem ter CPF, CNPJ, e-mails, tokens e senhas. Troque por
  valores fictícios no mesmo formato antes de pôr no spec (inclusive em `details.samples`), porque o
  HTML costuma ser repassado e o dataset inteiro vai dentro dele.
- **Termine com leitura.** Uma seção `text` com 1 ou 2 parágrafos de interpretação e os próximos
  passos em `bullets`. Separe fato de hipótese.

## 4. Gerar

Salve o spec e o HTML em `./reports/`, com o mesmo nome base. Assim o relatório pode ser
regenerado depois de um ajuste:

```bash
node <skill>/scripts/build.mjs reports/<nome>.spec.json reports/<nome>.html
```

Nomes: `panorama-<servico>-AAAA-MM-DD`, `maquinas-<hostname|todas>-AAAA-MM-DD`,
`incidentes-AAAA-MM-DD`, `comparativo-servicos-AAAA-MM-DD`, em minúsculas e sem acentos nem espaços.

Se o build listar problemas, corrija o spec e rode de novo. Ele aponta o campo exato (inclusive
campos de `query` que não existem no dataset). Os avisos não impedem a geração, mas normalmente
indicam que vale agregar mais.

## 5. Conferir e entregar

- Se você tiver como ver a página (ferramenta de screenshot ou navegador), abra e olhe:
  sobreposição de rótulos, gráfico vazio, número estranho, grafo embolado (diminua `limit`). Clique
  num filtro e confira se KPIs e gráficos mudam juntos. O build valida a estrutura, não o conteúdo.
- Informe o caminho do arquivo e ofereça abrir. No Linux use `xdg-open <arquivo>`, no macOS
  `open <arquivo>`, no Windows `start "" <arquivo>` e no WSL `explorer.exe "$(wslpath -w <arquivo>)"`.
- No chat, resuma em 3 a 5 linhas o que o relatório mostra (o principal problema e o próximo
  passo) e diga em uma linha o que dá para explorar ("clique numa instância ou arraste um período").
  Não repita o relatório inteiro.

## Cuidados

- Não edite o HTML gerado nem crie um template por relatório. Se faltar um componente, ele deve
  entrar no `assets/template.html` e no `build.mjs`, para valer para todos os relatórios.
- O arquivo tem cerca de 1,2 MB por causa do ECharts embutido, mais o tamanho do dataset. Isso é
  esperado; acima de 20 000 linhas de dataset, agregue mais.
- O ECharts (Apache-2.0) fica em `assets/vendor/`, com `ECHARTS-LICENSE` e `ECHARTS-NOTICE`. Para
  atualizar, substitua o `echarts.min.js` pelo da versão nova do pacote `echarts` no npm, confira
  o hash do pacote e regenere o exemplo para testar (filtros, arrastar período, grafo e sankey).
