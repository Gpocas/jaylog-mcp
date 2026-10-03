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

export function registerKeyUserTools(server: McpServer) {
  server.registerTool(
    'list-key-users',
    {
      description:
        'List key users—business stakeholders/contacts tracked for services (not system login users). ' +
        'Each has a name, email and optional branch/cellphone.',
      inputSchema: {
        name: z.string().optional().describe('Substring match against the name'),
        email: z.string().optional().describe('Substring match against the email'),
        status: z
          .union([z.boolean(), z.literal('all')])
          .optional()
          .describe('Filter by active status (true, default) or "all" to include inactive ones')
      }
    },
    async params => asText(await fetchJSON('/key-user/list', params))
  )

  server.registerTool(
    'list-service-key-users',
    {
      description: 'List the links between services and their key users.',
      inputSchema: {
        service_id: z.string().uuid().optional().describe('Restrict to a service'),
        key_user_id: z.string().uuid().optional().describe('Restrict to a key user'),
        status: z
          .union([z.boolean(), z.literal('all')])
          .optional()
          .describe('Filter by the key user\'s active status (true, default) or "all"')
      }
    },
    async params => asText(await fetchJSON('/service-key-user/list', params))
  )
}
