import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // SEC1/SEC2 — see vite.config.js (the config Vite actually resolves) for the
  // full rationale. Kept in sync so this dormant config cannot reintroduce the
  // leak.
  define: {
    'import.meta.env.VITE_ANTHROPIC_API_KEY': 'undefined',
    'import.meta.env.VITE_OPENAI_API_KEY': 'undefined',
    'import.meta.env.VITE_ELEVENLABS_API_KEY': 'undefined',
    'import.meta.env.VITE_ELEVEN_LABS_API_KEY': 'undefined',
    'import.meta.env.VITE_UPSTASH_REDIS_TOKEN': 'undefined',
    'import.meta.env.VITE_UPSTASH_REDIS_URL': 'undefined',
  },
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
    // SEC1: no sourcemaps in production builds. Kept in sync with
    // vite.config.js (the file Vite actually resolves) so this dormant config
    // cannot reintroduce the leak if the .js one is ever removed.
    sourcemap: false,
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
        // SEC2: 'redis-vendor' removed — @upstash/redis is no longer imported
        // by any client module (it now runs only inside the session-store
        // Netlify function), so the entry would generate an empty chunk.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase-vendor': ['@supabase/supabase-js'],
        },
      },
    },
  },
})
