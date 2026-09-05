import { execSync } from 'child_process'
import path from 'path'
import { loadEnv, type UserConfig } from 'vite'
import packageJson from './package.json'
import { normalizeUrl } from './src/lib/url'

const getGitHash = () => {
  try {
    return JSON.stringify(execSync('git rev-parse --short HEAD').toString().trim())
  } catch (error) {
    console.warn('Failed to retrieve commit hash:', error)
    return '"unknown"'
  }
}

const getAppVersion = () => {
  try {
    return JSON.stringify(packageJson.version)
  } catch (error) {
    console.warn('Failed to retrieve app version:', error)
    return '"unknown"'
  }
}

export const createSharedConfig = (mode: string, base: string): UserConfig => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base,
    define: {
      'import.meta.env.GIT_COMMIT': getGitHash(),
      'import.meta.env.APP_VERSION': getAppVersion(),
      'import.meta.env.VITE_COMMUNITY_RELAY_SETS': JSON.parse(
        (env.VITE_COMMUNITY_RELAY_SETS ?? '').trim() || '[]'
      ),
      'import.meta.env.VITE_COMMUNITY_RELAYS': (env.VITE_COMMUNITY_RELAYS ?? '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean)
        .map((url) => normalizeUrl(url))
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
    }
  }
}
