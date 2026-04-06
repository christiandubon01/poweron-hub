// @ts-nocheck
/**
 * CodePanel — Dark-themed electrical code search and Q&A interface.
 *
 * Tabs:
 * - Search Articles: NEC article keyword search
 * - Ask Question: Claude-powered code Q&A with Trade Knowledge Base enrichment
 * - Trade Library: Searchable/filterable trade knowledge entries with owner notes
 *
 * Session 12 additions:
 * - Trade Knowledge Base enrichment on Q&A answers
 * - "Add field note" button after each answer
 * - Trade Library tab with search, filter, add, and edit owner notes
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Search, Send, Loader2, BookOpen, AlertCircle, ChevronRight,
  PlusCircle, X, Save, Library, StickyNote, Tag, ChevronDown, ChevronUp,
  WifiOff,
} from 'lucide-react'
import { NecLookupPanel } from '@/components/ohm/NecLookupPanel'
import { NecTablesPanel } from '@/components/ohm/NecTablesPanel'
import { useAuth } from '@/hooks/useAuth'
import * as codeSearch from '@/agents/ohm/codeSearch'
import { useProactiveAI } from '@/hooks/useProactiveAI'
import { ProactiveInsightCard } from '@/components/shared/ProactiveInsightCard'
import { getBackupData } from '@/services/backupDataService'
import {
  queryTradeKnowledge,
  formatTradeKnowledgeContext,
  saveOwnerNote,
  createTradeEntry,
  getAllTradeEntries,
  type TradeKnowledgeEntry,
  type TradeKnowledgeMatch,
} from '@/services/tradeKnowledgeService'

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
  tradeMatches?: Array<{ id: string; scenario: string; relevance: number }>
}

type ActiveTab = 'search' | 'ask' | 'library' | 'nec-lookup' | 'nec-tables'

// ── Component ────────────────────────────────────────────────────────────────

export interface CodePanelProps {
  jurisdiction?: string
  onSelectArticle?: (articleNumber: string) => void
}

export function CodePanel({ jurisdiction = 'California', onSelectArticle }: CodePanelProps) {
  const { user, org } = useAuth()
  const [activeTab, setActiveTab] = useState<ActiveTab>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [question, setQuestion] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState('')
  const resultsRef = useRef<HTMLDivElement>(null)

  // Owner note capture state
  const [noteEntryId, setNoteEntryId] = useState<string | null>(null)
  const [noteScenario, setNoteScenario] = useState('')
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteSaved, setNoteSaved] = useState(false)

  // Trade Library state
  const [libraryEntries, setLibraryEntries] = useState<TradeKnowledgeEntry[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [librarySearch, setLibrarySearch] = useState('')
  const [libraryTagFilter, setLibraryTagFilter] = useState('')
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [showAddEntry, setShowAddEntry] = useState(false)
  const [newEntry, setNewEntry] = useState({
    scenario: '',
    tags: '',
    code_answer: '',
    field_answer: '',
    failure_modes: '',
  })

  // Proactive AI context
  const backup = getBackupData()
  const activeJobTypes = [...new Set(
    (backup?.projects || [])
      .filter((p: any) => p.status !== 'completed')
      .map((p: any) => p.type)
      .filter(Boolean)
  )]
  const ohmContext = activeJobTypes.length > 0
    ? `Active project types: ${activeJobTypes.join(', ')}. List the most relevant NEC 2023 code articles for these job types. Include article numbers and brief summaries.`
    : 'No active projects. Provide a quick NEC 2023 reference overview for common residential and commercial electrical work.'
  const ohmSystem = 'You are OHM, the electrical code compliance coach for Power On Solutions LLC, a California C-10 contractor. Reference NEC 2023 articles specifically. Be concise with article numbers and practical guidance.'
  const ohm = useProactiveAI('ohm', ohmSystem, ohmContext)

  // ── Load Trade Library ────────────────────────────────────────────────────

  const loadLibrary = useCallback(async () => {
    if (!org?.id) return
    setLibraryLoading(true)
    try {
      const entries = await getAllTradeEntries(org.id)
      setLibraryEntries(entries)
    } finally {
      setLibraryLoading(false)
    }
  }, [org?.id])

  useEffect(() => {
    if (activeTab === 'library') {
      loadLibrary()
    }
  }, [activeTab, loadLibrary])

  // ── Filtered library entries ───────────────────────────────────────────────

  const filteredLibrary = libraryEntries.filter(entry => {
    const matchesSearch = !librarySearch ||
      entry.scenario.toLowerCase().includes(librarySearch.toLowerCase()) ||
      (entry.field_answer || '').toLowerCase().includes(librarySearch.toLowerCase()) ||
      (entry.code_answer || '').toLowerCase().includes(librarySearch.toLowerCase())
    const matchesTag = !libraryTagFilter ||
      (entry.tags || []).some(t => t.toLowerCase().includes(libraryTagFilter.toLowerCase()))
    return matchesSearch && matchesTag
  })

  // All unique tags for filter hints
  const allTags = [...new Set(libraryEntries.flatMap(e => e.tags || []))].sort()

  // ── Search Handler ──────────────────────────────────────────────────────

  const handleSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return

    setLoading(true)
    setError('')

    try {
      const searchResults = await codeSearch.searchNECArticles(searchQuery, jurisdiction)

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
    setNoteEntryId(null)
    setNoteSaved(false)

    try {
      // Query Trade Knowledge Base FIRST
      const tradeMatches = await queryTradeKnowledge(question, org.id)
      const tradeContext = formatTradeKnowledgeContext(tradeMatches)

      const systemPrompt = `You are OHM, an electrical code expert for PowerOn Hub. Answer questions about NEC 2023 and California electrical codes.
Always cite specific NEC articles and sections. Provide practical guidance for electrical contractors.
Include safety-critical warnings and AHJ consideration.`

      const userContent = `Answer this electrical code question for ${jurisdiction}:

${question}

${tradeContext ? tradeContext + '\n\n' : ''}Provide:
1. Direct answer
2. Relevant NEC articles
3. Safety considerations
4. Any jurisdiction-specific notes
5. Field/practical notes where applicable`

      const response = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
        }),
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`)
      }

      const data = await response.json()
      const answer = (data.content?.[0]?.text ?? '') as string

      // Search for related articles
      const relatedArticles = await codeSearch.searchNECArticles(question, jurisdiction)

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
          tradeMatches: tradeMatches.map(m => ({
            id: m.entry.id,
            scenario: m.entry.scenario,
            relevance: m.relevance,
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

  // ── Owner Note Save ────────────────────────────────────────────────────────

  const handleSaveNote = useCallback(async () => {
    if (!noteEntryId || !noteText.trim() || !org?.id) return
    setNoteSaving(true)
    try {
      const ok = await saveOwnerNote(noteEntryId, noteText, org.id)
      if (ok) {
        setNoteSaved(true)
        setNoteText('')
        setNoteEntryId(null)
      }
    } finally {
      setNoteSaving(false)
    }
  }, [noteEntryId, noteText, org?.id])

  // ── Handle Article Select ──────────────────────────────────────────────────

  const handleArticleSelect = useCallback((articleNumber: string | undefined) => {
    if (articleNumber) {
      onSelectArticle?.(articleNumber)
    }
  }, [onSelectArticle])

  // ── Scroll to results ──────────────────────────────────────────────────────

  useEffect(() => {
    if (results.length > 0 && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [results])

  // ── Save inline library owner note ─────────────────────────────────────────

  const handleSaveLibraryNote = useCallback(async (entryId: string) => {
    if (!editingNoteText.trim() || !org?.id) return
    const ok = await saveOwnerNote(entryId, editingNoteText, org.id)
    if (ok) {
      setEditingNoteId(null)
      setEditingNoteText('')
      await loadLibrary()
    }
  }, [editingNoteText, org?.id, loadLibrary])

  // ── Add new entry ──────────────────────────────────────────────────────────

  const handleAddEntry = useCallback(async () => {
    if (!newEntry.scenario.trim() || !org?.id) return
    const tags = newEntry.tags.split(',').map(t => t.trim()).filter(Boolean)
    const id = await createTradeEntry({
      scenario: newEntry.scenario,
      tags,
      code_answer: newEntry.code_answer || null,
      field_answer: newEntry.field_answer || null,
      failure_modes: newEntry.failure_modes || null,
      material_options: [],
      regional_factors: null,
      owner_notes: null,
      org_id: org.id,
      source: 'owner',
    }, org.id)
    if (id) {
      setNewEntry({ scenario: '', tags: '', code_answer: '', field_answer: '', failure_modes: '' })
      setShowAddEntry(false)
      await loadLibrary()
    }
  }, [newEntry, org?.id, loadLibrary])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100">
      <ProactiveInsightCard
        agentName="OHM"
        agentColor="#10b981"
        response={ohm.response}
        loading={ohm.loading}
        error={ohm.error}
        onRefresh={ohm.refresh}
        emptyMessage="Search for electrical code articles to get started."
        systemPrompt={ohmSystem}
      />

      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-400 mb-1">
          <BookOpen size={20} />
          OHM Code Search
        </h2>
        <div className="text-xs text-gray-400">Jurisdiction: {jurisdiction}</div>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-gray-800 px-4 pt-3">
        <button
          onClick={() => setActiveTab('search')}
          className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'search'
              ? 'text-emerald-400 border-emerald-400'
              : 'text-gray-400 border-transparent hover:text-gray-300'
          }`}
        >
          Search Articles
        </button>
        <button
          onClick={() => setActiveTab('ask')}
          className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'ask'
              ? 'text-emerald-400 border-emerald-400'
              : 'text-gray-400 border-transparent hover:text-gray-300'
          }`}
        >
          Ask Question
        </button>
        <button
          onClick={() => setActiveTab('library')}
          className={`flex items-center gap-1 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'library'
              ? 'text-amber-400 border-amber-400'
              : 'text-gray-400 border-transparent hover:text-gray-300'
          }`}
        >
          <Library size={14} />
          Trade Library
        </button>
        <button
          onClick={() => setActiveTab('nec-lookup')}
          className={`flex items-center gap-1 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'nec-lookup'
              ? 'text-green-400 border-green-400'
              : 'text-gray-400 border-transparent hover:text-gray-300'
          }`}
        >
          <WifiOff size={14} />
          NEC Calculators
        </button>
        <button
          onClick={() => setActiveTab('nec-tables')}
          className={`flex items-center gap-1 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'nec-tables'
              ? 'text-emerald-400 border-emerald-400'
              : 'text-gray-400 border-transparent hover:text-gray-300'
          }`}
        >
          <Search size={14} />
          NEC Tables
        </button>
      </div>

      {/* ── Search Articles Tab ─────────────────────────────────────────────── */}
      {activeTab === 'search' && (
        <>
          <div className="px-4 pt-4">
            <form onSubmit={handleSearch} className="mb-4">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search size={16} className="absolute left-3 top-3 text-gray-500 pointer-events-none" />
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
          </div>

          {error && (
            <div className="mx-4 mb-4 p-3 bg-red-900/20 border border-red-700 rounded flex items-start gap-3 text-red-200 text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

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
              <div
                key={result.id}
                className="p-4 border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer transition-colors"
                onClick={() => setSelectedResult(result)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-emerald-300 text-sm mb-1 break-words">{result.title}</h3>
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
                    <p className="text-gray-300 text-sm line-clamp-3 mb-2">{result.content}</p>
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

          {selectedResult && (
            <div className="border-t border-gray-800 p-4 bg-gray-800/50 max-h-40 overflow-y-auto">
              <div className="text-sm text-gray-300 whitespace-pre-wrap">{selectedResult.content}</div>
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
        </>
      )}

      {/* ── Ask Question Tab ───────────────────────────────────────────────── */}
      {activeTab === 'ask' && (
        <>
          <div className="px-4 pt-4">
            <form onSubmit={handleAskQuestion} className="mb-4">
              <div className="flex gap-2 mb-1">
                <input
                  type="text"
                  placeholder="Ask an electrical code question..."
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  className="flex-1 px-3 py-2 bg-gray-800 text-gray-100 border border-gray-700 rounded
                    placeholder-gray-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="submit"
                  disabled={loading || !question.trim()}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50
                    text-white rounded font-medium transition-colors flex items-center gap-2"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
              <p className="text-xs text-gray-500">Answers include Trade Knowledge Base field judgment when relevant.</p>
            </form>
          </div>

          {error && (
            <div className="mx-4 mb-4 p-3 bg-red-900/20 border border-red-700 rounded flex items-start gap-3 text-red-200 text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          <div ref={resultsRef} className="flex-1 overflow-y-auto px-4">
            {results.length === 0 && !loading && (
              <div className="py-8 text-center text-gray-400">
                <p className="text-sm">Ask a code question to get field-enriched guidance</p>
              </div>
            )}
            {loading && (
              <div className="flex items-center justify-center h-32 text-gray-400">
                <Loader2 size={20} className="animate-spin" />
                <span className="ml-2 text-sm">Checking trade knowledge base + code...</span>
              </div>
            )}

            {results.map(result => (
              <div key={result.id} className="mb-4">
                {result.type === 'answer' ? (
                  <div className="rounded-lg bg-gray-800 border border-gray-700 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-emerald-300 text-sm">{result.title}</h3>
                      {result.tradeMatches && result.tradeMatches.length > 0 && (
                        <span className="text-xs bg-amber-900/40 text-amber-300 px-2 py-0.5 rounded border border-amber-700">
                          +{result.tradeMatches.length} field note{result.tradeMatches.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="text-gray-300 text-sm whitespace-pre-wrap mb-3">{result.content}</div>

                    {result.references && result.references.length > 0 && (
                      <div className="text-xs text-cyan-300 mb-3">
                        References: {result.references.map(r => `NEC ${r.article}`).join(', ')}
                      </div>
                    )}

                    {/* Trade Knowledge Matches shown inline */}
                    {result.tradeMatches && result.tradeMatches.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-700">
                        <p className="text-xs text-amber-400 font-medium mb-1">📋 Related trade scenarios:</p>
                        <div className="flex flex-wrap gap-2">
                          {result.tradeMatches.map(m => (
                            <span key={m.id} className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded">
                              {m.scenario}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Add Field Note section */}
                    {result.tradeMatches && result.tradeMatches.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-700">
                        {noteSaved ? (
                          <p className="text-xs text-emerald-400">✓ Field note saved to Trade Library</p>
                        ) : noteEntryId ? (
                          <div>
                            <p className="text-xs text-gray-400 mb-1">
                              Adding note to: <span className="text-amber-300">{noteScenario}</span>
                            </p>
                            <div className="flex gap-2">
                              <textarea
                                value={noteText}
                                onChange={e => setNoteText(e.target.value)}
                                placeholder="What did you observe in the field on this job?"
                                rows={2}
                                className="flex-1 px-2 py-1.5 text-xs bg-gray-700 border border-gray-600 rounded
                                  text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-500 resize-none"
                              />
                              <div className="flex flex-col gap-1">
                                <button
                                  onClick={handleSaveNote}
                                  disabled={noteSaving || !noteText.trim()}
                                  className="px-2 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs rounded flex items-center gap-1"
                                >
                                  {noteSaving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                                  Save
                                </button>
                                <button
                                  onClick={() => { setNoteEntryId(null); setNoteText('') }}
                                  className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              const first = result.tradeMatches![0]
                              setNoteEntryId(first.id)
                              setNoteScenario(first.scenario)
                              setNoteText('')
                              setNoteSaved(false)
                            }}
                            className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"
                          >
                            <StickyNote size={12} />
                            Add field note from this job
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 border border-gray-800 rounded hover:bg-gray-800/50 cursor-pointer"
                    onClick={() => setSelectedResult(result)}>
                    <h3 className="font-medium text-emerald-300 text-xs mb-1">{result.title}</h3>
                    <p className="text-gray-400 text-xs line-clamp-2">{result.content}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Trade Library Tab ──────────────────────────────────────────────── */}
      {/* ── NEC Calculators (Offline) Tab ─────────────────────────────────── */}
      {activeTab === 'nec-lookup' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 py-4">
          <NecLookupPanel />
        </div>
      )}

      {/* ── NEC Tables Tab (Session 8) ─────────────────────────────────────── */}
      {activeTab === 'nec-tables' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 py-4">
          <NecTablesPanel />
        </div>
      )}

      {activeTab === 'library' && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Library Controls */}
          <div className="px-4 pt-4 pb-2 space-y-2 border-b border-gray-800">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-gray-500 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search scenarios, field notes..."
                  value={librarySearch}
                  onChange={e => setLibrarySearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm bg-gray-800 text-gray-100 border border-gray-700 rounded
                    placeholder-gray-500 focus:outline-none focus:border-amber-500"
                />
              </div>
              <button
                onClick={() => setShowAddEntry(v => !v)}
                className="flex items-center gap-1 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm rounded font-medium transition-colors"
              >
                <PlusCircle size={14} />
                Add
              </button>
            </div>

            {/* Tag filter */}
            <div className="flex items-center gap-2">
              <Tag size={12} className="text-gray-500" />
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => setLibraryTagFilter('')}
                  className={`text-xs px-2 py-0.5 rounded ${
                    !libraryTagFilter ? 'bg-amber-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  All
                </button>
                {allTags.slice(0, 12).map(tag => (
                  <button
                    key={tag}
                    onClick={() => setLibraryTagFilter(libraryTagFilter === tag ? '' : tag)}
                    className={`text-xs px-2 py-0.5 rounded ${
                      libraryTagFilter === tag ? 'bg-amber-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Add Entry Form */}
            {showAddEntry && (
              <div className="bg-gray-800 rounded-lg p-3 space-y-2 border border-amber-700">
                <p className="text-xs font-medium text-amber-400">New Trade Entry</p>
                <input
                  type="text"
                  placeholder="Scenario title *"
                  value={newEntry.scenario}
                  onChange={e => setNewEntry(v => ({ ...v, scenario: e.target.value }))}
                  className="w-full px-2 py-1.5 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-500"
                />
                <input
                  type="text"
                  placeholder="Tags (comma-separated: conduit, underground, burial)"
                  value={newEntry.tags}
                  onChange={e => setNewEntry(v => ({ ...v, tags: e.target.value }))}
                  className="w-full px-2 py-1.5 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-500"
                />
                <textarea
                  placeholder="Code answer (NEC article reference)"
                  value={newEntry.code_answer}
                  onChange={e => setNewEntry(v => ({ ...v, code_answer: e.target.value }))}
                  rows={2}
                  className="w-full px-2 py-1.5 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-500 resize-none"
                />
                <textarea
                  placeholder="Field judgment (what you've learned from doing the actual job)"
                  value={newEntry.field_answer}
                  onChange={e => setNewEntry(v => ({ ...v, field_answer: e.target.value }))}
                  rows={3}
                  className="w-full px-2 py-1.5 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-500 resize-none"
                />
                <textarea
                  placeholder="Failure modes (what goes wrong if done incorrectly)"
                  value={newEntry.failure_modes}
                  onChange={e => setNewEntry(v => ({ ...v, failure_modes: e.target.value }))}
                  rows={2}
                  className="w-full px-2 py-1.5 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-500 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleAddEntry}
                    disabled={!newEntry.scenario.trim()}
                    className="flex-1 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs rounded font-medium"
                  >
                    Save Entry
                  </button>
                  <button
                    onClick={() => setShowAddEntry(false)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Library Entries List */}
          <div className="flex-1 overflow-y-auto">
            {libraryLoading && (
              <div className="flex items-center justify-center h-24 text-gray-400">
                <Loader2 size={18} className="animate-spin mr-2" />
                <span className="text-sm">Loading trade library...</span>
              </div>
            )}
            {!libraryLoading && filteredLibrary.length === 0 && (
              <div className="p-6 text-center text-gray-500 text-sm">
                {librarySearch || libraryTagFilter ? 'No entries match your filter.' : 'No trade knowledge entries yet.'}
              </div>
            )}
            {filteredLibrary.map(entry => {
              const isExpanded = expandedEntryId === entry.id
              const isEditingNote = editingNoteId === entry.id
              const isSystem = entry.source === 'system'
              return (
                <div key={entry.id} className="border-b border-gray-800">
                  {/* Entry Header */}
                  <button
                    onClick={() => setExpandedEntryId(isExpanded ? null : entry.id)}
                    className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-800/40 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm text-gray-100 break-words">{entry.scenario}</span>
                        {isSystem && (
                          <span className="text-xs bg-emerald-900/40 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-800 flex-shrink-0">
                            system
                          </span>
                        )}
                        {entry.owner_notes && (
                          <span className="text-xs bg-amber-900/40 text-amber-400 px-1.5 py-0.5 rounded border border-amber-800 flex-shrink-0">
                            <StickyNote size={10} className="inline mr-0.5" />
                            note
                          </span>
                        )}
                      </div>
                      {entry.tags && entry.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {entry.tags.slice(0, 5).map(tag => (
                            <span key={tag} className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {isExpanded
                      ? <ChevronUp size={14} className="text-gray-500 flex-shrink-0 mt-1" />
                      : <ChevronDown size={14} className="text-gray-500 flex-shrink-0 mt-1" />
                    }
                  </button>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 bg-gray-800/20">
                      {entry.code_answer && (
                        <div>
                          <p className="text-xs font-medium text-cyan-400 mb-1">📖 Code</p>
                          <p className="text-xs text-gray-300 leading-relaxed">{entry.code_answer}</p>
                        </div>
                      )}
                      {entry.field_answer && (
                        <div>
                          <p className="text-xs font-medium text-emerald-400 mb-1">🏗️ Field Judgment</p>
                          <p className="text-xs text-gray-300 leading-relaxed">{entry.field_answer}</p>
                        </div>
                      )}
                      {entry.failure_modes && (
                        <div>
                          <p className="text-xs font-medium text-red-400 mb-1">⚠️ Failure Modes</p>
                          <p className="text-xs text-gray-300 leading-relaxed">{entry.failure_modes}</p>
                        </div>
                      )}
                      {entry.material_options && Array.isArray(entry.material_options) && entry.material_options.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-amber-400 mb-1">📦 Material Options</p>
                          <div className="space-y-1">
                            {entry.material_options.map((opt: any, i: number) => (
                              <div key={i} className="text-xs text-gray-300 bg-gray-700/50 px-2 py-1 rounded">
                                {Object.entries(opt).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {entry.regional_factors && (
                        <div>
                          <p className="text-xs font-medium text-purple-400 mb-1">🌵 Regional Factors</p>
                          <p className="text-xs text-gray-300 leading-relaxed">{entry.regional_factors}</p>
                        </div>
                      )}

                      {/* Owner Notes */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-medium text-amber-400">
                            <StickyNote size={10} className="inline mr-1" />
                            Your Field Notes
                          </p>
                          {!isEditingNote && (
                            <button
                              onClick={() => {
                                setEditingNoteId(entry.id)
                                setEditingNoteText('')
                              }}
                              className="text-xs text-amber-500 hover:text-amber-300"
                            >
                              + Add note
                            </button>
                          )}
                        </div>
                        {entry.owner_notes && (
                          <p className="text-xs text-gray-300 bg-amber-900/10 border border-amber-900/30 px-2 py-2 rounded leading-relaxed mb-2">
                            {entry.owner_notes}
                          </p>
                        )}
                        {isEditingNote && (
                          <div className="flex gap-2">
                            <textarea
                              value={editingNoteText}
                              onChange={e => setEditingNoteText(e.target.value)}
                              placeholder="What did you learn from the actual job?"
                              rows={2}
                              autoFocus
                              className="flex-1 px-2 py-1.5 text-xs bg-gray-700 border border-amber-600 rounded
                                text-gray-200 placeholder-gray-500 focus:outline-none resize-none"
                            />
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => handleSaveLibraryNote(entry.id)}
                                disabled={!editingNoteText.trim()}
                                className="px-2 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs rounded"
                              >
                                <Save size={10} />
                              </button>
                              <button
                                onClick={() => { setEditingNoteId(null); setEditingNoteText('') }}
                                className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-400 text-xs rounded"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
