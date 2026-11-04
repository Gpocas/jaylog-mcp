import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fetchJSON, postJSON } from '../api'

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

  server.registerTool(
    'create-issue',
    {
      description:
        'Open a new issue (bug/error) against a service, authored by the authenticated user. ' +
        'If no assignee is given, the service owner is assigned. The assignee is notified by email. ' +
        'This writes data—confirm title, description, service and assignee with the user before calling.',
      inputSchema: {
        title: z.string().min(10).max(100).describe('Short summary of the problem (10–100 characters)'),
        description: z
          .string()
          .max(3000)
          .optional()
          .describe('Details: what happened, impact, evidence such as log IDs (up to 3000 characters)'),
        service: z.string().uuid().describe('ID of the service the issue is opened against'),
        assignee: z
          .string()
          .uuid()
          .optional()
          .describe('User ID to assign; defaults to the service owner')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false
      }
    },
    async params => asText(await postJSON('/issues/add', params))
  )
}
