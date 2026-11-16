import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => {
  const lan = mode === 'lan'
  if (lan) {
    // LAN testing shares only the app; local management tools remain disabled.
    process.env.X_LOCAL_EXPLORER = 'false'
    process.env.WRANGLER_SEND_METRICS = 'false'
    process.env.WRANGLER_LOG_PATH ??= resolve('.wrangler/logs')
  }
  return {
    plugins: [react(), cloudflare({
      viteEnvironment: { name: 'worker' },
      ...(lan ? { inspectorPort: false, remoteBindings: false, tunnel: false } : {}),
    })],
  }
})
