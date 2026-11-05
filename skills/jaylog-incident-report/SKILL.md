---
name: jaylog-incident-report
description: Gera um relatório de incidentes do ecossistema Jaylog (por padrão do dia anterior) com 3 opções de visualização — Harness (listas estruturadas direto no chat/terminal, padrão), Markdown (arquivo .md com tabelas) e HTML interativo (painel com gráficos) —, consolidando erros nos logs, serviços parados, agendamentos não cumpridos, issues e máquinas com recursos no limite (CPU, memória, disco), depois de uma entrevista rápida de múltipla escolha para personalizar escopo, período e conteúdo. Use sempre que o usuário pedir relatório de incidentes, resumo do que deu errado ontem, balanço diário de erros, "como foi a noite/o dia dos serviços", status dos bots/serviços, máquinas sobrecarregadas ou sem espaço em disco, relatório dos meus serviços favoritos ou de um dono específico, ou health check diário, mesmo que não cite "Jaylog" nem "relatório" explicitamente.
---

# Relatório de incidentes Jaylog

Produz um relatório do que deu errado usando as tools do MCP `jaylog` (somente leitura), com **três modos de visualização**: **Harness** (padrão, formatado em listas estruturadas direto no chat para leitura perfeita no terminal, sem tabelas largas que quebram), **Markdown** (arquivo `.md` em `./reports/`) e **HTML** (painel visual interativo em `./reports/`). O leitor típico abre o relatório de manhã para decidir o que atacar primeiro, então ele precisa dizer rápido **quem está quebrado, desde quando e quem acionar**, e deixar o detalhe para quem quiser se aprofundar. Como cada pessoa quer um recorte diferente (só os próprios serviços, só os erros graves, outro período...), a skill começa com uma entrevista curta para montar o relatório sob medida.

Se as tools do Jaylog (`list-logs`, `get-latest-logs` etc.) não estiverem disponíveis, avise que o MCP não está configurado/autenticado (`npx -y github:Gpocas/jaylog-mcp login`, com `JAYLOG_URL` definida) e pare. Não invente dados.

## 1. Entrevista de personalização

Use a tool de perguntas de múltipla escolha (`AskUserQuestion`), numa única chamada com exatamente as quatro perguntas abaixo, sem acrescentar, dividir ou reformular nenhuma (a tool aceita no máximo 4 perguntas com 4 opções cada). Marque a opção padrão como "(Recomendado)" e coloque-a primeiro: quem só quer o relatório de sempre escolhe a primeira opção de cada pergunta e segue em frente. A pessoa pode digitar outra resposta em "Outra".

| Pergunta (cabeçalho) | Tipo | Opções |
|---|---|---|
| **Escopo**: de quais serviços? | única | Todos os serviços (Recomendado) · Só os meus favoritos · Serviços de um owner (nome ou e-mail) |
| **Período**: qual janela? | única | Ontem (Recomendado) · Últimos 3 dias · Últimos 7 dias · (Outra: data ou intervalo) |
| **Erros**: quais níveis de erro dos logs entram? | única | Todos: CRITICAL, EXCEPTION e ERROR (Recomendado) · Só os graves: CRITICAL e EXCEPTION · Nenhum: não incluir erros dos logs |
| **Categorias**: o que mais entra? | múltipla | Serviços parados · Agendamentos não cumpridos · Issues · Recursos das máquinas |

O nível de erro é decidido **só** na pergunta "Erros", que é de escolha única e também diz se os erros entram ou não. Por isso "Erros nos logs" não aparece em "Categorias", e não existe filtro de nível em nenhuma outra pergunta: assim as respostas não podem se contradizer.

Regras para não virar burocracia:

- **Pergunte só o que falta.** Se o pedido já responde algo ("relatório de ontem dos meus favoritos", "só os críticos"), não pergunte de novo: omita essa pergunta e confirme a escolha na resposta final.
- **Pule a entrevista** se a pessoa disser que quer o padrão, "rápido" ou "sem perguntas", ou se a skill estiver rodando sem ninguém para responder (rotina agendada, `/loop`). Nesse caso use o **padrão**: todos os serviços, ontem, todos os níveis de erro e as quatro categorias.
- **Sem a tool de perguntas** (outro cliente, por exemplo), faça as mesmas perguntas numa única mensagem de texto, com opções numeradas, e espere a resposta.
- Nada marcado em "Categorias" significa todas. "Nenhum" em "Erros" com nada marcado em "Categorias" também significa todas as categorias, sem erros dos logs.
- Se escolheu "Serviços de um owner", faça uma pergunta de texto curta pedindo o nome ou e-mail do dono.
- **Contatos e mensagem completa** dos erros principais entram sempre, sem pergunta. Só tire se o pedido disser ("sem contatos", "só a mensagem principal").
- **Formato de visualização (Harness, Markdown, HTML)**: não pergunte na entrevista. Por padrão, apresente na visualização **Harness** (direto no chat, em listas estruturadas sem tabelas Markdown) e ofereça salvar em Markdown (`.md`) ou gerar a versão interativa em HTML (`.html`) na última linha. Se o pedido inicial já pedir Markdown ("em markdown", "salvar .md") ou HTML ("em html", "com gráfico", "painel", "dashboard"), gere o formato pedido e responda com o resumo curto da etapa 7.

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
- Entra conforme a pergunta "Erros": com "Nenhum", pule esta categoria inteira (e não a mostre no relatório).
- `list-logs` com a janela e `log_level` = `CRITICAL`, `EXCEPTION` e `ERROR` (uma chamada por nível, o filtro é exato), mais `is_exception: true` se `EXCEPTION` não retornar nada, pois exceções às vezes vêm marcadas só por essa flag. Com "Só os graves", pule `ERROR`.
- Agrupe por serviço e depois por mensagem parecida (ignore ids, timestamps e números variáveis ao comparar). Conte ocorrências, anote primeira e última ocorrência e os hosts afetados.
- Se a resposta vier enorme ou truncada, use `get-error-history` para dimensionar e `list-logs` com filtro por serviço só nos mais ofensores. Registre no relatório que a amostra foi parcial.
- Para os serviços mais ofensores, `get-error-summary` (com `days` igual à janela) mostra quais instâncias (host + usuário) concentram os erros. Isso diz se o problema é de uma máquina só ou do serviço todo. Com janela de vários dias, ela também dá o total acumulado do serviço.
- Use `get-log` nos 1–3 erros mais relevantes de cada serviço para a mensagem completa; a lista pode estar resumida. Se o pedido disse "só a mensagem principal", pule.

**b) Serviços parados**
- `get-latest-logs` traz o último log por instância com dados de liveness (execução ativa, última atividade, múltiplas execuções vivas).
- Para cada instância parada ou sem atividade recente, `get-resource-usage` (filtro `service` e `include_stopped: true`) mostra se a máquina estava no limite (CPU, memória, disco) ou se o processo vinha crescendo em memória antes de parar. Isso ajuda a separar "caiu por falta de recurso" de "parou por outro motivo". As amostras só existem para as últimas 48 h.
- Considere incidente: instância sem execução ativa que deveria estar rodando, última atividade muito antiga, ou mais de uma execução viva ao mesmo tempo (duplicidade). Um serviço agendado que roda e termina normalmente não está "parado": confira com os agendamentos antes de classificar.

**c) Agendamentos não cumpridos**
- `list-service-schedules` (ativos). Veja quais deveriam ter rodado na janela: `DIARIO` todo dia; `SEMANA` se `day_of_week` bate com o dia analisado; `DIA` se `day_of_month` bate; `CONTINUO` deveria ter logs ao longo do dia.
- Para cada um, confira com `list-logs` (filtro `service`, intervalo em torno do horário) se houve atividade. Sem logs no horário = candidato a não cumprido. Tolere alguns minutos de atraso e lembre que `source: TASK_SCHEDULER` vem do agendador do Windows do host.
- Se houver muitos agendamentos, priorize os de serviços que também apareceram em (a) ou (b) e diga no relatório quantos foram conferidos.

**d) Issues**
- `list-issues` e filtre pelas que foram criadas ou alteradas na janela, usando os campos de data que a resposta trouxer. Se a resposta não tiver campo de data, diga isso em vez de adivinhar, e liste as abertas (`state: open`/`working`) dos serviços que tiveram incidentes.

**e) Recursos das máquinas**
- `get-resource-usage` mostra, por instância, o uso atual e o pico/média de CPU, memória e disco, além de alertas prontos (CPU ou memória alta, disco acima de 90%, memória do processo crescendo, instância sem amostras). Com escopo "todos", chame sem filtro (a tool limita a 40 instâncias e avisa). Com favoritos ou owner, chame uma vez por serviço do escopo.
- Use `hours` cobrindo a janela do relatório até agora (máximo 48). As métricas só ficam guardadas por 48 h, então numa janela maior que isso diga que os dias mais antigos não puderam ser verificados.
- Considere incidente as instâncias com `alerts`, exceto a que só diz "sem amostras", que já entra em (b) como parada. Os valores `host_*` são da máquina inteira: vários serviços na mesma máquina vão mostrar os mesmos números. Agrupe por máquina para não repetir o mesmo problema.
- Para entender um pico específico (por exemplo, no horário de um erro), use `get-host-metrics` daquela instância, que traz a série minuto a minuto.

Em todas as categorias, descarte o que não pertence aos serviços do escopo (etapa 2).

## 5. Contatos

Para cada serviço que aparece em alguma categoria, busque quem acionar: `list-service-key-users` (filtro `service_id`) e `list-key-users` para nome e e-mail. O `owner` que vem em `list-services` é só um ID de usuário, sem nome; cite o nome do dono apenas quando você o tiver (por exemplo, vindo de `search-services-by-owner`). Um incidente sem contato é pouco acionável, por isso os contatos entram sempre; só tire a coluna "Contato" se o pedido disser "sem contatos".

## 6. Montar e entregar o relatório (3 visualizações)

Em qualquer visualização, ordene os itens de cada categoria sempre por gravidade: **CRITICAL**, depois **EXCEPTION**, depois **ERROR** (a mesma escala da skill `jaylog-html-report`); dentro do mesmo nível, mais ocorrências primeiro. Omita as seções e campos que a personalização excluiu. Uma categoria selecionada que não teve ocorrências deve aparecer com a linha `"Nenhum incidente identificado."` (e o resumo do topo só conta as categorias incluídas).

Quando o usuário pedir outro formato depois da primeira entrega (por exemplo, pedir o `.md` ou o `.html` após ver no Harness), **reaproveite os dados já coletados** e não consulte as tools do Jaylog de novo.

### a) Visualização Harness (padrão — direto no chat/terminal)

Use esta visualização por padrão quando o usuário não tiver pedido especificamente arquivo Markdown ou HTML. Muitos harnesses de terminal/TUI não renderizam bem tabelas Markdown de várias colunas (o texto quebra e desalinha); por isso, **não use tabelas Markdown (`| col | col |`) na visualização Harness**. Use apenas títulos (`##`), listas estruturadas com marcadores curtos e blocos de código (` ```text `) somente para tracebacks resumidos:

````markdown
# Relatório de incidentes — DD/MM/AAAA
Janela: <início> a <fim> (<fuso>)
Escopo: <todos os serviços | favoritos de <usuário> | serviços de <owner>> · Erros: <níveis> · Categorias: <lista>

## Resumo
- **Erros nos logs:** N serviços com erros (X no total: C CRITICAL, E EXCEPTION, R ERROR)
- **Serviços parados:** N
- **Agendamentos não cumpridos:** N
- **Issues abertas/alteradas:** N
- **Máquinas com recursos no limite:** N

**Prioridades:**
1. **<Serviço / problema 1>** — o que atacar primeiro, impacto e quem acionar (`email`).
2. **<Serviço / problema 2>** — ...

## Erros nos logs
- **[NÍVEL · N×] SERVIÇO** (`HH:MM` a `HH:MM`)
  - Mensagem: `<mensagem principal>`
  - Hosts: `<host (usuário), ...>` · Log ID: `<id>`
  - Contato: <Nome (`email`)>

**Detalhe dos principais erros (traceback resumido):**
- **SERVIÇO** (`<host / usuário>` · Log ID `<id>`):
  ```text
  <1 a 5 linhas principais do traceback, com dados sensíveis mascarados>
  ```

## Serviços parados
- **SERVIÇO** — `<host / usuário>` (última atividade: `DD/MM/AAAA HH:MM`)
  - Observação: <status de execução/recursos antes de parar ou duplicidade>
  - Contato: <Nome (`email`)>

## Agendamentos não cumpridos
- **SERVIÇO** — `<REPETIÇÃO> <horário> (<origem>)`
  - Esperado: <quando deveria rodar> · Observado: <o que ocorreu nos logs>
  - Contato: <Nome (`email`)>

## Issues
- **[ESTADO] SERVIÇO** — `<título / id da issue>`
  - Responsável: <nome> · Observação: <detalhe>

## Recursos das máquinas
- **MÁQUINA** — `<serviços / usuários afetados>`
  - Alerta: <alerta reportado>
  - Uso (agora / pico): <processo e host>
  - Contato: <Nome (`email`)>

## Limitações
- <O que foi parcial, janela em andamento ou categorias sem dados>
````

Ao final da visualização Harness, termine com uma única linha oferecendo os outros formatos:
`"Quer salvar em arquivo Markdown (.md) ou gerar a versão interativa em HTML (.html)?"`

### b) Visualização Markdown (arquivo `.md` em `./reports/`)

Gere quando o usuário pedir arquivo Markdown no pedido inicial ou depois da resposta no Harness. Salve em `./reports/`, criando a pasta se não existir:

- Um dia: `incidentes-AAAA-MM-DD.md` (data do dia **analisado**, não a de hoje).
- Vários dias: `incidentes-AAAA-MM-DD_a_AAAA-MM-DD.md`.
- Escopo diferente de "todos": acrescente `-favoritos` ou `-<owner>` (nome em minúsculas, sem acentos nem espaços), para um relatório recortado não sobrescrever o geral.

Se o arquivo já existir, sobrescreva: o relatório é regerável a partir dos dados. No arquivo `.md`, use tabelas GFM completas:

```markdown
# Relatório de incidentes — DD/MM/AAAA

Gerado em DD/MM/AAAA HH:MM · janela: <início> a <fim> (<fuso>)
Escopo: <todos os serviços | favoritos de <usuário> | serviços de <owner>> · Erros: <CRITICAL, EXCEPTION e ERROR | só CRITICAL e EXCEPTION | não incluídos> · Categorias: <lista>

## Resumo
- N serviços com erros (X no total: C CRITICAL, E EXCEPTION, R ERROR)
- N serviços parados
- N agendamentos não cumpridos
- N issues abertas/alteradas
- N máquinas com recursos no limite

Prioridades: 1–3 linhas dizendo o que atacar primeiro e por quê.

## Erros nos logs
| Serviço | Nível | Ocorrências | Primeira / última | Mensagem principal | Contato |
|---|---|---|---|---|---|

(Detalhe dos 1–3 erros mais relevantes, com mensagem completa ou traceback resumido, hosts afetados, id do log.)

## Serviços parados
| Serviço | Host / usuário | Última atividade | Observação | Contato |

## Agendamentos não cumpridos
| Serviço | Agendamento | Esperado | Observado | Contato |

## Issues
| Issue | Serviço | Estado | Responsável | Observação |

## Recursos das máquinas
| Máquina | Serviços afetados | Alerta | Agora / pico | Contato |

## Limitações
O que não pôde ser verificado ou foi amostrado (resposta truncada, categoria sem campo de data etc.).
```

### c) Visualização HTML (painel interativo `.html` em `./reports/`)

Gere quando o usuário pedir HTML, gráfico, painel ou dashboard (no pedido inicial ou após o Harness/Markdown), usando a skill `jaylog-html-report` (tipo "Incidentes") e reaproveitando os dados já coletados. Use o mesmo nome base do markdown, com `.spec.json` e `.html` (ex.: `reports/incidentes-2026-11-05.html`). Cada categoria escolhida vira uma seção, e as que não tiveram ocorrência viram uma seção `text` com `"Nenhum incidente identificado."`.

## 7. Responder no chat quando gerar arquivo (`.md` ou `.html`)

- Se a entrega foi na visualização **Harness** (etapa 6a), o próprio relatório estruturado em listas já é a resposta no chat (não repita um segundo resumo abaixo dele; apenas finalize oferecendo `.md` ou `.html`).
- Se você gerou um arquivo **Markdown (`.md`)** ou **HTML (`.html`)**, não cole o relatório inteiro no chat: responda apenas com um resumo curto (3–6 linhas) contendo as escolhas de personalização usadas, os números do topo, a prioridade principal, o caminho do arquivo gerado e, se gerou só um dos arquivos, ofereça o outro numa linha (ex.: `"Quer também a versão interativa em HTML?"`).

## Cuidados

- Todas as tools são de leitura; nada aqui cria, altera ou fecha issues. Se o usuário quiser agir sobre um incidente, sugira a skill `jaylog-fix-service-errors` para erros de código.
- Separe fato de hipótese: "causa provável" só com evidência (mensagem, traceback, padrão de horário). Não atribua causa a um serviço parado só pela ausência de logs.
- Não inclua dados sensíveis que apareçam em mensagens de log (tokens, senhas, dados pessoais); mascare-os no relatório.
