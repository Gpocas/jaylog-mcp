# Jaylog MCP Server

Servidor [Model Context Protocol](https://github.com/modelcontextprotocol) para observabilidade do
ecossistema Jaylog: consulta de logs, métricas de recursos, erros, usuários chave, serviços e
agendamento de tarefas, contra a API do Jaylog.

> **Escopo inicial:** apenas ferramentas de leitura (GET). Nenhuma tool cria, altera ou apaga dados.

## Instalação

```bash
bun install
cp .env.example .env
# edite .env com a URL da API (e, se for diferente, a do app web)
bun run login
```

## Autenticação

`bun run login` abre o navegador numa tela de consentimento do app web do Jaylog
(`/mcp/authorize`) — o mesmo padrão do `claude login`/`gh auth login`: o MCP sobe um servidor HTTP
local efêmero (`127.0.0.1:<porta>`), o navegador confirma sua identidade (sessão já logada ou
login + 2FA) e, ao clicar em "Permitir", o Jaylog emite um token pessoal que volta pro MCP via esse
callback local.

- O token é salvo em `~/.config/jaylog-mcp/credentials.json` (permissão `600`).
- Expira em 15 dias, renovado automaticamente a cada uso — não expira por ficar o MCP parado, só por
  ficar **sem uso**.
- Pode ser revogado a qualquer momento na tela "Tokens MCP" do app, sem precisar reinstalar nada.
- `bun run logout` apenas apaga a credencial local; para invalidar o token de fato, revogue-o no app.

```bash
bun run login      # autentica (abre o navegador)
bun run logout     # remove a credencial local
```

## Configuração

| Variável | Descrição |
|---|---|
| `JAYLOG_API_BASE_URL` | URL base da API do Jaylog (ex: `http://localhost:3000`) |
| `JAYLOG_FRONTEND_URL` | URL do app web do Jaylog, usada só pelo `login` para abrir `/mcp/authorize`. Se omitida, cai para `JAYLOG_API_BASE_URL` (ok quando os dois estão atrás do mesmo domínio). |
| `JAYLOG_API_TOKEN` | Override explícito: se definida, tem prioridade sobre a credencial salva pelo `login`. Útil para CI/scripting. Qualquer perfil (guest, standard, staff, admin) funciona — cada tool exige o perfil mínimo que a rota correspondente já exige na API. |

## Rodando

```bash
bun run start     # roda direto com Bun
bun run dev        # com --watch
bun run build      # compila para dist/ (uso via Node/bin)
```

## Tools

### Logs, métricas e recursos

- **`list-logs`**: lista logs com filtros (serviço, hostname, username, ipv4, nível, mensagem, intervalo de tempo).
- **`get-latest-logs`**: último log de cada instância em execução, com dados de liveness (execução ativa, última atividade, múltiplas execuções vivas).
- **`get-log`**: um log específico por ID, com a mensagem completa.
- **`get-error-histogram`**: histograma de contagem de logs/erros por período, a partir dos logs brutos (janela limitada pela retenção).
- **`get-error-history`**: histórico diário consolidado de erros por serviço (janela maior que o histograma).
- **`get-host-metrics`**: uso de CPU/memória/disco/I/O de uma instância ao longo do tempo, com os limites de hardware da máquina.
- **`list-hosts`**: instâncias registradas (ambiente, versão do Python/jaylog, estado do git, venv).
- **`get-host-stats`**: contagem agregada por modo de execução, versão do Python/jaylog, tipo de venv e branch do git.

### Serviços

- **`list-services`**: lista serviços (aplicações/bots que enviam logs), com dono, empresa e setor resolvidos.

### Agendamento de tarefas

- **`list-service-schedules`**: horários agendados dos serviços — manuais ou sincronizados do Task Scheduler do Windows (somente leitura nesse caso).

### Usuários chave

- **`list-key-users`**: usuários chave (contatos de negócio ligados a serviços — não são usuários de login do sistema).
- **`list-service-key-users`**: vínculos entre serviços e seus usuários chave.

### Erros / Issues

- **`list-issues`**: issues (bugs/erros) abertos manualmente contra um serviço, com autor e responsável resolvidos.
- **`get-issue`**: uma issue específica por ID.

## Estrutura

```
src/
├── index.ts        → bootstrap do McpServer (stdio)
├── api.ts          → fetch autenticado contra a API do Jaylog
└── tools/
    ├── logs.ts      → logs, métricas, recursos, hosts
    ├── services.ts  → serviços
    ├── schedules.ts → agendamento de tarefas
    ├── keyUsers.ts  → usuários chave
    └── issues.ts    → erros/issues
```

## Debugging

Como o MCP roda via stdio, use o [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector bun src/index.ts
```
