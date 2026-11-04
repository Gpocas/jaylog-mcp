import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fetchJSON } from '../api'

// Mirrors the backend: `service_error_history` keeps 45 days, and the cleanup job
// keeps only the latest 1000 raw logs per instance (service + hostname + username).
const HISTORY_RETENTION_DAYS = 45
const RAW_LOGS_PER_INSTANCE = 1000
const DAY_MS = 86_400_000
const CONCURRENCY = 5

interface LevelCounts {
  total: number
  error: number
  critical: number
  exception: number
}

interface HistoryResponse {
  days: Array<LevelCounts & { date: string }>
}

interface HistogramResponse {
  range_from: string | null
  range_to: string | null
  total_logs: number
  buckets: Array<{ bucket: string; count: number; error: number; critical: number; exception: number }>
}

interface LastLog {
  service: string
  service_name: string
  hostname: string
  username: string
  last_activity_at: string | null
  live_run_count: number
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

function asText(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

function summarizeHistory(history: HistoryResponse, from: string, to: string) {
  const days = history.days.filter(day => day.total > 0)
  const sum = (key: keyof LevelCounts) => days.reduce((acc, day) => acc + day[key], 0)
  const peak = days.reduce<(typeof days)[number] | null>(
    (best, day) => (!best || day.total > best.total ? day : best),
    null
  )
  return {
    from,
    to,
    note: 'Daily snapshot taken overnight: covers completed days only (today is not included).',
    total: sum('total'),
    error: sum('error'),
    critical: sum('critical'),
    exception: sum('exception'),
    days_with_errors: days.length,
    first_error_day: days[0]?.date ?? null,
    last_error_day: days.at(-1)?.date ?? null,
    peak_day: peak ? { date: peak.date, total: peak.total } : null
  }
}

async function summarizeInstance(serviceId: string, instance: LastLog, cutoffMs: number) {
  const histogram = await fetchJSON<HistogramResponse>('/logs/error-histogram', {
    service: serviceId,
    hostname: instance.hostname,
    username: instance.username,
    bucket_minutes: 1440
  })

  const inWindow = histogram.buckets.filter(b => b.count > 0 && Date.parse(b.bucket) >= cutoffMs)
  const sum = (key: 'count' | 'error' | 'critical' | 'exception') =>
    inWindow.reduce((acc, b) => acc + b[key], 0)

  const retainedFromMs = histogram.range_from ? Date.parse(histogram.range_from) : null
  const fullyCovered = retainedFromMs !== null && retainedFromMs <= cutoffMs

  return {
    hostname: instance.hostname,
    username: instance.username,
    total: sum('count'),
    error: sum('error'),
    critical: sum('critical'),
    exception: sum('exception'),
    days_with_errors: inWindow.length,
    last_error_day: inWindow.length ? isoDay(Date.parse(inWindow.at(-1)!.bucket)) : null,
    last_activity_at: instance.last_activity_at,
    live_run_count: instance.live_run_count,
    retained_logs: histogram.total_logs,
    retained_from: histogram.range_from,
    // The raw logs only go back as far as the latest ~1000 logs of the instance.
    // When they start after the window, older errors were either never logged or
    // already pruned; a full buffer points to pruning.
    window_fully_covered: fullyCovered,
    possibly_pruned: !fullyCovered && histogram.total_logs >= RAW_LOGS_PER_INSTANCE
  }
}

export function registerErrorSummaryTools(server: McpServer) {
  server.registerTool(
    'get-error-summary',
    {
      description:
        'Accumulated error counts (ERROR/CRITICAL/EXCEPTION) for a service over the last N days ' +
        '(default and max 45), with two views: `service` sums the daily consolidated history ' +
        '(complete for every day, but service-wide only), and `instances` breaks errors down per ' +
        'instance (hostname + username), sorted by most errors. The per-instance numbers come from ' +
        'raw logs, of which only the latest ~1000 per instance are kept, so check ' +
        '`window_fully_covered`/`possibly_pruned` before treating them as the whole window; they can ' +
        'add up to less than the service total. Use it to see which machines concentrate the errors ' +
        'and how big the problem is. Use `get-error-history` for the day-by-day series.',
      inputSchema: {
        service: z.string().uuid().describe('Service ID (required)'),
        days: z
          .number()
          .int()
          .min(1)
          .max(HISTORY_RETENTION_DAYS)
          .optional()
          .describe(`Window size in days, counting back from today (default: ${HISTORY_RETENTION_DAYS})`)
      }
    },
    async ({ service, days = HISTORY_RETENTION_DAYS }) => {
      const nowMs = Date.now()
      const cutoffMs = Date.parse(isoDay(nowMs - days * DAY_MS))
      const from = isoDay(cutoffMs)
      const to = isoDay(nowMs)

      const [history, lastLogs] = await Promise.all([
        fetchJSON<HistoryResponse>('/logs/error-history', { service, from, to }),
        fetchJSON<LastLog[]>('/logs/last')
      ])

      const instances = lastLogs.filter(log => log.service === service)
      const perInstance = await mapLimited(instances, CONCURRENCY, instance =>
        summarizeInstance(service, instance, cutoffMs)
      )
      perInstance.sort((a, b) => b.total - a.total)

      return asText({
        service,
        service_name: instances[0]?.service_name ?? null,
        window: { days, from, to },
        service_history: summarizeHistory(history, from, to),
        instances: perInstance
      })
    }
  )
}
