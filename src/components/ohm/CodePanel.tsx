// @ts-nocheck
/**
 * CodePanel — Dark-themed electrical code search and Q&A interface.
 *
 * Features:
 * - NEC article search with keyword matching
 * - Code question input and Claude responses
 * - Jurisdiction-specific rule display
 * - Related articles navigation
 * - NEC article references with excerpts
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Search, Send, Loader2, BookOpen, AlertCircle, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/hooks/useAuth'
import * as codeSearch from '@/agents/ohm/codeSearch'

// ── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  type: 'article' | 'answer'
  id: string
  title: string
  content: string
  references?: Array<{ article: string; section: string }>
  necArticle?: string
  section?: string
  jurisdiction?: string
}

// ── Component ────────────────────────────────────────────────────────────────

export interface CodePanelProps {
  jurisdiction?: string
  onSelectArticle?: (articleNumber: string) => void
}

export function CodePanel({ jurisdiction = 'California', onSelectArticle }: CodePanelProps) {
  const { user, org } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [question, setQuestion] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState('')
  const resultsRef = useRef<HTMLDivElement>(null)

  // ── Search Handler ──────────────────────────────────────────────────────

  const handleSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return

    setLoading(true)
    setError('')

    try {
      const searchResults = await codeSearch.searchNECArticles(
        searchQuery,
        jurisdiction
      )

      const formattedResults: SearchResult[] = searchResults.articles.map(article => ({
        type: 'article' as const,
        id: article.id,
        title: `NEC ${article.article_number} — ${article.title}`,
        content: article.excerpt,
        necArticle: article.article_number,
        section: article.section,
        jurisdiction: article.is_california_amendment ? 'California Amendment' : undefined,
      }))

      setResults(formattedResults)
      if (formattedResults.length === 0) {
        setError('No matching NEC articles found. Try different keywords.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed'
      setError(message)
      console.error('[CodePanel] Search error:', err)
    } finally {
      setLoading(false)
    }
  }, [searchQuery, jurisdiction])

  // ── Ask Question Handler ────────────────────────────────────────────────

  const handleAskQuestion = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!question.trim() || !user || !org) return

    setLoading(true)
    setError('')
    setResults([])

    try {
      const response = await fetch('/api/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY as string,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          system: `You are OHM, an electrical code expert for PowerOn Hub. Answer questions about NEC 2023 and California electrical codes.
Always cite specific NEC articles and sections. Provide practical guidance for electrical contractors.
Include safety-critical warnings and AHJ consideration.`,
          messages: [
            {
              role: 'user',
              content: `Answer this electrical code question for ${jurisdiction}:

${question}

Provide:
1. Direct answer
2. Relevant NEC articles
3. Safety considerations
4. Any jurisdiction-specific notes`,
            },
          ],
        }),
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`)
      }

      const data = await response.json()
      const answer = (data.content?.[0]?.text ?? '') as string

      // Search for related articles
      const relatedArticles = await codeSearch.searchNECArticles(
        question,
        jurisdiction
      )

      setResults([
        {
          type: 'answer',
          id: 'answer-' + Date.now(),
          title: 'Code Guidance',
          content: answer,
          references: relatedArticles.articles.map(a => ({
            article: a.article_number,
            section: a.section,
          })),
        },
        ...relatedArticles.articles.map(article => ({
          type: 'article' as const,
          id: article.id,
          title: `NEC ${article.article_number} — ${article.title}`,
          content: article.excerpt,
          necArticle: article.article_number,
          section: article.section,
          jurisdiction: article.is_california_amendment ? 'California Amendment' : undefined,
        })),
      ])

      setQuestion('')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Question failed'
      setError(message)
      console.error('[CodePanel] Question error:', err)
    } finally {
      setLoading(false)
    }
  }, [question, user, org, jurisdiction])

  // ── Handle Article Select ────────────────────────────────────────────────

  const handleArticleSelect = useCallback((articleNumber: string | undefined) => {
    if (articleNumber) {
      onSelectArticle?.(articleNumber)
    }
  }, [onSelectArticle])

  // ── Scroll to results ─────────────────────────────────────────────────────

  useEffect(() => {
    if (results.length > 0 && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [results])

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-400 mb-4">
          <BookOpen size={20} />
          OHM Code Search
        </h2>
        <div className="text-sm text-gray-400 mb-2">Jurisdiction: {jurisdiction}</div>
      </div>

      {/* Search Tabs */}
      <div className="px-4 pt-4">
        <div className="flex gap-2 mb-4 border-b border-gray-800">
          <button className="px-3 py-2 text-sm font-medium text-emerald-400 border-b-2 border-emerald-400">
            Search Articles
          </button>
          <button className="px-3 py-2 text-sm text-gray-400 hover:text-gray-300">Ask Question</button>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSearch} className="mb-4">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search
                size={16}
                className="absolute left-3 top-3 text-gray-500 pointer-events-none"
              />
              <input
                type="text"
                placeholder="Search NEC articles... (e.g., wire sizing, EV charging, grounding)"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-gray-800 text-gray-100 border border-gray-700 rounded
                  placeholder-gray-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50
                text-white rounded font-medium transition-colors flex items-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            </button>
          </div>
        </form>

        {/* Question Form (Alternative Tab) */}
        {false && (
          <form onSubmit={handleAskQuestion} className="mb-4">
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                placeholder="Ask an electrical code question..."
                value={question}
                onChange={e => setQuestion(e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-800 text-gray-100 border border-gray-700 rounded
                  placeholder-gray-500 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                disabled={loading}
                className="px-3 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50
                  text-white rounded font-medium transition-colors flex items-center gap-2"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Error State */}
      {error && (
        <div className="mx-4 mb-4 p-3 bg-red-900/20 border border-red-700 rounded
          flex items-start gap-3 text-red-200 text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      {/* Results */}
      <div ref={resultsRef} className="flex-1 overflow-y-auto">
        {results.length === 0 && !loading && (
          <div className="p-4 text-center text-gray-400">
            <p>Search NEC articles to get started</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center h-32 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}

        {results.map(result => (
          <div key={result.id} className="p-4 border-b border-gray-800 hover:bg-gray-800/50
            cursor-pointer transition-colors"
            onClick={() => setSelectedResult(result)}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-emerald-300 text-sm mb-1 break-words">
                  {result.title}
                </h3>
                {result.type === 'article' && result.necArticle && (
                  <div className="text-xs text-gray-400 mb-2">
                    Article: {result.necArticle} | Section: {result.section}
                    {result.jurisdiction && (
                      <span className="ml-2 px-2 py-0.5 bg-amber-900/30 text-amber-200 rounded inline-block">
                        {result.jurisdiction}
                      </span>
                    )}
                  </div>
                )}
                <p className="text-gray-300 text-sm line-clamp-3 mb-2">
                  {result.content}
                </p>
                {result.references && result.references.length > 0 && (
                  <div className="text-xs text-cyan-300">
                    References: {result.references.map(r => `NEC ${r.article}`).join(', ')}
                  </div>
                )}
              </div>
              <ChevronRight size={16} className="text-gray-600 flex-shrink-0 mt-1" />
            </div>
          </div>
        ))}
      </div>

      {/* Selected Result Detail */}
      {selectedResult && (
        <div className="border-t border-gray-800 p-4 bg-gray-800/50 max-h-40 overflow-y-auto">
          <div className="text-sm text-gray-300 whitespace-pre-wrap">
            {selectedResult.content}
          </div>
          {selectedResult.necArticle && (
            <button
              onClick={() => handleArticleSelect(selectedResult.necArticle)}
              className="mt-3 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded"
            >
              View Full Article
            </button>
          )}
        </div>
      )}
    </div>
  )
}
