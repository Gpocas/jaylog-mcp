import { colors } from '../cli/colors'
import { clearCredentials } from '../credentials'

export async function logout(): Promise<void> {
  const cleared = await clearCredentials()
  console.error(
    cleared
      ? colors.boldGreen('Logged out. Local credential removed.') +
          '\n' +
          colors.dim(
            'The token itself still works until it expires or is revoked from "Tokens MCP" in the app.'
          )
      : colors.yellow('No stored credential found.')
  )
}
