---
name: jaylog-incident-report
description: Gera um relatório de incidentes do ecossistema Jaylog em markdown (por padrão do dia anterior), consolidando erros nos logs, serviços parados, agendamentos não cumpridos e issues, depois de uma entrevista rápida de múltipla escolha para a pessoa personalizar escopo, período e conteúdo. Use sempre que o usuário pedir relatório de incidentes, resumo do que deu errado ontem, balanço diário de erros, "como foi a noite/o dia dos serviços", status dos bots/serviços, relatório dos meus serviços favoritos ou de um dono específico, ou health check diário, mesmo que não cite "Jaylog" nem "relatório" explicitamente.
---

# Relatório de incidentes Jaylog

Produz um relatório em markdown do que deu errado, usando as tools do MCP `jaylog` (somente leitura). O leitor típico abre o relatório de manhã para decidir o que atacar primeiro, então ele precisa dizer rápido **quem está quebrado, desde quando e quem acionar**, e deixar o detalhe para quem quiser se aprofundar. Como cada pessoa quer um recorte diferente (só os próprios serviços, só o que é crítico, sem contatos...), a skill começa com uma entrevista curta para montar o relatório sob medida.

Se as tools do Jaylog (`list-logs`, `get-latest-logs` etc.) não estiverem disponíveis, avise que o MCP não está configurado/autenticado (`npx -y jaylog-mcp login`, com `JAYLOG_URL` definida) e pare. Não invente dados.

## 1. Entrevista de personalização

Use a tool de perguntas de múltipla escolha (`AskUserQuestion`), numa única chamada com as perguntas abaixo. Marque a opção padrão como "(Recomendado)" e coloque-a primeiro: quem só quer o relatório de sempre escolhe a primeira opção de cada pergunta e segue em frente. A pessoa pode digitar outra resposta em "Outra".

| Pergunta (cabeçalho) | Tipo | Opções |
|---|---|---|
| **Escopo**: de quais serviços? | única | Todos os serviços (Recomendado) · Só os meus favoritos · Serviços de um owner (nome ou e-mail) |
| **Categorias**: o que entra? | múltipla | Erros nos logs · Serviços parados · Agendamentos não cumpridos · Issues |
| **Período**: qual janela? | única | Ontem (Recomendado) · Últimos 3 dias · Últimos 7 dias · (Outra: data ou intervalo) |
| **Extras**: o que mais? | múltipla | Contatos de quem acionar · Mensagem/traceback completo dos erros principais · Só CRITICAL e EXCEPTION (ignorar ERROR) |

Regras para não virar burocracia:

- **Pergunte só o que falta.** Se o pedido já responde algo ("relatório de ontem dos meus favoritos"), não pergunte de novo: omita essa pergunta e confirme a escolha na resposta final.
- **Pule a entrevista** se a pessoa disser que quer o padrão, "rápido" ou "sem perguntas", ou se a skill estiver rodando sem ninguém para responder (rotina agendada, `/loop`). Nesse caso use o **padrão**: todos os serviços, as quatro categorias, ontem, com contatos e mensagens completas, todos os níveis de erro.
- **Sem a tool de perguntas** (outro cliente, por exemplo), faça as mesmas perguntas numa única mensagem de texto, com opções numeradas, e espere a resposta.
- Nada marcado em "Categorias" significa todas; nada marcado em "Extras" significa que os extras ficam de fora (foi uma escolha).
- Se escolheu "Serviços de um owner", faça uma pergunta de texto curta pedindo o nome ou e-mail do dono.

Guarde as escolhas: elas guiam a coleta e vão para o cabeçalho do relatório, para o leitor saber o que está (e o que não está) ali.

## 2. Resolver o escopo

Descubra a lista de serviços do recorte antes de coletar dados; as categorias da etapa 4 serão filtradas por ela.

- **Todos:** sem filtro.
- **Favoritos:** `list-favorite-services` (favoritos do usuário logado no MCP). Se vier vazio, diga isso e ofereça rodar com todos os serviços.
- **Owner:** `search-services-by-owner` com `name` ou `email`. Descarte quem não tem serviços. Se mais de uma pessoa bater com serviços, confirme qual (ou quais) com uma pergunta de múltipla escolha listando as pessoas encontradas (nome e quantos serviços), ou peça para refinar se forem muitas. Nenhum resultado: diga que não encontrou e pare.

Essas duas tools exigem perfil `standard` ou superior; se falharem por permissão, avise e ofereça o escopo "todos".

Para filtrar, guarde os `id` dos serviços do escopo. Com poucos serviços (até uns 10), consulte cada um pelo filtro `service`; com muitos, busque no conjunto geral e filtre pelos ids localmente.

## 3. Definir a janela

- Padrão: o dia anterior inteiro, 00:00 a 23:59:59 no fuso local da máquina. Respeite o período escolhido na entrevista (um dia, vários dias ou um intervalo informado).
- Descubra datas e offset com `date` (ex.: `date -d yesterday +%F` e `date +%:z`). Não calcule de cabeça.
- Monte `log_timestamp_from` / `log_timestamp_to` em ISO 8601 **com offset** (ex.: `2026-10-03T00:00:00-03:00`). Os logs podem estar em UTC, e um dia local não coincide com um dia UTC; o offset evita perder ou duplicar eventos nas bordas.
- Janelas de vários dias: o volume de `list-logs` cresce rápido e os logs brutos têm retenção limitada. Dimensione com `get-error-history` (contagens diárias por serviço, alcance maior) e use `list-logs` só nos serviços mais ofensores.

## 4. Coletar as categorias escolhidas

Faça as chamadas independentes em paralelo. Cada categoria selecionada é um tipo de incidente, e uma sem ocorrências deve aparecer no relatório como "nenhum", e não ser omitida: quem lê precisa saber que foi verificada. Categorias que a pessoa não selecionou não entram (nem como "nenhum").

**a) Erros nos logs**
- `list-logs` com a janela e `log_level` = `ERROR`, `CRITICAL` e `EXCEPTION` (uma chamada por nível, o filtro é exato), mais `is_exception: true` se `EXCEPTION` não retornar nada, pois exceções às vezes vêm marcadas só por essa flag. Se a pessoa pediu "só CRITICAL e EXCEPTION", pule `ERROR`.
- Agrupe por serviço e depois por mensagem parecida (ignore ids, timestamps e números variáveis ao comparar). Conte ocorrências, anote primeira e última ocorrência e os hosts afetados.
- Se a resposta vier enorme ou truncada, use `get-error-history` para dimensionar e `list-logs` com filtro por serviço só nos mais ofensores. Registre no relatório que a amostra foi parcial.
- Se escolheu o extra de mensagem completa, use `get-log` nos 1–3 erros mais relevantes de cada serviço; a lista pode estar resumida. Sem o extra, basta a mensagem principal.

**b) Serviços parados**
- `get-latest-logs` traz o último log por instância com dados de liveness (execução ativa, última atividade, múltiplas execuções vivas).
- Considere incidente: instância sem execução ativa que deveria estar rodando, última atividade muito antiga, ou mais de uma execução viva ao mesmo tempo (duplicidade). Um serviço agendado que roda e termina normalmente não está "parado": confira com os agendamentos antes de classificar.

**c) Agendamentos não cumpridos**
- `list-service-schedules` (ativos). Veja quais deveriam ter rodado na janela: `DIARIO` todo dia; `SEMANA` se `day_of_week` bate com o dia analisado; `DIA` se `day_of_month` bate; `CONTINUO` deveria ter logs ao longo do dia.
- Para cada um, confira com `list-logs` (filtro `service`, intervalo em torno do horário) se houve atividade. Sem logs no horário = candidato a não cumprido. Tolere alguns minutos de atraso e lembre que `source: TASK_SCHEDULER` vem do agendador do Windows do host.
- Se houver muitos agendamentos, priorize os de serviços que também apareceram em (a) ou (b) e diga no relatório quantos foram conferidos.

**d) Issues**
- `list-issues` e filtre pelas que foram criadas ou alteradas na janela, usando os campos de data que a resposta trouxer. Se a resposta não tiver campo de data, diga isso em vez de adivinhar, e liste as abertas (`state: open`/`working`) dos serviços que tiveram incidentes.

Em todas as categorias, descarte o que não pertence aos serviços do escopo (etapa 2).

## 5. Contatos (se escolhido)

Para cada serviço que aparece em alguma categoria, busque quem acionar: `list-service-key-users` (filtro `service_id`) e `list-key-users` para nome e e-mail. O `owner` que vem em `list-services` é só um ID de usuário, sem nome; cite o nome do dono apenas quando você o tiver (por exemplo, vindo de `search-services-by-owner`). Um incidente sem contato é pouco acionável, e por isso o extra é recomendado, mas sem ele a coluna "Contato" sai do relatório.

## 6. Escrever o relatório

Salve em `./reports/`, criando a pasta se não existir:

- Um dia: `incidentes-AAAA-MM-DD.md` (data do dia **analisado**, não a de hoje).
- Vários dias: `incidentes-AAAA-MM-DD_a_AAAA-MM-DD.md`.
- Escopo diferente de "todos": acrescente `-favoritos` ou `-<owner>` (nome em minúsculas, sem acentos nem espaços), para um relatório recortado não sobrescrever o geral.

Se o arquivo já existir, sobrescreva: o relatório é regerável a partir dos dados. Use este formato, em português, **omitindo as seções e colunas que a personalização excluiu**:

```markdown
# Relatório de incidentes — DD/MM/AAAA

Gerado em DD/MM/AAAA HH:MM · janela: <início> a <fim> (<fuso>)
Escopo: <todos os serviços | favoritos de <usuário> | serviços de <owner>> · Categorias: <lista> · Níveis: <todos | CRITICAL e EXCEPTION>

## Resumo
- N serviços com erros (X erros/críticos/exceções no total)
- N serviços parados
- N agendamentos não cumpridos
- N issues abertas/alteradas

Prioridades: 1–3 linhas dizendo o que atacar primeiro e por quê.

## Erros nos logs
| Serviço | Nível | Ocorrências | Primeira / última | Mensagem principal | Contato |
|---|---|---|---|---|---|

(Se escolheu mensagens completas: detalhe dos 1–3 erros mais relevantes, com mensagem completa ou traceback resumido, hosts afetados, id do log.)

## Serviços parados
| Serviço | Host / usuário | Última atividade | Observação | Contato |

## Agendamentos não cumpridos
| Serviço | Agendamento | Esperado | Observado | Contato |

## Issues
| Issue | Serviço | Estado | Responsável | Observação |

## Limitações
O que não pôde ser verificado ou foi amostrado (resposta truncada, categoria sem campo de data etc.).
```

Ordene cada tabela por gravidade (CRITICAL/EXCEPTION antes de ERROR; mais ocorrências primeiro). Categoria selecionada sem ocorrências: uma linha "Nenhum incidente identificado." no lugar da tabela. O resumo só conta as categorias incluídas.

## 7. Responder no chat

Termine com um resumo curto (3–6 linhas): as escolhas de personalização usadas, os números do topo, a prioridade principal e o caminho do arquivo gerado. Não cole o relatório inteiro no chat; ele está no arquivo.

## Cuidados

- Todas as tools são de leitura; nada aqui cria, altera ou fecha issues. Se o usuário quiser agir sobre um incidente, sugira a skill `jaylog-fix-service-errors` para erros de código.
- Separe fato de hipótese: "causa provável" só com evidência (mensagem, traceback, padrão de horário). Não atribua causa a um serviço parado só pela ausência de logs.
- Não inclua dados sensíveis que apareçam em mensagens de log (tokens, senhas, dados pessoais); mascare-os no relatório.
