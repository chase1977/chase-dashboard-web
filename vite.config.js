// frontend/vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ---------------------------------------------------------------------------
// Config — change BACKEND_PORT if you run FastAPI on a different port
// ---------------------------------------------------------------------------
const BACKEND_PORT = 8000

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // All /api requests in dev are proxied to the FastAPI backend
      '/api': {
        target:      `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
