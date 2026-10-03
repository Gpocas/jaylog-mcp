// Bun's `console.error` wraps everything written to it in ANSI red by
// default (confirmed: `bun -e "console.error('x')"` emits `\x1b[31m`) — and
// stdout is reserved for the MCP JSON-RPC protocol, so stderr is the only
// place these messages can go. Each call below resets *before* applying its
// own code, which is required, not just tidy: a color code (e.g. white/cyan)
// replaces Bun's red, but `dim` alone only adds faintness to whatever
// foreground is already active, so without the leading reset it would render
// as dim *red* instead of a neutral dim. Disabled outside a TTY
// (piped/redirected output) and when NO_COLOR is set, per https://no-color.org.
const supportsColor = !!process.stderr.isTTY && !process.env.NO_COLOR

function wrap(code: string): (text: string) => string {
  return text => (supportsColor ? `\x1b[0m\x1b[${code}m${text}\x1b[0m` : text)
}

// `boldGreen`/`boldRed` are single combined codes, not `bold(green(x))`: each
// `wrap()` call resets first (see above), so nesting two of them would have
// the inner reset wipe out the outer's bold — two SGR codes in one escape
// sequence is the only way to actually get both at once.
export const colors = {
  white: wrap('37'),
  dim: wrap('2'),
  cyan: wrap('36'),
  green: wrap('32'),
  yellow: wrap('33'),
  red: wrap('31'),
  boldGreen: wrap('1;32'),
  boldRed: wrap('1;31')
}
