// @ts-nocheck
/**
 * SolarTrainingView.tsx
 * INT-1 — Solar Income & Training center.
 *
 * Combines solar training components:
 *   - SolarQuizCard    (SOL1 — quiz engine, loads mock question on mount)
 *   - NEM3Visualizer   (SOL2 — NEM 3.0 savings visualizer)
 *   - SolarRetentionHeatmap (SOL3 — retention/progress heatmap)
 *
 * Services: SolarCurriculumSequencer, SolarQuizEngine, SolarNEM3Calculator
 */

import React, { useState, useEffect } from 'react'
import NEM3Visualizer from '@/components/solarTraining/NEM3Visualizer'
import { SolarRetentionHeatmap } from '@/components/solarTraining/SolarRetentionHeatmap'
import { getSolarQuizEngine } from '@/services/solarTraining/SolarQuizEngine'
import type { QuizQuestion } from '@/services/solarTraining/SolarQuizEngine'
import { SolarQuizCard } from '@/components/solarTraining/SolarQuizCard'

type SolarTab = 'quiz' | 'nem3' | 'retention'

const TABS: { id: SolarTab; label: string; emoji: string }[] = [
  { id: 'quiz',      label: 'Solar Quiz',    emoji: '⚡' },
  { id: 'nem3',      label: 'NEM 3.0',       emoji: '☀️' },
  { id: 'retention', label: 'Progress',      emoji: '📈' },
]

function QuizSection() {
  const [question, setQuestion] = useState<QuizQuestion | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadQuestion() {
    setLoading(true)
    try {
      const engine = getSolarQuizEngine()
      const q = await engine.generateQuizQuestion('microinverter_sizing', 'beginner')
      setQuestion(q)
    } catch {
      setQuestion(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadQuestion() }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        Loading quiz…
      </div>
    )
  }

  if (!question) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3">
        <p className="text-gray-500 text-sm">Could not load quiz question.</p>
        <button
          onClick={loadQuestion}
          className="px-4 py-2 bg-yellow-700 text-white text-xs font-semibold rounded hover:bg-yellow-600"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <SolarQuizCard
      question={question}
      mode="learning"
      onAnswered={() => {}}
      onNext={loadQuestion}
    />
  )
}

export default function SolarTrainingView() {
  const [activeTab, setActiveTab] = useState<SolarTab>('quiz')

  return (
    <div className="w-full min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-2">
        <h1 className="text-xl font-bold text-yellow-400 flex items-center gap-2">
          ☀️ Solar Training
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          NEM 3.0 curriculum, quiz engine, and retention tracking.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-6 pt-2 pb-0 border-b border-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-semibold rounded-t transition-colors ${
              activeTab === tab.id
                ? 'bg-yellow-900/30 text-yellow-300 border-b-2 border-yellow-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.emoji} {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'quiz'      && <QuizSection />}
        {activeTab === 'nem3'      && <NEM3Visualizer />}
        {activeTab === 'retention' && <SolarRetentionHeatmap />}
      </div>
    </div>
  )
}
