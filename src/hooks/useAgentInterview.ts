// @ts-nocheck
/**
 * useAgentInterview — Hook for managing agent interview state.
 *
 * Handles:
 * - Interview lifecycle (start → questions → output → approve/cancel)
 * - Memory pre-fill from nexusMemory (answers persist per project)
 * - Output generation via Claude
 * - Approval flow — nothing saved without explicit confirm
 */

import { useState, useCallback, useRef } from 'react'
import { callClaude, extractText } from '@/services/claudeProxy'
import { getMemory, addLearnedPattern, saveToLocalStorage } from '@/services/nexusMemory'
import type {
  AgentInterviewDefinition,
  InterviewQuestion,
} from '@/agents/nexus/interviewDefinitions'

// ── Types ───────────────────────────────────────────────────────────────────

export type InterviewStatus =
  | 'idle'
  | 'interviewing'
  | 'generating'
  | 'reviewing'
  | 'approved'
  | 'cancelled'

export interface InterviewAnswer {
  questionId: string
  label: string
  value: string
  skipped: boolean
}

export interface InterviewSession {
  id: string
  agent: string
  agentName: string
  definition: AgentInterviewDefinition
  answers: InterviewAnswer[]
  currentQuestionIndex: number
  status: InterviewStatus
  output: string
  outputRaw: string
  startedAt: number
  completedAt?: number
  projectId?: string
}

// ── Memory Integration ──────────────────────────────────────────────────────

const INTERVIEW_MEMORY_KEY = 'nexus_interview_memory'

interface InterviewMemoryStore {
  /** key: `${agent}_${memoryKey}_${projectId}` → value */
  answers: Record<string, string>
  /** Completed interview count per agent */
  completedCount: Record<string, number>
}

function loadInterviewMemory(): InterviewMemoryStore {
  try {
    const raw = localStorage.getItem(INTERVIEW_MEMORY_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { answers: {}, completedCount: {} }
}

function saveInterviewMemory(mem: InterviewMemoryStore): void {
  try {
    localStorage.setItem(INTERVIEW_MEMORY_KEY, JSON.stringify(mem))
  } catch { /* ignore */ }
}

function getPrefilledAnswer(
  agent: string,
  memoryKey: string | undefined,
  projectId: string | undefined
): string {
  if (!memoryKey) return ''
  const mem = loadInterviewMemory()
  const key = `${agent}_${memoryKey}_${projectId || 'global'}`
  return mem.answers[key] || ''
}

function saveAnswerToMemory(
  agent: string,
  memoryKey: string | undefined,
  projectId: string | undefined,
  value: string
): void {
  if (!memoryKey || !value) return
  const mem = loadInterviewMemory()
  const key = `${agent}_${memoryKey}_${projectId || 'global'}`
  mem.answers[key] = value
  saveInterviewMemory(mem)
}

function recordCompletedInterview(agent: string): void {
  const mem = loadInterviewMemory()
  mem.completedCount[agent] = (mem.completedCount[agent] || 0) + 1
  saveInterviewMemory(mem)
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useAgentInterview() {
  const [session, setSession] = useState<InterviewSession | null>(null)
  const sessionRef = useRef<InterviewSession | null>(null)

  // Keep ref in sync for async callbacks
  const updateSession = useCallback((updater: (prev: InterviewSession) => InterviewSession) => {
    setSession((prev) => {
      if (!prev) return prev
      const next = updater(prev)
      sessionRef.current = next
      return next
    })
  }, [])

  /**
   * Start an interview for a given agent definition.
   */
  const startInterview = useCallback((
    definition: AgentInterviewDefinition,
    projectId?: string
  ) => {
    const newSession: InterviewSession = {
      id: `interview_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      agent: definition.agent,
      agentName: definition.agentName,
      definition,
      answers: [],
      currentQuestionIndex: 0,
      status: 'interviewing',
      output: '',
      outputRaw: '',
      startedAt: Date.now(),
      projectId,
    }
    sessionRef.current = newSession
    setSession(newSession)
  }, [])

  /**
   * Get the current question with any pre-filled answer from memory.
   */
  const getCurrentQuestion = useCallback((): {
    question: InterviewQuestion
    prefilled: string
    questionNumber: number
    totalQuestions: number
  } | null => {
    const s = sessionRef.current || session
    if (!s || s.status !== 'interviewing') return null
    const q = s.definition.questions[s.currentQuestionIndex]
    if (!q) return null
    return {
      question: q,
      prefilled: getPrefilledAnswer(s.agent, q.memoryKey, s.projectId),
      questionNumber: s.currentQuestionIndex + 1,
      totalQuestions: s.definition.questions.length,
    }
  }, [session])

  /**
   * Submit an answer to the current question and advance.
   */
  const submitAnswer = useCallback((value: string, skipped: boolean = false) => {
    const s = sessionRef.current
    if (!s || s.status !== 'interviewing') return

    const question = s.definition.questions[s.currentQuestionIndex]
    if (!question) return

    const answer: InterviewAnswer = {
      questionId: question.id,
      label: question.label,
      value: skipped ? '' : value,
      skipped,
    }

    // Save to memory for future pre-fill
    if (!skipped && value) {
      saveAnswerToMemory(s.agent, question.memoryKey, s.projectId, value)
    }

    const newAnswers = [...s.answers, answer]
    const nextIndex = s.currentQuestionIndex + 1
    const isDone = nextIndex >= s.definition.questions.length

    updateSession((prev) => ({
      ...prev,
      answers: newAnswers,
      currentQuestionIndex: nextIndex,
      status: isDone ? 'generating' : 'interviewing',
    }))

    // If all questions answered, generate output
    if (isDone) {
      generateOutput(s.definition, newAnswers, s.projectId)
    }
  }, [updateSession])

  /**
   * Skip the current question.
   */
  const skipQuestion = useCallback(() => {
    submitAnswer('', true)
  }, [submitAnswer])

  /**
   * Generate the final output using Claude.
   */
  const generateOutput = useCallback(async (
    definition: AgentInterviewDefinition,
    answers: InterviewAnswer[],
    projectId?: string
  ) => {
    try {
      // Build the answer summary for Claude
      const answerSummary = answers
        .map((a) => {
          if (a.skipped) return `${a.label}: (skipped)`
          return `${a.label}: ${a.value}`
        })
        .join('\n')

      const systemPrompt = `You are ${definition.agentName}, a specialist agent for Power On Solutions LLC, a C-10 electrical contractor in the Coachella Valley, CA. Operator: Christian Dubon.

${definition.outputPrompt}

Important:
- This is a DRAFT for Christian's review — he will approve or edit before anything is saved
- Be specific, practical, and use contractor language
- Include all relevant details from the interview answers
- Format clearly so it's easy to scan on mobile`

      const userMessage = `Interview answers for ${definition.output.label}:

${answerSummary}

${projectId ? `Project ID: ${projectId}` : ''}

Generate the output now.`

      const response = await callClaude({
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        max_tokens: 2048,
      })

      const outputText = extractText(response) || 'Failed to generate output. Please try again.'

      updateSession((prev) => ({
        ...prev,
        status: 'reviewing',
        output: outputText,
        outputRaw: outputText,
      }))
    } catch (err) {
      console.error('[Interview] Output generation failed:', err)
      updateSession((prev) => ({
        ...prev,
        status: 'reviewing',
        output: 'Error generating output. You can edit this manually or retry.',
        outputRaw: '',
      }))
    }
  }, [updateSession])

  /**
   * Update the output text (user editing before approval).
   */
  const updateOutput = useCallback((newOutput: string) => {
    updateSession((prev) => ({
      ...prev,
      output: newOutput,
    }))
  }, [updateSession])

  /**
   * Approve the output — saves to memory, marks complete.
   * Returns the approved output for the caller to persist to the correct store.
   */
  const approveOutput = useCallback((): { output: string; targetStore: string; agent: string } | null => {
    const s = sessionRef.current
    if (!s || s.status !== 'reviewing') return null

    // Record to interview memory
    recordCompletedInterview(s.agent)

    // Save as learned pattern in nexusMemory
    const answersStr = s.answers
      .filter((a) => !a.skipped && a.value)
      .map((a) => `${a.label}: ${a.value}`)
      .join('; ')
    addLearnedPattern(
      `${s.agentName} interview completed: ${answersStr.slice(0, 100)}`
    )
    saveToLocalStorage()

    const result = {
      output: s.output,
      targetStore: s.definition.output.targetStore,
      agent: s.agent,
    }

    updateSession((prev) => ({
      ...prev,
      status: 'approved',
      completedAt: Date.now(),
    }))

    return result
  }, [updateSession])

  /**
   * Cancel the interview — discard everything.
   */
  const cancelInterview = useCallback(() => {
    setSession((prev) => {
      if (!prev) return null
      return { ...prev, status: 'cancelled' }
    })
    // Clear after brief delay so UI can show cancellation
    setTimeout(() => {
      setSession(null)
      sessionRef.current = null
    }, 300)
  }, [])

  /**
   * Dismiss a completed/approved interview.
   */
  const dismissInterview = useCallback(() => {
    setSession(null)
    sessionRef.current = null
  }, [])

  return {
    session,
    isActive: session !== null && session.status !== 'cancelled' && session.status !== 'approved',
    startInterview,
    getCurrentQuestion,
    submitAnswer,
    skipQuestion,
    updateOutput,
    approveOutput,
    cancelInterview,
    dismissInterview,
  }
}
