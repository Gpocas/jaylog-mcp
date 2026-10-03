const config = {
  baseUrl: process.env.JAYLOG_API_BASE_URL,
  token: process.env.JAYLOG_API_TOKEN
}

function getAuthHeaders(): Record<string, string> {
  if (!config.token) return {}
  return { Authorization: `Bearer ${config.token}` }
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
  const resp = await fetch(url, { headers: getAuthHeaders() })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`Jaylog API error [${resp.status}] ${resp.statusText}${body ? `: ${body}` : ''}`)
  }
  return (await resp.json()) as T
}
