---
name: jaylog-incident-report
description: Gera o relatório de incidentes do dia anterior (ou de outra data) do ecossistema Jaylog em markdown, consolidando erros nos logs, serviços parados, agendamentos não cumpridos e issues. Use sempre que o usuário pedir relatório de incidentes, resumo do que deu errado ontem, balanço diário de erros, "como foi a noite/o dia dos serviços", status dos bots/serviços ou health check diário, mesmo que não cite "Jaylog" nem "relatório" explicitamente.
---

# Relatório de incidentes Jaylog

Produz um relatório em markdown do que deu errado no dia anterior, usando as tools do MCP `jaylog` (somente leitura). O leitor típico abre o relatório de manhã para decidir o que atacar primeiro, então ele precisa dizer rápido **quem está quebrado, desde quando e quem acionar**, e deixar o detalhe para quem quiser se aprofundar.

Se as tools do Jaylog (`list-logs`, `get-latest-logs` etc.) não estiverem disponíveis, avise que o MCP não está configurado/autenticado (`npx -y jaylog-mcp-server login`) e pare. Não invente dados.

## 1. Definir a janela

- Padrão: o dia anterior inteiro, 00:00 a 23:59:59 no fuso local da máquina. Se o usuário pedir outra data ou intervalo, use essa.
- Descubra a data e o offset com `date` (ex.: `date -d yesterday +%F` e `date +%:z`). Não calcule de cabeça.
- Monte `log_timestamp_from` / `log_timestamp_to` em ISO 8601 **com offset** (ex.: `2026-10-03T00:00:00-03:00`). Os logs podem estar em UTC, e um dia local não coincide com um dia UTC; o offset evita perder ou duplicar eventos nas bordas.

## 2. Coletar as quatro categorias

Faça as chamadas independentes em paralelo. Cada categoria é um tipo de incidente, e uma categoria sem ocorrências deve aparecer no relatório como "nenhum", e não ser omitida: quem lê precisa saber que foi verificada.

**a) Erros nos logs**
- `list-logs` com a janela e `log_level` = `ERROR`, `CRITICAL` e `EXCEPTION` (uma chamada por nível, o filtro é exato), mais `is_exception: true` se `EXCEPTION` não retornar nada, pois exceções às vezes vêm marcadas só por essa flag.
- Agrupe por serviço e depois por mensagem parecida (ignore ids, timestamps e números variáveis ao comparar). Conte ocorrências, anote primeira e última ocorrência e os hosts afetados.
- Se a resposta vier enorme ou truncada, use `get-error-history` (contagens diárias por serviço) para dimensionar e `list-logs` com filtro por serviço só nos mais ofensores. Registre no relatório que a amostra foi parcial.
- Use `get-log` para trazer a mensagem completa apenas dos 1–3 erros mais relevantes de cada serviço; a lista pode estar resumida.

**b) Serviços parados**
- `get-latest-logs` traz o último log por instância com dados de liveness (execução ativa, última atividade, múltiplas execuções vivas).
- Considere incidente: instância sem execução ativa que deveria estar rodando, última atividade muito antiga, ou mais de uma execução viva ao mesmo tempo (duplicidade). Um serviço agendado que roda e termina normalmente não está "parado": confira com os agendamentos antes de classificar.

**c) Agendamentos não cumpridos**
- `list-service-schedules` (ativos). Veja quais deveriam ter rodado na janela: `DIARIO` todo dia; `SEMANA` se `day_of_week` bate com o dia analisado; `DIA` se `day_of_month` bate; `CONTINUO` deveria ter logs ao longo do dia.
- Para cada um, confira com `list-logs` (filtro `service`, intervalo em torno do horário) se houve atividade. Sem logs no horário = candidato a não cumprido. Tolere alguns minutos de atraso e lembre que `source: TASK_SCHEDULER` vem do agendador do Windows do host.
- Se houver muitos agendamentos, priorize os de serviços que também apareceram em (a) ou (b) e diga no relatório quantos foram conferidos.

**d) Issues do dia**
- `list-issues` e filtre pelas que foram criadas ou alteradas na janela, usando os campos de data que a resposta trouxer. Se a resposta não tiver campo de data, diga isso em vez de adivinhar, e liste as abertas (`state: open`/`working`) dos serviços que tiveram incidentes.

## 3. Enriquecer com contatos

Para cada serviço que aparece em alguma categoria, busque quem acionar: `list-service-key-users` (filtro `service_id`) e `list-key-users` para nome e e-mail. Nomes de serviço e dono já vêm resolvidos em `list-services`/`get-latest-logs`. Um incidente sem contato é pouco acionável, então esse passo vale o custo.

## 4. Escrever o relatório

Salve em `./reports/incidentes-AAAA-MM-DD.md` (a data é a do dia **analisado**, não a de hoje), criando a pasta se não existir. Se o arquivo já existir, sobrescreva: o relatório é regerável a partir dos dados. Use este formato, em português:

```markdown
# Relatório de incidentes — DD/MM/AAAA

Gerado em DD/MM/AAAA HH:MM · janela: <início> a <fim> (<fuso>)

## Resumo
- N serviços com erros (X erros/críticos/exceções no total)
- N serviços parados
- N agendamentos não cumpridos
- N issues abertas/alteradas

Prioridades: 1–3 linhas dizendo o que atacar primeiro e por quê.

## Erros nos logs
| Serviço | Nível | Ocorrências | Primeira / última | Mensagem principal | Contato |
|---|---|---|---|---|---|

(Detalhe dos 1–3 erros mais relevantes: mensagem completa ou traceback resumido, hosts afetados, id do log.)

## Serviços parados
| Serviço | Host / usuário | Última atividade | Observação | Contato |

## Agendamentos não cumpridos
| Serviço | Agendamento | Esperado | Observado | Contato |

## Issues
| Issue | Serviço | Estado | Responsável | Observação |

## Limitações
O que não pôde ser verificado ou foi amostrado (resposta truncada, categoria sem campo de data etc.).
```

Ordene cada tabela por gravidade (CRITICAL/EXCEPTION antes de ERROR; mais ocorrências primeiro). Categoria sem ocorrências: uma linha "Nenhum incidente identificado." no lugar da tabela.

## 5. Responder no chat

Termine com um resumo curto (3–6 linhas): os números do topo, a prioridade principal e o caminho do arquivo gerado. Não cole o relatório inteiro no chat; ele está no arquivo.

## Cuidados

- Todas as tools são de leitura; nada aqui cria, altera ou fecha issues. Se o usuário quiser agir sobre um incidente, sugira a skill `jaylog-fix-service-errors` para erros de código.
- Separe fato de hipótese: "causa provável" só com evidência (mensagem, traceback, padrão de horário). Não atribua causa a um serviço parado só pela ausência de logs.
- Não inclua dados sensíveis que apareçam em mensagens de log (tokens, senhas, dados pessoais); mascare-os no relatório.
