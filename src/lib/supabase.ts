import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

// ── Lazy Supabase singleton ──────────────────────────────────────────────────
// CRITICAL: The Supabase client MUST NOT be created at module scope.
//
// Why? In Vite production builds, Rollup concatenates modules into chunks using
// let/const bindings. If Rollup evaluates this module before a module that it
// depends on (or vice versa), the createClient() call can hit a Temporal Dead
// Zone (TDZ) error: "Cannot access 'X' before initialization".
//
// The fix: defer createClient() to the first access via a lazy getter.
// Every file that imports `supabase` gets the same singleton — it's just
// created on first use instead of at import time.

let _instance: SupabaseClient<Database> | null = null

function _getSupabaseClient(): SupabaseClient<Database> {
  if (_instance) return _instance

  const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string ?? ''
  const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string ?? ''

  if (!supabaseUrl || !supabaseAnon) {
    console.warn(
      '[supabase] Missing env vars VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
      'App will run in offline/backup-only mode. ' +
      'Check that .env.local exists in the project root and restart the dev server.'
    )
  }

  const safeUrl = supabaseUrl || 'https://placeholder.supabase.co'
  const safeKey = supabaseAnon || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder'

  _instance = createClient<Database>(safeUrl, safeKey, {
    auth: {
      autoRefreshToken:    true,
      persistSession:      true,
      detectSessionInUrl:  true,
      storage:             window.localStorage,
      storageKey:          'poweron-hub-auth',
      flowType:            'pkce',
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
    global: {
      headers: {
        'x-application': 'poweron-hub-v2',
      },
    },
  })

  return _instance
}

// ── Proxy-based export: `supabase` behaves exactly like the real client ──────
// This proxy forwards every property access and method call to the lazy
// singleton. Code that does `supabase.auth.getSession()` or
// `supabase.from('profiles')` works identically — the client is created
// on the first access.
export const supabase: SupabaseClient<Database> = new Proxy(
  {} as SupabaseClient<Database>,
  {
    get(_target, prop, receiver) {
      const client = _getSupabaseClient()
      const value = Reflect.get(client, prop, receiver)
      if (typeof value === 'function') {
        return value.bind(client)
      }
      return value
    },
    set(_target, prop, value) {
      const client = _getSupabaseClient()
      return Reflect.set(client, prop, value)
    },
  }
)

// ── Type-safe table helpers ──────────────────────────────────────────────────
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type InsertDto<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type UpdateDto<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

// ── Convenience re-exports ───────────────────────────────────────────────────
export type { User, Session } from '@supabase/supabase-js'
