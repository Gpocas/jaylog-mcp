# Formato do spec (JSON)

O `scripts/build.mjs` recebe um JSON neste formato e gera o HTML. Ele valida tudo antes e lista
todos os problemas de uma vez, com o caminho do campo (ex.: `sections[2].chart.query.x`).
Exemplo completo, com todos os componentes interativos: `assets/example-spec.json`.

Todo texto é exibido como **texto puro**: HTML aparece literalmente. Isso é proposital, porque
mensagens de log entram no relatório e não podem virar código na página. A única exceção são as
seções `text`, que aceitam um Markdown mínimo (abaixo), montado sem HTML.

## As duas abas

O relatório tem duas abas. Cada seção vai para uma delas automaticamente, ou pelo campo `tab`.

| Aba | `tab` | Conteúdo | Para quem |
|---|---|---|---|
| **Visão geral** (abre primeiro) | `overview` (padrão de tudo que não é gráfico) | resumo, KPIs, alertas, marcos (`timeline`), tabelas e texto. **Sem gráficos e sem filtros**: os números são sempre do relatório inteiro | qualquer pessoa, inclusive leiga |
| **Análise detalhada** | `analysis` (padrão de `chart`) | gráficos, barra de filtros, painel de detalhes | quem vai investigar |

- Na visão geral, alertas, KPIs, marcos e linhas de tabela com `filter`/`target` levam para a
  análise já filtrada. Uma tabela com `filter_field` (ou `query`) faz o mesmo ao clicar numa linha.
- Com seções só de um tipo, as abas somem e a página fica com uma só.
- Evite gráfico na visão geral (o build avisa). Uma tabela ou KPI pode ir para a análise com
  `"tab": "analysis"`; lá ela responde aos filtros.

## Dois jeitos de alimentar uma seção

- **Estático**: você manda os números prontos (`series`, `rows`, `value`). Serve para dados que não
  se cruzam com o resto (ex.: CPU de uma máquina nas últimas 48 h). Quando há filtro ativo, o
  gráfico ganha o selo "Não muda com os filtros".
- **Ligado a um dataset** (`query`): você manda os registros uma vez, em `datasets`, e cada gráfico,
  KPI ou tabela diz como agregá-los. O navegador recalcula tudo quando o leitor filtra ou clica.
  É isso que torna o relatório interativo: prefira este modo para tudo que vier de logs.

## Raiz

| Campo | Obrigatório | Descrição |
|---|---|---|
| `title` | sim | Título da página e da aba do navegador |
| `subtitle` | não | Uma linha dizendo o recorte (serviço, máquina, período) |
| `period` | não | Texto do período, mostrado ao lado da data de geração (ex.: `20/09/2026 a 03/11/2026`) |
| `source` | não | Tools usadas, para quem quiser refazer a consulta (rodapé) |
| `generated_at` | não | ISO 8601; se omitido, o build usa a hora atual |
| `datasets` | não | Registros para as seções com `query` (abaixo) |
| `filters` | não | Controles da barra de filtros fixa no topo |
| `labels` | não | Nome legível de cada campo: `{ "instance": "Instância", "error": "Erro" }` |
| `events` | não | Marcos verticais nos gráficos de tempo (deploy, incidente) |
| `details` | não | Texto, fatos, exemplos e links extras do painel de detalhes |
| `glossary` | não | Termos explicados em linguagem simples: `{ "CRITICAL": "Falha grave…" }`. Já vem com CRITICAL, EXCEPTION e ERROR; use para trocar ou acrescentar termos |
| `sections` | sim | Lista de seções, renderizadas na ordem |

Toda seção aceita `title` (h2), `description` (uma ou duas frases sob o título), `id` (minúsculas e
hífen), usado por alertas, KPIs e marcos para levar o leitor até ela, e `tab`. Em gráficos o
`title` é obrigatório.

## `datasets`: os registros

```json
"datasets": {
  "erros": {
    "value": "count", "unit": "erros", "time": "date",
    "dimensions": ["instance", "level", "error", "weekday"],
    "rows": [
      { "date": "2026-10-21", "weekday": "ter", "hour": "14h", "instance": "VM01 · bot", "level": "EXCEPTION", "error": "KeyError: 'cnpj' em importar_notas()", "count": 3 }
    ]
  }
}
```

### Dataset em arquivo (`from_file`)

```json
"datasets": { "erros": { "from_file": "panorama-faturamento-2026-11-05.dataset.json" } }
```

Lê o arquivo gerado por `jaylog-mcp dataset` (caminho relativo ao spec) e põe as linhas dentro do
HTML. Do arquivo vêm `rows`, `value`, `unit`, `time`, `time_range`, `dimensions` e `label`; qualquer
um deles escrito no spec tem prioridade. Os `details` do arquivo (exemplos mascarados e
primeira/última vez dos erros principais) completam os `details` do spec, que também têm prioridade.
Com cobertura parcial, o build avisa.

`time_range: ["AAAA-MM-DD", "AAAA-MM-DD"]` (também aceito em dataset escrito à mão) faz o eixo de
dias e os atalhos de período cobrirem o período inteiro, mesmo com dias sem nenhum registro nas
pontas.

### Regras das linhas

- Uma linha por combinação de dimensões, já **pré-agregada** (dia × hora × instância × nível ×
  mensagem → contagem). Não mande um log por linha: 45 dias cabem em poucos milhares de linhas.
- `value`: campo numérico somado por padrão. Sem ele, cada linha conta 1.
- `unit`: unidade do `value`, usada em KPIs, tooltips e no painel de detalhes.
- `time`: campo de data ISO (`2026-11-03` ou `2026-11-03T14:00`). É a base do "ao longo do tempo" e
  das correlações. Dias faltantes são preenchidos com zero automaticamente.
- `dimensions`: campos que o painel de detalhes quebra ("Por instância", "Por nível"…), além dos
  campos de `filters`.
- Campos derivados (dia da semana, hora no fuso local) entram já calculados nas linhas.
- Acima de 20 000 linhas o build avisa: agregue mais.

## `filters`: barra de filtros

```json
"filters": [
  { "field": "date", "kind": "date-range", "label": "Período" },
  { "field": "instance", "label": "Instância" },
  { "field": "level", "label": "Nível" },
  { "field": "error", "label": "Erro" }
]
```

- `kind: "date-range"` (no máximo um): atalhos "Todo o período", "Últimos 7/14/30 dias" (relativos
  ao último dia do dataset) e intervalo personalizado.
- `kind: "values"` (padrão): lista de valores com caixa de seleção múltipla, contagem ao vivo e busca.
- Os filtros valem para **todas** as seções com `query` cujo dataset tenha o campo. Cada filtro
  ativo vira um chip removível; clicar no chip abre o painel de detalhes daquele valor.
- O recorte fica no endereço da página (`#f=…`): dá para copiar o link de uma visão filtrada.

Clicar num gráfico também filtra, mesmo por campos que não estão em `filters` (ex.: célula do
heatmap filtra por dia da semana e hora). Um gráfico não se filtra pelo próprio eixo: ele mantém
todas as barras, destaca a seleção e esmaece o resto, para o leitor ver o contexto.

## `events`: marcos no tempo

```json
"events": [{ "at": "2026-10-21T15:00", "label": "Deploy v2.3", "status": "info" }]
```

Viram linhas verticais tracejadas em todo gráfico `line`/`bar` com `dates: true` e no "ao longo do
tempo" do painel. É a forma mais direta de mostrar correlação entre uma mudança e um problema.
Use poucos (1 a 4) e rótulos curtos.

## `details`: conteúdo extra do painel de detalhes

```json
"details": {
  "error": {
    "KeyError: 'cnpj' em importar_notas()": {
      "text": "Começou no deploy v2.3.",
      "facts": [{ "label": "Issue", "value": "#128" }],
      "samples": ["KeyError: 'cnpj'\n  File \"importar_notas.py\", line 212"],
      "links": [{ "label": "Abrir no Jaylog", "url": "https://…" }]
    }
  },
  "instance": { "VM01 · bot": { "facts": [{ "label": "CPU agora", "value": 95, "unit": "%" }] } }
}
```

Chave: campo → valor exato. Só links `http(s)` são aceitos. Mascare dados sensíveis nos `samples`.

O painel abre ao clicar num chip, num nó do grafo ou numa célula de correlação, e mostra sozinho:
total e participação no recorte, última ocorrência, minigráfico no tempo (com `events`), quebra por
cada dimensão (clicável, para navegar de um valor a outro) e **"Varia junto com"**: os valores do
mesmo campo cuja série diária mais se correlaciona com a dele (Pearson, r ≥ 0,3).

## `query`: como agregar

Campos comuns a toda `query`:

| Campo | Descrição |
|---|---|
| `dataset` | Nome em `datasets` (obrigatório) |
| `value` | Campo medido (padrão: o `value` do dataset) |
| `agg` | `sum` (padrão com `value`), `count`, `avg`, `max`, `min`, `distinct` (valores distintos de `value`) |
| `where` | Pré-filtro fixo: `{ "level": "CRITICAL" }` ou `{ "level": ["ERROR", "EXCEPTION"] }` |

## `kpis`: indicadores no topo

```json
{ "type": "kpis", "items": [
  { "label": "Erros no período", "query": { "dataset": "erros" }, "status": "critical", "status_label": "Subindo desde 21/10", "target": "erros-por-dia" },
  { "label": "Críticos", "query": { "dataset": "erros", "where": { "level": "CRITICAL" } }, "filter": { "level": "CRITICAL" } },
  { "label": "Instâncias com erro", "query": { "dataset": "erros", "agg": "distinct", "value": "instance" }, "unit": "de 3" },
  { "label": "Disco da VM01", "value": 91, "unit": "%", "status": "warning", "status_label": "Acima de 90%", "target": "recursos" }
]}
```

- `value` (estático) ou `query` (recalculado com os filtros; mostra "no recorte" e "de N no total").
  O número anima de um valor ao outro.
- `unit`: `%` cola no número, as outras unidades ficam com espaço.
- `status`: `good`, `warning`, `serious`, `critical` ou `info`, sempre com bolinha e rótulo
  (`status_label`, ou "OK", "Atenção", "Grave", "Crítico", "Info"). A cor nunca aparece sozinha.
  O status é fixo: ele descreve o relatório inteiro, não o recorte.
- `hint`: linha pequena de contexto.
- `target` (id de seção) e/ou `filter` (`{ "campo": valor }`): o cartão vira clicável. `filter`
  **substitui** o recorte atual e `target` rola até a seção.

## `alerts`: lista de alertas

```json
{ "type": "alerts", "title": "Alertas", "items": [
  { "severity": "critical", "title": "CPU da VM01 em 95% agora", "detail": "Média de 64% nas últimas 2 h.",
    "filter": { "instance": "VM01 · bot" }, "target": "recursos" }
]}
```

`severity` usa os valores de `status`. Ordene do mais grave para o menos grave.

- `action`: o que fazer, numa frase, em linguagem simples ("Reiniciar o robô hoje"). Aparece como
  "O que fazer: …". Dê a todo alerta que não seja só informativo.
- `filter` e `target` funcionam como nos KPIs: o alerta ganha "Ver nos gráficos →" e leva para a
  análise já filtrada.

```json
{ "severity": "warning", "title": "Memória do robô crescendo sem parar", "detail": "270 MB → 660 MB em 2 h.",
  "action": "Reiniciar o robô hoje e acompanhar a issue #119.", "filter": { "error": "MemoryError ao gerar o PDF do lote" }, "target": "correlacao" }
```

## `timeline`: marcos do período

```json
{ "type": "timeline", "title": "Marcos do período", "items": [
  { "at": "2026-10-21T15:00", "label": "Entrou a versão 2.3 do robô", "detail": "A partir daqui o erro de CNPJ disparou.",
    "filter": { "error": "KeyError: 'cnpj' em importar_notas()" }, "target": "erros-por-dia" },
  { "at": "2026-10-30", "label": "Dois dias de instabilidade do SAP", "status": "warning", "filter": { "date": ["2026-10-30", "2026-10-31"] } }
]}
```

Linha do tempo vertical, em ordem de data. Sem `items`, usa os `events` da raiz. `status` pinta o
marco e mostra o rótulo (exceto `info`). `filter`/`target` deixam o marco clicável; um `filter` no
campo de período aceita `[início, fim]`. Use 3 a 6 marcos: o que mudou e quando.

## `chart`: gráfico

```json
{ "type": "chart", "title": "…", "description": "…", "chart": { "kind": "…", … } }
```

| `kind` | Pergunta que responde | Dados |
|---|---|---|
| `line` | Como evolui no tempo? | estático ou `query` |
| `bar` | Quanto por dia / por entidade? | estático ou `query` |
| `heatmap` | Onde se concentra (dia × hora)? | estático ou `query` |
| `correlation` | Quais problemas variam juntos? | só `query` |
| `graph` | Como as entidades se ligam? | estático (`nodes`/`links`) ou `query` |
| `sankey` | Por onde o volume flui? | estático (`nodes`/`links`) ou `query` |

Campos comuns do objeto `chart`:

| Campo | Descrição |
|---|---|
| `unit` | Unidade dos valores (padrão com `query`: a do dataset) |
| `dates` | `true` quando o eixo são datas ISO. Viram `03/11` ou `03/11 14:00` |
| `height` | Altura em px (padrão 340; grafo 480; sankey 420; correlação conforme o número de itens). Barras horizontais: cerca de 60 px por barra + 40 |
| `palette` | `categorical` (padrão) ou `severity` |
| `thresholds` | Linhas de referência: `[{ "value": 90, "status": "critical", "label": "Crítico" }]` |
| `y_min`, `y_max` | Limites do eixo de valores (ex.: `0` e `100` para percentuais) |
| `filter_field` | Só em gráfico estático: clicar numa categoria filtra o relatório por este campo |

Todo gráfico ganha automaticamente: botão **"Como ler"** (abaixo), tooltip, botão "Tabela" (tabela
ordenável e pesquisável com os números do recorte atual), botão "PNG", animação de entrada quando aparece na tela e de
transição quando os filtros mudam, barra de zoom quando o eixo é longo, e tooltip sincronizado
entre gráficos com o mesmo eixo de tempo (passar o mouse num dia mostra o mesmo dia nos outros).

### `help`: o "Como ler" de cada gráfico

Todo gráfico tem um botão "? Como ler". Passar o mouse mostra uma frase do que ele mostra; clicar
abre um diálogo com **O que mostra**, **Como usar** (passos de interação e filtros, conforme o tipo
de gráfico), **Como interpretar** e, quando há níveis de log, **O que significam os níveis**.

O template gera textos genéricos por tipo. Sobrescreva o que quiser, no nível da seção:

```json
{ "type": "chart", "title": "Erros por dia e nível",
  "help": { "read": "Até 20/10 o robô tinha poucos erros por dia. Depois da linha tracejada (versão 2.3) as barras ficam bem mais altas e escuras: são os erros de notas sem CNPJ." },
  "chart": { … } }
```

| Campo | Descrição |
|---|---|
| `read` | **Escreva sempre.** O que o leitor deve notar *neste* gráfico, com datas, nomes e números reais. O build avisa quando falta |
| `what` | O que o gráfico mostra (padrão: frase gerada pelo tipo e pelos campos) |
| `how` | Texto ou lista de passos (padrão: gerado pelo tipo; só troque se houver algo específico) |
| `short` | Frase do tooltip (padrão: `what`) |

Escreva para quem nunca viu o gráfico: frases curtas, sem jargão ("r", "Pearson", "bucket"), com
os nomes que aparecem na tela.

### `line` e `bar`

Estático:

```json
{ "kind": "line", "dates": true, "unit": "%", "y_min": 0, "y_max": 100,
  "x": ["2026-11-03T00:00", "2026-11-03T01:00"],
  "thresholds": [{ "value": 80, "status": "warning", "label": "Atenção" }, { "value": 90, "status": "critical", "label": "Crítico" }],
  "series": [{ "name": "CPU da máquina", "values": [40.2, 45.1] }, { "name": "Memória da máquina", "values": [50, 50.4] }] }
```

```json
{ "kind": "bar", "categories": ["VM01 · bot", "VM02 · bot"], "horizontal": true, "unit": "erros",
  "series": [{ "name": "Erros", "values": [512, 203] }] }
```

Cada série é `{ "name": "…", "values": [números ou null] }`, um valor por posição do eixo. `null`
deixa buraco ("sem dado"); zero significa "medido e deu zero". Máximo de 6 séries.

Com `query`:

```json
{ "kind": "bar", "stacked": true, "palette": "severity", "dates": true,
  "query": { "dataset": "erros", "x": "date", "series": "level" } }
```

```json
{ "kind": "bar", "horizontal": true, "query": { "dataset": "erros", "x": "instance", "series_name": "Erros", "limit": 8 } }
```

| Campo da `query` | Descrição |
|---|---|
| `x` | Campo do eixo (categorias ou datas) |
| `series` | Campo que separa as séries (opcional). Com mais de 6 valores, os 5 maiores + "Outros" |
| `series_name` | Nome da série única quando não há `series` (padrão: título da seção) |
| `series_order` | Ordem fixa das séries (até 6) |
| `order` | Ordem fixa das categorias do eixo |
| `limit` | Mostra as N maiores categorias e soma o resto em "Outros" |
| `fill_dates` | `false` para não preencher dias faltantes com zero |

- A ordem das categorias e a cor de cada série vêm do total no dataset inteiro, então não mudam
  quando o leitor filtra.
- Clique: filtra pelo valor de `x`. Quando `x` é o campo do filtro de período, clicar num dia filtra
  aquele dia, **arrastar** seleciona um intervalo e Shift+clique estende o intervalo.
- `horizontal: true` para comparar entidades; `stacked: true` para composição.
- `palette: "severity"`: as séries (ou os valores do campo `series`) devem ser `ERROR`,
  `EXCEPTION` e `CRITICAL`, e recebem a escala de gravidade.

### `heatmap`

```json
{ "kind": "heatmap", "query": { "dataset": "erros", "x": "hour", "y": "weekday",
  "x_order": ["00h", "01h", "…", "23h"], "y_order": ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"] } }
```

Com `query`, `x_order`/`y_order` garantem todos os rótulos na ordem certa (mesmo os sem dado).
Clicar numa célula filtra pelos dois campos; clicar de novo desfaz.

Estático: `"x": […], "y": […], "values": [[índice_x, índice_y, valor], …]`, índices a partir de 0;
o primeiro item de `y` fica no topo.

Escala sequencial azul, do claro (pouco) ao escuro (muito).

### `correlation`: quais problemas variam juntos

```json
{ "kind": "correlation", "query": { "dataset": "erros", "field": "error", "bucket": "date", "limit": 7 } }
```

Matriz com a correlação de Pearson entre as séries por intervalo (`bucket`, padrão: o `time` do
dataset) dos `limit` (2 a 12, padrão 8) maiores valores de `field`. Azul: sobem e descem juntos;
âmbar: quando um sobe, o outro desce; cinza: sem relação. Clicar numa célula abre as duas séries
sobrepostas no painel de detalhes. Responde aos filtros: com o período filtrado, só os intervalos
dentro dele entram na conta.

Correlação por dia captura padrões semanais (dois erros que só acontecem em dia útil se
correlacionam). Se isso atrapalhar, use um `bucket` por hora (campo `"slot": "2026-10-21T14"`).

### `graph`: mapa de relações

Com `query` (recomendado):

```json
{ "kind": "graph", "query": { "dataset": "erros", "fields": ["instance", "error"], "correlate": "error", "min_r": 0.5 } }
```

- `fields` (2 a 6): cada campo vira uma categoria de nó (cor) e cada valor um nó, com tamanho pelo
  volume. Os `limit` (padrão 8) maiores valores de cada campo entram.
- Ligações cheias entre campos vizinhos da lista, com espessura pelo volume. `links: "all"` liga
  todos os pares de campos.
- `correlate`: um dos `fields`. Acrescenta ligações **tracejadas** entre valores desse campo que
  variam juntos no tempo (r ≥ `min_r`, padrão 0,6).
- O leitor arrasta nós, aproxima com a roda, passa o mouse para destacar vizinhos e clica num nó para
  abrir o painel de detalhes. Com filtro ativo, os nós selecionados ganham contorno e os não ligados
  a eles esmaecem.

Estático (relações que não estão num dataset, ex.: serviço → máquina → issue):

```json
{ "kind": "graph", "categories": ["Serviço", "Máquina", "Issue"],
  "nodes": [
    { "id": "fat", "name": "Robô Faturamento", "category": "Serviço", "value": 438, "filter": { "field": "service", "value": "Robô Faturamento" } },
    { "id": "vm01", "name": "VM01", "category": "Máquina", "value": 95, "status": "critical", "detail": "CPU em 95% agora." },
    { "id": "i128", "name": "#128 Notas sem CNPJ", "category": "Issue", "value": 1 }
  ],
  "links": [{ "source": "fat", "target": "vm01", "value": 237 }, { "source": "i128", "target": "fat", "dashed": true }] }
```

`status` põe um anel com a cor de status (e o rótulo no tooltip). `filter` liga o nó a um campo de
dataset (o painel mostra os números dele); sem `filter`, o painel mostra `detail` e `details`.

### `sankey`: fluxo

```json
{ "kind": "sankey", "query": { "dataset": "erros", "fields": ["instance", "level", "error"], "limit": 6 } }
```

Colunas na ordem de `fields`; a largura da faixa é o volume. Valores além de `limit` por coluna
viram "Outros". Clicar num bloco filtra. Estático: `nodes` e `links` como no grafo, com `value`
positivo em todo link e sem ciclos.

## `table`: tabela

Estática:

```json
{ "type": "table", "title": "Issues abertas", "filter_field": "error",
  "columns": [
    { "key": "id", "label": "Issue", "format": "code" },
    { "key": "error", "label": "Erro relacionado", "format": "code" },
    { "key": "status", "label": "Status", "format": "status" }
  ],
  "rows": [{ "id": "#128", "error": "KeyError: 'cnpj' em importar_notas()", "status": "critical" }] }
```

Com `query`:

```json
{ "type": "table", "title": "Principais erros",
  "query": { "dataset": "erros", "group_by": ["error", "level"],
    "measures": { "count": "sum:count", "instances": "distinct:instance", "last": "max:date" }, "sort": "count" },
  "columns": [
    { "key": "level", "label": "Nível", "format": "level" },
    { "key": "error", "label": "Mensagem", "format": "code" },
    { "key": "count", "label": "Ocorrências", "numeric": true },
    { "key": "last", "label": "Último dia", "format": "date" }
  ] }
```

- `measures`: `"agg:campo"` (`sum`, `max`, `min`, `avg`, `distinct`) ou `"count"`. Sem `measures`,
  há uma coluna `count`. As `columns` só podem usar campos de `group_by` e chaves de `measures`.
- `sort` (chave), `sort_dir` (`asc`; padrão decrescente), `limit`, `page_size` (padrão 10 na visão
  geral e 25 na análise). Na visão geral, prefira `limit` de 5 a 10 linhas.
- Clicar numa linha filtra por `filter_field` (padrão com `query`: o primeiro `group_by`). Na visão
  geral, o clique leva para a análise já filtrada; na análise, a linha selecionada fica destacada e
  as outras esmaecem. Na visão geral a tabela mostra sempre o relatório inteiro. Use `filter_field` numa tabela estática para
  ligá-la ao dataset (ex.: issue → erro).
- `format`: `text` (padrão), `number`, `code` (monoespaçado), `date` (ISO vira `03/11 22:41`),
  `status` (bolinha + rótulo), `level` (bolinha na cor de gravidade + nome do nível, com a
  explicação do `glossary` ao passar o mouse), `percent`
  (0,25 vira 25%) ou `link` (URL `http(s)`, com `link_text`).
- `numeric: true` alinha à direita. `unit` acrescenta a unidade.
- Busca acima de 8 linhas, paginação, e ordenação ao clicar no cabeçalho.

## `text`: resumo, leitura e próximos passos

```json
{ "type": "text", "variant": "summary", "status": "critical", "title": "Em resumo", "paragraphs": [
  "O Robô Faturamento teve **438 erros** nos últimos 45 dias, e eles **aumentaram desde 21/10**."
] }
```

```json
{ "type": "text", "title": "O que fazer agora", "paragraphs": ["**Fato:** …", "**Hipótese:** …"], "bullets": ["…", "…"] }
```

- `variant: "summary"`: cartão em destaque, com letra maior e faixa lateral na cor de `status`. É a
  primeira seção da visão geral (o build avisa quando falta).
- Markdown aceito em `paragraphs` e `bullets`: `**negrito**`, `*itálico*`, `` `código` `` e
  `[texto](https://…)`. Nada mais: listas vêm de `bullets`, e títulos, do `title` da seção.
