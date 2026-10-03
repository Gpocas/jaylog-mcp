import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fetchJSON } from '../api'

const logLevels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'EXCEPTION'] as const

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

export function registerLogTools(server: McpServer) {
  server.registerTool(
    'list-logs',
    {
      description:
        'List logs with optional filters. Returns the raw log entries ordered by most recent first. ' +
        'Use `get-error-histogram` instead when you only need error counts over time.',
      inputSchema: {
        service: z.string().uuid().optional().describe('Service ID to filter by'),
        hostname: z.string().optional().describe('Exact hostname to filter by'),
        username: z.string().optional().describe('Exact username to filter by'),
        ipv4: z.string().optional().describe('Exact IPv4 address to filter by'),
        service_path: z.string().optional().describe('Substring match against the service path'),
        is_exception: z.boolean().optional().describe('Filter logs raised from an exception handler'),
        log_level: z.enum(logLevels).optional().describe('Exact log level to filter by'),
        log_message: z.string().optional().describe('Substring match against the log message'),
        log_timestamp_from: z
          .string()
          .optional()
          .describe('ISO 8601 timestamp; only logs at or after this instant'),
        log_timestamp_to: z
          .string()
          .optional()
          .describe('ISO 8601 timestamp; only logs at or before this instant')
      }
    },
    async params => asText(await fetchJSON('/logs/list', params))
  )

  server.registerTool(
    'get-latest-logs',
    {
      description:
        'Get the most recent log per running instance (service + hostname + username), enriched ' +
        'with service/company/sector info and liveness data (active run, last activity, whether more ' +
        'than one live run was detected). This is the data behind the dashboard\'s service list.'
    },
    async () => asText(await fetchJSON('/logs/last'))
  )

  server.registerTool(
    'get-log',
    {
      description: 'Retrieve a single log entry by ID, including its full message and service context.',
      inputSchema: {
        id: z.string().uuid().describe('The log ID')
      }
    },
    async ({ id }) => asText(await fetchJSON(`/logs/${id}`))
  )

  server.registerTool(
    'get-error-histogram',
    {
      description:
        'Get a time-bucketed histogram of log counts and error/critical/exception counts for a service, ' +
        'built from raw logs. Limited to however far back the raw logs retention goes. Use ' +
        '`get-error-history` instead for a longer-range daily summary.',
      inputSchema: {
        service: z.string().uuid().describe('Service ID (required)'),
        hostname: z.string().optional().describe('Restrict to a single hostname'),
        username: z.string().optional().describe('Restrict to a single username'),
        bucket_minutes: z
          .number()
          .int()
          .min(1)
          .max(1440)
          .optional()
          .describe('Bucket width in minutes (default: 60)')
      }
    },
    async params => asText(await fetchJSON('/logs/error-histogram', params))
  )

  server.registerTool(
    'get-error-history',
    {
      description:
        'Get the daily consolidated error history for a service (total/error/critical/exception counts ' +
        'per day), built by the nightly snapshot job. Covers a longer range than ' +
        '`get-error-histogram`, which depends on raw log retention.',
      inputSchema: {
        service: z.string().uuid().describe('Service ID (required)'),
        from: z.string().optional().describe('Start date (YYYY-MM-DD), inclusive'),
        to: z.string().optional().describe('End date (YYYY-MM-DD), inclusive')
      }
    },
    async params => asText(await fetchJSON('/logs/error-history', params))
  )

  server.registerTool(
    'get-host-metrics',
    {
      description:
        'Get time-bucketed resource usage (CPU, memory, disk, process I/O) for a single running instance ' +
        '(service + hostname + username), along with the machine\'s hardware limits. Samples are sent by ' +
        'the jaylog client roughly every minute and retained for 48 hours.',
      inputSchema: {
        service: z.string().uuid().describe('Service ID (required)'),
        hostname: z.string().min(1).describe('Hostname of the instance (required)'),
        username: z.string().min(1).describe('Username running the instance (required)'),
        run_id: z.string().uuid().optional().describe('Restrict to a single run; omit for the active run'),
        bucket_minutes: z
          .number()
          .int()
          .min(1)
          .max(1440)
          .optional()
          .describe('Bucket width in minutes (default: 1)')
      }
    },
    async params => asText(await fetchJSON('/logs/host-metrics', params))
  )

  server.registerTool(
    'list-hosts',
    {
      description:
        'List registered host/instance records (one per run_id by default, or every heartbeat with ' +
        '`all_runs`), including environment details (OS, Python version, git state, venv) reported once ' +
        'per run by the jaylog client.',
      inputSchema: {
        service_id: z.string().uuid().optional().describe('Restrict to a service'),
        run_id: z.string().uuid().optional().describe('Restrict to a single run'),
        hostname: z.string().optional().describe('Restrict to a hostname'),
        username: z.string().optional().describe('Restrict to a username'),
        live: z.boolean().optional().describe('Only include runs considered currently alive'),
        all_runs: z
          .boolean()
          .optional()
          .describe('Return every run instead of only the most relevant one per instance')
      }
    },
    async params => asText(await fetchJSON('/logs/hosts', params))
  )

  server.registerTool(
    'get-host-stats',
    {
      description:
        'Get an aggregate breakdown (value -> count) of execution mode, Python version, jaylog version, ' +
        'venv kind and git branch across every active instance. Useful for a quick fleet overview.'
    },
    async () => asText(await fetchJSON('/logs/host-stats'))
  )
}
