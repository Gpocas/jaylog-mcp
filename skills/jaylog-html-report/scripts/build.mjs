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
const SECTION_TYPES = ['kpis', 'chart', 'table', 'alerts', 'text']
const CHART_KINDS = ['line', 'bar', 'heatmap']
const STATUSES = ['good', 'warning', 'serious', 'critical', 'info']
const COLUMN_FORMATS = ['text', 'number', 'code', 'date', 'status']
const SEVERITY_NAMES = ['ERROR', 'EXCEPTION', 'CRITICAL']

const errors = []
const warnings = []
const fail = (path, message) => errors.push(`${path}: ${message}`)
const isStr = v => typeof v === 'string' && v.trim() !== ''
const isNumOrNull = v => v === null || (typeof v === 'number' && Number.isFinite(v))
const isArr = v => Array.isArray(v)

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

function checkChart(path, chart) {
  if (!chart || typeof chart !== 'object') return fail(path, 'objeto "chart" obrigatório')
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
  if (chart.kind === 'line') {
    if (!isArr(chart.x) || chart.x.length === 0) return fail(`${path}.x`, 'lista de rótulos do eixo X obrigatória')
    checkSeries(path, chart, chart.x.length)
    const points = chart.x.length * (chart.series?.length ?? 0)
    if (points > 6000) warnings.push(`${path}: ${points} pontos; agregue em intervalos maiores para o arquivo ficar leve`)
  } else if (chart.kind === 'bar') {
    if (!isArr(chart.categories) || chart.categories.length === 0) return fail(`${path}.categories`, 'lista de categorias obrigatória')
    checkSeries(path, chart, chart.categories.length)
    if (!chart.dates && chart.categories.length > 40) warnings.push(`${path}: ${chart.categories.length} barras; considere mostrar só as principais e somar o resto em "Outros"`)
  } else if (chart.kind === 'heatmap') {
    if (!isArr(chart.x) || !isArr(chart.y)) return fail(path, 'heatmap exige "x" e "y" (listas de rótulos)')
    if (!isArr(chart.values)) return fail(`${path}.values`, 'lista de [índice_x, índice_y, valor]')
    chart.values.forEach((t, i) => {
      if (!isArr(t) || t.length !== 3) return fail(`${path}.values[${i}]`, 'use [índice_x, índice_y, valor]')
      const [xi, yi, v] = t
      if (!Number.isInteger(xi) || xi < 0 || xi >= chart.x.length) fail(`${path}.values[${i}][0]`, `índice x fora de 0..${chart.x.length - 1}`)
      if (!Number.isInteger(yi) || yi < 0 || yi >= chart.y.length) fail(`${path}.values[${i}][1]`, `índice y fora de 0..${chart.y.length - 1}`)
      if (!isNumOrNull(v)) fail(`${path}.values[${i}][2]`, 'valor deve ser número ou null')
    })
  }
}

function validate(spec) {
  if (!spec || typeof spec !== 'object') return fail('spec', 'o arquivo deve conter um objeto JSON')
  if (!isStr(spec.title)) fail('title', 'título obrigatório')
  if (!isArr(spec.sections) || spec.sections.length === 0) return fail('sections', 'informe ao menos uma seção')
  spec.sections.forEach((section, i) => {
    const p = `sections[${i}]`
    if (!SECTION_TYPES.includes(section?.type)) return fail(`${p}.type`, `use um de: ${SECTION_TYPES.join(', ')}`)
    switch (section.type) {
      case 'kpis':
        if (!isArr(section.items) || section.items.length === 0) return fail(`${p}.items`, 'lista de indicadores obrigatória')
        section.items.forEach((item, j) => {
          if (!isStr(item.label)) fail(`${p}.items[${j}].label`, 'rótulo obrigatório')
          if (item.status !== undefined && !STATUSES.includes(item.status)) fail(`${p}.items[${j}].status`, `use um de: ${STATUSES.join(', ')}`)
        })
        break
      case 'chart':
        if (!isStr(section.title)) fail(`${p}.title`, 'todo gráfico precisa de título (é ele que nomeia uma série única)')
        checkChart(`${p}.chart`, section.chart)
        break
      case 'table':
        if (!isArr(section.columns) || section.columns.length === 0) return fail(`${p}.columns`, 'lista de colunas obrigatória')
        section.columns.forEach((col, j) => {
          if (!isStr(col.key) || !isStr(col.label)) fail(`${p}.columns[${j}]`, '"key" e "label" obrigatórios')
          if (col.format !== undefined && !COLUMN_FORMATS.includes(col.format)) fail(`${p}.columns[${j}].format`, `use um de: ${COLUMN_FORMATS.join(', ')}`)
        })
        if (!isArr(section.rows)) fail(`${p}.rows`, 'lista de linhas obrigatória')
        else if (section.rows.length > 2000) warnings.push(`${p}: ${section.rows.length} linhas; considere resumir`)
        break
      case 'alerts':
        if (!isArr(section.items)) return fail(`${p}.items`, 'lista de alertas obrigatória')
        section.items.forEach((item, j) => {
          if (!isStr(item.title)) fail(`${p}.items[${j}].title`, 'título obrigatório')
          if (item.severity !== undefined && !STATUSES.includes(item.severity)) fail(`${p}.items[${j}].severity`, `use um de: ${STATUSES.join(', ')}`)
        })
        break
      case 'text':
        if (!isArr(section.paragraphs) && !isArr(section.bullets)) fail(p, 'informe "paragraphs" e/ou "bullets" (listas de strings)')
        break
    }
  })
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
console.log(`OK: ${out}`)
console.log(`   ${spec.sections.length} seções (${charts} gráficos) · ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB`)
for (const w of warnings) console.log(`   aviso: ${w}`)
