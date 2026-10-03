import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fetchJSON } from '../api'

const repetitions = ['CONTINUO', 'DIARIO', 'SEMANA', 'DIA'] as const
const weekDays = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY'
] as const
const sources = ['MANUAL', 'TASK_SCHEDULER'] as const

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

export function registerScheduleTools(server: McpServer) {
  server.registerTool(
    'list-service-schedules',
    {
      description:
        'List the scheduled run times for services—either manually registered or synced from the ' +
        'host\'s Windows Task Scheduler (`source: TASK_SCHEDULER`, read-only). `repetition` drives which ' +
        'other fields are set: CONTINUO (none), DIARIO (time only), SEMANA (day_of_week + time), DIA ' +
        '(day_of_month + time).',
      inputSchema: {
        service_id: z.string().uuid().optional().describe('Restrict to a service'),
        repetition: z.enum(repetitions).optional().describe('Filter by repetition kind'),
        day_of_month: z.number().int().min(1).max(31).optional().describe('Filter by day of month'),
        day_of_week: z.enum(weekDays).optional().describe('Filter by day of week'),
        time: z.string().optional().describe('Filter by exact time (HH:MM, 24h)'),
        source: z.enum(sources).optional().describe('Filter by origin of the schedule entry'),
        status: z.boolean().optional().describe('Include only active (true, default) or inactive schedules')
      }
    },
    async params => asText(await fetchJSON('/service-schedule/list', params))
  )
}
