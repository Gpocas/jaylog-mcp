# Jaylog MCP Server

Servidor [Model Context Protocol](https://github.com/modelcontextprotocol) para observabilidade do
ecossistema Jaylog: consulta de logs, métricas de recursos, erros, usuários chave, serviços e
agendamento de tarefas, contra a API do Jaylog.

> **Escopo inicial:** apenas ferramentas de leitura (GET). Nenhuma tool cria, altera ou apaga dados.

## Instalação

Requer Node.js 18+. Não precisa instalar nada: o `npx` baixa e executa o pacote.

```bash
export JAYLOG_API_BASE_URL=https://sua-api-jaylog   # URL da API
npx -y jaylog-mcp-server login                       # abre o navegador para autenticar
```

Depois do login, registre o servidor no seu cliente MCP.

**Claude Code:**

```bash
claude mcp add jaylog --env JAYLOG_API_BASE_URL=https://sua-api-jaylog -- npx -y jaylog-mcp-server
```

**Outros clientes (Claude Desktop, Cursor etc.):**

```json
{
  "mcpServers": {
    "jaylog": {
      "command": "npx",
      "args": ["-y", "jaylog-mcp-server"],
      "env": {
        "JAYLOG_API_BASE_URL": "https://sua-api-jaylog"
      }
    }
  }
}
```

> Rodando via `npx`/Node, o arquivo `.env` **não** é lido. Defina as variáveis no shell ou no
> bloco `env` do cliente MCP, como acima.

## Autenticação

`npx -y jaylog-mcp-server login` abre o navegador numa tela de consentimento do app web do Jaylog
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
npx -y jaylog-mcp-server login     # autentica (abre o navegador)
npx -y jaylog-mcp-server logout    # remove a credencial local
```

## Configuração

| Variável | Descrição |
|---|---|
| `JAYLOG_API_BASE_URL` | URL base da API do Jaylog (ex: `http://localhost:3000`) |
| `JAYLOG_FRONTEND_URL` | URL do app web do Jaylog, usada só pelo `login` para abrir `/mcp/authorize`. Se omitida, cai para `JAYLOG_API_BASE_URL` (ok quando os dois estão atrás do mesmo domínio). |
| `JAYLOG_API_TOKEN` | Override explícito: se definida, tem prioridade sobre a credencial salva pelo `login`. Útil para CI/scripting. Qualquer perfil (guest, standard, staff, admin) funciona — cada tool exige o perfil mínimo que a rota correspondente já exige na API. |

## Desenvolvimento

Para rodar a partir do código-fonte (requer [Bun](https://bun.sh)):

```bash
bun install
cp .env.example .env   # edite com a URL da API
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

## Skills

O repositório inclui skills (pasta `skills/`) com fluxos prontos que usam as tools acima. Elas
seguem o padrão do [skills.sh](https://skills.sh) e funcionam em Claude Code, Cursor e outros
agentes compatíveis. Requerem o MCP configurado e autenticado.

```bash
npx skills add Gpocas/jaylog-mcp                                   # instala todas
npx skills add Gpocas/jaylog-mcp --skill jaylog-incident-report    # instala uma
npx skills add Gpocas/jaylog-mcp -g                                # global (~/.claude/skills)
```

- **`jaylog-incident-report`**: relatório em markdown dos incidentes do dia anterior (erros nos
  logs, serviços parados, agendamentos não cumpridos e issues), salvo em
  `./reports/incidentes-AAAA-MM-DD.md`.
- **`jaylog-fix-service-errors`**: levanta os erros recentes de um serviço, localiza o código
  responsável na pasta atual e **propõe** correções (não edita arquivos).

## Estrutura

```
skills/
├── jaylog-incident-report/SKILL.md
└── jaylog-fix-service-errors/SKILL.md
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
npx @modelcontextprotocol/inspector npx -y jaylog-mcp-server
```
