/**
 * SparkOnDemandPanel.tsx — Phase E SPARK On-Demand UI
 *
 * React component for the on-demand interface
 * - Top 3 recommendations as tappable cards
 * - Quick drill buttons (filler, pitch, objection, price)
 * - Review selector (list of recent conversations)
 * - Pipeline health summary
 */

// @ts-nocheck

import { useState, useEffect } from 'react'
import {
  Zap,
  Flame,
  Target,
  BarChart3,
  CheckCircle2,
  Clock,
  MessageSquare,
  Mic,
  TrendingUp,
  Loader2,
  AlertCircle,
  ChevronRight,
  Play,
  Settings,
  RefreshCw,
} from 'lucide-react'
import clsx from 'clsx'
import {
  handleSparkActivation,
  generateSuggestions,
  createFillerWordDrill,
  createElevatorPitchDrill,
  createObjectionDrill,
  createPriceDefenseDrill,
  analyzePipeline,
  type Suggestion,
  type PracticeDrill,
  type SparkOnDemandResponse,
  type PipelineMetrics,
} from '@/services/sparkLiveCall/SparkOnDemand'

// ── Types ────────────────────────────────────────────────────────────────────

type TabView = 'suggestions' | 'drills' | 'review' | 'analytics'

// ── Priority Colors ─────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<Suggestion['priority'], string> = {
  overdue: 'bg-red-500/15 text-red-400 border-red-500/30',
  pending: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  practice: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  outbound: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  optimize: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  drill: 'bg-green-500/15 text-green-400 border-green-500/30',
}

const PRIORITY_ICONS: Record<Suggestion['priority'], React.ReactNode> = {
  overdue: <AlertCircle size={16} />,
  pending: <Clock size={16} />,
  practice: <TrendingUp size={16} />,
  outbound: <Target size={16} />,
  optimize: <BarChart3 size={16} />,
  drill: <Flame size={16} />,
}

// ── Pipeline Health Summary ──────────────────────────────────────────────────

function PipelineHealthCard({ metrics }: { metrics: PipelineMetrics }) {
  const healthScore = Math.min(
    100,
    (metrics.pendingActionItems + metrics.overdueDueCallbacks) * 15
  )
  const healthColor =
    healthScore > 70 ? 'text-red-400' : healthScore > 40 ? 'text-yellow-400' : 'text-green-400'

  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-zinc-300">Pipeline Health</h3>
        <BarChart3 size={16} className="text-zinc-500" />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">Overdue callbacks</span>
          <span className={clsx('text-sm font-bold', healthColor)}>
            {metrics.overdueDueCallbacks}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">Pending items</span>
          <span className={clsx('text-sm font-bold', healthColor)}>
            {metrics.pendingActionItems}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">Recent call score</span>
          <span className="text-sm font-bold text-blue-400">{metrics.recentCallScore}/10</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">Sub Script converting</span>
          <span className="text-sm font-bold text-cyan-400">{metrics.subScriptConverting}%</span>
        </div>

        <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mt-3">
          <div
            className={clsx('h-full transition-all', healthColor.replace('text-', 'bg-'))}
            style={{ width: `${Math.min(healthScore, 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ── Recommendation Card ──────────────────────────────────────────────────────

function SuggestionCard({
  suggestion,
  onSelect,
  isSelected,
}: {
  suggestion: Suggestion
  onSelect: (s: Suggestion) => void
  isSelected: boolean
}) {
  return (
    <div
      onClick={() => onSelect(suggestion)}
      className={clsx(
        'p-4 rounded-lg border cursor-pointer transition-all',
        isSelected
          ? 'bg-zinc-900/80 border-blue-500/50 ring-2 ring-blue-500/30'
          : 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-900/60 hover:border-zinc-700'
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              'px-2 py-1 rounded text-xs font-medium border',
              PRIORITY_COLORS[suggestion.priority]
            )}
          >
            <span className="flex items-center gap-1">
              {PRIORITY_ICONS[suggestion.priority]}
              {suggestion.priority.charAt(0).toUpperCase() + suggestion.priority.slice(1)}
            </span>
          </span>
          <span className="text-xs font-bold text-zinc-400">#{suggestion.rank}</span>
        </div>
        <span className="text-xs font-bold text-yellow-400">{suggestion.roiScore.toFixed(2)} ROI</span>
      </div>

      <h4 className="font-semibold text-zinc-200 mb-1">{suggestion.title}</h4>
      <p className="text-sm text-zinc-400 mb-3">{suggestion.description}</p>

      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-500">
          <span className="mr-3">⏱️ {suggestion.timeRequired}</span>
          {suggestion.estimatedValue && <span>💰 {suggestion.estimatedValue}</span>}
        </div>
        <button className="text-xs px-2 py-1 bg-blue-600/30 border border-blue-500/50 text-blue-400 rounded hover:bg-blue-600/50 transition-all flex items-center gap-1">
          {suggestion.actionLabel}
          <ChevronRight size={12} />
        </button>
      </div>
    </div>
  )
}

// ── Practice Drill Card ──────────────────────────────────────────────────────

function PracticeDrillCard({
  drill,
  onStart,
}: {
  drill: PracticeDrill
  onStart: (drill: PracticeDrill) => void
}) {
  const drillLabels = {
    filler: 'Filler Word Drill',
    pitch: 'Elevator Pitch',
    objection: 'Objection Rapid-Fire',
    price: 'Price Defense',
  }

  const drillIcons = {
    filler: <Mic size={20} />,
    pitch: <MessageSquare size={20} />,
    objection: <AlertCircle size={20} />,
    price: <Flame size={20} />,
  }

  const drillColors = {
    filler: 'from-green-500/10 to-green-600/5 border-green-500/30',
    pitch: 'from-blue-500/10 to-blue-600/5 border-blue-500/30',
    objection: 'from-orange-500/10 to-orange-600/5 border-orange-500/30',
    price: 'from-red-500/10 to-red-600/5 border-red-500/30',
  }

  return (
    <div
      className={clsx(
        'p-4 rounded-lg border bg-gradient-to-br cursor-pointer hover:bg-opacity-80 transition-all',
        drillColors[drill.type]
      )}
      onClick={() => onStart(drill)}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="text-zinc-300">{drillIcons[drill.type]}</div>
          <h4 className="font-semibold text-zinc-200">{drillLabels[drill.type]}</h4>
        </div>
        <span className="text-xs px-2 py-1 bg-zinc-800/50 text-zinc-400 rounded">
          ⏱️ {drill.duration}s
        </span>
      </div>

      <p className="text-sm text-zinc-400 mb-3">{drill.prompt}</p>

      {drill.scoring && drill.scoring.length > 0 && (
        <div className="space-y-2 mb-3">
          {drill.scoring.slice(0, 2).map((score, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">{score.metric}</span>
              <span className="font-bold text-zinc-300">{score.value}/10</span>
            </div>
          ))}
        </div>
      )}

      <button className="w-full py-2 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-200 rounded border border-zinc-700 text-sm font-medium transition-all flex items-center justify-center gap-2">
        <Play size={14} /> Start Drill
      </button>
    </div>
  )
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export function SparkOnDemandPanel() {
  const [activeTab, setActiveTab] = useState<TabView>('suggestions')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion | null>(null)
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        const [sugg, metr] = await Promise.all([generateSuggestions(), analyzePipeline()])
        setSuggestions(sugg)
        setSelectedSuggestion(sugg[0] || null)
        setMetrics(metr)
      } catch (err) {
        setError('Failed to load SPARK data')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const handleActivation = async (input: string) => {
    try {
      setLoading(true)
      const response = await handleSparkActivation(input)
      setSuggestions(response.suggestions)
      setSelectedSuggestion(response.selectedSuggestion || null)
    } catch (err) {
      setError('Failed to process SPARK request')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading && !metrics) {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 size={32} className="text-blue-400 animate-spin mx-auto mb-3" />
          <p className="text-zinc-400">Loading SPARK...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-zinc-950 to-zinc-900">
      {/* Header ─────────────────────────────────────────────────────────────────*/}
      <div className="sticky top-0 z-10 bg-zinc-950/80 backdrop-blur border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600/20 rounded-lg">
              <Zap size={20} className="text-blue-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-zinc-100">SPARK On-Demand</h1>
              <p className="text-xs text-zinc-500">Smart suggestions for your downtime</p>
            </div>
          </div>
        </div>

        {/* Tab Navigation ──────────────────────────────────────────────────────*/}
        <div className="flex gap-1 border-b border-zinc-800 -mx-6 px-6">
          {(['suggestions', 'drills', 'review', 'analytics'] as TabView[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                'px-3 py-2 text-xs font-medium border-b-2 transition-all',
                activeTab === tab
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-400'
              )}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Content ─────────────────────────────────────────────────────────────────*/}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4 flex items-start gap-3">
            <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-400">{error}</p>
            </div>
          </div>
        )}

        {/* Suggestions Tab ──────────────────────────────────────────────────────*/}
        {activeTab === 'suggestions' && (
          <div>
            {metrics && <PipelineHealthCard metrics={metrics} />}

            <h2 className="text-sm font-semibold text-zinc-300 mb-3">Top 3 Recommendations</h2>
            <div className="space-y-3">
              {suggestions.map((sugg) => (
                <SuggestionCard
                  key={sugg.rank}
                  suggestion={sugg}
                  onSelect={setSelectedSuggestion}
                  isSelected={selectedSuggestion?.rank === sugg.rank}
                />
              ))}
            </div>

            {selectedSuggestion && (
              <div className="mt-6 p-4 bg-blue-600/10 border border-blue-500/30 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 size={16} className="text-blue-400" />
                  <h4 className="font-semibold text-blue-300">Next Action</h4>
                </div>
                <p className="text-sm text-blue-200 mb-3">{selectedSuggestion.description}</p>
                <button className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-sm transition-all">
                  {selectedSuggestion.actionLabel} →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Drills Tab ───────────────────────────────────────────────────────────*/}
        {activeTab === 'drills' && (
          <div>
            <h2 className="text-sm font-semibold text-zinc-300 mb-4">2-Minute Field Practice</h2>
            <div className="space-y-4">
              <PracticeDrillCard
                drill={createFillerWordDrill()}
                onStart={() => alert('Starting filler word drill...')}
              />
              <PracticeDrillCard
                drill={createElevatorPitchDrill()}
                onStart={() => alert('Starting elevator pitch drill...')}
              />
              <PracticeDrillCard
                drill={createObjectionDrill()}
                onStart={() => alert('Starting objection drill...')}
              />
              <PracticeDrillCard
                drill={createPriceDefenseDrill()}
                onStart={() => alert('Starting price defense drill...')}
              />
            </div>
          </div>
        )}

        {/* Review Tab ──────────────────────────────────────────────────────────*/}
        {activeTab === 'review' && (
          <div>
            <h2 className="text-sm font-semibold text-zinc-300 mb-4">Call Review</h2>
            <div className="space-y-3">
              <input
                type="text"
                placeholder='Say "SPARK, analyze call with Martinez"'
                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500/50"
              />
              <button className="w-full py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/50 text-blue-400 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2">
                <MessageSquare size={14} /> Analyze Call
              </button>
            </div>

            <div className="mt-6 p-4 bg-zinc-900/40 border border-zinc-800 rounded-lg">
              <p className="text-xs text-zinc-500 text-center">Recent calls will appear here</p>
            </div>
          </div>
        )}

        {/* Analytics Tab ───────────────────────────────────────────────────────*/}
        {activeTab === 'analytics' && (
          <div>
            <h2 className="text-sm font-semibold text-zinc-300 mb-4">Pipeline Analytics</h2>

            {metrics && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg">
                    <p className="text-xs text-zinc-500 mb-1">This Week Revenue</p>
                    <p className="text-lg font-bold text-green-400">$28,500</p>
                    <p className="text-xs text-zinc-600 mt-1">↑ 12% vs last week</p>
                  </div>
                  <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg">
                    <p className="text-xs text-zinc-500 mb-1">Closing Rate</p>
                    <p className="text-lg font-bold text-blue-400">72%</p>
                    <p className="text-xs text-zinc-600 mt-1">↑ 5% improvement</p>
                  </div>
                  <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg">
                    <p className="text-xs text-zinc-500 mb-1">Calls This Month</p>
                    <p className="text-lg font-bold text-purple-400">34</p>
                    <p className="text-xs text-zinc-600 mt-1">On pace for 136/yr</p>
                  </div>
                  <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg">
                    <p className="text-xs text-zinc-500 mb-1">Avg Deal Value</p>
                    <p className="text-lg font-bold text-orange-400">$5,200</p>
                    <p className="text-xs text-zinc-600 mt-1">↑ 8% vs average</p>
                  </div>
                </div>

                <button className="w-full py-2 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2">
                  <RefreshCw size={14} /> Refresh Data
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default SparkOnDemandPanel
