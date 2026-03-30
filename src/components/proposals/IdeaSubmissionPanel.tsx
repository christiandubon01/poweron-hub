// @ts-nocheck
/**
 * IdeaSubmissionPanel — User interface for submitting improvement ideas.
 *
 * Allows users to describe an idea, select a category, and submit it to SCOUT
 * for analysis. Shows results as integration options that can be converted
 * into proposals.
 */

import { useState } from 'react'
import { Lightbulb, Send, Loader2, CheckCircle, AlertTriangle, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/hooks/useAuth'
import { analyzeUserIdea, type IdeaAnalysis, type IntegrationOption } from '@/agents/scout'

// ── Types ────────────────────────────────────────────────────────────────────

type IdeaCategory = 'Operations' | 'Financial' | 'Compliance' | 'Estimating' | 'Scheduling' | 'Other'

interface SubmissionState {
  idea: string
  category: IdeaCategory
  isSubmitting: boolean
  error: string | null
  analysis: IdeaAnalysis | null
  proposalIds: string[]
}

// ── Component ────────────────────────────────────────────────────────────────

export function IdeaSubmissionPanel() {
  const { profile } = useAuth()
  const [state, setState] = useState<SubmissionState>({
    idea:          '',
    category:      'Operations',
    isSubmitting:  false,
    error:         null,
    analysis:      null,
    proposalIds:   [],
  })

  const orgId = profile?.org_id
  const email = profile?.email

  // ── Submit idea ────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!orgId || !email) {
      setState(prev => ({ ...prev, error: 'Unable to identify user or organization' }))
      return
    }

    if (!state.idea.trim()) {
      setState(prev => ({ ...prev, error: 'Please describe your idea' }))
      return
    }

    setState(prev => ({ ...prev, isSubmitting: true, error: null }))

    try {
      const result = await analyzeUserIdea(
        state.idea.trim(),
        email,
        orgId,
        state.category
      )

      setState(prev => ({
        ...prev,
        isSubmitting:  false,
        analysis:      result.analysis,
        proposalIds:   result.proposalIds,
        idea:          '',  // Clear form after successful submission
      }))
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to analyze idea'
      console.error('[IdeaSubmissionPanel] Error:', err)
      setState(prev => ({
        ...prev,
        isSubmitting: false,
        error:        errorMsg,
      }))
    }
  }

  // ── Reset state ────────────────────────────────────────────────────────
  const handleReset = () => {
    setState({
      idea:          '',
      category:      'Operations',
      isSubmitting:  false,
      error:         null,
      analysis:      null,
      proposalIds:   [],
    })
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-cyan-subtle border border-[rgba(34,211,238,0.25)] flex items-center justify-center">
            <Lightbulb className="w-5 h-5 text-cyan" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-text-1">Submit an Idea</h2>
            <p className="text-xs text-text-3">Help improve PowerOn Hub by sharing your suggestions</p>
          </div>
        </div>
      </div>

      {/* Analysis Results */}
      {state.analysis && (
        <div className="mb-6 space-y-4">
          {/* Summary Card */}
          <div className="px-4 py-3 rounded-lg bg-bg-2 border border-cyan/20">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="w-4 h-4 text-green" />
                  <span className="text-xs font-bold text-text-1">Analysis Complete</span>
                </div>
                <p className="text-xs text-text-2">{state.analysis.summary}</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-cyan">{state.analysis.feasibility_score}</div>
                <div className="text-[10px] text-text-3">Feasibility</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-bg-3">
              <div>
                <div className="text-[10px] text-text-4 uppercase tracking-wider mb-1">Category</div>
                <div className="text-xs font-semibold text-text-1">{state.analysis.category}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-4 uppercase tracking-wider mb-1">Options</div>
                <div className="text-xs font-semibold text-text-1">{state.analysis.options.length}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-4 uppercase tracking-wider mb-1">Proposed</div>
                <div className="text-xs font-semibold text-green">{state.proposalIds.length}</div>
              </div>
            </div>
          </div>

          {/* Integration Options */}
          <div className="space-y-3">
            {state.analysis.options.map((option, idx) => (
              <IntegrationOptionCard
                key={idx}
                option={option}
                index={idx}
                isPassed={state.proposalIds.length > idx}
              />
            ))}
          </div>

          {/* Reset Button */}
          <div className="flex justify-center pt-4">
            <button
              onClick={handleReset}
              className="px-4 py-2 rounded-lg bg-bg-2 hover:bg-bg-3 text-text-2 hover:text-text-1 text-xs font-semibold transition-colors"
            >
              Submit Another Idea
            </button>
          </div>
        </div>
      )}

      {/* Submission Form */}
      {!state.analysis && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Error Message */}
          {state.error && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-red-subtle border border-[rgba(255,80,96,0.25)]">
              <AlertTriangle className="w-4 h-4 text-red flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs text-red font-semibold">{state.error}</p>
              </div>
              <button
                type="button"
                onClick={() => setState(prev => ({ ...prev, error: null }))}
                className="text-red hover:text-red/80 flex-shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Idea Textarea */}
          <div>
            <label className="block text-xs font-bold text-text-1 mb-2">Your Idea</label>
            <textarea
              value={state.idea}
              onChange={e => setState(prev => ({ ...prev, idea: e.target.value }))}
              placeholder="Describe your improvement idea for PowerOn Hub. Be specific about what problem you're solving or what opportunity you see..."
              className={clsx(
                'w-full px-3 py-3 rounded-lg bg-bg-2 border text-xs text-text-1 placeholder:text-text-4',
                'focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan/50',
                state.error ? 'border-red/50' : 'border-bg-4'
              )}
              rows={5}
              disabled={state.isSubmitting}
            />
            <div className="mt-1 text-[10px] text-text-4">
              {state.idea.length} characters
            </div>
          </div>

          {/* Category Dropdown */}
          <div>
            <label className="block text-xs font-bold text-text-1 mb-2">Category</label>
            <select
              value={state.category}
              onChange={e => setState(prev => ({ ...prev, category: e.target.value as IdeaCategory }))}
              className={clsx(
                'w-full px-3 py-2 rounded-lg bg-bg-2 border border-bg-4 text-xs text-text-1',
                'focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan/50',
                'appearance-none cursor-pointer'
              )}
              disabled={state.isSubmitting}
            >
              <option value="Operations">Operations</option>
              <option value="Financial">Financial</option>
              <option value="Compliance">Compliance</option>
              <option value="Estimating">Estimating</option>
              <option value="Scheduling">Scheduling</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {/* Submit Button */}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={state.isSubmitting || !state.idea.trim()}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold text-xs transition-all',
                state.isSubmitting || !state.idea.trim()
                  ? 'bg-bg-3 text-text-4 cursor-not-allowed'
                  : 'bg-cyan text-bg hover:brightness-110'
              )}
            >
              {state.isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Send size={14} />
                  Analyze Idea
                </>
              )}
            </button>
          </div>

          {/* Help Text */}
          <div className="text-[10px] text-text-3 space-y-1 pt-2">
            <p>
              💡 <strong>Tip:</strong> Be specific. Instead of "improve scheduling," try "Add buffer time between jobs for crew breaks and transition time."
            </p>
            <p>
              🔍 SCOUT will analyze your idea against the PowerOn Hub architecture and suggest integration points.
            </p>
          </div>
        </form>
      )}
    </div>
  )
}

// ── Integration Option Card ────────────────────────────────────────────────

function IntegrationOptionCard({
  option,
  index,
  isPassed,
}: {
  option: IntegrationOption
  index: number
  isPassed: boolean
}) {
  return (
    <div className={clsx(
      'px-4 py-3 rounded-lg border',
      isPassed
        ? 'bg-bg-2 border-green/20'
        : 'bg-bg-2 border-bg-4'
    )}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-text-1">Option {index + 1}</span>
            {isPassed && <CheckCircle className="w-3.5 h-3.5 text-green" />}
          </div>
          <p className="text-xs text-text-2 leading-relaxed">{option.description}</p>
        </div>
      </div>

      {/* Business Impact */}
      <div className="mb-3 px-3 py-2 rounded bg-bg-3 border border-bg-4">
        <div className="text-[10px] text-text-4 uppercase tracking-wider mb-1">Business Impact</div>
        <p className="text-xs text-text-2">{option.business_impact}</p>
      </div>

      {/* Affected Agents & Files */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-[10px] text-text-4 uppercase tracking-wider mb-2">Affected Agents</div>
          <div className="flex flex-wrap gap-1.5">
            {option.affected_agents.map((agent, i) => (
              <span
                key={i}
                className="px-2 py-1 rounded-full text-[10px] font-semibold bg-cyan/10 text-cyan border border-cyan/20"
              >
                {agent}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[10px] text-text-4 uppercase tracking-wider mb-2">Effort · Risk</div>
          <div className="flex gap-2">
            <span className={clsx(
              'px-2 py-1 rounded-full text-[10px] font-semibold border',
              option.effort === 'Low'
                ? 'bg-green/10 text-green border-green/20'
                : option.effort === 'Medium'
                ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                : 'bg-red/10 text-red border-red/20'
            )}>
              {option.effort}
            </span>
            <span className={clsx(
              'px-2 py-1 rounded-full text-[10px] font-semibold border',
              option.risk === 'Low'
                ? 'bg-green/10 text-green border-green/20'
                : option.risk === 'Medium'
                ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                : 'bg-red/10 text-red border-red/20'
            )}>
              {option.risk}
            </span>
          </div>
        </div>
      </div>

      {/* Affected Files */}
      <div>
        <div className="text-[10px] text-text-4 uppercase tracking-wider mb-1.5">Affected Files</div>
        <div className="flex flex-wrap gap-1">
          {option.affected_files.map((file, i) => (
            <span
              key={i}
              className="px-2 py-1 text-[9px] font-mono bg-bg-3 text-text-3 border border-bg-4 rounded"
            >
              {file}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
