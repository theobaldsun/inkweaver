import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@inkweaver/shared': resolve(__dirname, '../../packages/shared/src'),
      '@inkweaver/ui': resolve(__dirname, '../../packages/ui/src'),
      '@inkweaver/api': resolve(__dirname, '../../packages/api/src'),
      '@inkweaver/services': resolve(__dirname, '../../packages/services/src'),
      '@inkweaver/assets': resolve(__dirname, '../../packages/assets/src'),
      '@inkweaver/sync-engine': resolve(__dirname, '../../packages/sync-engine/src'),
      '@inkweaver/db-adapter': resolve(__dirname, '../../packages/db-adapter/src'),
    },
  },
  server: {
    port: 3001,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/sync': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})