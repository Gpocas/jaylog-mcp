import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fetchJSON } from '../api'

function asText(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2)
      }
    ]
  }
}

export function registerServiceTools(server: McpServer) {
  server.registerTool(
    'list-services',
    {
      description:
        'List registered services (the applications/bots that send logs), with their owner, company and ' +
        'sector already resolved.',
      inputSchema: {
        name: z.string().optional().describe('Substring match against the service name'),
        owner: z.string().uuid().optional().describe('User ID of the service owner'),
        company_id: z.string().uuid().optional().describe('Restrict to a company'),
        sector_id: z.string().uuid().optional().describe('Restrict to a sector')
      }
    },
    async params => asText(await fetchJSON('/service/list', params))
  )
}
