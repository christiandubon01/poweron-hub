// @ts-nocheck
'use client'

import { useState } from 'react'
import { Search, Loader2, Brain, Filter } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { getRelatedMemories, type MemoryRecord } from '@/services/vectorMemory'
import clsx from 'clsx'

const ENTITY_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'project', label: 'Projects' },
  { value: 'estimate', label: 'Estimates' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'client', label: 'Clients' },
  { value: 'lead', label: 'Leads' },
  { value: 'service_call', label: 'Service Calls' },
  { value: 'field_log', label: 'Field Logs' },
  { value: 'pattern', label: 'Patterns' },
  { value: 'conversation', label: 'Conversations' },
  { value: 'compliance', label: 'Compliance' },
]

export function SemanticSearchPanel() {
  const { profile } = useAuth()
  const orgId = profile?.org_id

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemoryRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [entityFilter, setEntityFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const handleSearch = async () => {
    if (!query.trim() || !orgId) return

    setLoading(true)
    setSearched(true)

    try {
      const memories = await getRelatedMemories(orgId, query.trim(), {
        entityType: entityFilter || undefined,
        limit: 10,
        threshold: 0.55,
      })
      setResults(memories)
    } catch (err) {
      console.error('[SemanticSearch] Search failed:', err)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const getSimilarityColor = (similarity: number) => {
    if (similarity >= 0.85) return 'text-emerald-400 bg-emerald-400/10'
    if (similarity >= 0.70) return 'text-cyan-400 bg-cyan-400/10'
    if (similarity >= 0.55) return 'text-yellow-400 bg-yellow-400/10'
    return 'text-gray-400 bg-gray-400/10'
  }

  const getEntityBadgeColor = (type: string) => {
    const colors: Record<string, string> = {
      project: 'bg-blue-400/10 text-blue-400',
      estimate: 'bg-purple-400/10 text-purple-400',
      invoice: 'bg-green-400/10 text-green-400',
      client: 'bg-pink-400/10 text-pink-400',
      lead: 'bg-orange-400/10 text-orange-400',
      service_call: 'bg-yellow-400/10 text-yellow-400',
      field_log: 'bg-teal-400/10 text-teal-400',
      pattern: 'bg-indigo-400/10 text-indigo-400',
      conversation: 'bg-gray-400/10 text-gray-400',
      compliance: 'bg-red-400/10 text-red-400',
    }
    return colors[type] || 'bg-gray-400/10 text-gray-400'
  }

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search memories... (e.g. 'panel upgrade pricing')"
            className="w-full pl-10 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-cyan-500 transition-colors"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={clsx(
            'px-3 py-2.5 rounded-lg border transition-colors',
            showFilters
              ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-300'
          )}
        >
          <Filter className="w-4 h-4" />
        </button>
        <button
          onClick={handleSearch}
          disabled={!query.trim() || loading}
          className="px-4 py-2.5 bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/30 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex gap-2 flex-wrap">
          {ENTITY_TYPES.map(type => (
            <button
              key={type.value}
              onClick={() => setEntityFilter(type.value)}
              className={clsx(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                entityFilter === type.value
                  ? 'bg-cyan-500/20 text-cyan-400'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-300'
              )}
            >
              {type.label}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center items-center py-8">
          <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
      )}

      {/* Results */}
      {!loading && searched && results.length === 0 && (
        <div className="py-12 text-center">
          <Brain className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No matching memories found</p>
          <p className="text-gray-600 text-xs mt-1">Try a different query or broaden your filters</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-gray-500 text-xs">{results.length} result{results.length !== 1 ? 's' : ''} found</p>

          {results.map((result, idx) => (
            <div
              key={result.id || idx}
              className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors space-y-3"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={clsx('px-2 py-0.5 rounded text-xs font-medium', getEntityBadgeColor(result.entity_type))}>
                    {result.entity_type.replace(/_/g, ' ')}
                  </span>
                  {result.agent_id && (
                    <span className="text-gray-500 text-xs">
                      via {result.agent_id.toUpperCase()}
                    </span>
                  )}
                </div>
                <span className={clsx('px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap', getSimilarityColor(result.similarity))}>
                  {Math.round(result.similarity * 100)}% match
                </span>
              </div>

              {/* Content */}
              <p className="text-gray-300 text-sm leading-relaxed">
                {result.content.length > 200
                  ? result.content.substring(0, 200) + '...'
                  : result.content}
              </p>

              {/* Footer */}
              <div className="flex items-center gap-3 text-xs text-gray-500">
                {result.entity_id && (
                  <span>ID: {result.entity_id.substring(0, 12)}...</span>
                )}
                <span>{new Date(result.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
