import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      tslib: fileURLToPath(new URL('./src/vendor/tslib.es6.mjs', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['tslib', '@supabase/supabase-js'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: ['.ngrok-free.app', '.ngrok.io', 'localhost'],
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
