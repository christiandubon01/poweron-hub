// @ts-nocheck
/**
 * useProactiveAI — Shared hook for proactive AI loading on panel mount.
 *
 * Auto-fetches Claude analysis when a panel mounts, with loading state,
 * caching, and error handling. Used by all agent panels.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { callClaude, extractText } from '@/services/claudeProxy'

// Simple cache: key → { text, timestamp }
const cache = new Map<string, { text: string; ts: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export interface ProactiveAIResult {
  response: string
  loading: boolean
  error: string
  refresh: () => void
}

export function useProactiveAI(
  panelName: string,
  systemPrompt: string,
  userMessage: string,
  enabled = true
): ProactiveAIResult {
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const fetchAI = useCallback(async (force = false) => {
    if (!enabled || !userMessage) return

    const key = panelName + '::' + userMessage.slice(0, 200)

    // Check cache
    if (!force) {
      const cached = cache.get(key)
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        setResponse(cached.text)
        return
      }
    }

    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError('')

    try {
      const result = await callClaude({
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        max_tokens: 1024,
        signal: controller.signal,
      })
      const text = extractText(result)
      setResponse(text)
      cache.set(key, { text, ts: Date.now() })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [panelName, systemPrompt, userMessage, enabled])

  useEffect(() => {
    fetchAI()
    return () => { if (abortRef.current) abortRef.current.abort() }
  }, [fetchAI])

  return { response, loading, error, refresh: () => fetchAI(true) }
}
