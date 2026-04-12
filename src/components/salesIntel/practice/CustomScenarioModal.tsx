/**
 * CustomScenarioModal.tsx
 * Modal for custom scenario/character description
 *
 * Features:
 *   - Large text area for scenario description
 *   - Recent custom scenarios (last 5 from localStorage)
 *   - HUNTER Lead dropdown to pull context
 *   - Submit to start practice with custom scenario
 */

import { useState, useEffect } from 'react'
import { X, Zap, Search, ArrowRight, Save } from 'lucide-react'
import clsx from 'clsx'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface RecentScenario {
  id: string
  description: string
  characterName: string
  savedAt: Date
}

interface HUNTERLead {
  id: string
  name: string
  company?: string
  objections?: string[]
  notes?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────────────────────────────

const RECENT_SCENARIOS_KEY = 'poweron-practice-recent-scenarios'

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions for localStorage
// ─────────────────────────────────────────────────────────────────────────────

function getRecentScenarios(): RecentScenario[] {
  try {
    const stored = localStorage.getItem(RECENT_SCENARIOS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveRecentScenario(scenario: RecentScenario) {
  try {
    const recent = getRecentScenarios()
    // Add new scenario to front, keep last 5
    const updated = [scenario, ...recent].slice(0, 5)
    localStorage.setItem(RECENT_SCENARIOS_KEY, JSON.stringify(updated))
  } catch (e) {
    console.warn('Failed to save recent scenario:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock HUNTER leads (in production: fetch from API/state)
// ─────────────────────────────────────────────────────────────────────────────

function getMockHUNTERLeads(): HUNTERLead[] {
  return [
    {
      id: 'hunter-1',
      name: 'ABC Properties LLC',
      company: 'ABC Properties',
      objections: ['Price', 'Timeline concerns'],
      notes: 'Manages 40 units in Palm Springs. Budget conscious but quality-focused.',
    },
    {
      id: 'hunter-2',
      name: 'XYZ Construction',
      company: 'XYZ Construction',
      objections: ['Already has vendor relationships', 'Price shopping'],
      notes: 'General contractor. Always comparing bids. Appreciates fast turnaround.',
    },
    {
      id: 'hunter-3',
      name: 'John Smith',
      company: 'Smith Electrical Services',
      objections: ['Competes directly', 'Licensing questions'],
      notes: 'Subcontractor in local area. Skeptical of outside competition.',
    },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// CustomScenarioModal Component
// ─────────────────────────────────────────────────────────────────────────────

export function CustomScenarioModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (scenario: string, characterName: string, characterDesc: string) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'custom' | 'hunter' | 'recent'>('custom')
  const [customScenario, setCustomScenario] = useState('')
  const [customCharacterName, setCustomCharacterName] = useState('')
  const [selectedHUNTERLead, setSelectedHUNTERLead] = useState<HUNTERLead | null>(null)
  const [selectedRecent, setSelectedRecent] = useState<RecentScenario | null>(null)
  const [hunterLeads, setHunterLeads] = useState<HUNTERLead[]>([])
  const [recentScenarios, setRecentScenarios] = useState<RecentScenario[]>([])
  const [submitting, setSubmitting] = useState(false)

  // Load HUNTER leads and recent scenarios
  useEffect(() => {
    setHunterLeads(getMockHUNTERLeads())
    setRecentScenarios(getRecentScenarios())
  }, [])

  // Handle HUNTER lead selection
  const handleSelectHUNTERLead = (lead: HUNTERLead) => {
    setSelectedHUNTERLead(lead)
    // Pre-fill scenario with lead context
    const context = `
Lead: ${lead.name} (${lead.company || 'N/A'})
Objections: ${lead.objections?.join(', ') || 'None'}
Context: ${lead.notes || 'Standard call'}

Play this character realistically based on their concerns and background.
`.trim()
    setCustomScenario(context)
    setCustomCharacterName(lead.name)
  }

  // Handle custom scenario submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customScenario.trim() || !customCharacterName.trim()) {
      alert('Please provide both character name and scenario description.')
      return
    }

    setSubmitting(true)

    // Save to recent
    const newScenario: RecentScenario = {
      id: `scenario-${Date.now()}`,
      description: customScenario,
      characterName: customCharacterName,
      savedAt: new Date(),
    }
    saveRecentScenario(newScenario)

    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 500))

    onSubmit(customScenario, customCharacterName, `Custom scenario: ${customCharacterName}`)
    setSubmitting(false)
  }

  // Handle recent scenario selection
  const handleSelectRecent = (scenario: RecentScenario) => {
    setSelectedRecent(scenario)
    setCustomScenario(scenario.description)
    setCustomCharacterName(scenario.characterName)
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between bg-zinc-800 px-6 py-4 border-b border-zinc-700">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Zap size={20} className="text-blue-400" />
            Custom Practice Scenario
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 bg-zinc-950 px-6">
          <button
            onClick={() => setTab('custom')}
            className={clsx(
              'px-4 py-3 font-medium text-sm transition-colors border-b-2',
              tab === 'custom'
                ? 'text-blue-400 border-blue-500'
                : 'text-zinc-500 border-transparent hover:text-zinc-300'
            )}
          >
            Custom
          </button>
          <button
            onClick={() => setTab('hunter')}
            className={clsx(
              'px-4 py-3 font-medium text-sm transition-colors border-b-2',
              tab === 'hunter'
                ? 'text-blue-400 border-blue-500'
                : 'text-zinc-500 border-transparent hover:text-zinc-300'
            )}
          >
            HUNTER Lead
          </button>
          {recentScenarios.length > 0 && (
            <button
              onClick={() => setTab('recent')}
              className={clsx(
                'px-4 py-3 font-medium text-sm transition-colors border-b-2',
                tab === 'recent'
                  ? 'text-blue-400 border-blue-500'
                  : 'text-zinc-500 border-transparent hover:text-zinc-300'
              )}
            >
              Recent ({recentScenarios.length})
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Custom Tab */}
          {tab === 'custom' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-white mb-2">Character Name</label>
                <input
                  type="text"
                  value={customCharacterName}
                  onChange={e => setCustomCharacterName(e.target.value)}
                  placeholder="e.g., Skeptical Property Manager"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-white mb-2">Scenario Description *</label>
                <p className="text-xs text-zinc-400 mb-2">
                  Describe the character, their personality, situation, and what objections they might have.
                </p>
                <textarea
                  value={customScenario}
                  onChange={e => setCustomScenario(e.target.value)}
                  placeholder="Example: Play a skeptical property manager in Palm Springs who manages 40 units and thinks you're too expensive. They've worked with your competitor before and weren't impressed. They're looking for quick turnaround but always shop around on price."
                  className="w-full h-48 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 resize-none font-mono text-sm"
                />
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <p className="text-xs text-blue-300">
                  💡 <strong>Tip:</strong> Be specific about personality, budget constraints, timeline, and specific objections you want to practice handling.
                </p>
              </div>
            </form>
          )}

          {/* HUNTER Lead Tab */}
          {tab === 'hunter' && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">
                Select a lead from your HUNTER pipeline to practice with their real context and objections.
              </p>

              {hunterLeads.length === 0 ? (
                <div className="text-center py-8">
                  <Search size={32} className="text-zinc-600 mx-auto mb-2" />
                  <p className="text-zinc-500">No HUNTER leads available yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {hunterLeads.map(lead => (
                    <button
                      key={lead.id}
                      onClick={() => handleSelectHUNTERLead(lead)}
                      className={clsx(
                        'w-full text-left p-3 rounded-lg border-2 transition-all',
                        selectedHUNTERLead?.id === lead.id
                          ? 'bg-blue-500/20 border-blue-500'
                          : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-semibold text-white">{lead.name}</p>
                          {lead.company && <p className="text-xs text-zinc-400">{lead.company}</p>}
                          {lead.objections && lead.objections.length > 0 && (
                            <p className="text-xs text-orange-400 mt-1">
                              Objections: {lead.objections.join(', ')}
                            </p>
                          )}
                        </div>
                        <ArrowRight size={16} className="text-zinc-500 mt-1 shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {selectedHUNTERLead && (
                <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3">
                  <p className="text-xs text-zinc-400 mb-2">Context will be auto-filled below:</p>
                  <p className="text-sm text-zinc-300 font-mono whitespace-pre-wrap break-words">
                    {customScenario}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Recent Tab */}
          {tab === 'recent' && recentScenarios.length > 0 && (
            <div className="space-y-2">
              {recentScenarios.map(scenario => (
                <button
                  key={scenario.id}
                  onClick={() => handleSelectRecent(scenario)}
                  className={clsx(
                    'w-full text-left p-3 rounded-lg border-2 transition-all',
                    selectedRecent?.id === scenario.id
                      ? 'bg-green-500/20 border-green-500'
                      : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-semibold text-white">{scenario.characterName}</p>
                      <p className="text-xs text-zinc-400 mt-1">
                        {scenario.description.substring(0, 60)}...
                      </p>
                      <p className="text-xs text-zinc-500 mt-1">
                        Saved {new Date(scenario.savedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Save size={16} className="text-zinc-500 mt-1 shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 bg-zinc-950 px-6 py-4 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!customScenario.trim() || !customCharacterName.trim() || submitting}
            className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition-colors font-semibold flex items-center gap-2"
          >
            {submitting ? (
              <>
                <span className="animate-spin">⏳</span>
                Creating...
              </>
            ) : (
              <>
                <Zap size={16} />
                Create Scenario
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
