# Formato do spec (JSON)

O `scripts/build.mjs` recebe um JSON neste formato e gera o HTML. Ele valida tudo antes e lista
todos os problemas de uma vez, com o caminho do campo (ex.: `sections[2].chart.series[0].values`).
Exemplo completo: `assets/example-spec.json`.

Todo texto é exibido como **texto puro**: HTML e Markdown aparecem literalmente. Isso é proposital,
porque mensagens de log entram no relatório e não podem virar código na página.

## Raiz

| Campo | Obrigatório | Descrição |
|---|---|---|
| `title` | sim | Título da página e da aba do navegador |
| `subtitle` | não | Uma linha dizendo o recorte (serviço, máquina, período) |
| `period` | não | Texto do período, mostrado ao lado da data de geração (ex.: `20/09/2026 a 03/11/2026`) |
| `source` | não | Tools usadas, para quem quiser refazer a consulta (rodapé) |
| `generated_at` | não | ISO 8601; se omitido, o build usa a hora atual |
| `sections` | sim | Lista de seções, renderizadas na ordem |

Toda seção aceita `title` (h2) e `description` (uma ou duas frases sob o título). Em gráficos o
`title` é obrigatório.

## `kpis`: indicadores no topo

```json
{ "type": "kpis", "items": [
  { "label": "Erros em 45 dias", "value": 715, "hint": "ERROR + EXCEPTION + CRITICAL",
    "status": "critical", "status_label": "Subindo desde 21/10" },
  { "label": "Disco da VM01", "value": 91, "unit": "%", "status": "warning", "status_label": "Acima de 90%" }
]}
```

- `value`: número (formatado em pt-BR) ou texto curto.
- `unit`: opcional. `%` cola no número, as outras unidades ficam com espaço.
- `status`: `good`, `warning`, `serious`, `critical` ou `info`. Sempre aparece com bolinha e
  rótulo (`status_label`, ou o padrão "OK", "Atenção", "Grave", "Crítico", "Info"). A cor nunca
  aparece sozinha.
- `hint`: linha pequena de contexto (ex.: data do pico).

## `alerts`: lista de alertas

```json
{ "type": "alerts", "title": "Alertas", "items": [
  { "severity": "critical", "title": "CPU da VM01 em 95% agora", "detail": "Média de 64% nas últimas 2 h." }
]}
```

`severity` usa os mesmos valores de `status`. Ordene do mais grave para o menos grave.

## `chart`: gráfico

```json
{ "type": "chart", "title": "…", "description": "…", "chart": { "kind": "line | bar | heatmap", … } }
```

Campos comuns do objeto `chart`:

| Campo | Descrição |
|---|---|
| `unit` | Unidade dos valores: aparece no tooltip, na tabela "Ver dados" e, se for `%`, no eixo |
| `dates` | `true` quando os rótulos do eixo são datas ISO (`2026-11-03` ou `2026-11-03T14:00`). Viram `03/11` ou `03/11 14:00` |
| `height` | Altura em px (padrão 340). Barras horizontais com poucas categorias ficam melhor com cerca de 60 px por barra + 40 |
| `palette` | `categorical` (padrão: cores 1 a 6 na ordem das séries) ou `severity` |
| `thresholds` | Linhas de referência: `[{ "value": 90, "status": "critical", "label": "Crítico" }]` |
| `y_min`, `y_max` | Limites do eixo de valores (ex.: `0` e `100` para percentuais) |

Cada série é `{ "name": "…", "values": [números ou null] }`, com um valor por posição do eixo.
`null` deixa um buraco, que é o certo para "sem dado". Zero significa "medido e deu zero".
Máximo de 6 séries por gráfico.

### `line`: evolução contínua no tempo

```json
{ "kind": "line", "dates": true, "unit": "%", "y_min": 0, "y_max": 100,
  "x": ["2026-11-03T00:00", "2026-11-03T01:00"],
  "thresholds": [{ "value": 80, "status": "warning", "label": "Atenção" }, { "value": 90, "status": "critical", "label": "Crítico" }],
  "series": [{ "name": "CPU da máquina", "values": [40.2, 45.1] }, { "name": "Memória da máquina", "values": [50, 50.4] }] }
```

### `bar`: comparação e contagens

```json
{ "kind": "bar", "categories": ["VM01 · bot", "VM02 · bot"], "horizontal": true, "unit": "erros",
  "series": [{ "name": "Erros", "values": [512, 203] }] }
```

- `horizontal: true` para comparar entidades (instâncias, serviços), ordenadas da maior para a menor.
- `stacked: true` para composição (ex.: erros por nível em cada dia).
- `palette: "severity"`: as séries devem se chamar `ERROR`, `EXCEPTION` e `CRITICAL`, nessa ordem,
  e recebem a escala de gravidade (um único tom de vermelho, do mais claro ao mais escuro).

### `heatmap`: concentração em duas dimensões

```json
{ "kind": "heatmap", "unit": "erros",
  "x": ["00h", "01h", "…", "23h"], "y": ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"],
  "values": [[0, 0, 3], [1, 0, 0]] }
```

`values` é uma lista de `[índice_x, índice_y, valor]`. Os índices começam em 0. O primeiro item de
`y` fica no topo. Usa a escala sequencial azul, do claro (pouco) ao escuro (muito).

Todo gráfico ganha automaticamente um botão "Ver dados", que mostra os mesmos números numa tabela
ordenável. É a alternativa acessível ao gráfico e não precisa ser declarada.

## `table`: tabela ordenável

```json
{ "type": "table", "title": "Principais erros",
  "columns": [
    { "key": "level", "label": "Nível", "format": "status" },
    { "key": "message", "label": "Mensagem", "format": "code" },
    { "key": "count", "label": "Ocorrências", "numeric": true },
    { "key": "last", "label": "Última", "format": "date" }
  ],
  "rows": [{ "level": "critical", "message": "KeyError: 'cnpj'", "count": 312, "last": "2026-11-03T22:41" }] }
```

- `format`: `text` (padrão), `number`, `code` (monoespaçado e com quebra de linha, bom para
  mensagens e ids), `date` (ISO vira `03/11 22:41`) ou `status` (valor `good`/`warning`/…,
  exibido com bolinha e rótulo).
- `numeric: true` alinha à direita. `unit` acrescenta a unidade ao número.
- Clicar no cabeçalho ordena a coluna, e clicar de novo inverte.

## `text`: leitura e próximos passos

```json
{ "type": "text", "title": "Leitura", "paragraphs": ["…"], "bullets": ["…", "…"] }
```
