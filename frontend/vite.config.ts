import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8095',
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '../static'),
    // папку не чистим: при неудачной сборке прод останется на прошлой
    emptyOutDir: false,
  },
})
