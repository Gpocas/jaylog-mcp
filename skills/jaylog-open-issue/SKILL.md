---
name: jaylog-open-issue
description: Decide se um bug de um serviço Jaylog merece uma issue e, se merecer, abre a issue com a tool `create-issue`. Antes de abrir, confere se o erro já foi corrigido numa versão mais nova, se já existe issue igual, qual a causa, como pode voltar e qual o Exemplo Mínimo Reproduzível (EMR). Também orienta a resolução (planejar a correção, medir o impacto e testar com o EMR). Use sempre que o usuário quiser abrir, registrar, reportar ou criar uma issue, bug, chamado ou ticket contra um serviço, bot ou RPA, mesmo sem citar "Jaylog". Use também quando ele perguntar se vale abrir uma issue para um erro, ou quiser transformar um erro dos logs em issue.
---

# Abrir uma issue no Jaylog

Uma boa issue economiza o tempo de quem vai resolver: diz o que quebrou, em qual versão, como reproduzir e por que provavelmente aconteceu. Uma issue ruim (duplicada, sobre algo já corrigido, sem como reproduzir) gera trabalho e um e-mail inútil para o responsável. Por isso a skill tem duas metades: **decidir se a issue deve existir** e, se sim, **escrevê-la de forma que outra pessoa consiga reproduzir o problema meses depois**.

Se as tools do Jaylog (`list-issues`, `create-issue` etc.) não estiverem disponíveis, avise que o MCP não está configurado/autenticado (`npx -y github:Gpocas/jaylog-mcp login`, com `JAYLOG_URL` definida) e pare. Não invente dados.

## 1. Identificar o serviço e o problema

- Ache o serviço com `list-services` (`name`, substring) ou `search-services-by-owner`. Com mais de um candidato, pergunte qual (múltipla escolha com `AskUserQuestion`, se disponível). Guarde o `id`; a `create-issue` exige o UUID do serviço.
- Entenda o sintoma nas palavras do usuário: o que ele esperava e o que aconteceu.
- Junte evidência no Jaylog:
  - `list-logs` com `service` e níveis `ERROR`/`CRITICAL`/`EXCEPTION`, na janela em que o problema aconteceu.
  - `get-log` no exemplar mais recente, para ter a mensagem completa e o traceback.
  - `get-error-history` para saber desde quando acontece e se está piorando.
  - `get-error-summary` para o tamanho do problema: total de erros do serviço nos últimos 45 dias e quais instâncias (host + usuário) são afetadas. Isso alimenta a seção "Impacto" da issue. Erro numa instância só também sugere causa de ambiente ou versão (seção 2).
  - Anote ids dos logs, primeira e última ocorrência, hosts e usuários afetados.

## 2. Descobrir em qual versão o erro acontece

Saber a versão é o que permite reproduzir o problema depois. Também revela o caso mais comum de issue desnecessária: o erro já foi corrigido e a máquina só está rodando código antigo.

- `list-hosts` (`service_id`, `live: true`) traz o que cada instância reporta: branch e commit do git, versão do Python, versão do jaylog e venv.
- Se a pasta atual for o repositório do serviço (os caminhos do traceback existem aqui), compare com a versão mais recente:
  - `git fetch` e `git log --oneline <commit-da-instância>..origin/main -- <arquivos do traceback>` mostram o que mudou depois da versão em produção no trecho que quebrou.
  - Leia esses commits. Se algum já corrige o erro, a instância só está desatualizada.
- Se não tiver acesso ao repositório, registre a versão reportada pelo host mesmo assim. Ela vai para a issue.

## 3. Decidir se a issue deve ser aberta

Passe pelos filtros abaixo, nesta ordem. Cada "não abra" economiza uma notificação para alguém.

1. **Já corrigido numa versão mais nova** (o commit da correção existe, mas a instância roda um commit anterior): não abra issue de bug. Diga ao usuário qual commit corrige e que o caminho é atualizar a instância (deploy/`git pull`). Se quem pode atualizar é outra pessoa, recomende falar com o dono do serviço. Abrir issue só para cobrar deploy de algo já resolvido incomoda e não acelera nada.
2. **Já existe issue aberta para o mesmo problema**: rode `list-issues` com `service` (e `title` com palavras-chave do erro), olhando os estados `open` e `working`. Se uma delas descreve o mesmo sintoma ou a mesma causa, não abra outra. Mostre a existente (id, título, responsável). Se houver evidência nova, sugira acrescentá-la à descrição com `update-issue`, o que só funciona se o usuário for o autor (senão, combine com o autor ou com o responsável).
3. **Já houve issue `merged` ou `closed` para o mesmo problema**: é uma **regressão** ou uma correção incompleta. Abra uma issue nova (as fechadas não podem ser reeditadas) e cite o id da anterior na descrição, com o `commit` e a `solution` dela, se houver (`get-issue`).
4. **Não é bug do serviço**: falha pontual de dependência externa que já se normalizou, erro de uso, credencial expirada ou máquina sem recurso. Para conferir o último caso, use `get-resource-usage` (últimas 48 h) e `get-host-metrics` no horário do erro. Se o próprio processo vinha crescendo em memória (`proc_mem_change_pct` alto), o problema pode ser do código, como um vazamento de memória, e aí cabe issue. Explique por que provavelmente não cabe issue e pergunte se o usuário quer abrir mesmo assim, por exemplo para pedir mais resiliência ou monitoramento. Nesse caso, o título deve deixar claro que o pedido é esse.
5. **Mais de um problema misturado**: uma issue por problema. Erros com causas diferentes, abertos juntos, não conseguem ser fechados juntos.

Se a decisão for não abrir, termine aqui com a explicação e o próximo passo recomendado.

## 4. Antes de resolver: entender o problema

Responda às perguntas abaixo antes de escrever a issue. Elas forçam a separar sintoma de causa, e as respostas formam o corpo da issue. Quando algo não puder ser confirmado, escreva como hipótese ("provável causa: ...", "não confirmado") em vez de afirmar. Uma causa errada apresentada como certa desvia quem for resolver.

- **Qual foi o problema?** O sintoma observável: o que deveria acontecer, o que aconteceu, quando, com que frequência e com que impacto (quem ou qual processo foi afetado, se houve dado errado ou perdido, se há contorno).
- **Por que ele aconteceu?** A causa raiz, não só a linha que estourou. Pergunte "por quê?" até chegar a uma condição que dá para corrigir. Por exemplo: `KeyError: 'cnpj'` → a API passou a omitir o campo quando vazio → o código assume que o campo sempre existe. Se a pasta atual tiver o código, leia o trecho do traceback para fundamentar a resposta.
- **Como ele pode voltar a acontecer?** Em que condições o erro reaparece (outros dados, outro horário, outra máquina) e se o mesmo padrão existe em outros pontos do código ou em outros serviços. Isso define se a correção deve ser local ou mais ampla.
- **Reproduza o erro com um Exemplo Mínimo Reproduzível (EMR).** É a menor entrada, ou o menor trecho de código, que ainda provoca o erro, mais o resultado esperado e o obtido. Ver a seção 5.

## 5. Montar o EMR

O EMR serve como prova do bug para quem vai resolver e depois como teste da correção. Ele precisa ser:

- **Mínimo**: parta do cenário real e remova o que não é necessário (passos, campos, dependências, dados), até que remover mais faça o erro sumir. O que sobra é o que causa o problema.
- **Reproduzível**: outra pessoa, em outra máquina, consegue rodar e ver o mesmo erro. Fixe as versões (Python, bibliotecas, commit) e evite depender de estado que só existe em produção.
- **Completo**: diz o que é esperado e o que é obtido (mensagem de erro ou traceback curto).

Formatos, do melhor para o pior:

1. Um trecho de código autocontido que roda e falha, por exemplo uma função isolada chamada com o dado problemático.
2. Uma entrada específica com o comando para rodar o serviço, por exemplo um arquivo ou registro de exemplo.
3. Passos numerados, quando o erro depende de sistema externo ou de interface.

Se der para rodar o EMR localmente, rode e confirme que o erro aparece, pois um EMR não testado costuma estar errado. Se não der (precisa de produção, credencial ou sistema externo), diga isso na issue e marque o EMR como "não executado localmente".

Dados reais costumam ter informação sensível. Troque CPF, CNPJ, nomes, e-mails, tokens e senhas por valores fictícios do mesmo formato, para que o EMR continue reproduzindo o erro sem expor ninguém. Faça o mesmo com trechos de log citados.

## 6. Escrever a issue

**Título** (10 a 100 caracteres, exigido pela API): diga o sintoma e onde ele acontece, de forma que dê para reconhecer numa lista. Exemplos: `KeyError 'cnpj' ao importar notas sem CNPJ do fornecedor` em vez de `Erro no bot`, e `Robô de faturamento para após timeout no login do SAP` em vez de `Bug`.

**Descrição** (Markdown GFM, **até 3000 caracteres**): use o modelo abaixo. Remova as seções que não se aplicam em vez de preenchê-las com "N/A". Conte os caracteres antes de enviar. Se passar de 3000, encurte os logs e tracebacks primeiro (mantenha a última linha do erro e o frame do código do projeto) e cite o id do log no Jaylog para quem quiser o texto completo.

```markdown
## Problema
<sintoma: o que era esperado x o que aconteceu, desde quando, com que frequência>

## Impacto
<quem/qual processo foi afetado, dados envolvidos, se há contorno>

## Versão / ambiente
- Instância: <hostname> — branch `<branch>`, commit `<commit>`
- Python <versão>, jaylog <versão>
- Recursos no momento do erro (se relevante): CPU <x>%, memória <y>%, disco <z>% (de `get-resource-usage`/`get-host-metrics`)
- Testado na versão mais recente (`origin/main` @ `<commit>`)? <sim, continua acontecendo | não foi possível testar>

## EMR (Exemplo Mínimo Reproduzível)
<código, entrada ou passos numerados>

**Esperado:** <...>
**Obtido:** <erro/traceback curto>
<se aplicável: "não executado localmente porque ...">

## Causa
<causa raiz confirmada, ou "Hipótese: ..." com o motivo>

## Pode voltar a acontecer quando
<condições de recorrência; outros pontos com o mesmo padrão>

## Evidências
- Logs no Jaylog: <ids>, de <primeira> a <última ocorrência>
- Volume: <N> erros nos últimos <dias> dias, em <instâncias afetadas> (de `get-error-summary`)
- <issue anterior relacionada, se regressão: id + commit/solução>
```

**Responsável:** sem `assignee`, a API atribui ao dono do serviço, que é o padrão certo na maioria dos casos. Só preencha se o usuário indicar outra pessoa. Use `search-services-by-owner` ou a lista de usuários para achar o UUID.

## 7. Confirmar e criar

A `create-issue` grava no banco e envia um e-mail ao responsável, e a issue não pode ser apagada pelo MCP. Por isso, mostre ao usuário uma prévia antes de chamar a tool:

- serviço (nome e id), título, responsável (ou "dono do serviço") e a descrição completa, com a contagem de caracteres;
- a decisão da seção 3 em uma linha, por exemplo "não há issue aberta igual; o erro continua no commit mais recente".

Só chame `create-issue` depois que o usuário aprovar. Se ele pedir ajustes, refaça a prévia. Depois de criar, informe o id da issue e quem foi notificado. Para mudar algo depois (título, descrição, responsável), use `update-issue`, com a mesma regra de prévia e aprovação.

## 8. Resolver o problema

Se o usuário também vai corrigir o bug (ou pedir ajuda com isso depois), siga estes passos antes de escrever código. Eles valem tanto para quem abriu a issue quanto para o responsável.

1. **Sinalize que está trabalhando nela.** Com aprovação do usuário, mova a issue para `working` (`update-issue` com `state: "working"`), para que ninguém mais comece a mesma correção.
2. **Planeje a solução.** Parta da causa raiz da seção 4, não do sintoma. Um `try/except` em volta da linha que estoura esconde o erro, não corrige. Liste as alternativas, escolha a menor mudança que elimina a causa e explique por que ela é melhor. Se a causa for externa (API, sistema, rede), o plano é resiliência: validação, retry com limite, mensagem de erro clara e log útil.
3. **Avalie o que a alteração pode impactar.** Quem chama o código alterado, outros fluxos do mesmo serviço, outros serviços que usam o mesmo módulo ou dado, formato de saída (arquivos, banco, integrações), dados já gravados de forma errada (precisam de correção retroativa?), deploy (variáveis, dependências) e como voltar atrás se der errado. Liste os riscos, com o mais grave primeiro.
4. **Teste a solução com base no EMR.** O EMR tem que falhar antes da correção e passar depois. Se der, transforme-o num teste automatizado de regressão, para o erro não voltar sem ninguém perceber. Rode também os casos vizinhos levantados em "Pode voltar a acontecer quando".
5. **Confirme em produção.** Depois do deploy, acompanhe pelo Jaylog: `list-hosts` mostra se a instância está no commit novo, e `list-logs`/`get-error-history`/`get-error-summary` (com `days` curto, a partir do deploy) mostram se o erro parou de aparecer em todas as instâncias.
6. **Feche a issue com o registro da solução.** Use `update-issue` com `state: "merged"`, `commit` (hash da correção, até 50 caracteres) e `solution` na mesma chamada, porque a API só aceita `commit` e `solution` junto com a mudança para `merged`. A `solution` (Markdown, até 3000 caracteres) deve dizer a causa, o que mudou e como foi testado (o EMR e o teste de regressão). Mostre a prévia antes: depois de `merged` a issue fica travada e o autor recebe e-mail. Só o responsável pode registrar a solução. Se o usuário não for o responsável, reatribua antes (`assignee`) com o acordo dele, ou passe o texto para o responsável fechar. Se o problema não for corrigido (não é bug, duplicada, desistência), use `state: "closed"` em vez de `merged`.

## Cuidados

- Não chame `create-issue` nem `update-issue` sem aprovação explícita da prévia, nem abra ou altere mais de uma issue por pedido sem confirmar cada uma.
- Não trate hipótese como fato. A seção "Causa" deve dizer o grau de certeza.
- Não inclua dados pessoais nem segredos na issue. Ela fica visível para outras pessoas e é enviada por e-mail.
- Se a evidência não bastar para reproduzir o erro, abra a issue mesmo assim quando o problema for real. Diga o que falta (por exemplo, "não foi possível reproduzir; acontece só em produção com o lote X") e o que ajudaria a investigar, como mais log ou instrumentação.
