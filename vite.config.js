import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // SEC1 — SERVER-ONLY SECRETS MUST NOT REACH THE CLIENT BUNDLE.
  //
  // zustand 4.5.x guards its dev warnings with
  //   (import.meta.env ? import.meta.env.MODE : void 0)
  // The bare `import.meta.env` in that condition is a non-static reference, so
  // Vite serialises the ENTIRE env object — every VITE_ var, including these
  // secrets — into any chunk containing a zustand store.
  //
  // The first four keys are only read on DEV-guarded local fallback paths
  // (claudeProxy.ts, whisper.ts, elevenLabs.ts); production always goes through
  // the server-side Netlify functions. Forcing them to undefined at build time
  // keeps those dev paths working locally while ensuring the production bundle
  // never carries the values. Does not touch .env or any key value.
  //
  // SEC2 — the two Upstash entries are read by NO client code at all now
  // (src/lib/redis.ts no longer builds a browser Redis client). They are listed
  // purely to neutralise the whole-env serialisation above: without them, Vite
  // still inlines the token from .env into every zustand chunk even though
  // nothing imports it. Verified against dist/ after each build.
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
    // SEC1: no sourcemaps in production builds — they shipped full original
    // source to the public bundle. The dev server generates its own sourcemaps
    // independently of this flag, so local debugging is unaffected.
    sourcemap: false,
    commonjsOptions: {
      include: [/node_modules/],
      strictRequires: [/react-dom/],
    },
    rollupOptions: {
      output: {
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
