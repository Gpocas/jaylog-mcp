---
name: jaylog-html-report
description: Gera relatórios visuais do Jaylog em HTML autocontido (um único arquivo que abre offline no navegador, com gráficos ECharts embutidos), como panorama de erros de um serviço, saúde de máquinas (CPU, memória, disco), versão visual do relatório de incidentes ou comparativo entre serviços. O layout, os componentes e as cores (baseadas no OpenTelemetry, validadas para daltonismo e com tema claro e escuro) são sempre os mesmos. Use sempre que o usuário pedir relatório visual, dashboard, painel, gráficos, "em HTML", "com gráfico", para visualizar ou plotar dados do Jaylog, ou uma versão visual de um relatório, mesmo sem citar "HTML" nem "Jaylog".
---

# Relatórios visuais do Jaylog em HTML

Você monta um **spec em JSON** com os dados e as seções, e o script `scripts/build.mjs` gera o HTML
a partir do template padrão. A divisão existe por dois motivos:

- **Padronização.** Se o modelo escrevesse HTML a cada vez, cada relatório sairia com um layout
  diferente. Com o template, todos têm o mesmo cabeçalho, os mesmos cartões, as mesmas cores, o
  botão de tema e a tabela "Ver dados" em todo gráfico.
- **Funciona offline.** O ECharts e os dados ficam dentro do arquivo (cerca de 1,1 MB). Ele abre
  sem internet e atrás do proxy corporativo, onde um gráfico que carrega a biblioteca de um CDN
  apareceria em branco.

Os caminhos abaixo são relativos ao diretório base desta skill. O script precisa só do Node 18+,
que o MCP do Jaylog já exige. Se as tools do Jaylog não estiverem disponíveis, avise que o MCP não
está configurado ou autenticado (`npx -y github:Gpocas/jaylog-mcp login`, com `JAYLOG_URL`
definida) e pare. Não invente dados.

## 1. Escolher o relatório

Identifique qual dos tipos abaixo atende o pedido. Se faltar o recorte (qual serviço, qual máquina,
qual período), pergunte numa única pergunta de múltipla escolha (`AskUserQuestion`, se disponível),
oferecendo os favoritos (`list-favorite-services`) como atalho.

| Tipo | Pergunta que responde | Seções típicas |
|---|---|---|
| **Panorama de um serviço** | "Como está o serviço X?" | KPIs → alertas → erros por dia e nível → erros por instância → recursos da instância mais afetada → heatmap dia × hora → principais erros → issues abertas → leitura |
| **Saúde de máquinas** | "Como estão as máquinas / a VM01?" | KPIs → alertas → tabela de instâncias (agora e pico) → CPU e memória ao longo do tempo das máquinas com alerta → leitura |
| **Incidentes (visual)** | Versão visual do `jaylog-incident-report` | KPIs por categoria → erros por serviço → serviços parados → agendamentos não cumpridos → máquinas no limite → issues |
| **Comparativo de serviços** | "Quais serviços mais erram?" | KPIs → erros em 45 dias por serviço (barra horizontal) → evolução diária dos 3 a 5 principais → tabela |

Esses são pontos de partida. Tire as seções que não têm dado e acrescente o que o pedido exigir.

## 2. Coletar os dados

Faça em paralelo as chamadas que não dependem uma da outra. Para agregar muitos registros (contar
logs por hora, somar por instância), escreva um script curto (Node ou Python) em vez de contar à
mão. Conta de cabeça em centenas de linhas erra.

- **`get-error-summary`** (`service`, `days` ≤ 45): total do serviço e erros por instância. Gera os
  KPIs e o gráfico de barras horizontal por instância. Quando houver instância com
  `possibly_pruned: true`, escreva na `description` que os números por instância cobrem só os logs
  mais recentes.
- **`get-error-history`** (`service`, `from`/`to`): série diária por nível, usada na barra
  empilhada com `palette: "severity"`. A resposta **só traz os dias que tiveram erro**: preencha os
  dias faltantes com 0 para o eixo não pular datas.
- **`get-resource-usage`** (`service` ou `hostname`, `hours` ≤ 48): alertas prontos e a situação
  atual de cada instância. Os campos `alerts` viram itens da seção `alerts` (crítico para
  CPU/memória/disco no limite, atenção para crescimento de memória, info para falta de amostras), e
  o resto vira tabela.
- **`get-host-metrics`** (`service`, `hostname`, `username`, `bucket_minutes`): série de recursos
  para o gráfico de linha. Escolha o tamanho do intervalo para ter até cerca de 300 pontos (48 h com
  intervalo de 10 min = 288). Use os campos `*_avg`.
- **`list-logs`**: principais erros (agrupe por mensagem, ignorando ids e números) e heatmap
  dia da semana × hora. Converta o horário para o fuso local antes de agrupar e diga o fuso na
  `description`.
- **`list-issues`**, **`list-hosts`**, **`get-latest-logs`**: issues abertas, versões em produção e
  liveness, quando o tipo de relatório pedir.

## 3. Montar o spec

O formato completo, com um exemplo por componente, está em `references/spec.md`. Um relatório
completo de exemplo está em `assets/example-spec.json`. Regras que mantêm o relatório legível:

- **Comece pelo que se responde em 5 segundos.** De 2 a 6 KPIs no topo, e depois os alertas, do
  mais grave para o menos grave. Um número sozinho é KPI, não gráfico.
- **Um gráfico, uma pergunta.** O título diz o que se vê ("Erros por dia e nível"). A descrição
  diz de onde vem o dado e o que notar ("O volume sobe a partir de 21/10").
- **Escolha a forma pela pergunta:**
  - evolução contínua (CPU, memória) → `line`;
  - contagem por dia → `bar`;
  - composição por nível → `bar` com `stacked` e `palette: "severity"`;
  - comparar instâncias ou serviços → `bar` com `horizontal`, da maior para a menor;
  - concentração em duas dimensões (dia × hora) → `heatmap`.
- **Uma unidade por gráfico.** Percentual e bytes nunca no mesmo gráfico. Sem eixo duplo: faça dois
  gráficos.
- **No máximo 6 séries.** Agrupe o resto em "Outros". A mesma instância ou o mesmo serviço fica na
  mesma posição da lista em todos os gráficos, porque a cor acompanha a entidade, e não o ranking.
- **Limites como referência.** Em percentuais de recurso, use `thresholds` de 80 (warning) e
  90 (critical), e `y_min: 0`, `y_max: 100`.
- **Status é reservado.** `good`/`warning`/`serious`/`critical` só aparecem em KPIs, alertas,
  limites e colunas de status, sempre com rótulo. As cores e a validação estão em
  `references/palette.md`. Não troque cores por relatório.
- **Sem dado não é zero.** Use `null` em séries sem medição. Se uma seção inteira ficar sem dado,
  troque-a por uma seção `text` dizendo o que faltou, em vez de mostrar um gráfico vazio.
- **Dados sensíveis.** Mensagens de log podem ter CPF, CNPJ, e-mails, tokens e senhas. Troque por
  valores fictícios no mesmo formato antes de pôr no spec, porque o HTML costuma ser repassado.
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

Se o build listar problemas, corrija o spec e rode de novo. Ele aponta o campo exato. Os avisos
(muitos pontos ou barras) não impedem a geração, mas normalmente indicam que vale agregar mais.

## 5. Conferir e entregar

- Se você tiver como ver a página (ferramenta de screenshot ou navegador), abra e olhe:
  sobreposição de rótulos, gráfico vazio, número estranho. O build valida a estrutura, não o
  conteúdo.
- Informe o caminho do arquivo e ofereça abrir. No Linux use `xdg-open <arquivo>`, no macOS
  `open <arquivo>`, no Windows `start "" <arquivo>` e no WSL `explorer.exe "$(wslpath -w <arquivo>)"`.
- No chat, resuma em 3 a 5 linhas o que o relatório mostra (o principal problema e o próximo
  passo). Não repita o relatório inteiro.

## Cuidados

- Não edite o HTML gerado nem crie um template por relatório. Se faltar um componente, ele deve
  entrar no `assets/template.html` e no `build.mjs`, para valer para todos os relatórios.
- O arquivo tem cerca de 1,1 MB por causa do ECharts embutido. Isso é esperado.
- O ECharts (Apache-2.0) fica em `assets/vendor/`, com `ECHARTS-LICENSE` e `ECHARTS-NOTICE`. Para
  atualizar, substitua o `echarts.min.js` pelo da versão nova do pacote `echarts` no npm, confira
  o hash do pacote e regenere o exemplo para testar.
