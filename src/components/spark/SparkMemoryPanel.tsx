/**
 * SPARK Memory Panel
 *
 * React component showing contact profiles, conversation history,
 * promise tracking, and relationship scoring.
 *
 * Features:
 * - Search bar with natural language queries
 * - Contact profile cards with relationship score gauge
 * - Conversation timeline
 * - Promise tracker with status badges
 * - "NEEDS ATTENTION" section for overdue follow-ups and broken promises
 */

import React, { useState, useEffect } from 'react'
import {
  getAllSparkContacts,
  getOverdueFollowUps,
  getBrokenPromises,
  searchSparkContacts,
  ContactProfile,
  Conversation,
  SearchQuery,
  Commitment,
} from '@/services/sparkLiveCall/SparkConversationMemory'

// ── Types ────────────────────────────────────────────────────────────────────

interface PanelState {
  contacts: ContactProfile[]
  overdueFollowUps: ContactProfile[]
  brokenPromises: Array<{ contact: ContactProfile; promise: Commitment }>
  selectedContact: ContactProfile | null
  searchQuery: string
  searchResults: ContactProfile[]
  isLoading: boolean
  error: string | null
}

// ── Component ────────────────────────────────────────────────────────────────

export const SparkMemoryPanel: React.FC = () => {
  const [state, setState] = useState<PanelState>({
    contacts: [],
    overdueFollowUps: [],
    brokenPromises: [],
    selectedContact: null,
    searchQuery: '',
    searchResults: [],
    isLoading: true,
    error: null,
  })

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [contacts, overdue, broken] = await Promise.all([
          getAllSparkContacts(),
          getOverdueFollowUps(),
          getBrokenPromises(),
        ])

        setState((prev) => ({
          ...prev,
          contacts,
          overdueFollowUps: overdue,
          brokenPromises: broken,
          isLoading: false,
        }))
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : 'Failed to load contacts',
          isLoading: false,
        }))
      }
    }

    loadData()
  }, [])

  // Handle search
  const handleSearch = async (query: string) => {
    setState((prev) => ({ ...prev, searchQuery: query }))

    if (!query.trim()) {
      setState((prev) => ({ ...prev, searchResults: [] }))
      return
    }

    try {
      // Parse natural language query
      const searchQuery: SearchQuery = {
        query_text: query,
      }

      // Check for date range patterns
      if (query.toLowerCase().includes('march')) {
        const currentYear = new Date().getFullYear()
        searchQuery.date_range = {
          start: `${currentYear}-03-01T00:00:00Z`,
          end: `${currentYear}-03-31T23:59:59Z`,
        }
      } else if (query.toLowerCase().includes('february')) {
        const currentYear = new Date().getFullYear()
        searchQuery.date_range = {
          start: `${currentYear}-02-01T00:00:00Z`,
          end: `${currentYear}-02-28T23:59:59Z`,
        }
      }

      // Check for specific contact names
      const results = await searchSparkContacts(searchQuery)
      const resultContacts = results.map((r) => r.contact)

      setState((prev) => ({ ...prev, searchResults: resultContacts }))
    } catch (err) {
      console.error('Search failed:', err)
    }
  }

  // Render relationship score gauge
  const renderScoreGauge = (score: number) => {
    const percentage = (score / 10) * 100
    let color = 'bg-red-500'
    if (score >= 7) color = 'bg-green-500'
    else if (score >= 5) color = 'bg-yellow-500'
    else if (score >= 3) color = 'bg-orange-500'

    return (
      <div className="flex items-center gap-2">
        <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full ${color} transition-all duration-300`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <span className="text-sm font-semibold text-gray-300">{score.toFixed(1)}</span>
      </div>
    )
  }

  // Render promise status badge
  const renderPromiseBadge = (promise: Commitment) => {
    const isOverdue =
      promise.due_date && new Date(promise.due_date) < new Date() && promise.status === 'pending'

    let bgColor = 'bg-blue-900'
    let textColor = 'text-blue-200'

    if (promise.status === 'fulfilled') {
      bgColor = 'bg-green-900'
      textColor = 'text-green-200'
    } else if (promise.status === 'broken' || isOverdue) {
      bgColor = 'bg-red-900'
      textColor = 'text-red-200'
    } else if (promise.flagged) {
      bgColor = 'bg-orange-900'
      textColor = 'text-orange-200'
    }

    return (
      <span className={`px-2 py-1 text-xs font-medium rounded ${bgColor} ${textColor}`}>
        {promise.status === 'fulfilled' ? '✓' : promise.status === 'broken' ? '✗' : '◐'}{' '}
        {promise.status}
        {isOverdue ? ' (OVERDUE)' : ''}
      </span>
    )
  }

  // Render contact card
  const renderContactCard = (contact: ContactProfile) => (
    <div
      key={contact.contact_id}
      className="bg-gray-800 border border-gray-700 rounded-lg p-4 cursor-pointer hover:border-blue-500 transition-colors"
      onClick={() => setState((prev) => ({ ...prev, selectedContact: contact }))}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-lg font-semibold text-white">{contact.name}</h3>
          <p className="text-sm text-gray-400">
            {contact.company && `${contact.company} • `}
            {contact.type}
          </p>
        </div>
        <span className="px-2 py-1 bg-blue-900 text-blue-200 text-xs rounded font-medium">
          {contact.total_conversations} conversations
        </span>
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-xs text-gray-500 mb-1">Relationship Score</p>
          {renderScoreGauge(contact.relationship_score)}
        </div>

        <div className="text-sm text-gray-400">
          <p>
            💰 Business Value:{' '}
            <span className="text-white font-semibold">
              ${(contact.total_business_value || 0).toLocaleString()}
            </span>
          </p>
          <p>
            📅 Last Contact:{' '}
            <span className="text-gray-300">
              {new Date(contact.last_contact_date).toLocaleDateString()}
            </span>
          </p>
        </div>
      </div>
    </div>
  )

  // Render conversation item
  const renderConversation = (conv: Conversation) => (
    <div key={conv.id} className="border-l-2 border-blue-600 pl-4 py-3 mb-3">
      <div className="flex justify-between items-start mb-2">
        <h4 className="font-semibold text-white">{new Date(conv.date).toLocaleDateString()}</h4>
        <span className="text-xs text-gray-400">
          {conv.duration_minutes ? `${conv.duration_minutes} min` : 'Duration not recorded'}
        </span>
      </div>
      <p className="text-sm text-gray-300 mb-2">{conv.transcript_summary}</p>

      {conv.commitments_made.length > 0 && (
        <div className="mb-2">
          <p className="text-xs text-gray-500 mb-1">✓ Christian Committed:</p>
          <div className="space-y-1">
            {conv.commitments_made.map((c, i) => (
              <div key={i} className="text-xs text-gray-400">
                {renderPromiseBadge(c)} — {c.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {conv.commitments_received.length > 0 && (
        <div className="mb-2">
          <p className="text-xs text-gray-500 mb-1">⚡ They Committed:</p>
          <div className="space-y-1">
            {conv.commitments_received.map((c, i) => (
              <div key={i} className="text-xs text-gray-400">
                {renderPromiseBadge(c)} — {c.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {conv.outcome && (
        <div className="mt-2 text-xs">
          <span className="px-2 py-1 bg-gray-700 text-gray-200 rounded">
            Outcome: {conv.outcome}
          </span>
        </div>
      )}

      {conv.follow_up_due && (
        <div className="mt-2 text-xs text-orange-400">
          ⏰ Follow-up due: {new Date(conv.follow_up_due).toLocaleDateString()}
        </div>
      )}
    </div>
  )

  // Render needs attention section
  const renderNeedsAttention = () => {
    const hasOverdue = state.overdueFollowUps.length > 0
    const hasBroken = state.brokenPromises.length > 0

    if (!hasOverdue && !hasBroken) return null

    return (
      <div className="mt-8 p-4 bg-red-950 border border-red-700 rounded-lg">
        <h3 className="text-lg font-bold text-red-200 mb-4">🚨 NEEDS ATTENTION</h3>

        {hasOverdue && (
          <div className="mb-4">
            <h4 className="text-red-300 font-semibold mb-2">Overdue Follow-ups ({state.overdueFollowUps.length})</h4>
            <div className="space-y-2">
              {state.overdueFollowUps.slice(0, 5).map((contact) => (
                <div
                  key={contact.contact_id}
                  className="p-2 bg-red-900 rounded text-sm text-red-100 cursor-pointer hover:bg-red-800"
                  onClick={() => setState((prev) => ({ ...prev, selectedContact: contact }))}
                >
                  <span className="font-semibold">{contact.name}</span> — Last contact:{' '}
                  {new Date(contact.last_contact_date).toLocaleDateString()}
                </div>
              ))}
            </div>
          </div>
        )}

        {hasBroken && (
          <div>
            <h4 className="text-red-300 font-semibold mb-2">Broken Promises ({state.brokenPromises.length})</h4>
            <div className="space-y-2">
              {state.brokenPromises.slice(0, 5).map(({ contact, promise }, i) => (
                <div
                  key={i}
                  className="p-2 bg-red-900 rounded text-sm text-red-100 cursor-pointer hover:bg-red-800"
                  onClick={() => setState((prev) => ({ ...prev, selectedContact: contact }))}
                >
                  <span className="font-semibold">{contact.name}</span> promised: "{promise.text}"
                  {promise.due_date && ` (due ${new Date(promise.due_date).toLocaleDateString()})`}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (state.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400">Loading SPARK memory...</p>
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="p-4 bg-red-900 border border-red-700 rounded text-red-200">
        <p>Error: {state.error}</p>
      </div>
    )
  }

  const displayedContacts = state.searchResults.length > 0 ? state.searchResults : state.contacts

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">SPARK Conversation Memory</h1>
        <p className="text-gray-400">
          Track every conversation, promise, and commitment with every contact forever.
        </p>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <input
          type="text"
          placeholder='Search: "What did I tell Martinez in March?" or "Who owes me callbacks?"'
          value={state.searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex gap-6">
        {/* Contact List */}
        <div className="flex-1 overflow-y-auto pr-4 space-y-3">
          <div className="sticky top-0 bg-gray-900 pb-3 border-b border-gray-700">
            <p className="text-sm text-gray-400">
              {displayedContacts.length} contact{displayedContacts.length !== 1 ? 's' : ''}
            </p>
          </div>

          {displayedContacts.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No contacts found. Start recording conversations to build memory.</p>
            </div>
          ) : (
            displayedContacts.map((contact) => renderContactCard(contact))
          )}
        </div>

        {/* Contact Detail / Conversation History */}
        <div className="flex-1 flex flex-col overflow-hidden border-l border-gray-700 pl-6">
          {state.selectedContact ? (
            <>
              {/* Contact Header */}
              <div className="mb-6 pb-4 border-b border-gray-700">
                <h2 className="text-2xl font-bold text-white mb-1">{state.selectedContact.name}</h2>
                <p className="text-gray-400 mb-3">
                  {state.selectedContact.company && `${state.selectedContact.company} • `}
                  {state.selectedContact.role || 'Unknown role'} • {state.selectedContact.type}
                </p>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Relationship Score</p>
                    {renderScoreGauge(state.selectedContact.relationship_score)}
                  </div>
                  <div>
                    <p className="text-gray-500">Business Value</p>
                    <p className="text-lg font-semibold text-green-400">
                      ${(state.selectedContact.total_business_value || 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Conversation Timeline */}
              <div className="flex-1 overflow-y-auto">
                <h3 className="text-lg font-semibold text-white mb-4">
                  Conversations ({state.selectedContact.total_conversations})
                </h3>

                {state.selectedContact.conversations.length === 0 ? (
                  <p className="text-gray-500">No conversations recorded yet.</p>
                ) : (
                  state.selectedContact.conversations.map((conv) => renderConversation(conv))
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <p>Select a contact to view conversation history</p>
            </div>
          )}
        </div>
      </div>

      {/* Needs Attention Section */}
      {renderNeedsAttention()}
    </div>
  )
}

export default SparkMemoryPanel
