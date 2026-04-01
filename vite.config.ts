import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['chart.js', 'chart.js/auto'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['chart.js'],
  },
  server: {
    port: 5173,
    open: true,
    watch: {
      usePolling: true,
    },
    proxy: {
      // Proxy Claude API calls to avoid CORS issues in the browser
      '/api/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
        secure: true,
      },
    },
  },
  build: {
    target: 'es2015',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // ── Manual chunk splitting ──────────────────────────────────────────
        // Only split npm vendor packages. Internal app modules stay in the
        // default chunk — the TDZ fix is in V15rLayout.tsx (isMobile moved
        // before useEffect), not in chunk isolation.
        //
        // IMPORTANT: lucide-react MUST be in the same chunk as react.
        // Splitting them causes "Cannot read properties of undefined
        // (reading 'forwardRef')" because Icon.js needs React initialized.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase-vendor': ['@supabase/supabase-js'],
          'redis-vendor': ['@upstash/redis'],
        },
      },
    },
  },
})
