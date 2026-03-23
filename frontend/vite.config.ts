import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // In dev mode, forward /api and /ws calls to the Python backend
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws':  { target: 'ws://localhost:8000',  ws: true }
    }
  },
  // Production build goes into backend/static so FastAPI can serve it
  build: {
    outDir: '../backend/static',
    emptyOutDir: true
  }
})
