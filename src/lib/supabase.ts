import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string ?? ''
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string ?? ''

if (!supabaseUrl || !supabaseAnon) {
  console.warn(
    '[supabase] Missing env vars VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
    'App will run in offline/backup-only mode. ' +
    'Check that .env.local exists in the project root and restart the dev server.'
  )
}

// ── Public client (uses anon key + RLS) ──────────────────────────────────────
// Fallback to a dummy URL so createClient never throws at import time.
// Actual Supabase calls will fail gracefully when env vars are missing.
const safeUrl = supabaseUrl || 'https://placeholder.supabase.co'
const safeKey = supabaseAnon || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder'
export const supabase = createClient<Database>(safeUrl, safeKey, {
  auth: {
    autoRefreshToken:    true,
    persistSession:      true,
    detectSessionInUrl:  true,
    storage:             window.localStorage,   // persist Supabase JWT
    storageKey:          'poweron-hub-auth',
    flowType:            'pkce',                // PKCE for mobile-safe OAuth
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

// ── Type-safe table helpers ──────────────────────────────────────────────────
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type InsertDto<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type UpdateDto<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

// ── Convenience re-exports ───────────────────────────────────────────────────
export type { User, Session } from '@supabase/supabase-js'
