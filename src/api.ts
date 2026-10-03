import { readCredentials } from './credentials'

const config = {
  baseUrl: process.env.JAYLOG_API_BASE_URL
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
  if (!config.baseUrl) {
    throw new Error(
      'JAYLOG_API_BASE_URL is not set. Configure it (and JAYLOG_API_TOKEN) in the environment.'
    )
  }
  const url = new URL(path, config.baseUrl)
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
