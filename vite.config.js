import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * AI-DEV — local Claude proxy for `npm run dev` (no `netlify dev` required).
 *
 * HISTORY: local AI used to work via a browser-direct Anthropic call that read
 * VITE_ANTHROPIC_API_KEY from the bundle (insecure). SEC1-KEY-LEAK then added
 * the `define` guard below to force that access to `undefined` and stop the prod
 * leak — but Vite `define` also applies in dev, so it killed the dev fallback
 * ("No API key available"). AI-KEY-1 removed that dead fallback entirely.
 *
 * This restores local AI WITHOUT a browser secret: the Vite dev server serves
 * the SAME path the production Netlify function serves
 * (/.netlify/functions/claude), reads ANTHROPIC_API_KEY server-side from .env,
 * and injects it as x-api-key when forwarding to api.anthropic.com. The key
 * stays in the Node dev process — it never reaches the browser bundle — and
 * src/services/claudeProxy.ts is identical in dev and production. The browser
 * still POSTs to /.netlify/functions/claude; only the dev server injects the
 * key. `configureServer` runs only under `vite`/`vite dev`, never in
 * `vite build`, so production is unaffected (Netlify serves the real function).
 */
function claudeDevProxy(env) {
  // SEC1 dev-auth parity: verify the caller's Supabase JWT with the SAME
  // convention as netlify/functions/claude.ts (auth.getUser(token)). Identity
  // comes ONLY from the Authorization bearer — the request body cannot choose
  // it. npm run dev may be reached from other LAN devices (desktop/iPad/phone),
  // so this endpoint must NOT be an unauthenticated local Anthropic relay.
  async function verifyDevUser(req) {
    const authHeader = req.headers?.authorization || req.headers?.Authorization || ''
    const token = String(authHeader).replace(/^Bearer\s+/i, '').trim()
    if (!token) return null
    const url =
      env.VITE_SUPABASE_URL || env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const anonKey =
      env.VITE_SUPABASE_ANON_KEY ||
      env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY
    if (!url || !anonKey) return null
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await client.auth.getUser(token)
    if (error || !data?.user) return null
    return data.user
  }

  return {
    name: 'poweron-claude-dev-proxy',
    configureServer(server) {
      // Non-secret startup diagnostics (booleans only — never the key, bearer,
      // or any env value). Helps confirm local resolution without exposing it.
      const keyConfigured = !!(env.ANTHROPIC_API_KEY || env.VITE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY)
      const supabaseConfigured = !!(
        (env.VITE_SUPABASE_URL || env.SUPABASE_URL) &&
        (env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY)
      )
      console.log(`[AI dev proxy] key_configured=${keyConfigured} supabase_configured=${supabaseConfigured}`)

      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST' || !req.url || !req.url.startsWith('/.netlify/functions/claude')) {
          return next()
        }
        res.setHeader('Content-Type', 'application/json')

        // 1) Auth FIRST — mirrors production (401 before any paid Anthropic
        //    call). Missing or invalid bearer → 401. Valid PowerOn session → allowed.
        const user = await verifyDevUser(req)
        if (!user) {
          res.statusCode = 401
          res.end(JSON.stringify({ error: 'Authentication required.' }))
          return
        }

        // 2) Server-side key. ANTHROPIC_API_KEY is the contract; the
        //    VITE_ANTHROPIC_API_KEY term is a TEMPORARY Node-only migration aid
        //    so an existing .env.local keeps working — it is NEVER exposed to
        //    the browser (the `define` guard force-replaces the client access
        //    with undefined). Rename to ANTHROPIC_API_KEY when convenient.
        const apiKey = env.ANTHROPIC_API_KEY || env.VITE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
        if (!apiKey) {
          // Same sanitized body the production function returns, so claudeProxy
          // surfaces "AI service is not configured on this environment."
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured on server' }))
          return
        }

        try {
          const chunks = []
          for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
          const body = Buffer.concat(chunks).toString('utf8')
          const upstream = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body,
          })
          res.statusCode = upstream.status
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
          res.end(await upstream.text())
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'AI service is temporarily unavailable.' }))
        }
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv with an empty prefix reads ALL env vars (including non-VITE_
  // server-side secrets like ANTHROPIC_API_KEY) into a LOCAL object for the dev
  // plugin only. They are NOT exposed to the client bundle — only VITE_-prefixed
  // vars reach import.meta.env. The key stays in the Node dev process.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), claudeDevProxy(env)],
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
  }
})