# Jaylog MCP Server

Servidor [Model Context Protocol](https://github.com/modelcontextprotocol) para observabilidade do
ecossistema Jaylog: consulta de logs, métricas de recursos, erros, usuários chave, serviços e
agendamento de tarefas, contra a API do Jaylog.

> **Escopo:** ferramentas de leitura (GET), mais criação e edição de issues (`create-issue` e
> `update-issue`). Nenhuma tool apaga dados.

## Sumário

- [Instalação](#instalação)
  - [Atualizações](#atualizações)
- [Autenticação](#autenticação)
- [Configuração](#configuração)
- [Desenvolvimento](#desenvolvimento)
- [Tools](#tools)
  - [Logs, métricas e recursos](#logs-métricas-e-recursos)
  - [Serviços](#serviços)
  - [Agendamento de tarefas](#agendamento-de-tarefas)
  - [Usuários chave](#usuários-chave)
  - [Erros / Issues](#erros--issues)
- [Skills](#skills)
- [Estrutura](#estrutura)
- [Debugging](#debugging)

## Instalação

O pacote é instalado direto do repositório
[Gpocas/jaylog-mcp](https://github.com/Gpocas/jaylog-mcp) pelo `npx`. Ele **não** é publicado no
npmjs.

Requisitos:

- Node.js 20.18+.
- **`git` instalado** e no `PATH`: o npm usa `git ls-remote`/`git clone` para buscar o repositório.

```bash
export JAYLOG_URL=https://seu-app-jaylog       # URL do app web do Jaylog
npx -y github:Gpocas/jaylog-mcp login           # abre o navegador para autenticar
```

> Uma única URL basta: o MCP chama a API pelo proxy do app web (`<JAYLOG_URL>/proxy/*`). Para
> apontar a API diretamente (ex.: desenvolvimento local), veja [Configuração](#configuração).

Depois do login, registre o servidor no seu cliente MCP.

**Claude Code:**

```bash
claude mcp add jaylog --scope user --env JAYLOG_URL=https://seu-app-jaylog -- npx -y github:Gpocas/jaylog-mcp
```

> `--scope user` registra o servidor para o seu usuário, em todos os projetos. Sem a flag, o padrão
> é `local`: o servidor só aparece no diretório onde o comando foi executado. Há ainda o escopo
> `project`, que grava em `.mcp.json` na raiz do repositório e vale para todos que o usam.

**Outros clientes (Claude Desktop, Cursor etc.):**

```json
{
  "mcpServers": {
    "jaylog": {
      "command": "npx",
      "args": ["-y", "github:Gpocas/jaylog-mcp"],
      "env": {
        "JAYLOG_URL": "https://seu-app-jaylog"
      }
    }
  }
}
```

> Rodando via `npx`/Node, o arquivo `.env` **não** é lido. Defina as variáveis no shell ou no
> bloco `env` do cliente MCP, como acima.

O `dist/` não é versionado. Na primeira execução de cada commit novo, o npm instala as dependências
de desenvolvimento e compila o projeto (script `prepare`). Por isso essa primeira inicialização
leva alguns segundos a mais. As seguintes saem do cache local.

### Atualizações

Sem uma referência fixa (`github:Gpocas/jaylog-mcp`), o `npx` acompanha a branch `main`. **A cada
inicialização** ele roda `git ls-remote` para descobrir o commit atual da `main` e compara com o
que está no cache (`~/.npm/_npx`). Se o commit mudou, reinstala e recompila. Se não mudou, usa o
cache. Ou seja, não é preciso limpar cache nem passar flags: basta **reiniciar o servidor MCP** (ou
o cliente, ex. Claude Code/Claude Desktop), porque o processo em execução não se atualiza sozinho.

Para conferir a versão, envie ao servidor a mensagem `initialize` do protocolo MCP, a mesma que o
cliente envia ao conectar. A resposta traz a versão em `result.serverInfo.version`, lida do
`package.json`:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"cli","version":"0"}}}' \
  | npx -y github:Gpocas/jaylog-mcp 2>/dev/null
# {"result":{...,"serverInfo":{"name":"Jaylog","version":"0.1.6"}},"jsonrpc":"2.0","id":1}
```

Esse comando passa pelo mesmo `npx`, então já atualiza para o commit atual da `main` antes de
responder. Ele mostra a versão que o cliente MCP vai carregar na **próxima** inicialização. Uma
sessão aberta antes da atualização continua com a versão antiga até ser reiniciada.

Se mesmo assim uma versão antiga persistir (ex.: cache corrompido ou instalação interrompida),
apague o cache do `npx` e reinicie o cliente:

```bash
rm -rf "$(npm config get cache)/_npx"            # Linux/macOS
# Windows (PowerShell):
# Remove-Item -Recurse -Force "$(npm config get cache)\_npx"
```

Para o comportamento oposto (fixar uma versão e **não** atualizar), aponte para um commit, branch
ou tag com `#`:

```bash
npx -y github:Gpocas/jaylog-mcp#53eec55   # commit específico
npx -y github:Gpocas/jaylog-mcp#v0.1.6    # tag (se existir)
```

## Autenticação

`npx -y github:Gpocas/jaylog-mcp login` abre o navegador numa tela de consentimento do app web do Jaylog
(`/mcp/authorize`) — o mesmo padrão do `claude login`/`gh auth login`: o MCP sobe um servidor HTTP
local efêmero (`127.0.0.1:<porta>`), o navegador confirma sua identidade (sessão já logada ou
login + 2FA) e, ao clicar em "Permitir", o Jaylog emite um token pessoal que volta pro MCP via esse
callback local.

- O token é salvo em `~/.config/jaylog-mcp/credentials.json` (permissão `600`).
- Expira em 15 dias, renovado automaticamente a cada uso — não expira por ficar o MCP parado, só por
  ficar **sem uso**.
- Pode ser revogado a qualquer momento na tela "Tokens MCP" do app, sem precisar reinstalar nada.
- `logout` apenas apaga a credencial local; para invalidar o token de fato, revogue-o no app.

```bash
npx -y github:Gpocas/jaylog-mcp login     # autentica (abre o navegador)
npx -y github:Gpocas/jaylog-mcp logout    # remove a credencial local
```

## Configuração

| Variável | Descrição |
|---|---|
| `JAYLOG_URL` | URL do app web do Jaylog. É a única variável necessária: o `login` abre `<JAYLOG_URL>/mcp/authorize` e as tools chamam a API em `<JAYLOG_URL>/proxy/*`. |
| `JAYLOG_API_BASE_URL` | Override opcional: URL base da API chamada diretamente, sem passar pelo proxy (ex: `http://localhost:3000`). Quando definida, tem prioridade sobre `JAYLOG_URL` nas chamadas à API. |
| `JAYLOG_FRONTEND_URL` | Override opcional: URL do app web usada só pelo `login`. Útil em desenvolvimento local, onde a API e o app web rodam em portas diferentes. Se omitida, cai para `JAYLOG_URL`. |
| `JAYLOG_API_TOKEN` | Override explícito: se definida, tem prioridade sobre a credencial salva pelo `login`. Útil para CI/scripting. Qualquer perfil (guest, standard, staff, admin) funciona — cada tool exige o perfil mínimo que a rota correspondente já exige na API. |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Opcionais: proxy corporativo usado nas chamadas à API (ex: `http://proxy.empresa:8080`). Aceitos em maiúsculas ou minúsculas; `NO_PROXY` lista hosts que devem ignorar o proxy. |

### Proxy corporativo

Se a sua rede exige proxy para acessar o Jaylog, defina `HTTPS_PROXY` (e `NO_PROXY`, se precisar)
no bloco `env` do cliente MCP, junto com o `JAYLOG_URL`:

**Claude Code:**

```bash
claude mcp add jaylog --scope user \
  --env JAYLOG_URL=https://seu-app-jaylog \
  --env HTTPS_PROXY=http://proxy.empresa:8080 \
  --env NO_PROXY=localhost,127.0.0.1 \
  -- npx -y github:Gpocas/jaylog-mcp
```

**Outros clientes (Claude Desktop, Cursor etc.):**

```json
{
  "mcpServers": {
    "jaylog": {
      "command": "npx",
      "args": ["-y", "github:Gpocas/jaylog-mcp"],
      "env": {
        "JAYLOG_URL": "https://seu-app-jaylog",
        "HTTPS_PROXY": "http://proxy.empresa:8080",
        "NO_PROXY": "localhost,127.0.0.1"
      }
    }
  }
}
```

- Como o `JAYLOG_URL` normalmente é `https://`, vale o `HTTPS_PROXY`. O `HTTP_PROXY` só é usado
  quando a URL é `http://`.
- Se o proxy exigir autenticação, informe as credenciais na URL: `http://usuario:senha@proxy.empresa:8080`.
- Se o Jaylog for interno e não deve passar pelo proxy, inclua o domínio dele no `NO_PROXY`.
- As variáveis também podem ser exportadas no shell (`export HTTPS_PROXY=...`) ao rodar o
  servidor manualmente. Nomes em minúsculas (`https_proxy`) também funcionam.
- Sem nenhuma dessas variáveis, as requisições saem direto, como antes.
- O `git` usado pelo `npx` para baixar o repositório também precisa passar pelo proxy. Ele respeita
  `HTTPS_PROXY`/`HTTP_PROXY` do ambiente, ou configure de forma permanente com
  `git config --global http.proxy http://proxy.empresa:8080`.

## Desenvolvimento

Para rodar a partir do código-fonte (requer [Bun](https://bun.sh)):

```bash
bun install
cp .env.example .env   # edite com as URLs do app web/API
bun run login          # autentica (abre o navegador)
bun run start          # roda direto com Bun
bun run dev            # com --watch
bun run build          # compila para dist/ (uso via Node/bin)
```

## Tools

### Logs, métricas e recursos

- **`list-logs`**: lista logs com filtros (serviço, hostname, username, ipv4, nível, mensagem, intervalo de tempo).
- **`get-latest-logs`**: último log de cada instância em execução, com dados de liveness (execução ativa, última atividade, múltiplas execuções vivas).
- **`get-log`**: um log específico por ID, com a mensagem completa.
- **`get-error-histogram`**: histograma de contagem de logs/erros por período, a partir dos logs brutos (janela limitada pela retenção).
- **`get-error-history`**: histórico diário consolidado de erros por serviço (janela maior que o histograma).
- **`get-error-summary`**: erros acumulados de um serviço nos últimos N dias (padrão e máximo: 45), com o total do serviço (histórico diário consolidado) e a divisão por instância (host + usuário), ordenada pela que mais erra. Os números por instância vêm dos logs brutos, que guardam só os ~1000 mais recentes de cada instância. Os campos `window_fully_covered` e `possibly_pruned` indicam quando eles não cobrem a janela inteira.
- **`get-host-metrics`**: uso de CPU/memória/disco/I/O de uma instância ao longo do tempo, com os limites de hardware da máquina.
- **`get-resource-usage`**: visão de "gerenciador de tarefas" das instâncias em execução, filtrável por serviço e/ou máquina. Mostra CPU, memória e disco da máquina e CPU e memória do processo agora, mais média, pico, tendência de memória do processo e I/O nas últimas N horas (padrão 1, máximo 48). Também traz alertas prontos: CPU, memória ou disco alto, possível vazamento de memória e instância sem amostras recentes.
- **`list-hosts`**: instâncias registradas (ambiente, versão do Python/jaylog, estado do git, venv).
- **`get-host-stats`**: contagem agregada por modo de execução, versão do Python/jaylog, tipo de venv e branch do git.

### Serviços

- **`list-services`**: lista serviços (aplicações/bots que enviam logs), com empresa e setor resolvidos. O `owner` vem como ID de usuário.
- **`list-favorite-services`**: serviços favoritados pelo usuário autenticado (os favoritos são sempre do usuário logado no MCP).
- **`search-services-by-owner`**: busca serviços pelo nome e/ou e-mail do dono (substring, sem diferenciar maiúsculas), retornando um item por usuário encontrado com seus serviços. Requer perfil `standard` ou superior.

### Agendamento de tarefas

- **`list-service-schedules`**: horários agendados dos serviços — manuais ou sincronizados do Task Scheduler do Windows (somente leitura nesse caso).

### Usuários chave

- **`list-key-users`**: usuários chave (contatos de negócio ligados a serviços — não são usuários de login do sistema).
- **`list-service-key-users`**: vínculos entre serviços e seus usuários chave.

### Erros / Issues

- **`list-issues`**: issues (bugs/erros) abertos manualmente contra um serviço, com autor e responsável resolvidos.
- **`get-issue`**: uma issue específica por ID.
- **`create-issue`**: abre uma issue contra um serviço, tendo como autor o usuário autenticado.
  Parâmetros: `title` (10–100 caracteres), `description` (opcional, até 3000), `service` (UUID) e
  `assignee` (opcional, UUID — padrão: dono do serviço). O responsável é notificado por e-mail.
  Exige perfil `standard` ou superior.
- **`update-issue`**: edita uma issue existente. Só os campos enviados mudam: `title`,
  `description`, `state` (`open`, `working`, `merged`, `closed`), `commit`, `solution` e
  `assignee`. Regras aplicadas pela API:
  - issues `merged` ou `closed` ficam travadas e não podem mais ser editadas;
  - só o autor altera `title` e `description`;
  - `commit` e `solution` só podem ser enviados junto com `state: "merged"`, pelo responsável;
  - mover para `merged` ou `closed` registra a data de fechamento e notifica o autor por e-mail.

## Skills

O repositório inclui skills (pasta `skills/`) com fluxos prontos que usam as tools acima. Elas
seguem o padrão do [skills.sh](https://skills.sh) e funcionam em Claude Code, Cursor e outros
agentes compatíveis. Requerem o MCP configurado e autenticado.

```bash
npx skills add Gpocas/jaylog-mcp                                   # instala todas
npx skills add Gpocas/jaylog-mcp --skill jaylog-incident-report    # instala uma
npx skills add Gpocas/jaylog-mcp -g                                # global (~/.claude/skills)
```

### Atualizando as skills

As skills instaladas são **cópias** dos arquivos do repositório. Elas não se atualizam sozinhas
quando o repositório muda. O CLI do skills.sh registra de onde cada skill veio num arquivo de
controle (lock): `~/.agents/.skill-lock.json` para as globais e `skills-lock.json` na raiz do
projeto para as de projeto. É por esse registro que ele sabe o que atualizar.

```bash
npx skills check        # lista as skills com versão mais nova no repositório (não instala nada)
npx skills update       # atualiza as instaladas (pergunta o escopo: global ou projeto)
npx skills update -g    # só as globais
npx skills update -p    # só as do projeto
```

Depois de atualizar, **abra uma nova sessão** do Claude Code (ou do seu agente). As skills são
carregadas no início da sessão.

**Skills novas no repositório** (ex.: `jaylog-open-issue`) não são instaladas pelo `update`, que só
atualiza o que você já tem. Instale com `add`:

```bash
npx skills add Gpocas/jaylog-mcp --skill jaylog-open-issue -g
```

**Skills legadas** (instaladas com uma versão antiga do CLI, ou copiadas manualmente para
`~/.claude/skills`) podem não estar no arquivo de controle. Quando ele está num formato antigo, o
CLI o descarta, e essas skills deixam de ser acompanhadas. O `check`/`update` então as ignora ou
avisa que *não podem ser verificadas automaticamente*. Reinstale com `add`, que sobrescreve os
arquivos e volta a registrar a origem. A partir daí, o `update` funciona normalmente:

```bash
npx skills add Gpocas/jaylog-mcp -g -y    # globais; sem -g para as de projeto
```

Vale reinstalar também se as suas skills ainda mandam rodar `npx -y jaylog-mcp login`. É a
instalação antiga via npmjs, que não é mais usada.

- **`jaylog-incident-report`**: relatório em markdown de incidentes (erros nos logs, serviços
  parados, agendamentos não cumpridos, issues e máquinas com recursos no limite). Começa com uma entrevista de múltipla escolha
  para personalizar escopo (todos, favoritos ou serviços de um owner), categorias, período
  (padrão: dia anterior) e extras (contatos, mensagens completas, só críticos). Salva em
  `./reports/incidentes-AAAA-MM-DD.md`.
- **`jaylog-fix-service-errors`**: levanta os erros recentes de um serviço (escolhido por nome,
  owner ou entre os favoritos), localiza o código responsável na pasta atual e **propõe**
  correções (não edita arquivos).
- **`jaylog-open-issue`**: decide se um bug merece issue (já corrigido numa versão mais nova?
  já existe issue igual? é regressão?) e, se merecer, monta a issue com versão/ambiente, causa,
  condições de recorrência e um Exemplo Mínimo Reproduzível (EMR). Mostra uma prévia e só chama
  `create-issue` após aprovação. Também orienta a resolução: planejar, avaliar impacto e testar
  com o EMR.

## Estrutura

```
skills/
├── jaylog-incident-report/SKILL.md
├── jaylog-fix-service-errors/SKILL.md
└── jaylog-open-issue/SKILL.md
src/
├── index.ts        → bootstrap do McpServer (stdio)
├── api.ts          → fetch autenticado contra a API do Jaylog
└── tools/
    ├── logs.ts          → logs, métricas, recursos, hosts
    ├── services.ts      → serviços
    ├── schedules.ts     → agendamento de tarefas
    ├── keyUsers.ts      → usuários chave
    ├── errorSummary.ts  → erros acumulados por serviço/instância
    ├── resourceUsage.ts → uso de recursos por instância (task manager)
    └── issues.ts        → erros/issues
```

## Debugging

Como o MCP roda via stdio, use o [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector npx -y github:Gpocas/jaylog-mcp
```
