// `jaylog-mcp dataset`: fetches a service's error logs straight from the Jaylog API and
// writes the aggregated dataset used by the `jaylog-html-report` skill, so the model
// never has to read or copy raw logs. stdout gets a compact JSON summary (numbers the
// model can quote); progress and warnings go to stderr.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { fetchJSON } from '../api'
import {
  aggregate, dayList, LEVELS, localMidnight, mask, normalizeLevel, offsetLabel, summarize, zoneParts,
  groupMessage, type RawLog, type ReportEvent
} from '../dataset/aggregate'
import { colors } from './colors'

const HOUR_MS = 3_600_000
const MAX_DAYS = 45
const CONCURRENCY = 4
// Sizes that look like a server-side page cap rather than a real count. A window that
// comes back with one of them (or with `--split-at` logs or more) is split and refetched.
const SUSPICIOUS_SIZES = new Set([50, 100, 200, 250, 300, 1000, 2000, 5000, 10000])

const USAGE = `Uso: jaylog-mcp dataset --service <id>[,<id>...] --out <arquivo.dataset.json> [opções]

  --service <ids>       Um ou mais ids de serviço (separados por vírgula). Com mais de um, as
                        linhas ganham o campo "service" (comparativo de serviços).
  --days <n>            Últimos n dias, contando hoje (padrão 45, máximo 45).
  --from / --to <dia>   Intervalo explícito (AAAA-MM-DD), no fuso de --tz. Substitui --days.
  --tz <fuso>           Fuso IANA para dia/hora (padrão: o da máquina, ${Intl.DateTimeFormat().resolvedOptions().timeZone}).
  --levels <lista>      Níveis, separados por vírgula (padrão CRITICAL,EXCEPTION,ERROR).
  --event "<data>=<rótulo>"  Marco (deploy, incidente). Repetível. O resumo mostra o antes e o depois.
  --samples <n>         Exemplos de mensagem completa (mascarada) por erro principal (padrão 2).
  --window-hours <n>    Tamanho de cada consulta à API (padrão 72).
  --split-at <n>        Divide a janela quando vierem n logs ou mais (padrão 500).
  --out <arquivo>       Arquivo de saída (obrigatório).`

interface Args {
  services: string[]
  from: string
  to: string
  timeZone: string
  levels: string[]
  events: ReportEvent[]
  samples: number
  windowHours: number
  splitAt: number
  out: string
}

function fail(message: string): never {
  console.error(colors.boldRed(message))
  console.error(USAGE)
  process.exit(2)
}

function parseArgs(argv: string[]): Args {
  const values: Record<string, string[]> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--help' || a === '-h') { console.error(USAGE); process.exit(0) }
    if (!a.startsWith('--')) fail(`Argumento inesperado: ${a}`)
    const [key, inline] = a.slice(2).split(/=(.*)/s)
    const value = inline ?? argv[++i]
    if (value === undefined) fail(`Falta o valor de --${key}`)
    ;(values[key!] ??= []).push(value)
  }
  const one = (k: string) => values[k]?.at(-1)
  const timeZone = one('tz') ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  try { new Intl.DateTimeFormat('en', { timeZone }) } catch { fail(`Fuso inválido: ${timeZone} (use um nome IANA, ex.: America/Sao_Paulo)`) }

  const services = (one('service') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!services.length) fail('Informe --service')
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  for (const s of services) if (!uuid.test(s)) fail(`--service deve ser o id (UUID) do serviço; recebi "${s}"`)
  const out = one('out') ?? fail('Informe --out')

  const today = zoneParts(Date.now(), timeZone).date
  let from = one('from'), to = one('to')
  const isDay = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d)
  if (from || to) {
    if (!isDay(from) || !isDay(to)) fail('--from e --to precisam estar juntos, no formato AAAA-MM-DD')
    if (from! > to!) fail('--from é depois de --to')
  } else {
    const days = Number(one('days') ?? MAX_DAYS)
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) fail(`--days deve ser um inteiro de 1 a ${MAX_DAYS}`)
    to = today
    from = new Date(Date.parse(today + 'T00:00:00Z') - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  }
  if (dayList(from!, to!).length > MAX_DAYS) console.error(colors.yellow(`Aviso: mais de ${MAX_DAYS} dias; o histórico consolidado do Jaylog só guarda ${MAX_DAYS}.`))

  const levels = (one('levels') ?? LEVELS.join(',')).split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  const events = (values.event ?? []).map(e => {
    const m = /^(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?)\s*=\s*(.+)$/.exec(e)
    if (!m) fail(`--event deve ser "AAAA-MM-DD[THH:MM]=Rótulo"; recebi "${e}"`)
    return { at: m[1]!.replace(' ', 'T'), label: m[2]!.trim() }
  })
  const num = (k: string, d: number) => {
    const v = Number(one(k) ?? d)
    if (!Number.isFinite(v) || v < 0) fail(`--${k} deve ser um número positivo`)
    return v
  }
  return { services, from: from!, to: to!, timeZone, levels, events, samples: num('samples', 2), windowHours: Math.max(1, num('window-hours', 72)), splitAt: Math.max(10, num('split-at', 500)), out }
}

// ---------- API ----------

function extractList(data: any): RawLog[] {
  if (Array.isArray(data)) return data
  for (const key of ['logs', 'items', 'data', 'results', 'rows']) if (Array.isArray(data?.[key])) return data[key]
  throw new Error(`Resposta inesperada de /logs/list (campos: ${Object.keys(data ?? {}).join(', ') || 'nenhum'})`)
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]!) }
  }))
  return results
}

let requests = 0
async function fetchRange(params: Record<string, unknown>, fromMs: number, toMs: number, splitAt: number, depth = 0): Promise<RawLog[]> {
  requests++
  const list = extractList(await fetchJSON('/logs/list', {
    ...params, log_timestamp_from: new Date(fromMs).toISOString(), log_timestamp_to: new Date(toMs).toISOString()
  }))
  const looksCapped = list.length >= splitAt || SUSPICIOUS_SIZES.has(list.length)
  if (looksCapped && toMs - fromMs > HOUR_MS && depth < 14) {
    const mid = Math.floor((fromMs + toMs) / 2)
    const [a, b] = await Promise.all([fetchRange(params, fromMs, mid, splitAt, depth + 1), fetchRange(params, mid + 1, toMs, splitAt, depth + 1)])
    return a.concat(b)
  }
  if (looksCapped && list.length >= splitAt) console.error(colors.yellow(`Aviso: ${list.length} logs numa janela de 1 h (${new Date(fromMs).toISOString()}); pode haver corte do servidor.`))
  // The payload can carry screenshots; nothing downstream needs them.
  return list.map(({ id, log_timestamp, log_level, is_exception, log_message, hostname, username, service }) =>
    ({ id, log_timestamp, log_level, is_exception, log_message, hostname, username, service }))
}

function windows(fromMs: number, toMs: number, hours: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let t = fromMs; t <= toMs; t += hours * HOUR_MS) out.push([t, Math.min(toMs, t + hours * HOUR_MS - 1)])
  return out
}

async function fetchServiceLogs(service: string, args: Args, fromMs: number, toMs: number): Promise<RawLog[]> {
  const ws = windows(fromMs, toMs, args.windowHours)
  const byLevel = async (extra: Record<string, unknown>) =>
    (await mapLimited(ws, CONCURRENCY, ([a, b]) => fetchRange({ service, ...extra }, a, b, args.splitAt))).flat()
  const logs: RawLog[] = []
  for (const level of args.levels) {
    let got = await byLevel({ log_level: level })
    // Exceptions are sometimes flagged only by `is_exception` (see the incident-report skill).
    // Duplicates with other levels are removed below.
    if (level === 'EXCEPTION' && !got.length) got = await byLevel({ is_exception: true })
    logs.push(...got)
    console.error(colors.dim(`  ${service.slice(0, 8)}… ${level}: ${got.length} logs`))
  }
  const seen = new Set<string>()
  return logs.filter(l => {
    const key = l.id ?? `${l.log_timestamp}|${l.hostname}|${l.username}|${l.log_level}|${(l.log_message ?? '').slice(0, 200)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map(l => ({ ...l, service: l.service ?? service }))
}

interface HistoryDay { date: string; total: number; error: number; critical: number; exception: number }

// ---------- main ----------

export async function runDataset(argv: string[]) {
  const args = parseArgs(argv)
  const fromMs = localMidnight(args.from, args.timeZone)
  const toMs = Math.min(Date.now(), localMidnight(new Date(Date.parse(args.to + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10), args.timeZone) - 1)
  const tzLabel = `${args.timeZone} (${offsetLabel(fromMs, args.timeZone)})`
  console.error(colors.cyan(`Buscando logs de ${args.from} a ${args.to} · ${tzLabel} · ${args.levels.join(', ')}`))

  const last = await fetchJSON<Array<{ service: string; service_name?: string }>>('/logs/last').catch(() => [])
  const serviceNames: Record<string, string> = {}
  for (const l of Array.isArray(last) ? last : []) if (l.service && l.service_name) serviceNames[l.service] = l.service_name

  const logs: RawLog[] = []
  const history: Record<string, HistoryDay[]> = {}
  for (const service of args.services) {
    logs.push(...await fetchServiceLogs(service, args, fromMs, toMs))
    history[service] = await fetchJSON<{ days: HistoryDay[] }>('/logs/error-history', { service, from: args.from, to: args.to })
      .then(h => h.days ?? []).catch(() => [])
  }
  const inLevels = logs.filter(l => args.levels.includes(normalizeLevel(l)))
  const includeService = args.services.length > 1
  const rows = aggregate(inLevels, { timeZone: args.timeZone, serviceNames, includeService })
  const days = dayList(args.from, args.to)

  // Coverage: raw logs keep only the latest ~1000 per instance, so compare with the nightly history.
  const levelKey: Record<string, keyof HistoryDay> = { ERROR: 'error', CRITICAL: 'critical', EXCEPTION: 'exception' }
  const historyByDay: Record<string, number> = {}
  for (const d of Object.values(history).flat())
    historyByDay[d.date] = (historyByDay[d.date] ?? 0) + args.levels.reduce((s, l) => s + (Number(d[levelKey[l] ?? 'total']) || 0), 0)
  const datasetByDay: Record<string, number> = {}
  for (const r of rows) datasetByDay[r.date] = (datasetByDay[r.date] ?? 0) + r.count
  const compared = Object.keys(historyByDay).filter(d => d >= args.from && d <= args.to)
  const historyTotal = compared.reduce((s, d) => s + historyByDay[d]!, 0)
  const datasetTotalCompared = compared.reduce((s, d) => s + (datasetByDay[d] ?? 0), 0)
  const partialDays = compared.filter(d => (datasetByDay[d] ?? 0) < historyByDay[d]! * 0.95).sort()
  const coverage = {
    history_total: historyTotal,
    dataset_total_same_days: datasetTotalCompared,
    ratio: historyTotal ? Math.round((datasetTotalCompared / historyTotal) * 1000) / 1000 : null,
    partial: partialDays.length > 0,
    partial_days_count: partialDays.length,
    partial_days: partialDays.slice(0, 15),
    first_complete_day: partialDays.length ? (compared.filter(d => d > partialDays.at(-1)!).sort()[0] ?? null) : args.from,
    note: Object.keys(historyByDay).length
      ? 'Comparado com o histórico consolidado (get-error-history), que fecha à noite e não inclui hoje. Dias "parciais" tiveram menos logs brutos que o histórico: o Jaylog guarda só os ~1000 logs mais recentes por instância.'
      : 'Sem histórico consolidado para comparar.'
  }

  const summary = summarize(rows, days, args.events, { includeService })

  // Masked full messages of the main errors, for the report's details panel.
  const details: Record<string, { samples: string[]; facts: Array<{ label: string; value: string }> }> = {}
  const fmt = (iso: string) => { const p = zoneParts(Date.parse(iso), args.timeZone); return `${p.date.slice(8, 10)}/${p.date.slice(5, 7)} ${p.hour}:${p.minute}` }
  if (args.samples > 0) {
    const sorted = [...inLevels].sort((a, b) => b.log_timestamp.localeCompare(a.log_timestamp))
    for (const top of summary.top_errors) {
      const mine = sorted.filter(l => groupMessage(l.log_message) === top.error)
      if (!mine.length) continue
      details[top.error] = {
        samples: mine.slice(0, args.samples).map(l => {
          const text = mask(l.log_message ?? '').trim()
          return (text.length > 1500 ? text.slice(0, 1500) + '\n…' : text) + (l.id ? `\n(log ${l.id})` : '')
        }),
        facts: [
          { label: 'Primeira vez no período', value: fmt(mine.at(-1)!.log_timestamp) },
          { label: 'Última vez', value: fmt(mine[0]!.log_timestamp) },
          { label: 'Máquinas', value: Object.keys(top.instances).join(', ') }
        ]
      }
    }
  }

  const label = includeService ? 'Erros por serviço' : `Erros de ${serviceNames[args.services[0]!] ?? args.services[0]}`
  const file = {
    kind: 'jaylog-dataset',
    version: 1,
    generated_at: new Date().toISOString(),
    params: { services: args.services, service_names: Object.fromEntries(args.services.map(s => [s, serviceNames[s] ?? null])), from: args.from, to: args.to, levels: args.levels },
    timezone: tzLabel,
    label,
    value: 'count',
    unit: 'erros',
    time: 'date',
    time_range: [args.from, args.to],
    dimensions: includeService ? ['service', 'instance', 'level', 'error', 'weekday'] : ['instance', 'level', 'error', 'weekday'],
    rows,
    details: { error: details },
    events: args.events,
    coverage,
    summary
  }
  const out = resolve(args.out)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(file) + '\n')

  console.error(colors.boldGreen(`OK: ${out}`))
  console.error(colors.dim(`  ${inLevels.length} logs → ${rows.length} linhas · ${requests} consultas à API`))
  if (coverage.partial) console.error(colors.yellow(`  Aviso: cobertura parcial (${coverage.ratio === null ? '?' : Math.round(coverage.ratio * 100) + '%'} do histórico). Veja "coverage" no resumo.`))

  process.stdout.write(JSON.stringify({
    file: out,
    rows: rows.length,
    logs: inLevels.length,
    timezone: tzLabel,
    period: { from: args.from, to: args.to },
    services: file.params.service_names,
    coverage,
    summary,
    spec_snippet: {
      datasets: { erros: { from_file: out } },
      filters: [
        { field: 'date', kind: 'date-range', label: 'Período' },
        ...(includeService ? [{ field: 'service', label: 'Serviço' }] : []),
        { field: 'instance', label: 'Máquina' },
        { field: 'level', label: 'Nível' },
        { field: 'error', label: 'Erro' }
      ],
      labels: { service: 'Serviço', instance: 'Máquina', level: 'Nível', error: 'Erro', date: 'Dia', weekday: 'Dia da semana', hour: 'Hora' },
      events: args.events
    }
  }, null, 2) + '\n')
}
