---
name: jaylog-fix-service-errors
description: Identifica os erros recentes de um serviço específico no Jaylog, localiza o código responsável na codebase atual e propõe correções (sem editar arquivos). Use sempre que o usuário pedir para investigar, diagnosticar ou corrigir erros de um serviço/bot/RPA pelo nome, disser que um serviço "está dando erro", "caindo" ou "quebrando", ou colar o nome de um serviço pedindo para olhar os logs e resolver no código, mesmo sem citar "Jaylog".
---

# Corrigir erros de um serviço Jaylog

Parte dos logs reais de um serviço, acha onde no código da pasta atual cada erro nasce e **propõe** a correção. A skill não edita arquivos: o valor está em um diagnóstico fundamentado em evidência (logs + código) que a pessoa revisa antes de aplicar. Só aplique mudanças se o usuário pedir explicitamente depois de ver as propostas.

Se as tools do Jaylog não estiverem disponíveis, avise que o MCP não está configurado/autenticado (`npx -y jaylog-mcp login`) e pare.

## 1. Identificar o serviço

- Pegue o nome informado pelo usuário e rode `list-services` com `name`. Se não vier nome, pergunte; não adivinhe a partir do nome da pasta, a menos que ele seja o único candidato óbvio e você confirme.
- Mais de um resultado: mostre as opções (nome, empresa, setor) e pergunte qual. Nenhum: tente variações do nome e, se continuar vazio, diga que não achou.
- Guarde o `id` do serviço; as demais tools o exigem.

## 2. Levantar os erros

Janela padrão: últimos 7 dias, ou a que o usuário indicar.

- `get-error-history` (`from`/`to`) para ver a tendência diária: o problema é novo, constante ou piorando? Isso orienta a prioridade.
- `list-logs` com `service` e `log_level` = `ERROR`, `CRITICAL` (e `EXCEPTION`, ou `is_exception: true`), um nível por chamada. Restrinja o intervalo se vier volume demais.
- Agrupe erros equivalentes (mesma mensagem ignorando ids, números e timestamps). Para cada grupo, registre: nº de ocorrências, primeira/última, hosts e usuários afetados, `service_path`.
- `get-log` no exemplar mais recente de cada grupo relevante para ter a mensagem completa, incluindo o traceback. A listagem pode vir resumida, e o traceback é o que liga o erro ao código.
- Ranking: frequência × recência × severidade. Trabalhe os 3–5 grupos principais; mencione o resto numa linha.

## 3. Conferir qual versão está rodando

O código local pode não ser o que está em produção, e corrigir uma versão diferente gera propostas erradas.

- `list-hosts` (`service_id`, `live: true`) traz o estado do git reportado pela instância (branch, commit/versão do jaylog e do Python).
- Compare com o repositório local (`git branch --show-current`, `git log --oneline -5`). Se divergirem (outro branch, commit que não existe local ou muito atrás), avise e diga o que mudou no trecho relevante (`git log`/`git diff` nos arquivos citados) antes de propor algo.

## 4. Localizar o código

- Confirme que a pasta atual é o repositório do serviço: o `service_path` dos logs e os caminhos do traceback devem existir aqui (ou ser equivalentes após ajustar o prefixo da máquina de origem). Se não baterem, pare e diga: "esta pasta não parece ser o código de <serviço>". Pergunte onde está o repositório, em vez de procurar correção em código alheio.
- Para cada grupo de erro, parta do último frame do traceback que seja código do projeto (ignore bibliotecas) e leia o arquivo e a função ao redor. Se não houver traceback, busque pela mensagem do log (`Grep` na string fixa) para achar o ponto que a emite.
- Siga o fluxo até entender **por que** o erro acontece: que entrada, estado ou dependência o produz. Olhe também chamadores e tratamento de erro existente.

## 5. Distinguir tipos de causa

Nem todo erro se corrige no código; dizer isso evita um patch inútil:

- **Bug no código** (None não tratado, índice, tipo, regra de negócio): proponha a correção.
- **Dependência externa** (API fora do ar, timeout, login expirado, mudança de layout em site/sistema): proponha resiliência (retry, validação, mensagem melhor), deixando claro que a causa raiz é externa.
- **Recurso da máquina** (memória, disco, CPU): confirme com `get-host-metrics` (`service`, `hostname`, `username`; amostras ficam 48 h) antes de culpar o código.
- **Ambiente/configuração** (versão de Python/biblioteca, venv, variável de ambiente): `list-hosts` mostra o ambiente reportado; aponte a divergência.

## 6. Entregar as propostas

Para cada erro (em ordem de prioridade), apresente:

```markdown
### 1. <mensagem resumida> — <N> ocorrências, <primeira> a <última>
- **Evidência:** id do log, host/usuário, trecho do traceback
- **Local no código:** `caminho/arquivo.py:linha` (função)
- **Causa:** por que acontece, e se é código, dependência externa, recurso ou ambiente
- **Correção proposta:** diff em bloco de código (ou, se não for correção de código, a ação recomendada)
- **Risco / efeitos colaterais:** o que mais pode mudar
- **Como verificar:** teste a rodar, ou o que observar nos logs depois do deploy
```

Termine com um resumo: quantos grupos de erro, quais têm correção proposta, quais dependem de ação fora do código, e a pergunta se o usuário quer aplicar alguma das propostas.

## Cuidados

- Não edite, não crie commit e não rode comandos que alterem estado enquanto o usuário não pedir a aplicação.
- Se a evidência não bastar para afirmar a causa, diga o que falta (ex.: "o log não traz o traceback") e proponha instrumentação ou o próximo passo de investigação, em vez de inventar uma correção plausível.
- Mascare segredos que apareçam em mensagens de log (tokens, senhas, dados pessoais) ao citá-las.
