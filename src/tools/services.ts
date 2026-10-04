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
        'List registered services (the applications/bots that send logs), with company and sector names ' +
        'already resolved. `owner` is a user ID; use `search-services-by-owner` to search by the ' +
        'owner\'s name or email instead.',
      inputSchema: {
        name: z.string().optional().describe('Substring match against the service name'),
        owner: z.string().uuid().optional().describe('User ID of the service owner'),
        company_id: z.string().uuid().optional().describe('Restrict to a company'),
        sector_id: z.string().uuid().optional().describe('Restrict to a sector')
      }
    },
    async params => asText(await fetchJSON('/service/list', params))
  )

  server.registerTool(
    'list-favorite-services',
    {
      description:
        'List the services the authenticated user has marked as favorites, with the same fields as ' +
        '`list-services` (company and sector names resolved). Favorites belong to the user the MCP is ' +
        'logged in as; there is no way to read someone else\'s.'
    },
    async () => {
      const favorites = await fetchJSON<{ service_id: string }[]>('/favorites/list')
      if (favorites.length === 0) return asText([])

      // The favorites route only returns IDs, so resolve them against the service list.
      const favoriteIds = new Set(favorites.map(favorite => favorite.service_id))
      const services = await fetchJSON<{ id: string }[]>('/service/list')
      return asText(services.filter(service => favoriteIds.has(service.id)))
    }
  )

  server.registerTool(
    'search-services-by-owner',
    {
      description:
        'Find the services owned by a person, searching by the owner\'s name and/or email (case-insensitive ' +
        'substring match). Returns one entry per matching user with that user\'s services. A user that ' +
        'matches but owns nothing is returned with an empty list. Use `list-services` with `owner` ' +
        'instead when you already have the owner\'s user ID.',
      inputSchema: {
        name: z.string().min(1).optional().describe('Substring match against the owner\'s name'),
        email: z.string().min(1).optional().describe('Substring match against the owner\'s email')
      }
    },
    async ({ name, email }) => {
      if (!name && !email) {
        throw new Error('Provide at least one of `name` or `email`.')
      }

      const users = await fetchJSON<
        { id: string; name: string; email: string; is_active: boolean }[]
      >('/user/list', { name, email })
      if (users.length === 0) return asText([])

      // One service request filtered client-side beats one request per matching user.
      const services = await fetchJSON<{ owner: string }[]>('/service/list')
      return asText(
        users.map(user => ({
          owner: { id: user.id, name: user.name, email: user.email, is_active: user.is_active },
          services: services.filter(service => service.owner === user.id)
        }))
      )
    }
  )
}
