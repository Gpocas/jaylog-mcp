import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface StoredCredentials {
  token: string
  expiresAt?: string
  obtainedAt: string
}

function credentialsDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'jaylog-mcp')
}

function credentialsPath(): string {
  return join(credentialsDir(), 'credentials.json')
}

export async function readCredentials(): Promise<StoredCredentials | null> {
  try {
    const raw = await readFile(credentialsPath(), 'utf8')
    return JSON.parse(raw) as StoredCredentials
  } catch {
    return null
  }
}

export async function writeCredentials(creds: StoredCredentials): Promise<void> {
  await mkdir(credentialsDir(), { recursive: true, mode: 0o700 })
  await writeFile(credentialsPath(), JSON.stringify(creds, null, 2), { mode: 0o600 })
}

export async function clearCredentials(): Promise<boolean> {
  try {
    await rm(credentialsPath())
    return true
  } catch {
    return false
  }
}
