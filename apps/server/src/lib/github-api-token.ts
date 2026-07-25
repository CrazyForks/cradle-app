import { execSync } from 'node:child_process'

let cachedToken: string | null | undefined

export function resolveGitHubToken(): string | null {
  if (cachedToken !== undefined) {
    return cachedToken
  }

  const envToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (envToken) {
    cachedToken = envToken
    return envToken
  }

  try {
    const token = execSync('gh auth token', { encoding: 'utf-8', timeout: 5000 }).trim()
    if (token && !token.includes(' ')) {
      cachedToken = token
      return token
    }
  }
  catch {
    // gh is optional; unauthenticated public GitHub reads can still work.
  }

  cachedToken = null
  return null
}

export function resetGitHubTokenCache(): void {
  cachedToken = undefined
}

export function hasGitHubToken(): boolean {
  return resolveGitHubToken() !== null
}
