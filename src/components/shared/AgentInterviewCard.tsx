// @ts-nocheck
/**
 * AgentInterviewCard — Structured interview UI for agent data gathering.
 *
 * Flow:
 *   1. Agent header with icon + name
 *   2. Question displayed prominently with progress indicator
 *   3. Answer via text/select/voice
 *   4. Skip/Cancel controls
 *   5. Final output preview with "Approve & Save" / "Edit" / "Cancel"
 *   6. Nothing saved without explicit approval
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  X,
  SkipForward,
  Check,
  Edit3,
  Loader2,
  Send,
  Mic,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { InterviewSession, InterviewStatus } from '@/hooks/useAgentInterview'
import type { InterviewQuestion } from '@/agents/nexus/interviewDefinitions'

// ── Types ───────────────────────────────────────────────────────────────────

interface AgentInterviewCardProps {
  session: InterviewSession
  currentQuestion: {
    question: InterviewQuestion
    prefilled: string
    questionNumber: number
    totalQuestions: number
  } | null
  onSubmitAnswer: (value: string, skipped?: boolean) => void
  onSkipQuestion: () => void
  onUpdateOutput: (text: string) => void
  onApprove: () => void
  onCancel: () => void
  onDismiss: () => void
}

// ── Component ───────────────────────────────────────────────────────────────

export function AgentInterviewCard({
  session,
  currentQuestion,
  onSubmitAnswer,
  onSkipQuestion,
  onUpdateOutput,
  onApprove,
  onCancel,
  onDismiss,
}: AgentInterviewCardProps) {
  const [inputValue, setInputValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)

  // Pre-fill from memory when question changes
  useEffect(() => {
    if (currentQuestion?.prefilled) {
      setInputValue(currentQuestion.prefilled)
    } else {
      setInputValue('')
    }
  }, [currentQuestion?.question?.id, currentQuestion?.prefilled])

  // Auto-focus input
  useEffect(() => {
    if (session.status === 'interviewing' && inputRef.current) {
      inputRef.current.focus()
    }
  }, [session.status, currentQuestion?.question?.id])

  // Auto-focus edit textarea
  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus()
    }
  }, [isEditing])

  const handleSubmit = useCallback(() => {
    if (!inputValue.trim() && !currentQuestion?.question?.skippable) return
    onSubmitAnswer(inputValue.trim())
    setInputValue('')
  }, [inputValue, onSubmitAnswer, currentQuestion])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  const handleStartEdit = useCallback(() => {
    setEditText(session.output)
    setIsEditing(true)
  }, [session.output])

  const handleSaveEdit = useCallback(() => {
    onUpdateOutput(editText)
    setIsEditing(false)
  }, [editText, onUpdateOutput])

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditText('')
  }, [])

  const { definition } = session

  return (
    <div
      className={clsx(
        'rounded-xl border shadow-xl overflow-hidden',
        'bg-gray-900/95 border-gray-700/60 backdrop-blur-sm',
        'max-w-lg w-full mx-auto',
        'transition-all duration-300'
      )}
    >
      {/* ── Agent Header ─────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: `${definition.agentColor}20` }}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-xl">{definition.icon}</span>
          <div>
            <h3
              className="text-sm font-bold tracking-wide m-0"
              style={{ color: definition.agentColor }}
            >
              {definition.agentName}
            </h3>
            <p className="text-[10px] text-gray-400 m-0">
              {definition.output.label}
            </p>
          </div>
        </div>
        <button
          onClick={onCancel}
          className="text-gray-500 hover:text-gray-300 transition-colors p-1"
          title="Cancel Interview"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className="px-4 py-3">
        {/* Interviewing State */}
        {session.status === 'interviewing' && currentQuestion && (
          <InterviewQuestionView
            question={currentQuestion.question}
            questionNumber={currentQuestion.questionNumber}
            totalQuestions={currentQuestion.totalQuestions}
            inputValue={inputValue}
            onInputChange={setInputValue}
            onSubmit={handleSubmit}
            onSkip={onSkipQuestion}
            onKeyDown={handleKeyDown}
            inputRef={inputRef}
            agentColor={definition.agentColor}
            previousAnswers={session.answers}
          />
        )}

        {/* Generating State */}
        {session.status === 'generating' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2
              className="w-8 h-8 animate-spin"
              style={{ color: definition.agentColor }}
            />
            <p className="text-sm text-gray-400 m-0">
              {definition.agentName} is preparing your output...
            </p>
          </div>
        )}

        {/* Reviewing State */}
        {session.status === 'reviewing' && (
          <ReviewOutputView
            output={session.output}
            isEditing={isEditing}
            editText={editText}
            onEditTextChange={setEditText}
            onStartEdit={handleStartEdit}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={handleCancelEdit}
            onApprove={onApprove}
            onCancel={onCancel}
            editRef={editRef}
            agentColor={definition.agentColor}
            outputLabel={definition.output.label}
          />
        )}

        {/* Approved State */}
        {session.status === 'approved' && (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <CheckCircle2
              className="w-10 h-10"
              style={{ color: definition.agentColor }}
            />
            <p className="text-sm font-semibold text-gray-200 m-0">
              Approved & Saved
            </p>
            <p className="text-xs text-gray-400 m-0">
              {definition.output.label} has been saved.
            </p>
            <button
              onClick={onDismiss}
              className="mt-2 px-4 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Cancelled State */}
        {session.status === 'cancelled' && (
          <div className="flex flex-col items-center justify-center py-6 gap-2 opacity-60">
            <AlertTriangle className="w-8 h-8 text-gray-500" />
            <p className="text-sm text-gray-500 m-0">Interview cancelled</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function InterviewQuestionView({
  question,
  questionNumber,
  totalQuestions,
  inputValue,
  onInputChange,
  onSubmit,
  onSkip,
  onKeyDown,
  inputRef,
  agentColor,
  previousAnswers,
}: {
  question: InterviewQuestion
  questionNumber: number
  totalQuestions: number
  inputValue: string
  onInputChange: (v: string) => void
  onSubmit: () => void
  onSkip: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement>
  agentColor: string
  previousAnswers: Array<{ label: string; value: string; skipped: boolean }>
}) {
  return (
    <div className="space-y-3">
      {/* Progress */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
          Question {questionNumber} of {totalQuestions}
        </span>
        <div className="flex gap-1">
          {Array.from({ length: totalQuestions }).map((_, i) => (
            <div
              key={i}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                width: i < questionNumber ? '20px' : '8px',
                backgroundColor:
                  i < questionNumber - 1
                    ? agentColor
                    : i === questionNumber - 1
                    ? agentColor
                    : '#374151',
                opacity: i < questionNumber ? 1 : 0.4,
              }}
            />
          ))}
        </div>
      </div>

      {/* Previous answers summary (collapsed) */}
      {previousAnswers.length > 0 && (
        <div className="bg-gray-800/50 rounded-lg px-3 py-2 space-y-1">
          {previousAnswers.map((a, i) => (
            <div key={i} className="flex items-start gap-2 text-[10px]">
              <span className="text-gray-500 shrink-0">{a.label}:</span>
              <span className="text-gray-300">
                {a.skipped ? '(skipped)' : a.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Question text */}
      <p className="text-sm font-medium text-gray-100 m-0 leading-relaxed">
        {question.text}
      </p>

      {/* Input */}
      {question.inputType === 'select' && question.options ? (
        <div className="space-y-1.5">
          {question.options.map((option) => (
            <button
              key={option}
              onClick={() => onInputChange(option)}
              className={clsx(
                'w-full text-left px-3 py-2 rounded-lg text-xs transition-all',
                inputValue === option
                  ? 'ring-1 text-white'
                  : 'bg-gray-800/60 text-gray-300 hover:bg-gray-700/60'
              )}
              style={
                inputValue === option
                  ? {
                      backgroundColor: `${agentColor}20`,
                      borderColor: agentColor,
                      ringColor: agentColor,
                    }
                  : undefined
              }
            >
              {option}
            </button>
          ))}
        </div>
      ) : question.inputType === 'multiline' ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type your answer..."
          rows={3}
          className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:ring-1"
          style={{ '--tw-ring-color': agentColor } as React.CSSProperties}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type your answer..."
          className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1"
          style={{ '--tw-ring-color': agentColor } as React.CSSProperties}
        />
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex gap-2">
          {question.skippable && (
            <button
              onClick={onSkip}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-gray-400 hover:text-gray-200 bg-gray-800/40 hover:bg-gray-800/80 rounded-lg transition-colors"
            >
              <SkipForward className="w-3 h-3" />
              Skip
            </button>
          )}
        </div>
        <button
          onClick={onSubmit}
          disabled={!inputValue.trim() && !question.skippable}
          className={clsx(
            'flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg transition-all',
            inputValue.trim()
              ? 'text-white hover:opacity-90'
              : 'bg-gray-800 text-gray-500 cursor-not-allowed'
          )}
          style={
            inputValue.trim()
              ? { backgroundColor: agentColor }
              : undefined
          }
        >
          <Send className="w-3 h-3" />
          Next
        </button>
      </div>
    </div>
  )
}

function ReviewOutputView({
  output,
  isEditing,
  editText,
  onEditTextChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onApprove,
  onCancel,
  editRef,
  agentColor,
  outputLabel,
}: {
  output: string
  isEditing: boolean
  editText: string
  onEditTextChange: (v: string) => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onApprove: () => void
  onCancel: () => void
  editRef: React.RefObject<HTMLTextAreaElement>
  agentColor: string
  outputLabel: string
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
          Review Output
        </span>
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${agentColor}20`, color: agentColor }}
        >
          {outputLabel}
        </span>
      </div>

      {/* Output display or edit */}
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            ref={editRef}
            value={editText}
            onChange={(e) => onEditTextChange(e.target.value)}
            rows={12}
            className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono resize-y focus:outline-none focus:ring-1"
            style={{ '--tw-ring-color': agentColor } as React.CSSProperties}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={onCancelEdit}
              className="px-3 py-1.5 text-[11px] text-gray-400 hover:text-gray-200 bg-gray-800/40 rounded-lg transition-colors"
            >
              Cancel Edit
            </button>
            <button
              onClick={onSaveEdit}
              className="px-3 py-1.5 text-[11px] text-white rounded-lg transition-colors"
              style={{ backgroundColor: agentColor }}
            >
              Save Changes
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-gray-800/40 rounded-lg px-3 py-3 max-h-80 overflow-y-auto">
          <div className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap">
            {output}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!isEditing && (
        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-[11px] text-gray-400 hover:text-red-400 bg-gray-800/40 hover:bg-red-900/20 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onStartEdit}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-gray-300 hover:text-white bg-gray-800/40 hover:bg-gray-700/60 rounded-lg transition-colors"
            >
              <Edit3 className="w-3 h-3" />
              Edit
            </button>
          </div>
          <button
            onClick={onApprove}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white rounded-lg transition-all hover:opacity-90 shadow-lg"
            style={{ backgroundColor: agentColor }}
          >
            <Check className="w-3.5 h-3.5" />
            Approve & Save
          </button>
        </div>
      )}
    </div>
  )
}

export default AgentInterviewCard
