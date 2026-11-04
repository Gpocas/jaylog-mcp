import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fetchJSON } from '../api'

// Samples arrive about once a minute and are kept for 48 h. A 5-minute bucket
// keeps the per-instance payload small (≤ 576 buckets) while "now" stays recent.
const BUCKET_MINUTES = 5
const RETENTION_HOURS = 48
const STALE_AFTER_MINUTES = 15
const MAX_INSTANCES = 40
const CONCURRENCY = 5

const GAUGES = [
  'host_cpu_pct',
  'host_mem_pct',
  'host_mem_used_bytes',
  'host_disk_pct',
  'host_disk_used_bytes',
  'proc_cpu_pct',
  'proc_mem_pct',
  'proc_mem_bytes'
] as const
type Gauge = (typeof GAUGES)[number]

type Bucket = { bucket: string; samples: number; proc_io_read_bytes: number | null; proc_io_write_bytes: number | null } & {
  [K in `${Gauge}_avg` | `${Gauge}_max`]: number | null
}

interface HostMetricsResponse {
  range_to: string | null
  limits: {
    cpu_count: number | null
    memory_total_bytes: number | null
    disk_total_bytes: number | null
    disk_path: string | null
  } | null
  buckets: Bucket[]
}

interface LastLog {
  service: string
  service_name: string
  hostname: string
  username: string
  last_activity_at: string | null
  live_run_count: number
}

const round = (value: number | null, digits = 1) =>
  value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits))
const toMB = (bytes: number | null) => (bytes === null ? null : round(bytes / 1024 ** 2))
const toGB = (bytes: number | null) => (bytes === null ? null : round(bytes / 1024 ** 3))

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

/** Sample-weighted average of the bucket averages, and max of the bucket maxima. */
function aggregate(buckets: Bucket[], gauge: Gauge) {
  let weighted = 0
  let samples = 0
  let max: number | null = null
  for (const b of buckets) {
    const avg = b[`${gauge}_avg`]
    const peak = b[`${gauge}_max`]
    if (avg !== null) {
      weighted += avg * b.samples
      samples += b.samples
    }
    if (peak !== null) max = max === null ? peak : Math.max(max, peak)
  }
  return { avg: samples ? weighted / samples : null, max }
}

/** % change of process memory between the first and last quarter of the window. */
function memoryTrend(buckets: Bucket[]): number | null {
  if (buckets.length < 8) return null
  const quarter = Math.floor(buckets.length / 4)
  const first = aggregate(buckets.slice(0, quarter), 'proc_mem_bytes').avg
  const last = aggregate(buckets.slice(-quarter), 'proc_mem_bytes').avg
  if (!first || last === null) return null
  return round(((last - first) / first) * 100)
}

interface NowReadings {
  host_cpu_pct: number | null
  host_mem_pct: number | null
  host_disk_pct: number | null
}

interface WindowReadings {
  host_cpu_pct_avg: number | null
  host_mem_pct_max: number | null
}

function alertsFor(now: NowReadings | null, window: WindowReadings, trend: number | null) {
  const alerts: string[] = []
  if (!now) return alerts
  if ((now.host_cpu_pct ?? 0) >= 90) alerts.push(`CPU da máquina em ${now.host_cpu_pct}% agora`)
  else if ((window.host_cpu_pct_avg ?? 0) >= 80) alerts.push(`CPU da máquina com média de ${window.host_cpu_pct_avg}% no período`)
  if ((now.host_mem_pct ?? 0) >= 90 || (window.host_mem_pct_max ?? 0) >= 95)
    alerts.push(`memória da máquina alta (agora ${now.host_mem_pct}%, pico ${window.host_mem_pct_max}%)`)
  if ((now.host_disk_pct ?? 0) >= 90) alerts.push(`disco em ${now.host_disk_pct}%`)
  if (trend !== null && trend >= 50) alerts.push(`memória do processo cresceu ${trend}% no período (possível vazamento)`)
  return alerts
}

async function usageFor(instance: LastLog, hours: number, nowMs: number) {
  const metrics = await fetchJSON<HostMetricsResponse>('/logs/host-metrics', {
    service: instance.service,
    hostname: instance.hostname,
    username: instance.username,
    bucket_minutes: BUCKET_MINUTES
  })

  const withData = metrics.buckets.filter(b => b.samples > 0)
  const windowStart = nowMs - hours * 3_600_000
  const inWindow = withData.filter(b => Date.parse(b.bucket) >= windowStart)
  const latest = withData.at(-1)
  const latestAt = latest ? Date.parse(latest.bucket) + BUCKET_MINUTES * 60_000 : null
  const stale = latestAt === null || nowMs - latestAt > STALE_AFTER_MINUTES * 60_000

  const now = latest
    ? {
        at: metrics.range_to,
        host_cpu_pct: round(latest.host_cpu_pct_avg),
        host_mem_pct: round(latest.host_mem_pct_avg),
        host_mem_used_gb: toGB(latest.host_mem_used_bytes_avg),
        host_disk_pct: round(latest.host_disk_pct_avg),
        proc_cpu_pct: round(latest.proc_cpu_pct_avg),
        proc_mem_pct: round(latest.proc_mem_pct_avg),
        proc_mem_mb: toMB(latest.proc_mem_bytes_avg)
      }
    : null

  const cpu = aggregate(inWindow, 'host_cpu_pct')
  const mem = aggregate(inWindow, 'host_mem_pct')
  const disk = aggregate(inWindow, 'host_disk_pct')
  const procCpu = aggregate(inWindow, 'proc_cpu_pct')
  const procMem = aggregate(inWindow, 'proc_mem_bytes')
  const sumIO = (key: 'proc_io_read_bytes' | 'proc_io_write_bytes') =>
    toMB(inWindow.reduce((acc, b) => acc + (b[key] ?? 0), 0))
  const trend = memoryTrend(inWindow)

  const window = {
    host_cpu_pct_avg: round(cpu.avg),
    host_cpu_pct_max: round(cpu.max),
    host_mem_pct_avg: round(mem.avg),
    host_mem_pct_max: round(mem.max),
    host_disk_pct_max: round(disk.max),
    proc_cpu_pct_avg: round(procCpu.avg),
    proc_cpu_pct_max: round(procCpu.max),
    proc_mem_mb_avg: toMB(procMem.avg),
    proc_mem_mb_max: toMB(procMem.max),
    proc_mem_change_pct: trend,
    proc_io_read_mb: sumIO('proc_io_read_bytes'),
    proc_io_write_mb: sumIO('proc_io_write_bytes'),
    samples: inWindow.reduce((acc, b) => acc + b.samples, 0)
  }

  const limits = metrics.limits
  return {
    service: instance.service,
    service_name: instance.service_name,
    hostname: instance.hostname,
    username: instance.username,
    live: instance.live_run_count > 0,
    last_activity_at: instance.last_activity_at,
    machine: limits
      ? {
          cpu_count: limits.cpu_count,
          memory_total_gb: toGB(limits.memory_total_bytes),
          disk_total_gb: toGB(limits.disk_total_bytes),
          disk_path: limits.disk_path
        }
      : null,
    // Average of the latest bucket; `stale` means it is older than the cutoff.
    latest: now,
    stale,
    window,
    alerts: stale
      ? [latest ? `sem amostras há mais de ${STALE_AFTER_MINUTES} min` : 'nenhuma amostra de recursos nas últimas 48 h (instância parada ou cliente jaylog sem suporte a métricas)']
      : alertsFor(now, window, trend)
  }
}

export function registerResourceUsageTools(server: McpServer) {
  server.registerTool(
    'get-resource-usage',
    {
      description:
        'Task-manager view of resource usage for running instances (service + hostname + username): ' +
        'current CPU/memory/disk of the machine and CPU/memory of the jaylog process, plus averages, ' +
        'peaks, process-memory trend and I/O totals over the last N hours (default 1, max 48), and ' +
        'ready-made alerts (high CPU/memory/disk, possible memory leak, no recent samples). Filter by ' +
        'service and/or hostname; with neither, covers every live instance (capped). host_* values ' +
        'describe the whole machine and are shared by every service on it; proc_* values are the ' +
        'service process only (proc_cpu_pct can exceed 100 on multi-core machines). `latest` is the ' +
        `average of the most recent ${BUCKET_MINUTES}-minute bucket; \`stale: true\` means it is older than ` +
        `${STALE_AFTER_MINUTES} minutes, so it does not describe the machine right now. Use \`get-host-metrics\` for the ` +
        'minute-by-minute series of one instance (e.g. around the time of an error).',
      inputSchema: {
        service: z.string().uuid().optional().describe('Restrict to a service'),
        hostname: z.string().optional().describe('Restrict to a machine (exact hostname): every service running on it'),
        hours: z
          .number()
          .min(1)
          .max(RETENTION_HOURS)
          .optional()
          .describe('Window for averages/peaks, in hours (default: 1, max: 48)'),
        include_stopped: z
          .boolean()
          .optional()
          .describe('Also include instances with no live run (default: false)')
      }
    },
    async ({ service, hostname, hours = 1, include_stopped = false }) => {
      const nowMs = Date.now()
      const lastLogs = await fetchJSON<LastLog[]>('/logs/last')
      const matching = lastLogs.filter(
        log =>
          (!service || log.service === service) &&
          (!hostname || log.hostname === hostname) &&
          (include_stopped || log.live_run_count > 0)
      )
      const selected = matching.slice(0, MAX_INSTANCES)

      const usage = await mapLimited(selected, CONCURRENCY, instance => usageFor(instance, hours, nowMs))
      usage.sort(
        (a, b) =>
          b.alerts.length - a.alerts.length ||
          Number(a.stale) - Number(b.stale) ||
          (b.latest?.proc_cpu_pct ?? -1) - (a.latest?.proc_cpu_pct ?? -1)
      )

      return asText({
        filters: { service: service ?? null, hostname: hostname ?? null, include_stopped },
        window_hours: hours,
        instances_found: matching.length,
        instances_shown: usage.length,
        ...(matching.length > selected.length
          ? { note: `Only the first ${MAX_INSTANCES} instances were checked; filter by service or hostname.` }
          : {}),
        instances: usage
      })
    }
  )
}
