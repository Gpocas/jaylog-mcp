# Paleta

As cores vêm do OpenTelemetry (`$otel-colors` do site opentelemetry.io): azul `hsl(228,37%,49%)` =
`#4f61ab` e laranja `hsl(41,100%,48%)` = `#f5a700`. Elas foram ajustadas e validadas com o
`validate_palette.js` da skill `dataviz` (Delta E em OKLab, simulação de daltonismo
Machado-Oliveira-Fernandes 2009). Os valores ficam no `assets/template.html` como variáveis CSS.
Esta página explica de onde eles vieram, para que uma mudança futura passe pelo mesmo teste.

## Marca

- Barra de topo: gradiente azul `#4f61ab → #5a6cb5` no claro (e `#21262d → #30363d` no escuro) com
  borda inferior laranja `#f5a700`, seguindo a moldura do Tachyon (profiler do CPython).
- O laranja original **não** serve como cor de série: no tema claro passa da faixa de luminosidade
  (OKLCH L 0,785 > 0,77) e tem contraste de 1,97:1. As séries usam versões mais escuras do mesmo tom.

## Séries (categórica, ordem fixa)

| Slot | Tom | Claro | Escuro |
|---|---|---|---|
| 1 | azul OTel | `#4f61ab` | `#677bc7` |
| 2 | âmbar OTel | `#d38f01` | `#c28408` |
| 3 | magenta | `#e87ba4` | `#d55181` |
| 4 | verde | `#008300` | `#008300` |
| 5 | violeta | `#6250d6` | `#9085e9` |
| 6 | água | `#1baf7a` | `#199e70` |

A ordem foi escolhida entre 27 ordens válidas, enumeradas com o validador: era a de maior
separação para daltonismo nos dois temas.

- Claro (superfície `#ffffff`): pior par vizinho com CVD ΔE 14,1 e visão normal ΔE 18,2. Os slots
  2, 3 e 6 ficam abaixo de 3:1 de contraste. A compensação exigida (rótulos ou tabela) é o botão
  "Tabela" de todo gráfico (além do interruptor "Números nas barras" na barra lateral).
- Escuro (superfície `#0d1117`): pior par vizinho com CVD ΔE 12,5 e visão normal ΔE 19,2. Todos ≥ 3:1.

O vermelho fica de fora das séries de propósito, para não ser confundido com a escala de gravidade.
Mais de 6 séries não ganham cor nova: agrupe em "Outros" ou divida o gráfico.

## Gravidade (ordinal: ERROR < EXCEPTION < CRITICAL)

Um único tom de vermelho (o do status crítico), em três níveis de luminosidade. No escuro a ordem se
inverte: o mais grave é o mais claro, porque é o que mais se destaca no fundo escuro.

| Nível | Claro | Escuro |
|---|---|---|
| ERROR | `#ff7e76` | `#b61d25` |
| EXCEPTION | `#d23d3d` | `#ef5854` |
| CRITICAL | `#9e0116` | `#ff7e76` |

As duas versões passam no `--ordinal`: luminosidade monotônica, degraus visíveis e a ponta mais
próxima do fundo com contraste ≥ 2:1.

## Status (reservado)

`good #0ca30c`, `warning #fab219`, `serious #ec835a`, `critical #d03b3b`, `info` = azul da marca.
São as cores da paleta de referência da `dataviz`. Status sempre aparece com bolinha e rótulo,
nunca só pela cor, e nunca é usado como cor de série.

## Sequencial (heatmap)

Do azul quase branco ao azul profundo: claro `#e4e8f6` → `#2b3a78`, escuro `#20263d` → `#9fb0ec`.

## Divergente (matriz de correlação)

Âmbar (OTel) ↔ meio neutro ↔ azul (OTel), para r de −1 a +1. Os polos são as pontas escuras dos dois
tons da marca; o meio é o cinza neutro da `dataviz`, que lê como "nada".

| Ponto | Claro | Escuro |
|---|---|---|
| −1 (opostos) | `#9a6a00` | `#c28408` |
| 0 | `#f0efec` | `#383835` |
| +1 (juntos) | `#2b3a78` (= ponta do sequencial) | `#9fb0ec` (= ponta do sequencial) |

Validação: entre os dois polos, CVD ΔE 25,8 no claro e 24,1 no escuro, e visão normal ΔE 29,2 e
24,7. Os polos ficam fora da faixa de luminosidade das séries categóricas, o que é esperado: são
pontas de rampa, não cores de série. O meio tem contraste baixo com a superfície de propósito
(r ≈ 0 deve sumir); por isso cada célula traz o valor de r escrito e o botão "Tabela" lista os pares.
O vermelho fica de fora para não ser lido como gravidade.

## Interação

- Seleção: categorias não selecionadas ficam com opacidade 0,22, e a selecionada mantém a cor. O
  destaque nunca troca a cor da entidade.
- Seleção em heatmap, grafo e sankey: contorno na cor do texto (`--ink`), 2 a 3 px.
- Ligações de correlação no grafo: tracejado na cor da marca. Ligações de volume: cinza do eixo.
- "Outros" usa o cinza `--muted`, nunca um slot da paleta.

## Revalidar depois de mudar uma cor

Com a skill `dataviz` carregada (o caminho do validador aparece no diretório base dela):

```bash
node <dataviz>/scripts/validate_palette.js "#4f61ab,#d38f01,#e87ba4,#008300,#6250d6,#1baf7a" --mode light --surface "#ffffff"
node <dataviz>/scripts/validate_palette.js "#677bc7,#c28408,#d55181,#008300,#9085e9,#199e70" --mode dark --surface "#0d1117"
node <dataviz>/scripts/validate_palette.js "#ff7e76,#d23d3d,#9e0116" --ordinal --mode light --surface "#ffffff"
node <dataviz>/scripts/validate_palette.js "#b61d25,#ef5854,#ff7e76" --ordinal --mode dark --surface "#0d1117"
# divergente: confira a separação entre os polos (CVD e visão normal)
node <dataviz>/scripts/validate_palette.js "#9a6a00,#2b3a78" --mode light --surface "#ffffff"
node <dataviz>/scripts/validate_palette.js "#c28408,#9fb0ec" --mode dark --surface "#0d1117"
```
