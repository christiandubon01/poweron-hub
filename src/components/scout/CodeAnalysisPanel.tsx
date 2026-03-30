// @ts-nocheck
/**
 * CodeAnalysisPanel — React component for analyzing legacy code.
 *
 * Features:
 * - Paste code or upload file
 * - Provide context ("What is this code for?")
 * - Analyze via SCOUT's Code Intelligence Layer
 * - View structured migration report
 * - Create proposals for pending features
 *
 * All code is analyzed in memory only; never stored permanently.
 * All suggestions go through user confirmation before creating proposals.
 */

import { useState, useRef } from 'react'
import { Code2, Upload, FileCode, Loader2, CheckCircle, AlertTriangle, ArrowRight } from 'lucide-react'
import { clsx } from 'clsx'
import { analyzeCode, type CodeAnalysisReport, type MigrationFeature } from '@/agents/scout/codeAnalyzer'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/memory/audit'
import { useAuth } from '@/hooks/useAuth'

// ── Component ────────────────────────────────────────────────────────────────

export function CodeAnalysisPanel() {
  const { profile } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [codeInput, setCodeInput]         = useState('')
  const [context, setContext]             = useState('')
  const [analyzing, setAnalyzing]         = useState(false)
  const [report, setReport]               = useState<CodeAnalysisReport | null>(null)
  const [error, setError]                 = useState<string | null>(null)
  const [creatingProposals, setCreatingProposals] = useState(false)
  const [proposalStatus, setProposalStatus] = useState<Record<string, 'pending' | 'creating' | 'done' | 'error'>>({})

  const orgId = profile?.org_id
  const hasCode = codeInput.trim().length > 0
  const hasContext = context.trim().length > 0

  // ── Handle file upload ─────────────────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      setCodeInput(text)
      setError(null)
    } catch (err) {
      setError(`Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }

    // Reset input for re-uploads
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // ── Handle drag and drop ───────────────────────────────────────────────────
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()

    const file = e.dataTransfer.files?.[0]
    if (!file) return

    try {
      const reader = new FileReader()
      reader.onload = (event) => {
        const text = event.target?.result
        if (typeof text === 'string') {
          setCodeInput(text)
          setError(null)
        }
      }
      reader.readAsText(file)
    } catch (err) {
      setError(`Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // ── Analyze code ──────────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!hasCode || !hasContext) {
      setError('Please provide both code and context.')
      return
    }

    if (!orgId) {
      setError('Organization ID not found.')
      return
    }

    setAnalyzing(true)
    setError(null)
    setReport(null)

    try {
      const result = await analyzeCode(codeInput, context)
      setReport(result)

      // Audit the analysis
      try {
        await logAudit({
          action:      'analyze',
          entity_type: 'code_analysis',
          description: `Code analysis: ${result.total_features} features identified, language: ${result.language_detected}`,
          metadata: {
            code_length:     codeInput.length,
            language:        result.language_detected,
            total_features:  result.total_features,
            conflicts:       result.architecture_conflicts.length,
          },
        })
      } catch {
        // Non-critical
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
      console.error('[CodeAnalysisPanel] Analysis error:', err)
    } finally {
      setAnalyzing(false)
    }
  }

  // ── Create proposal for a feature ──────────────────────────────────────────
  const createProposal = async (feature: MigrationFeature) => {
    if (!orgId || !profile) {
      setError('Required profile data missing.')
      return
    }

    const featureKey = `${feature.feature_name}-${feature.priority_order}`
    setProposalStatus(s => ({ ...s, [featureKey]: 'creating' }))

    try {
      const { data, error: insertError } = await supabase
        .from('agent_proposals')
        .insert({
          org_id:          orgId,
          proposing_agent: 'scout',
          title:           `Migrate: ${feature.feature_name}`,
          description:     feature.description,
          category:        'operations',  // Default category for migration tasks
          source_data: {
            migration_feature:    feature.feature_name,
            migration_status:     feature.migration_status,
            risk:                 feature.risk,
            effort:               feature.effort,
            recommended_approach: feature.recommended_approach,
            affected_files:       feature.affected_files,
            code_analysis:        true,
          },
          impact_score:    0.7,  // Default for migrations
          risk_score:      feature.risk === 'Low' ? 0.3 : feature.risk === 'Medium' ? 0.5 : 0.8,
          status:          'proposed',
          mirofish_step:   5,
          mirofish_log:    [],
        })
        .select('id')
        .single()

      if (insertError) {
        throw insertError
      }

      setProposalStatus(s => ({ ...s, [featureKey]: 'done' }))

      // Audit the proposal creation
      try {
        await logAudit({
          action:      'insert',
          entity_type: 'agent_proposals',
          entity_id:   data?.id as string,
          description: `Migration proposal created from code analysis: "${feature.feature_name}"`,
          metadata: {
            feature_name:    feature.feature_name,
            migration_status: feature.migration_status,
            risk:            feature.risk,
            effort:          feature.effort,
          },
        })
      } catch {
        // Non-critical
      }

      // Auto-close after 2 seconds
      setTimeout(() => {
        setProposalStatus(s => {
          const newStatus = { ...s }
          delete newStatus[featureKey]
          return newStatus
        })
      }, 2000)
    } catch (err) {
      console.error('[CodeAnalysisPanel] Proposal creation error:', err)
      setProposalStatus(s => ({ ...s, [featureKey]: 'error' }))
      setError(err instanceof Error ? err.message : 'Failed to create proposal')

      // Reset error status after 3 seconds
      setTimeout(() => {
        setProposalStatus(s => {
          const newStatus = { ...s }
          delete newStatus[featureKey]
          return newStatus
        })
      }, 3000)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-bg-4 bg-bg-1/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-subtle border border-[rgba(255,80,96,0.25)] flex items-center justify-center">
            <Code2 className="w-4 h-4 text-scout" />
          </div>
          <div>
            <div className="text-sm font-bold text-text-1">Code Analysis</div>
            <div className="text-[10px] text-text-3 font-mono">
              Analyze legacy code for migration
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-5 space-y-5">

          {/* Input Section */}
          {!report && (
            <div className="space-y-4">
              {/* Code Input */}
              <div>
                <label className="text-xs font-bold text-text-1 uppercase tracking-wider mb-2 block">
                  Code Input
                </label>

                {/* Upload Area */}
                <div
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  className="relative mb-3 border-2 border-dashed border-bg-4 rounded-lg p-6 transition-colors hover:border-scout/50 cursor-pointer bg-bg-2"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".html,.htm,.js,.ts,.tsx,.jsx,.sql,.cs,.vb"
                    onChange={handleFileUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <div className="flex items-center justify-center gap-3">
                    <Upload className="w-5 h-5 text-text-3" />
                    <div className="text-center">
                      <div className="text-sm font-semibold text-text-2">Drag file here or click to upload</div>
                      <div className="text-xs text-text-3">Supports HTML, JS, TS, SQL, C#, VB.NET</div>
                    </div>
                  </div>
                </div>

                {/* Textarea */}
                <textarea
                  value={codeInput}
                  onChange={e => setCodeInput(e.target.value)}
                  placeholder="Or paste code here..."
                  rows={8}
                  className={clsx(
                    'w-full px-3 py-2 rounded-lg bg-bg-2 border font-mono text-xs text-text-1',
                    'placeholder-text-4 resize-none',
                    'focus:outline-none focus:border-scout transition-colors',
                    codeInput ? 'border-bg-4' : 'border-bg-4'
                  )}
                />
                <div className="text-[10px] text-text-4 mt-1">
                  {codeInput.length} characters
                </div>
              </div>

              {/* Context Input */}
              <div>
                <label className="text-xs font-bold text-text-1 uppercase tracking-wider mb-2 block">
                  Context
                </label>
                <input
                  type="text"
                  value={context}
                  onChange={e => setContext(e.target.value)}
                  placeholder="What is this code for? (e.g., 'Customer Invoice Tracker panel')"
                  className={clsx(
                    'w-full px-3 py-2 rounded-lg bg-bg-2 border font-base text-xs text-text-1',
                    'placeholder-text-4 focus:outline-none focus:border-scout transition-colors',
                    context ? 'border-bg-4' : 'border-bg-4'
                  )}
                />
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-red-subtle border border-[rgba(255,80,96,0.25)]">
                  <AlertTriangle size={16} className="text-red flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-red">{error}</div>
                </div>
              )}

              {/* Analyze Button */}
              <button
                onClick={handleAnalyze}
                disabled={!hasCode || !hasContext || analyzing}
                className={clsx(
                  'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all',
                  !hasCode || !hasContext || analyzing
                    ? 'bg-bg-3 text-text-4 cursor-not-allowed'
                    : 'bg-scout text-bg hover:brightness-110'
                )}
              >
                {analyzing
                  ? <>
                      <Loader2 size={16} className="animate-spin" />
                      Analyzing...
                    </>
                  : <>
                      <Code2 size={16} />
                      Analyze Code
                    </>
                }
              </button>
            </div>
          )}

          {/* Report Section */}
          {report && (
            <div className="space-y-6">
              {/* Summary */}
              <div className="bg-bg-2 border border-bg-4 rounded-lg p-4">
                <div className="text-xs font-bold text-text-3 uppercase tracking-wider mb-2">Summary</div>
                <div className="text-sm text-text-1 leading-relaxed">{report.summary}</div>
                <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-bg-4">
                  <div>
                    <div className="text-[10px] text-text-4">Language</div>
                    <div className="text-xs font-semibold text-text-1 uppercase">{report.language_detected}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-text-4">Features</div>
                    <div className="text-xs font-semibold text-text-1">{report.total_features}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-text-4">Conflicts</div>
                    <div className="text-xs font-semibold text-text-1">{report.architecture_conflicts.length}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-text-4">Analyzed</div>
                    <div className="text-xs font-semibold text-text-1">{new Date(report.analyzedAt).toLocaleTimeString()}</div>
                  </div>
                </div>
              </div>

              {/* Features Table */}
              {report.total_features > 0 && (
                <div>
                  <div className="text-xs font-bold text-text-1 uppercase tracking-wider mb-3">Migration Features</div>
                  <div className="overflow-x-auto border border-bg-4 rounded-lg">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-bg-2 border-b border-bg-4">
                          <th className="px-3 py-2 text-left font-bold text-text-1">Feature</th>
                          <th className="px-3 py-2 text-left font-bold text-text-1">Status</th>
                          <th className="px-3 py-2 text-left font-bold text-text-1">Risk</th>
                          <th className="px-3 py-2 text-left font-bold text-text-1">Effort</th>
                          <th className="px-3 py-2 text-left font-bold text-text-1">Priority</th>
                          <th className="px-3 py-2 text-left font-bold text-text-1">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.features.map((feat, i) => {
                          const featureKey = `${feat.feature_name}-${feat.priority_order}`
                          const status = proposalStatus[featureKey]

                          return (
                            <tr key={i} className="border-b border-bg-4 hover:bg-bg-2 transition-colors">
                              <td className="px-3 py-2 text-text-1 font-semibold">{feat.feature_name}</td>
                              <td className="px-3 py-2">
                                <span
                                  className={clsx(
                                    'inline-block px-2 py-1 rounded text-[10px] font-bold uppercase',
                                    feat.migration_status === 'done'
                                      ? 'bg-green-subtle text-green'
                                      : feat.migration_status === 'pending'
                                        ? 'bg-gold-subtle text-gold'
                                        : 'bg-red-subtle text-red'
                                  )}
                                >
                                  {feat.migration_status}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={clsx(
                                    'text-[10px] font-bold',
                                    feat.risk === 'Low'
                                      ? 'text-green'
                                      : feat.risk === 'Medium'
                                        ? 'text-gold'
                                        : 'text-red'
                                  )}
                                >
                                  {feat.risk}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-text-2">{feat.effort}</td>
                              <td className="px-3 py-2 text-text-2 font-mono">#{feat.priority_order}</td>
                              <td className="px-3 py-2">
                                {feat.migration_status === 'pending' && !status ? (
                                  <button
                                    onClick={() => createProposal(feat)}
                                    className="text-scout hover:text-scout/80 font-bold transition-colors flex items-center gap-1"
                                  >
                                    <ArrowRight size={12} />
                                    Propose
                                  </button>
                                ) : status === 'creating' ? (
                                  <div className="flex items-center gap-1 text-text-3">
                                    <Loader2 size={12} className="animate-spin" />
                                    Creating...
                                  </div>
                                ) : status === 'done' ? (
                                  <div className="flex items-center gap-1 text-green">
                                    <CheckCircle size={12} />
                                    Created
                                  </div>
                                ) : status === 'error' ? (
                                  <div className="flex items-center gap-1 text-red text-[10px]">
                                    <AlertTriangle size={12} />
                                    Error
                                  </div>
                                ) : null}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Architecture Conflicts */}
              {report.architecture_conflicts.length > 0 && (
                <div className="bg-red-subtle/50 border border-[rgba(255,80,96,0.25)] rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={18} className="text-red flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-bold text-red uppercase tracking-wider mb-2">Architecture Conflicts</div>
                      <ul className="space-y-1">
                        {report.architecture_conflicts.map((conflict, i) => (
                          <li key={i} className="text-xs text-text-1 leading-relaxed">• {conflict}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Recommended Migration Order */}
              {report.recommended_migration_order.length > 0 && (
                <div>
                  <div className="text-xs font-bold text-text-1 uppercase tracking-wider mb-3">Recommended Migration Order</div>
                  <ol className="space-y-2">
                    {report.recommended_migration_order.map((feature, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-scout/10 border border-scout/25 flex items-center justify-center text-[10px] font-bold text-scout">
                          {i + 1}
                        </span>
                        <span className="text-xs text-text-1 pt-0.5">{feature}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setReport(null)
                    setCodeInput('')
                    setContext('')
                  }}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-bg-2 border border-bg-4 text-xs font-bold text-text-1 hover:bg-bg-3 transition-colors"
                >
                  New Analysis
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
