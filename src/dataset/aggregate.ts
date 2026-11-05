// Pure functions behind `jaylog-mcp dataset`: masking, message grouping, timezone
// bucketing, aggregation and the summary the model reads to write the report.
// Kept free of I/O so the same rules apply to every report and are easy to test.

export interface RawLog {
  id?: string
  log_timestamp: string
  log_level: string
  is_exception?: boolean
  log_message?: string
  hostname?: string
  username?: string
  service?: string
}

export interface Row {
  date: string
  weekday: string
  hour: string
  instance: string
  level: string
  error: string
  service?: string
  count: number
}

export const LEVELS = ['CRITICAL', 'EXCEPTION', 'ERROR'] as const
const WEEKDAYS: Record<string, string> = { Sun: 'dom', Mon: 'seg', Tue: 'ter', Wed: 'qua', Thu: 'qui', Fri: 'sex', Sat: 'sáb' }
const MAX_GROUP_LENGTH = 90

// ---------- masking (always applied: the dataset ends up inside a shareable HTML) ----------

const MASKS: Array<[RegExp, string]> = [
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g, '<token>'],
  [/\b(Bearer|Basic)\s+[\w\-.~+/=]{8,}/gi, '$1 <token>'],
  [/\b(password|passwd|senha|pwd|token|secret|api[_-]?key|access[_-]?key|authorization)(["']?\s*[=:]\s*["']?)[^\s"',;&]+/gi, '$1$2<oculto>'],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>'],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '<cnpj>'],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '<cpf>'],
  [/\b[A-Fa-f0-9]{32,}\b/g, '<token>']
]

export function mask(text: string): string {
  return MASKS.reduce((acc, [re, to]) => acc.replace(re, to), text)
}

// ---------- grouping: same error, same group, in every report ----------

const VARIABLE: Array<[RegExp, string]> = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>'],
  [/\b\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?\b/g, '<data>'],
  [/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '<data>'],
  [/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '<hora>'],
  [/[A-Za-z]:\\[^\s"']*\\(Temp|tmp)\\[^\s"']*/g, '<temp>'],
  [/\/tmp\/[^\s"']*/g, '<temp>'],
  [/\b0x[0-9a-f]+\b/gi, '<hex>'],
  [/\b\d{4,}\b/g, '<n>']
]

function exceptionType(message: string): string | null {
  if (!/Traceback \(most recent call last\)/.test(message)) return null
  const lines = message.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const last = lines.at(-1) ?? ''
  const m = /^([A-Za-z_][\w.]*(Error|Exception|Exit|Interrupt|Warning|Timeout|Fault)|[A-Z]\w+Error)\b/.exec(last)
  return m ? m[1]!.split('.').at(-1)! : null
}

export function groupMessage(raw: string | undefined): string {
  const message = mask(raw ?? '')
  const first = message.split(/\r?\n/).map(l => l.trim()).find(l => l && !/^Traceback \(most recent call last\)/.test(l)) ?? ''
  let group = VARIABLE.reduce((acc, [re, to]) => acc.replace(re, to), first).replace(/\s+/g, ' ').trim()
  const type = exceptionType(message)
  if (type && !group.includes(type)) group = group ? `${group} · ${type}` : type
  if (!group) group = '(mensagem vazia)'
  return group.length > MAX_GROUP_LENGTH ? group.slice(0, MAX_GROUP_LENGTH - 1).trimEnd() + '…' : group
}

// ---------- timezone ----------

export function zoneParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
  }).formatToParts(new Date(ms))
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: get('hour'), minute: get('minute'), weekday: WEEKDAYS[get('weekday')] ?? get('weekday') }
}

/** Offset of `timeZone` at instant `ms`, in minutes (UTC−3 → −180). */
function offsetMinutes(ms: number, timeZone: string): number {
  const p = zoneParts(ms, timeZone)
  const wall = Date.UTC(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8, 10), +p.hour, +p.minute)
  return Math.round((wall - Math.floor(ms / 60000) * 60000) / 60000)
}

/** UTC instant of local midnight of `day` (YYYY-MM-DD) in `timeZone`. */
export function localMidnight(day: string, timeZone: string): number {
  const guess = Date.parse(`${day}T00:00:00Z`)
  return guess - offsetMinutes(guess - offsetMinutes(guess, timeZone) * 60000, timeZone) * 60000
}

export function offsetLabel(ms: number, timeZone: string): string {
  const off = offsetMinutes(ms, timeZone)
  const sign = off < 0 ? '−' : '+'
  const abs = Math.abs(off)
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? ':' + String(abs % 60).padStart(2, '0') : ''}`
}

export function dayList(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

// ---------- aggregation ----------

export function normalizeLevel(log: RawLog): string {
  const level = String(log.log_level ?? '').toUpperCase()
  if (log.is_exception && !LEVELS.includes(level as any)) return 'EXCEPTION'
  return level
}

export interface AggregateOptions {
  timeZone: string
  serviceNames?: Record<string, string>
  includeService: boolean
}

export function aggregate(logs: RawLog[], opts: AggregateOptions): Row[] {
  const cells = new Map<string, Row>()
  for (const log of logs) {
    const ms = Date.parse(log.log_timestamp)
    if (Number.isNaN(ms)) continue
    const p = zoneParts(ms, opts.timeZone)
    const row: Row = {
      date: p.date,
      weekday: p.weekday,
      hour: `${p.hour}h`,
      instance: `${log.hostname ?? '?'} · ${log.username ?? '?'}`,
      level: normalizeLevel(log),
      error: groupMessage(log.log_message),
      count: 0
    }
    if (opts.includeService) row.service = opts.serviceNames?.[log.service ?? ''] ?? log.service ?? '?'
    const key = [row.date, row.hour, row.service, row.instance, row.level, row.error].join('\u0001')
    const cur = cells.get(key)
    if (cur) cur.count++
    else cells.set(key, { ...row, count: 1 })
  }
  return [...cells.values()].sort((a, b) => (a.date + a.hour).localeCompare(b.date + b.hour) || b.count - a.count)
}

// ---------- summary for the model (numbers it can quote without recounting) ----------

const sumBy = (rows: Row[], key: keyof Row) => {
  const out: Record<string, number> = {}
  for (const r of rows) out[String(r[key])] = (out[String(r[key])] ?? 0) + r.count
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}
const round1 = (n: number) => Math.round(n * 10) / 10

function pearson(a: number[], b: number[]): number | null {
  const n = a.length
  if (n < 3) return null
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) { const x = a[i]! - ma, y = b[i]! - mb; num += x * y; da += x * x; db += y * y }
  return da && db ? num / Math.sqrt(da * db) : null
}

export interface ReportEvent { at: string; label: string }

export function summarize(rows: Row[], days: string[], events: ReportEvent[], opts: { includeService: boolean }) {
  const total = rows.reduce((s, r) => s + r.count, 0)
  const byDay = sumBy(rows, 'date')
  const daily = (filter: (r: Row) => boolean) => {
    const m: Record<string, number> = {}
    for (const r of rows) if (filter(r)) m[r.date] = (m[r.date] ?? 0) + r.count
    return days.map(d => m[d] ?? 0)
  }
  const errors = sumBy(rows, 'error')
  const top = Object.keys(errors).slice(0, 10)

  // Recent vs previous: the "is it getting worse?" question, per error.
  const recentN = Math.min(7, Math.floor(days.length / 2))
  const trend = (series: number[]) => {
    if (recentN < 2) return null
    const recent = series.slice(-recentN), before = series.slice(0, -recentN)
    const a = before.reduce((s, v) => s + v, 0) / before.length, b = recent.reduce((s, v) => s + v, 0) / recent.length
    return { per_day_before: round1(a), per_day_last_days: round1(b), last_days: recentN, ratio: a ? round1(b / a) : null }
  }

  const topErrors = top.map(error => {
    const mine = rows.filter(r => r.error === error)
    const dates = mine.map(r => r.date).sort()
    return {
      error,
      count: errors[error],
      levels: sumBy(mine, 'level'),
      instances: sumBy(mine, 'instance'),
      ...(opts.includeService ? { services: sumBy(mine, 'service') } : {}),
      first_day: dates[0],
      last_day: dates.at(-1),
      days_with_error: new Set(dates).size,
      trend: trend(daily(r => r.error === error))
    }
  })

  const peaks = Object.entries(byDay).slice(0, 5).map(([date, count]) => {
    const dayRows = rows.filter(r => r.date === date)
    const main = Object.entries(sumBy(dayRows, 'error'))[0]
    return { date, count, main_error: main?.[0], main_error_count: main?.[1] }
  })

  const cells: Record<string, number> = {}
  for (const r of rows) cells[`${r.weekday} ${r.hour}`] = (cells[`${r.weekday} ${r.hour}`] ?? 0) + r.count
  const hotspots = Object.entries(cells).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cell, count]) => ({ cell, count }))

  const series = Object.fromEntries(top.slice(0, 8).map(e => [e, daily(r => r.error === e)]))
  const pairs: Array<{ a: string; b: string; r: number }> = []
  const keys = Object.keys(series)
  keys.forEach((a, i) => keys.slice(i + 1).forEach(b => {
    const r = pearson(series[a]!, series[b]!)
    if (r !== null && Math.abs(r) >= 0.5) pairs.push({ a, b, r: Math.round(r * 100) / 100 })
  }))
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r))

  const eventEffects = events.map(ev => {
    const day = ev.at.slice(0, 10)
    const idx = days.indexOf(day)
    if (idx <= 0) return { ...ev, note: 'evento fora do período ou no primeiro dia' }
    const perDay = (s: number[]) => {
      const before = s.slice(0, idx), after = s.slice(idx)
      const a = before.reduce((x, v) => x + v, 0) / before.length, b = after.reduce((x, v) => x + v, 0) / after.length
      return { per_day_before: round1(a), per_day_after: round1(b), ratio: a ? round1(b / a) : null }
    }
    const changes = top.map(e => ({ error: e, ...perDay(daily(r => r.error === e)) }))
      .sort((x, y) => Math.abs(y.per_day_after - y.per_day_before) - Math.abs(x.per_day_after - x.per_day_before)).slice(0, 3)
    return { ...ev, all_errors: perDay(daily(() => true)), biggest_changes: changes }
  })

  return {
    total,
    by_level: sumBy(rows, 'level'),
    by_instance: sumBy(rows, 'instance'),
    ...(opts.includeService ? { by_service: sumBy(rows, 'service') } : {}),
    days: { from: days[0], to: days.at(-1), count: days.length, with_errors: Object.keys(byDay).length },
    trend: trend(daily(() => true)),
    peak_days: peaks,
    top_errors: topErrors,
    hotspots_weekday_hour: hotspots,
    correlated_errors: pairs.slice(0, 6),
    events: eventEffects
  }
}
