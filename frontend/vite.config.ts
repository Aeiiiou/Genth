import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineConfig } from 'vite'

/** Same location the backend uses (backend/src/backend/config.py). */
const dataDir =
  process.env.GENTH_DATA_DIR ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share'), 'Genth')
const tokenPath = path.join(dataDir, 'secrets', 'session_token')

/** Read on every request so starting the backend after Vite (which creates the token) just works. */
function sessionToken(): string {
  try {
    return fs.readFileSync(tokenPath, 'utf8').trim()
  } catch {
    return ''
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The proxy adds the backend session token, so the browser never sees it.
      '/api': {
        target: 'http://127.0.0.1:8000',
        ws: true,
        configure(proxy) {
          const addToken = (req: { setHeader(name: string, value: string): void }) => {
            const token = sessionToken()
            if (token) req.setHeader('Authorization', `Bearer ${token}`)
          }
          proxy.on('proxyReq', addToken)
          proxy.on('proxyReqWs', addToken)
        },
      },
    },
  },
})
