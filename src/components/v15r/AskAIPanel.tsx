// @ts-nocheck
/**
 * AskAIPanel — Shared "Ask AI" slide-in panel for contextual insights.
 * Rule-based analysis — no actual AI API calls.
 * AI suggests, user confirms. No auto-save. No auto-apply.
 */
import { useState } from 'react'
import { Zap, X, Sparkles } from 'lucide-react'

export interface Insight {
  icon: string
  text: string
  severity: 'info' | 'warning' | 'success'
}

interface AskAIPanelProps {
  panelName: string
  insights: Insight[]
  isOpen: boolean
  onClose: () => void
}

export function AskAIPanel({ panelName, insights, isOpen, onClose }: AskAIPanelProps) {
  if (!isOpen) return null

  return (
    <div className="fixed right-0 top-12 bottom-0 w-80 bg-[#0f1117] border-l border-purple-500/30 z-40 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-purple-400" />
          <span className="text-sm font-semibold text-purple-300">NEXUS Analysis</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
          <X size={16} />
        </button>
      </div>

      {/* Context label */}
      <div className="px-4 py-2 bg-purple-500/5 border-b border-gray-800">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">{panelName} Analysis</p>
      </div>

      {/* Insights */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {insights.map((insight, i) => (
          <div key={i} className={`rounded-lg p-3 text-xs border ${
            insight.severity === 'warning' ? 'bg-yellow-500/5 border-yellow-500/20 text-yellow-300' :
            insight.severity === 'success' ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300' :
            'bg-blue-500/5 border-blue-500/20 text-blue-300'
          }`}>
            <span className="mr-1">{insight.icon}</span> {insight.text}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-800 text-[9px] text-gray-600">
        AI suggestions only — review before acting. No changes applied automatically.
      </div>
    </div>
  )
}

export function AskAIButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition-colors"
    >
      <Zap size={12} />
      Ask AI ⚡
    </button>
  )
}
