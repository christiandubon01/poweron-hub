import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
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
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // ── Manual chunk splitting ──────────────────────────────────────────
        // Isolate modules into separate chunks to prevent Rollup from
        // concatenating them into one file. This eliminates TDZ (Temporal
        // Dead Zone) errors in production builds where `let`/`const`
        // bindings from different modules can reference each other before
        // initialization within a single concatenated chunk.
        manualChunks(id) {
          // Vendor chunks — npm packages
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'react-vendor'
            }
            if (id.includes('/react/')) {
              return 'react-vendor'
            }
            if (id.includes('@supabase/supabase-js') || id.includes('@supabase/')) {
              return 'supabase-vendor'
            }
            if (id.includes('@upstash/redis')) {
              return 'redis-vendor'
            }
            if (id.includes('zustand')) {
              return 'zustand-vendor'
            }
            // All other npm packages in one vendor chunk
            return 'vendor'
          }

          // Auth chain — isolate into its own chunk so Rollup can't
          // concatenate auth modules with other app modules
          if (
            id.includes('/lib/supabase') ||
            id.includes('/store/authStore') ||
            id.includes('/lib/auth/') ||
            id.includes('/lib/redis') ||
            id.includes('/lib/memory/') ||
            id.includes('/hooks/useAuth')
          ) {
            return 'auth'
          }

          // Subscription / Stripe chain — separate chunk
          if (
            id.includes('/services/stripe') ||
            id.includes('/config/subscriptionTiers') ||
            id.includes('/hooks/useSubscription')
          ) {
            return 'subscription'
          }
        },
      },
    },
  },
})
