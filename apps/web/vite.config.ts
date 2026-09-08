import { resolve } from 'path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
    port: 3003,
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
      // Socket.io 引擎路径（命名空间 /sync 仍走此握手）
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@tiptap') || id.includes('prosemirror') || id.includes('lowlight')) return 'editor-vendor';
          if (id.includes('yjs') || id.includes('socket.io') || id.includes('dexie')) return 'sync-vendor';
          if (id.includes('react-dom') || id.includes('react-router') || id.includes('/react/')) return 'react-vendor';
        },
      },
    },
  },
})
