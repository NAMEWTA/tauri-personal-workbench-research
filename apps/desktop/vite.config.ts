import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const requestedHost = process.env.TAURI_DEV_HOST
if (requestedHost && requestedHost !== '127.0.0.1') {
  throw new Error('Tauri dev server must bind to 127.0.0.1')
}
const host = '127.0.0.1'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host,
    hmr: requestedHost ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
