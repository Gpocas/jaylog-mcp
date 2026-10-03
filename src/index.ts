#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { registerIssueTools } from './tools/issues'
import { registerKeyUserTools } from './tools/keyUsers'
import { registerLogTools } from './tools/logs'
import { registerScheduleTools } from './tools/schedules'
import { registerServiceTools } from './tools/services'

const server = new McpServer({
  name: 'Jaylog',
  version: '0.1.0'
})

registerLogTools(server)
registerServiceTools(server)
registerScheduleTools(server)
registerKeyUserTools(server)
registerIssueTools(server)

async function runServer() {
  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error('Jaylog MCP Server running on stdio')
}

runServer().catch(error => {
  console.error('Fatal error running server:', error)
  process.exit(1)
})
