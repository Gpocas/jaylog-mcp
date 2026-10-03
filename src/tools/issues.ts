import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fetchJSON } from '../api'

const issueStates = ['open', 'working', 'merged', 'closed'] as const

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

export function registerIssueTools(server: McpServer) {
  server.registerTool(
    'list-issues',
    {
      description:
        'List issues—manually tracked bugs/errors opened against a service, with author/assignee names ' +
        'resolved.',
      inputSchema: {
        title: z.string().optional().describe('Substring match against the title'),
        state: z.enum(issueStates).optional().describe('Filter by issue state'),
        service: z.string().uuid().optional().describe('Restrict to a service'),
        author: z.string().uuid().optional().describe('Restrict to the user who opened the issue'),
        assignee: z.string().uuid().optional().describe('Restrict to the assigned user')
      }
    },
    async params => asText(await fetchJSON('/issues/list', params))
  )

  server.registerTool(
    'get-issue',
    {
      description: 'Retrieve a single issue by ID, with author/assignee/updated-by names resolved.',
      inputSchema: {
        id: z.string().uuid().describe('The issue ID')
      }
    },
    async ({ id }) => asText(await fetchJSON(`/issues/${id}`))
  )
}
