import { readCredentials } from './credentials'

const trimSlashes = (value: string) => value.replace(/\/+$/, '')

/**
 * Where API calls go. `JAYLOG_API_BASE_URL` wins when set (local dev, where the
 * backend and the web app run on different ports, or a deployment that exposes
 * the API directly). Otherwise the single `JAYLOG_URL` is the web app's address
 * and the API is reached through its `/proxy/*` route, which forwards to the
 * backend — that is what lets users configure one URL instead of two.
 */
export function resolveApiBaseUrl(): string | undefined {
  const apiBase = process.env.JAYLOG_API_BASE_URL
  if (apiBase) return trimSlashes(apiBase)

  const appUrl = process.env.JAYLOG_URL
  if (appUrl) return `${trimSlashes(appUrl)}/proxy`

  return undefined
}

/**
 * Resolution order: `JAYLOG_API_TOKEN` env var (explicit override, handy for CI
 * or scripting) first, then the credential saved by `login` — a personal,
 * 15-day sliding-expiration token minted via the browser consent flow at
 * `${JAYLOG_FRONTEND_URL}/mcp/authorize`. Re-read on every call (not cached)
 * so a `logout`/`login` in another terminal takes effect without a restart.
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  const envToken = process.env.JAYLOG_API_TOKEN
  if (envToken) return { Authorization: `Bearer ${envToken}` }

  const stored = await readCredentials()
  if (!stored) return {}
  return { Authorization: `Bearer ${stored.token}` }
}

export function buildUrl(path: string, qs: Record<string, any> = {}): string {
  const baseUrl = resolveApiBaseUrl()
  if (!baseUrl) {
    throw new Error(
      'JAYLOG_URL is not set. Set it to the Jaylog web app URL (or JAYLOG_API_BASE_URL to call the API directly).'
    )
  }
  // `new URL('/x', 'https://host/proxy')` drops `/proxy`, so keep the base's
  // path by resolving a relative path against a base that ends in `/`.
  const url = new URL(path.replace(/^\/+/, ''), `${baseUrl}/`)
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  }
  return url.toString()
}

export async function fetchJSON<T = any>(path: string, qs: Record<string, any> = {}): Promise<T> {
  const url = buildUrl(path, qs)
  const headers = await getAuthHeaders()
  if (!headers.Authorization) {
    throw new Error(
      'Not authenticated. Run `bun run login` (or set JAYLOG_API_TOKEN) before using jaylog-mcp.'
    )
  }
  const resp = await fetch(url, { headers })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`Jaylog API error [${resp.status}] ${resp.statusText}${body ? `: ${body}` : ''}`)
  }
  return (await resp.json()) as T
}
