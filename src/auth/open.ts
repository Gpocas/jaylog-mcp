import { spawn } from 'node:child_process'

/**
 * Best-effort browser launch. The caller always prints the URL too, since this
 * silently does nothing useful over a headless SSH session or inside WSL
 * without `wslview`/`xdg-open` wired to the Windows browser.
 */
export function openBrowser(url: string): void {
  try {
    const platform = process.platform
    const child =
      platform === 'darwin'
        ? spawn('open', [url], { stdio: 'ignore', detached: true })
        : platform === 'win32'
          ? spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true })
          : spawn('xdg-open', [url], { stdio: 'ignore', detached: true })

    // Without this, a missing binary (e.g. no `xdg-open` in a bare WSL image)
    // emits an unhandled 'error' event on the child process and crashes the
    // CLI — the printed URL is the real fallback, so just swallow it.
    child.on('error', () => {})
    child.unref()
  } catch {
    // Ignored: the printed URL is the real fallback.
  }
}
