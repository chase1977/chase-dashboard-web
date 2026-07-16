// frontend/vite.config.js
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Backend target:
  //   VITE_BACKEND_URL in .env.local → Railway (or any remote)
  //   fallback                       → localhost:8000 (local FastAPI dev)
  const BACKEND_TARGET = env.VITE_BACKEND_URL || 'http://localhost:8000'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target:       BACKEND_TARGET,
          changeOrigin: true,
          secure:       BACKEND_TARGET.startsWith('https'),
        },
      },
    },
    build: {
      outDir: 'dist',
    },
  }
})
