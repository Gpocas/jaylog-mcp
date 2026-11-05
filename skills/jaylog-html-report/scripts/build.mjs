#!/usr/bin/env node
// Builds a self-contained HTML report (ECharts + data + styles inline) from a JSON spec.
// Usage: node build.mjs <spec.json> <output.html>
// No dependencies: needs only Node 18+ (already required by the Jaylog MCP).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const assets = join(here, '..', 'assets')

const MAX_SERIES = 6
const SECTION_TYPES = ['kpis', 'chart', 'table', 'alerts', 'text', 'timeline']
const TABS = ['overview', 'analysis']
const CHART_KINDS = ['line', 'bar', 'heatmap', 'graph', 'sankey', 'correlation']
const STATUSES = ['good', 'warning', 'serious', 'critical', 'info']
const COLUMN_FORMATS = ['text', 'number', 'code', 'date', 'status', 'level', 'link', 'percent']
const AGGS = ['sum', 'count', 'avg', 'max', 'min', 'distinct']
const SEVERITY_NAMES = ['ERROR', 'EXCEPTION', 'CRITICAL']
const FILTER_KINDS = ['values', 'date-range']

const errors = []
const warnings = []
const fail = (path, message) => errors.push(`${path}: ${message}`)
const isStr = v => typeof v === 'string' && v.trim() !== ''
const isNumOrNull = v => v === null || (typeof v === 'number' && Number.isFinite(v))
const isArr = v => Array.isArray(v)
const isObj = v => v !== null && typeof v === 'object' && !isArr(v)
const isoDay = v => /^\d{4}-\d{2}-\d{2}/.test(String(v))

// ---------- datasets ----------
const datasets = {}

function checkDatasets(spec) {
  if (spec.datasets === undefined) return
  if (!isObj(spec.datasets)) return fail('datasets', 'objeto { "nome": { "rows": [...] } }')
  for (const [name, d] of Object.entries(spec.datasets)) {
    const p = `datasets.${name}`
    if (!isObj(d)) { fail(p, 'objeto com "rows"'); continue }
    if (!isArr(d.rows) || d.rows.length === 0) { fail(`${p}.rows`, 'lista de registros obrigatória (um objeto por linha)'); continue }
    const bad = d.rows.findIndex(r => !isObj(r))
    if (bad >= 0) { fail(`${p}.rows[${bad}]`, 'cada linha deve ser um objeto'); continue }
    const fields = new Set()
    d.rows.slice(0, 1000).forEach(r => Object.keys(r).forEach(k => fields.add(k)))
    datasets[name] = { fields, rows: d.rows }
    if (d.value !== undefined) {
      if (!fields.has(d.value)) fail(`${p}.value`, `campo "${d.value}" não existe nas linhas`)
      else if (d.rows.some(r => r[d.value] !== undefined && r[d.value] !== null && typeof r[d.value] !== 'number'))
        fail(`${p}.value`, `"${d.value}" deve ser numérico em todas as linhas`)
    }
    if (d.time !== undefined) {
      if (!fields.has(d.time)) fail(`${p}.time`, `campo "${d.time}" não existe nas linhas`)
      else if (!d.rows.slice(0, 200).every(r => r[d.time] === undefined || isoDay(r[d.time])))
        fail(`${p}.time`, `"${d.time}" deve ter datas ISO (2026-11-03 ou 2026-11-03T14:00)`)
    }
    if (d.dimensions !== undefined && (!isArr(d.dimensions) || d.dimensions.some(f => !fields.has(f))))
      fail(`${p}.dimensions`, 'lista de campos existentes nas linhas')
    if (d.rows.length > 20000) warnings.push(`${p}: ${d.rows.length} linhas; agregue mais (por dia/hora) para o arquivo ficar leve`)
  }
}

function checkField(path, dsName, field, label = 'campo') {
  const ds = datasets[dsName]
  if (!ds) return
  if (!isStr(field)) return fail(path, `${label} obrigatório`)
  if (!ds.fields.has(field)) fail(path, `campo "${field}" não existe no dataset "${dsName}" (campos: ${[...ds.fields].join(', ')})`)
}

function checkQueryBase(path, q) {
  if (!isObj(q)) { fail(path, 'objeto "query" inválido'); return false }
  if (!isStr(q.dataset)) { fail(`${path}.dataset`, 'nome do dataset obrigatório'); return false }
  if (!datasets[q.dataset]) { fail(`${path}.dataset`, `dataset "${q.dataset}" não existe em "datasets"`); return false }
  if (q.agg !== undefined && !AGGS.includes(q.agg)) fail(`${path}.agg`, `use um de: ${AGGS.join(', ')}`)
  if (q.value !== undefined) checkField(`${path}.value`, q.dataset, q.value)
  if (q.where !== undefined) {
    if (!isObj(q.where)) fail(`${path}.where`, 'objeto { "campo": valor ou [valores] }')
    else Object.keys(q.where).forEach(f => checkField(`${path}.where.${f}`, q.dataset, f))
  }
  return true
}

// ---------- gráficos ----------
function checkSeries(path, chart, length) {
  if (!isArr(chart.series) || chart.series.length === 0) return fail(`${path}.series`, 'informe ao menos uma série')
  if (chart.series.length > MAX_SERIES)
    fail(`${path}.series`, `${chart.series.length} séries; o máximo é ${MAX_SERIES}. Agrupe as menores em "Outros" ou divida em mais de um gráfico`)
  chart.series.forEach((s, i) => {
    const p = `${path}.series[${i}]`
    if (!isStr(s.name)) fail(`${p}.name`, 'nome obrigatório')
    if (!isArr(s.values)) return fail(`${p}.values`, 'deve ser uma lista')
    if (s.values.length !== length) fail(`${p}.values`, `tem ${s.values.length} valores, mas o eixo tem ${length}`)
    if (!s.values.every(isNumOrNull)) fail(`${p}.values`, 'só números ou null')
  })
  if (chart.palette === 'severity') {
    const unknown = chart.series.map(s => String(s.name).toUpperCase()).filter(n => !SEVERITY_NAMES.includes(n))
    if (unknown.length) fail(`${path}.palette`, `"severity" exige séries chamadas ${SEVERITY_NAMES.join('/')}; encontrei ${unknown.join(', ')}`)
  }
}

function checkCartesianQuery(path, chart) {
  const q = chart.query
  if (!checkQueryBase(`${path}.query`, q)) return
  checkField(`${path}.query.x`, q.dataset, q.x, '"x"')
  if (q.series !== undefined) {
    checkField(`${path}.query.series`, q.dataset, q.series, '"series"')
    const ds = datasets[q.dataset]
    if (ds.fields.has(q.series)) {
      const values = new Set(ds.rows.map(r => r[q.series]).filter(v => v !== undefined && v !== null).map(String))
      if (chart.palette === 'severity') {
        const unknown = [...values].filter(v => !SEVERITY_NAMES.includes(v))
        if (unknown.length) fail(`${path}.palette`, `"severity" exige valores ${SEVERITY_NAMES.join('/')} em "${q.series}"; encontrei ${unknown.join(', ')}`)
      } else if (values.size > MAX_SERIES && !q.series_order)
        warnings.push(`${path}: "${q.series}" tem ${values.size} valores; as 5 maiores viram séries e o resto vai para "Outros"`)
    }
  }
  if (q.series_order !== undefined && (!isArr(q.series_order) || q.series_order.length > MAX_SERIES))
    fail(`${path}.query.series_order`, `lista com até ${MAX_SERIES} valores`)
  if (q.limit !== undefined && !(Number.isInteger(q.limit) && q.limit > 0)) fail(`${path}.query.limit`, 'inteiro positivo')
  if (chart.dates && datasets[q.dataset]?.fields.has(q.x) && !datasets[q.dataset].rows.slice(0, 200).every(r => isoDay(r[q.x])))
    fail(`${path}.query.x`, `"dates: true" exige datas ISO em "${q.x}"`)
}

function checkNetwork(path, chart) {
  if (chart.query) {
    const q = chart.query
    if (!checkQueryBase(`${path}.query`, q)) return
    if (!isArr(q.fields) || q.fields.length < 2 || q.fields.length > MAX_SERIES)
      return fail(`${path}.query.fields`, `lista de 2 a ${MAX_SERIES} campos (cada campo vira uma coluna/categoria de nós)`)
    q.fields.forEach((f, i) => checkField(`${path}.query.fields[${i}]`, q.dataset, f))
    if (q.correlate !== undefined) {
      if (chart.kind !== 'graph') fail(`${path}.query.correlate`, 'só existe em "graph"')
      else if (!q.fields.includes(q.correlate)) fail(`${path}.query.correlate`, 'deve ser um dos "fields"')
    }
    if (q.bucket !== undefined) checkField(`${path}.query.bucket`, q.dataset, q.bucket)
    if (q.limit !== undefined && !(Number.isInteger(q.limit) && q.limit > 0)) fail(`${path}.query.limit`, 'inteiro positivo')
    return
  }
  if (!isArr(chart.nodes) || chart.nodes.length === 0) return fail(`${path}.nodes`, 'informe "query" ou a lista "nodes"')
  if (chart.categories !== undefined && (!isArr(chart.categories) || chart.categories.length > MAX_SERIES))
    fail(`${path}.categories`, `lista com até ${MAX_SERIES} nomes`)
  const ids = new Set()
  chart.nodes.forEach((n, i) => {
    const p = `${path}.nodes[${i}]`
    if (!isStr(n.name)) fail(`${p}.name`, 'nome obrigatório')
    const id = String(n.id ?? n.name)
    if (ids.has(id)) fail(`${p}.id`, `id "${id}" repetido`)
    ids.add(id)
    if (n.value !== undefined && typeof n.value !== 'number') fail(`${p}.value`, 'número')
    if (n.status !== undefined && !STATUSES.includes(n.status)) fail(`${p}.status`, `use um de: ${STATUSES.join(', ')}`)
    if (n.filter !== undefined && (!isObj(n.filter) || !isStr(n.filter.field) || n.filter.value === undefined))
      fail(`${p}.filter`, '{ "field": "...", "value": "..." }')
    if (n.category !== undefined && typeof n.category !== 'number' && !(chart.categories || []).includes(n.category))
      fail(`${p}.category`, 'índice ou nome presente em "categories"')
  })
  if (!isArr(chart.links)) return fail(`${path}.links`, 'lista de { "source", "target", "value" }')
  chart.links.forEach((l, i) => {
    if (!ids.has(String(l.source))) fail(`${path}.links[${i}].source`, `nó "${l.source}" não existe`)
    if (!ids.has(String(l.target))) fail(`${path}.links[${i}].target`, `nó "${l.target}" não existe`)
    if (chart.kind === 'sankey' && !(typeof l.value === 'number' && l.value > 0)) fail(`${path}.links[${i}].value`, 'número positivo (largura do fluxo)')
  })
  if (chart.nodes.length > 80) warnings.push(`${path}: ${chart.nodes.length} nós; acima de ~60 o grafo vira um novelo. Mostre os principais`)
}

function checkChart(path, chart) {
  if (!isObj(chart)) return fail(path, 'objeto "chart" obrigatório')
  if (!CHART_KINDS.includes(chart.kind)) return fail(`${path}.kind`, `use um de: ${CHART_KINDS.join(', ')}`)
  if (chart.palette !== undefined && !['categorical', 'severity'].includes(chart.palette))
    fail(`${path}.palette`, 'use "categorical" (padrão) ou "severity"')
  if (chart.thresholds !== undefined) {
    if (!isArr(chart.thresholds)) fail(`${path}.thresholds`, 'deve ser uma lista')
    else chart.thresholds.forEach((t, i) => {
      if (typeof t.value !== 'number') fail(`${path}.thresholds[${i}].value`, 'número obrigatório')
      if (t.status !== undefined && !STATUSES.includes(t.status)) fail(`${path}.thresholds[${i}].status`, `use um de: ${STATUSES.join(', ')}`)
    })
  }
  if (chart.filter_field !== undefined && !isStr(chart.filter_field)) fail(`${path}.filter_field`, 'nome de campo')

  if (chart.kind === 'graph' || chart.kind === 'sankey') return checkNetwork(path, chart)
  if (chart.kind === 'correlation') {
    const q = chart.query
    if (!q) return fail(`${path}.query`, '"correlation" é sempre calculado de um dataset: informe "query"')
    if (!checkQueryBase(`${path}.query`, q)) return
    checkField(`${path}.query.field`, q.dataset, q.field, '"field"')
    const bucket = q.bucket ?? q._defaultBucket
    if (bucket) checkField(`${path}.query.bucket`, q.dataset, bucket)
    else fail(`${path}.query.bucket`, 'informe "bucket" ou defina "time" no dataset')
    if (q.limit !== undefined && !(Number.isInteger(q.limit) && q.limit >= 2 && q.limit <= 12)) fail(`${path}.query.limit`, 'inteiro de 2 a 12')
    return
  }
  if (chart.kind === 'line' || chart.kind === 'bar') {
    if (chart.query) return checkCartesianQuery(path, chart)
    const axis = chart.kind === 'line' ? 'x' : 'categories'
    if (!isArr(chart[axis]) || chart[axis].length === 0) return fail(`${path}.${axis}`, `lista ${axis === 'x' ? 'de rótulos do eixo X' : 'de categorias'} obrigatória (ou use "query")`)
    checkSeries(path, chart, chart[axis].length)
    const points = chart[axis].length * (chart.series?.length ?? 0)
    if (chart.kind === 'line' && points > 6000) warnings.push(`${path}: ${points} pontos; agregue em intervalos maiores para o arquivo ficar leve`)
    if (chart.kind === 'bar' && !chart.dates && chart[axis].length > 40) warnings.push(`${path}: ${chart[axis].length} barras; considere mostrar só as principais e somar o resto em "Outros"`)
    return
  }
  // heatmap
  if (chart.query) {
    const q = chart.query
    if (!checkQueryBase(`${path}.query`, q)) return
    checkField(`${path}.query.x`, q.dataset, q.x, '"x"')
    checkField(`${path}.query.y`, q.dataset, q.y, '"y"')
    for (const k of ['x_order', 'y_order']) if (q[k] !== undefined && !isArr(q[k])) fail(`${path}.query.${k}`, 'lista de valores na ordem do eixo')
    return
  }
  if (!isArr(chart.x) || !isArr(chart.y)) return fail(path, 'heatmap exige "x" e "y" (listas de rótulos) ou "query"')
  if (!isArr(chart.values)) return fail(`${path}.values`, 'lista de [índice_x, índice_y, valor]')
  chart.values.forEach((t, i) => {
    if (!isArr(t) || t.length !== 3) return fail(`${path}.values[${i}]`, 'use [índice_x, índice_y, valor]')
    const [xi, yi, v] = t
    if (!Number.isInteger(xi) || xi < 0 || xi >= chart.x.length) fail(`${path}.values[${i}][0]`, `índice x fora de 0..${chart.x.length - 1}`)
    if (!Number.isInteger(yi) || yi < 0 || yi >= chart.y.length) fail(`${path}.values[${i}][1]`, `índice y fora de 0..${chart.y.length - 1}`)
    if (!isNumOrNull(v)) fail(`${path}.values[${i}][2]`, 'valor deve ser número ou null')
  })
}

function checkFocus(path, item, ids) {
  if (item.target !== undefined && !ids.has(item.target)) fail(`${path}.target`, `nenhuma seção com "id": "${item.target}"`)
  if (item.filter !== undefined) {
    if (!isObj(item.filter)) return fail(`${path}.filter`, 'objeto { "campo": valor ou [valores] }')
    for (const f of Object.keys(item.filter))
      if (!Object.values(datasets).some(d => d.fields.has(f))) fail(`${path}.filter.${f}`, `nenhum dataset tem o campo "${f}"`)
  }
}

function validate(spec) {
  if (!isObj(spec)) return fail('spec', 'o arquivo deve conter um objeto JSON')
  if (!isStr(spec.title)) fail('title', 'título obrigatório')
  checkDatasets(spec)
  const anyField = f => Object.values(datasets).some(d => d.fields.has(f))

  if (spec.filters !== undefined) {
    if (!isArr(spec.filters)) fail('filters', 'lista de filtros')
    else {
      if (!Object.keys(datasets).length) fail('filters', 'filtros precisam de "datasets"')
      spec.filters.forEach((f, i) => {
        const p = `filters[${i}]`
        if (!isStr(f.field)) return fail(`${p}.field`, 'campo obrigatório')
        if (f.kind !== undefined && !FILTER_KINDS.includes(f.kind)) fail(`${p}.kind`, `use um de: ${FILTER_KINDS.join(', ')}`)
        if (f.dataset !== undefined && !datasets[f.dataset]) fail(`${p}.dataset`, `dataset "${f.dataset}" não existe`)
        else if (!anyField(f.field)) fail(`${p}.field`, `nenhum dataset tem o campo "${f.field}"`)
      })
      if (spec.filters.filter(f => f.kind === 'date-range').length > 1) fail('filters', 'só pode haver um filtro "date-range"')
    }
  }
  if (spec.events !== undefined) {
    if (!isArr(spec.events)) fail('events', 'lista de { "at": "2026-10-21T15:00", "label": "Deploy v2.3" }')
    else spec.events.forEach((e, i) => {
      if (!isoDay(e.at)) fail(`events[${i}].at`, 'data ISO obrigatória')
      if (!isStr(e.label)) fail(`events[${i}].label`, 'rótulo curto obrigatório')
      if (e.status !== undefined && !STATUSES.includes(e.status)) fail(`events[${i}].status`, `use um de: ${STATUSES.join(', ')}`)
    })
  }
  if (spec.details !== undefined && !isObj(spec.details)) fail('details', 'objeto { "campo": { "valor": { ... } } }')
  if (spec.glossary !== undefined && (!isObj(spec.glossary) || Object.values(spec.glossary).some(v => !isStr(v))))
    fail('glossary', 'objeto { "TERMO": "explicação em linguagem simples" }')
  if (spec.labels !== undefined && !isObj(spec.labels)) fail('labels', 'objeto { "campo": "Rótulo" }')

  if (!isArr(spec.sections) || spec.sections.length === 0) return fail('sections', 'informe ao menos uma seção')
  const ids = new Set()
  spec.sections.forEach((s, i) => {
    if (s?.id === undefined) return
    if (!/^[a-z0-9][a-z0-9-]*$/.test(String(s.id))) fail(`sections[${i}].id`, 'use minúsculas, números e hífen')
    else if (ids.has(s.id)) fail(`sections[${i}].id`, `id "${s.id}" repetido`)
    ids.add(s.id)
  })

  spec.sections.forEach((section, i) => {
    const p = `sections[${i}]`
    if (!SECTION_TYPES.includes(section?.type)) return fail(`${p}.type`, `use um de: ${SECTION_TYPES.join(', ')}`)
    if (section.tab !== undefined && !TABS.includes(section.tab)) fail(`${p}.tab`, `use um de: ${TABS.join(', ')}`)
    section._tab = section.tab ?? (section.type === 'chart' ? 'analysis' : 'overview')
    switch (section.type) {
      case 'kpis':
        if (!isArr(section.items) || section.items.length === 0) return fail(`${p}.items`, 'lista de indicadores obrigatória')
        section.items.forEach((item, j) => {
          const ip = `${p}.items[${j}]`
          if (!isStr(item.label)) fail(`${ip}.label`, 'rótulo obrigatório')
          if (item.status !== undefined && !STATUSES.includes(item.status)) fail(`${ip}.status`, `use um de: ${STATUSES.join(', ')}`)
          if (item.query !== undefined) checkQueryBase(`${ip}.query`, item.query)
          checkFocus(ip, item, ids)
        })
        break
      case 'chart':
        if (!isStr(section.title)) fail(`${p}.title`, 'todo gráfico precisa de título (é ele que nomeia uma série única)')
        if (section.chart?.kind === 'correlation' && section.chart.query?.dataset)
          section.chart.query._defaultBucket = spec.datasets?.[section.chart.query.dataset]?.time
        checkChart(`${p}.chart`, section.chart)
        if (section.chart?.query) delete section.chart.query._defaultBucket
        {
          const help = section.help ?? section.chart?.help
          if (help !== undefined) {
            if (!isObj(help)) fail(`${p}.help`, 'objeto { "what", "how", "read" } com textos em linguagem simples')
            else {
              for (const k of ['short', 'what', 'read']) if (help[k] !== undefined && !isStr(help[k])) fail(`${p}.help.${k}`, 'texto')
              if (help.how !== undefined && !isStr(help.how) && !(isArr(help.how) && help.how.every(isStr))) fail(`${p}.help.how`, 'texto ou lista de textos')
            }
          }
          if (!help?.read) warnings.push(`${p} ("${section.title}"): sem "help.read"; o "Como ler" vai usar a interpretação genérica. Diga o que este gráfico mostra neste relatório`)
        }
        break
      case 'table':
        if (!isArr(section.columns) || section.columns.length === 0) return fail(`${p}.columns`, 'lista de colunas obrigatória')
        section.columns.forEach((col, j) => {
          if (!isStr(col.key) || !isStr(col.label)) fail(`${p}.columns[${j}]`, '"key" e "label" obrigatórios')
          if (col.format !== undefined && !COLUMN_FORMATS.includes(col.format)) fail(`${p}.columns[${j}].format`, `use um de: ${COLUMN_FORMATS.join(', ')}`)
        })
        if (section.query !== undefined) {
          const q = section.query
          if (checkQueryBase(`${p}.query`, q)) {
            const gb = [].concat(q.group_by ?? [])
            if (!gb.length) fail(`${p}.query.group_by`, 'campo (ou lista de campos) para agrupar')
            gb.forEach((f, k) => checkField(`${p}.query.group_by[${k}]`, q.dataset, f))
            const keys = new Set(gb)
            if (q.measures !== undefined) {
              if (!isObj(q.measures)) fail(`${p}.query.measures`, 'objeto { "coluna": "sum:count" | "max:date" | "distinct:instance" | "count" }')
              else for (const [k, m] of Object.entries(q.measures)) {
                keys.add(k)
                const [agg, field] = typeof m === 'string' ? m.split(':') : [m?.agg, m?.value]
                if (!AGGS.includes(agg)) fail(`${p}.query.measures.${k}`, `agregação "${agg}" inválida; use ${AGGS.join(', ')}`)
                if (field) checkField(`${p}.query.measures.${k}`, q.dataset, field)
                else if (agg !== 'count' && !(agg === 'sum' && spec.datasets?.[q.dataset]?.value)) fail(`${p}.query.measures.${k}`, `"${agg}" precisa de campo (ex.: "${agg}:campo")`)
              }
            } else keys.add('count')
            section.columns.forEach((col, j) => { if (isStr(col.key) && !keys.has(col.key)) fail(`${p}.columns[${j}].key`, `"${col.key}" não é campo de group_by nem medida`) })
          }
        } else if (!isArr(section.rows)) fail(`${p}.rows`, 'lista de linhas obrigatória (ou use "query")')
        else if (section.rows.length > 2000) warnings.push(`${p}: ${section.rows.length} linhas; considere resumir`)
        if (section.filter_field !== undefined && !anyField(section.filter_field)) fail(`${p}.filter_field`, `nenhum dataset tem o campo "${section.filter_field}"`)
        break
      case 'alerts':
        if (!isArr(section.items)) return fail(`${p}.items`, 'lista de alertas obrigatória')
        section.items.forEach((item, j) => {
          if (!isStr(item.title)) fail(`${p}.items[${j}].title`, 'título obrigatório')
          if (item.severity !== undefined && !STATUSES.includes(item.severity)) fail(`${p}.items[${j}].severity`, `use um de: ${STATUSES.join(', ')}`)
          if (item.action !== undefined && !isStr(item.action)) fail(`${p}.items[${j}].action`, 'texto curto: o que fazer')
          checkFocus(`${p}.items[${j}]`, item, ids)
        })
        break
      case 'text':
        if (!isArr(section.paragraphs) && !isArr(section.bullets)) fail(p, 'informe "paragraphs" e/ou "bullets" (listas de strings)')
        if (section.variant !== undefined && section.variant !== 'summary') fail(`${p}.variant`, 'use "summary" (resumo em destaque) ou omita')
        if (section.status !== undefined && !STATUSES.includes(section.status)) fail(`${p}.status`, `use um de: ${STATUSES.join(', ')}`)
        break
      case 'timeline': {
        const items = section.items ?? spec.events
        if (!isArr(items) || !items.length) { fail(`${p}.items`, 'informe "items" ou defina "events" na raiz'); break }
        items.forEach((it, j) => {
          const ip = section.items ? `${p}.items[${j}]` : `events[${j}]`
          if (!isoDay(it.at)) fail(`${ip}.at`, 'data ISO obrigatória')
          if (!isStr(it.label)) fail(`${ip}.label`, 'rótulo obrigatório')
          if (it.status !== undefined && !STATUSES.includes(it.status)) fail(`${ip}.status`, `use um de: ${STATUSES.join(', ')}`)
          checkFocus(ip, it, ids)
        })
        break
      }
    }
  })
  const tabs = new Set(spec.sections.map(s => s._tab))
  if (tabs.has('overview') && !spec.sections.some(s => s._tab === 'overview' && s.type === 'text' && s.variant === 'summary'))
    warnings.push('a visão geral não tem resumo: comece com uma seção "text" com "variant": "summary", em linguagem simples')
  if (spec.sections.some(s => s._tab === 'overview' && s.type === 'chart'))
    warnings.push('há gráfico na visão geral; ela deve ficar só com resumo, KPIs, alertas, marcos, tabelas e texto')
  if (Object.keys(datasets).length && !spec.filters?.length)
    warnings.push('há "datasets" mas nenhum "filters": o leitor só consegue filtrar clicando nos gráficos')
}

// ---------- main ----------
const [specPath, outPath] = process.argv.slice(2)
if (!specPath || !outPath) {
  console.error('Uso: node build.mjs <spec.json> <saida.html>')
  process.exit(2)
}

let spec
try {
  spec = JSON.parse(readFileSync(specPath, 'utf8'))
} catch (e) {
  console.error(`Não consegui ler ${specPath}: ${e.message}`)
  process.exit(2)
}

validate(spec)
if (errors.length) {
  console.error(`Spec inválida (${errors.length} problema(s)):`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}
spec.generated_at ??= new Date().toISOString()

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
// `<` escaped so log text like "</script>" cannot close the data block.
spec.sections.forEach(s => delete s._tab)
const data = JSON.stringify(spec).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

const html = readFileSync(join(assets, 'template.html'), 'utf8')
  // Function replacers: the payloads contain `$` sequences that String.replace would interpret.
  .replace('{{TITLE}}', () => escapeHtml(spec.title))
  .replace('{{REPORT_DATA}}', () => data)
  .replace('{{ECHARTS}}', () => readFileSync(join(assets, 'vendor', 'echarts.min.js'), 'utf8'))

const out = resolve(outPath)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html)

const charts = spec.sections.filter(s => s.type === 'chart').length
const dynamic = spec.sections.filter(s => s.query || s.chart?.query || s.items?.some(i => i.query)).length
const rows = Object.values(datasets).reduce((n, d) => n + d.rows.length, 0)
console.log(`OK: ${out}`)
console.log(`   ${spec.sections.length} seções (${charts} gráficos, ${dynamic} ligadas aos filtros) · ${rows} linhas em ${Object.keys(datasets).length} dataset(s) · ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB`)
for (const w of warnings) console.log(`   aviso: ${w}`)
