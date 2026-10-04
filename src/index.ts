#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { login } from './auth/login'
import { logout } from './auth/logout'
import { colors } from './cli/colors'
import { registerIssueTools } from './tools/issues'
import { registerKeyUserTools } from './tools/keyUsers'
import { registerLogTools } from './tools/logs'
import { registerScheduleTools } from './tools/schedules'
import { registerServiceTools } from './tools/services'

// `require` (not `import`) keeps package.json out of tsc's rootDir; the path resolves
// the same from src/ (bun) and dist/ (published), so the reported version can't drift.
const { version } = require('../package.json') as { version: string }

async function runServer() {
  const server = new McpServer({
    name: 'Jaylog',
    version
  })

  registerLogTools(server)
  registerServiceTools(server)
  registerScheduleTools(server)
  registerKeyUserTools(server)
  registerIssueTools(server)

  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error(colors.dim('Jaylog MCP Server running on stdio'))
}

async function main() {
  const command = process.argv[2]

  if (command === 'login') return login()
  if (command === 'logout') return logout()

  return runServer()
}

main().catch(error => {
  console.error(
    colors.boldRed(`Fatal error: ${error instanceof Error ? error.message : error}`)
  )
  process.exit(1)
})
