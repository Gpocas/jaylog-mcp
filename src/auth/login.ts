import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { hostname } from 'node:os'

import { colors } from '../cli/colors'
import { writeCredentials } from '../credentials'
import { openBrowser } from './open'

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

function page(message: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Jaylog MCP</title>
<style>
body { font-family: system-ui, sans-serif; background: #18181b; color: #e4e4e7; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
main { text-align: center; max-width: 28rem; padding: 0 1.5rem; }
h1 { font-size: 1.1rem; font-weight: 600; }
p { color: #a1a1aa; font-size: 0.9rem; }
</style>
</head>
<body><main><h1>${message}</h1><p>Você pode fechar esta aba e voltar pro terminal.</p></main></body>
</html>`
}

/**
 * Loopback browser login (RFC 8252), the same shape `gh auth login` and
 * `claude login` use: open the frontend's consent page, wait for it to hand a
 * freshly minted personal token back to a one-shot local server, store it.
 */
export async function login(): Promise<void> {
  const frontendUrl = process.env.JAYLOG_FRONTEND_URL || process.env.JAYLOG_API_BASE_URL
  if (!frontendUrl) {
    throw new Error('Set JAYLOG_FRONTEND_URL (or JAYLOG_API_BASE_URL) before running login.')
  }

  const state = randomBytes(16).toString('hex')

  const result = await new Promise<{ token: string; expiresAt?: string }>((resolve, reject) => {
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      fn()
    }

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }

      const receivedState = url.searchParams.get('state')
      const token = url.searchParams.get('token')
      const expiresAt = url.searchParams.get('expires_at') ?? undefined

      if (receivedState !== state || !token) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(page('Falha na autorização: parâmetros inválidos.'))
        done(() => reject(new Error('Invalid callback: state mismatch or missing token.')))
        server.close()
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(page('Autenticado com sucesso!'))
      done(() => resolve({ token, expiresAt }))
      server.close()
    })

    const timeout = setTimeout(() => {
      done(() => reject(new Error('Login timed out after 5 minutes. Run `login` again.')))
      server.close()
    }, CALLBACK_TIMEOUT_MS)
    timeout.unref()

    server.on('error', error => done(() => reject(error)))

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        done(() => reject(new Error('Failed to start local callback server.')))
        return
      }

      const authorizeUrl = new URL('/mcp/authorize', frontendUrl)
      authorizeUrl.searchParams.set('redirect_uri', `http://127.0.0.1:${address.port}/callback`)
      authorizeUrl.searchParams.set('state', state)
      authorizeUrl.searchParams.set('client_name', `Jaylog MCP (${hostname()})`)

      console.error(colors.white('Opening browser to authorize:'))
      console.error(`  ${colors.cyan(authorizeUrl.toString())}\n`)
      console.error(
        colors.dim('If it does not open automatically, copy the link above into your browser.')
      )
      openBrowser(authorizeUrl.toString())
    })
  })

  await writeCredentials({
    token: result.token,
    expiresAt: result.expiresAt,
    obtainedAt: new Date().toISOString()
  })

  console.error(
    colors.boldGreen(
      `Logged in. Credential saved${result.expiresAt ? ` (valid until ${result.expiresAt})` : ''}.`
    )
  )
}
