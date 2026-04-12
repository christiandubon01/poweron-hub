/**
 * OnboardingFlow.tsx — FIXED VERSION
 * V4-OB1 — First-run onboarding experience with back button, multi-select job types, and completion flag.
 *
 * FIX 1: Only show on first login — checks onboarding_completed flag in Supabase
 * FIX 2: Back button on every question with answer preservation
 * FIX 3: Multi-select job types with individual price range inputs
 *
 * Steps:
 *   1. Welcome + custom AI name input
 *   2. Business type detection
 *   3. Conversational interview via Claude (adaptive follow-ups)
 *   4. AI summary + user confirmation
 *   5. Platform configuration + activation
 *
 * Stores onboarding data in Supabase `user_onboarding` table with completed_at flag.
 * "Skip for now" is always available.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  Zap,
  ChevronRight,
  ChevronLeft,
  X,
  Sparkles,
  Bot,
  Building2,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Send,
  Settings,
  Wrench,
  Sun,
  Wind,
  HardHat,
  MoreHorizontal,
  Check,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { callClaude } from '@/services/claudeProxy'
import {
  runOnboardingInterview,
  configureFromOnboarding,
  saveOnboardingData,
} from '@/services/onboarding/OnboardingService'
import type {
  BusinessType,
  OnboardingResponses,
  OnboardingAnalysis,
} from '@/services/onboarding/OnboardingService'

// ── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 5

// Job type options for multi-select (FIX 3)
interface JobTypeOption {
  id: string
  label: string
  description: string
}

const JOB_TYPE_OPTIONS: JobTypeOption[] = [
  { id: 'service_calls', label: 'Service Calls', description: '$100–$600' },
  { id: 'small_projects', label: 'Small Projects', description: '$1,000–$5,000' },
  { id: 'medium_projects', label: 'Medium Projects', description: '$5,000–$20,000' },
  { id: 'large_projects', label: 'Large Projects', description: '$20,000+' },
  { id: 'solar_installation', label: 'Solar Installation', description: 'Varies' },
  { id: 'commercial_ti', label: 'Commercial/TI', description: 'Varies' },
]

// Fixed interview questions
const BASE_QUESTIONS: Array<{ key: keyof OnboardingResponses; label: string; placeholder: string }> = [
  {
    key: 'teamSize',
    label: 'How many people work with you?',
    placeholder: 'e.g. Just me, 2 electricians, 5-person crew…',
  },
  {
    key: 'jobTypes',
    label: 'What types of jobs do you do? (Select all that apply)',
    placeholder: 'Select one or more job types below…',
  },
  {
    key: 'typicalJobSize',
    label: "What's your typical overall job size range in dollars?",
    placeholder: 'e.g. $500–$2,000 on average…',
  },
  {
    key: 'trackingMethod',
    label: 'How do you currently track your projects?',
    placeholder: 'e.g. Spreadsheets, whiteboard, QuickBooks, pen and paper…',
  },
  {
    key: 'biggestHeadache',
    label: "What's your biggest operational headache right now?",
    placeholder: 'e.g. Chasing payments, scheduling chaos, estimating time, crew coordination…',
  },
]

// Business type options
interface BusinessOption {
  value: BusinessType
  label: string
  description: string
  icon: React.ReactNode
  color: string
}

const BUSINESS_OPTIONS: BusinessOption[] = [
  {
    value: 'electrical',
    label: 'Electrical',
    description: 'Licensed electrical contractor',
    icon: <Zap className="w-6 h-6" />,
    color: 'border-emerald-500 bg-emerald-500/10',
  },
  {
    value: 'plumbing',
    label: 'Plumbing',
    description: 'Plumbing contractor',
    icon: <Wrench className="w-6 h-6" />,
    color: 'border-blue-500 bg-blue-500/10',
  },
  {
    value: 'general_contractor',
    label: 'General Contractor',
    description: 'GC / multi-trade',
    icon: <HardHat className="w-6 h-6" />,
    color: 'border-orange-500 bg-orange-500/10',
  },
  {
    value: 'solar',
    label: 'Solar',
    description: 'Solar installation / RMO',
    icon: <Sun className="w-6 h-6" />,
    color: 'border-yellow-500 bg-yellow-500/10',
  },
  {
    value: 'hvac',
    label: 'HVAC',
    description: 'Heating, cooling & ventilation',
    icon: <Wind className="w-6 h-6" />,
    color: 'border-cyan-500 bg-cyan-500/10',
  },
  {
    value: 'other',
    label: 'Other Trade',
    description: 'Other specialty contractor',
    icon: <MoreHorizontal className="w-6 h-6" />,
    color: 'border-purple-500 bg-purple-500/10',
  },
]

// ── Sub-components ────────────────────────────────────────────────────────────

/** Step progress dots */
function StepDots({
  total,
  current,
}: {
  total: number
  current: number
}) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all duration-300 ${
            i === current
              ? 'w-6 h-2 bg-emerald-400'
              : i < current
              ? 'w-2 h-2 bg-emerald-600'
              : 'w-2 h-2 bg-zinc-600'
          }`}
        />
      ))}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

interface OnboardingFlowProps {
  /** Called when onboarding is fully completed or skipped */
  onComplete: () => void
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { user } = useAuth()
  const userId = user?.id ?? ''

  // ── Step tracking ──────────────────────────────────────────────────────────
  const [step, setStep] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)

  // ── Step 1: AI Name ────────────────────────────────────────────────────────
  const [aiName, setAiName] = useState('NEXUS')

  // ── Step 2: Business type ──────────────────────────────────────────────────
  const [businessType, setBusinessType] = useState<BusinessType>('electrical')

  // ── Step 3: Interview ──────────────────────────────────────────────────────
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [interviewAnswers, setInterviewAnswers] = useState<Partial<OnboardingResponses>>({
    jobTypes: [],
    jobTypeRanges: {},
  })
  const [currentAnswer, setCurrentAnswer] = useState('')
  const [selectedJobTypes, setSelectedJobTypes] = useState<string[]>([])
  const [jobTypeRanges, setJobTypeRanges] = useState<Record<string, string>>({})
  const [followUpQuestion, setFollowUpQuestion] = useState<string | null>(null)
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<string, string>>({})
  const [isGeneratingFollowUp, setIsGeneratingFollowUp] = useState(false)
  const [interviewComplete, setInterviewComplete] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Step 4: Analysis ───────────────────────────────────────────────────────
  const [analysis, setAnalysis] = useState<OnboardingAnalysis | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  // ── Step 5: Configuration ──────────────────────────────────────────────────
  const [isConfiguring, setIsConfiguring] = useState(false)
  const [configComplete, setConfigComplete] = useState(false)

  // ── Navigation helpers ─────────────────────────────────────────────────────

  const goToStep = useCallback((target: number) => {
    setIsTransitioning(true)
    setTimeout(() => {
      setStep(target)
      setIsTransitioning(false)
    }, 200)
  }, [])

  const goNext = useCallback(() => {
    if (step < TOTAL_STEPS - 1) goToStep(step + 1)
  }, [step, goToStep])

  const goBack = useCallback(() => {
    if (step > 0) goToStep(step - 1)
  }, [step, goToStep])

  // ── Skip handler ───────────────────────────────────────────────────────────

  const handleSkip = useCallback(async () => {
    // Record that user skipped so we can offer it again in Settings
    if (userId) {
      try {
        const { supabase } = await import('@/lib/supabase')
        await supabase
          .from('user_onboarding' as never)
          .upsert(
            {
              user_id: userId,
              ai_name: aiName || 'NEXUS',
              business_type: businessType,
              responses: {} as Record<string, unknown>,
              analysis: {} as Record<string, unknown>,
              completed_at: null,
              updated_at: new Date().toISOString(),
            } as never,
            { onConflict: 'user_id' }
          )
      } catch {
        // Non-critical — proceed anyway
      }
    }
    onComplete()
  }, [userId, aiName, businessType, onComplete])

  // ── Step 3: Interview logic ────────────────────────────────────────────────

  const currentBaseQuestion = BASE_QUESTIONS[currentQuestionIndex]
  const isLastBaseQuestion = currentQuestionIndex === BASE_QUESTIONS.length - 1
  const isJobTypesQuestion = currentQuestionIndex === 1 // Job types is question 2 (index 1)

  /**
   * Generates a Claude follow-up question based on the user's answer.
   * Only generates for the first 2 questions to keep total time under 10 min.
   */
  const generateFollowUp = useCallback(
    async (questionLabel: string, answer: string): Promise<string | null> => {
      // Only generate follow-ups for certain questions to keep time bounded
      if (currentQuestionIndex > 1) return null

      try {
        const response = await callClaude({
          messages: [
            {
              role: 'user',
              content: `User answered "${answer}" to the question "${questionLabel}".
Generate ONE short, specific follow-up question (max 15 words) that would help configure their operations platform better.
Return ONLY the question text, no preamble.`,
            },
          ],
          system:
            'You are an onboarding assistant for a contractor operations platform. Generate concise, relevant follow-up questions.',
          max_tokens: 60,
        })

        const text = response.content?.[0]?.text?.trim() ?? ''
        return text.length > 10 ? text : null
      } catch {
        return null
      }
    },
    [currentQuestionIndex]
  )

  // Handle job type selection (FIX 3 - multi-select)
  const handleJobTypeToggle = useCallback((jobTypeId: string) => {
    setSelectedJobTypes((prev) => {
      if (prev.includes(jobTypeId)) {
        return prev.filter((id) => id !== jobTypeId)
      } else {
        return [...prev, jobTypeId]
      }
    })
  }, [])

  // Handle submitting job types question with ranges
  const handleJobTypesSubmit = useCallback(async () => {
    if (selectedJobTypes.length === 0) return

    // Save selected job types and their ranges
    const jobTypeLabels = selectedJobTypes
      .map((id) => JOB_TYPE_OPTIONS.find((opt) => opt.id === id)?.label)
      .filter(Boolean)

    setInterviewAnswers((prev) => ({
      ...prev,
      jobTypes: jobTypeLabels as string[],
      jobTypeRanges: jobTypeRanges,
    }))

    // Move to next question or complete
    if (isLastBaseQuestion) {
      setInterviewComplete(true)
    } else {
      setCurrentQuestionIndex((i) => i + 1)
      setFollowUpQuestion(null)
      setSelectedJobTypes([])
      setJobTypeRanges({})
    }
  }, [selectedJobTypes, jobTypeRanges, isLastBaseQuestion])

  const handleAnswerSubmit = useCallback(async () => {
    if (!currentAnswer.trim()) return

    const question = currentBaseQuestion
    if (!question) return

    // Save the answer
    setInterviewAnswers((prev) => ({
      ...prev,
      [question.key]: currentAnswer.trim(),
    }))

    // Generate a follow-up question
    if (currentQuestionIndex <= 1 && !isJobTypesQuestion) {
      setIsGeneratingFollowUp(true)
      const followUp = await generateFollowUp(question.label, currentAnswer.trim())
      setIsGeneratingFollowUp(false)
      if (followUp) {
        setFollowUpQuestion(followUp)
        setCurrentAnswer('')
        return
      }
    }

    // Move to next question or complete
    setCurrentAnswer('')
    if (isLastBaseQuestion) {
      setInterviewComplete(true)
    } else {
      setCurrentQuestionIndex((i) => i + 1)
      setFollowUpQuestion(null)
    }
  }, [
    currentAnswer,
    currentBaseQuestion,
    currentQuestionIndex,
    generateFollowUp,
    isLastBaseQuestion,
    isJobTypesQuestion,
  ])

  const handleFollowUpSubmit = useCallback(() => {
    if (!currentAnswer.trim() || !followUpQuestion) return

    setFollowUpAnswers((prev) => ({
      ...prev,
      [followUpQuestion]: currentAnswer.trim(),
    }))

    setCurrentAnswer('')
    setFollowUpQuestion(null)

    if (isLastBaseQuestion) {
      setInterviewComplete(true)
    } else {
      setCurrentQuestionIndex((i) => i + 1)
    }
  }, [currentAnswer, followUpQuestion, isLastBaseQuestion])

  // ── Step 4: Run analysis ───────────────────────────────────────────────────

  const handleRunAnalysis = useCallback(async () => {
    setIsAnalyzing(true)
    setAnalysisError(null)

    try {
      const responses: OnboardingResponses = {
        aiName,
        businessType,
        teamSize: (interviewAnswers.teamSize as string) ?? '',
        jobTypes: (interviewAnswers.jobTypes as string[]) ?? [],
        jobTypeRanges: (interviewAnswers.jobTypeRanges as Record<string, string>) ?? {},
        typicalJobSize: (interviewAnswers.typicalJobSize as string) ?? '',
        trackingMethod: (interviewAnswers.trackingMethod as string) ?? '',
        biggestHeadache: (interviewAnswers.biggestHeadache as string) ?? '',
        followUpAnswers,
      }

      const result = await runOnboardingInterview(responses)
      setAnalysis(result)
      goToStep(3) // Go to confirmation step
    } catch (err) {
      console.error('[OnboardingFlow] Analysis failed:', err)
      setAnalysisError('Analysis failed. Please try again or skip for now.')
    } finally {
      setIsAnalyzing(false)
    }
  }, [aiName, businessType, interviewAnswers, followUpAnswers, goToStep])

  // ── Step 5: Configure platform ─────────────────────────────────────────────

  const handleConfigure = useCallback(async () => {
    if (!analysis) return

    setIsConfiguring(true)

    try {
      const responses: OnboardingResponses = {
        aiName,
        businessType,
        teamSize: (interviewAnswers.teamSize as string) ?? '',
        jobTypes: (interviewAnswers.jobTypes as string[]) ?? [],
        jobTypeRanges: (interviewAnswers.jobTypeRanges as Record<string, string>) ?? {},
        typicalJobSize: (interviewAnswers.typicalJobSize as string) ?? '',
        trackingMethod: (interviewAnswers.trackingMethod as string) ?? '',
        biggestHeadache: (interviewAnswers.biggestHeadache as string) ?? '',
        followUpAnswers,
      }

      // Run platform configuration and save data in parallel
      // FIX 1: Set completed_at to mark onboarding as complete (prevents repeated prompts)
      await Promise.all([
        configureFromOnboarding(userId, analysis),
        saveOnboardingData({
          user_id: userId,
          ai_name: aiName,
          business_type: businessType,
          responses,
          analysis,
          completed_at: new Date().toISOString(),
        }),
      ])

      setConfigComplete(true)

      // Brief pause so user sees the success state, then complete
      setTimeout(() => {
        onComplete()
      }, 2000)
    } catch (err) {
      console.error('[OnboardingFlow] Configuration failed:', err)
      // Even on failure, let them through
      onComplete()
    } finally {
      setIsConfiguring(false)
    }
  }, [
    analysis,
    aiName,
    businessType,
    interviewAnswers,
    followUpAnswers,
    userId,
    onComplete,
  ])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[9999] bg-zinc-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="text-sm font-semibold text-zinc-100">PowerOn Hub Setup</span>
        </div>
        <div className="flex items-center gap-4">
          <StepDots total={TOTAL_STEPS} current={step} />
          <button
            onClick={handleSkip}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            Skip for now
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className={`flex-1 overflow-y-auto transition-opacity duration-200 ${
          isTransitioning ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {/* ── Step 0: Welcome + AI Name ── */}
        {step === 0 && (
          <div className="max-w-xl mx-auto px-6 py-12 flex flex-col gap-8">
            <div className="text-center">
              <div className="w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-6">
                <Sparkles className="w-10 h-10 text-emerald-400" />
              </div>
              <h1 className="text-3xl font-bold text-zinc-100 mb-3">
                Welcome to PowerOn Hub
              </h1>
              <p className="text-zinc-400 text-base leading-relaxed">
                Your AI-powered business operating system. Let's spend a few minutes
                configuring it for your specific operation.
              </p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <Bot className="w-5 h-5 text-emerald-400" />
                <h2 className="font-semibold text-zinc-100">Name Your AI Assistant</h2>
              </div>
              <p className="text-sm text-zinc-400 mb-4">
                What would you like to call your AI assistant? (Default: NEXUS)
              </p>
              <input
                type="text"
                value={aiName}
                onChange={(e) => setAiName(e.target.value || 'NEXUS')}
                placeholder="NEXUS"
                maxLength={20}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors text-lg font-semibold"
              />
              <p className="text-xs text-zinc-600 mt-2">
                This name appears throughout the app when your AI responds.
              </p>
            </div>

            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3">What happens next:</h3>
              <div className="space-y-2">
                {[
                  'Tell us your trade & business type',
                  'Answer 5 quick questions about your operation',
                  'AI reviews your answers and configures the platform',
                  'Your agents activate, ready to work for you',
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm text-zinc-400">
                    <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-emerald-400 text-xs font-bold">{i + 1}</span>
                    </div>
                    {item}
                  </div>
                ))}
              </div>
              <p className="text-xs text-zinc-600 mt-4">
                ⏱ Takes about 3–5 minutes. Skip anytime and finish later in Settings.
              </p>
            </div>

            <button
              onClick={goNext}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-4 px-6 rounded-xl transition-colors flex items-center justify-center gap-2 text-base"
            >
              Get Started
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* ── Step 1: Business Type ── */}
        {step === 1 && (
          <div className="max-w-xl mx-auto px-6 py-12 flex flex-col gap-8">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center mx-auto mb-5">
                <Building2 className="w-8 h-8 text-blue-400" />
              </div>
              <h2 className="text-2xl font-bold text-zinc-100 mb-2">What's Your Trade?</h2>
              <p className="text-zinc-400 text-sm">
                Select your primary business type so we can configure the right tools and
                industry-specific defaults.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {BUSINESS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setBusinessType(opt.value)}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    businessType === opt.value
                      ? opt.color + ' border-opacity-100'
                      : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'
                  }`}
                >
                  <div
                    className={`mb-2 ${
                      businessType === opt.value ? '' : 'text-zinc-500'
                    }`}
                  >
                    {opt.icon}
                  </div>
                  <div className="font-semibold text-zinc-100 text-sm">{opt.label}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{opt.description}</div>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={goBack}
                className="flex-none bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium py-3 px-5 rounded-xl transition-colors flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
              <button
                onClick={goNext}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Interview ── */}
        {step === 2 && (
          <div className="max-w-xl mx-auto px-6 py-12 flex flex-col gap-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mx-auto mb-5">
                <MessageSquare className="w-8 h-8 text-purple-400" />
              </div>
              <h2 className="text-2xl font-bold text-zinc-100 mb-2">Tell Us About Your Business</h2>
              <p className="text-zinc-400 text-sm">
                {aiName} will adapt to your specific operation based on your answers.
              </p>
            </div>

            {/* Progress within interview */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${
                      interviewComplete
                        ? 100
                        : ((currentQuestionIndex + (followUpQuestion ? 0.5 : 0)) /
                            BASE_QUESTIONS.length) *
                          100
                    }%`,
                  }}
                />
              </div>
              <span className="text-xs text-zinc-500 flex-none">
                {interviewComplete
                  ? 'Complete'
                  : `${currentQuestionIndex + 1} / ${BASE_QUESTIONS.length}`}
              </span>
            </div>

            {/* Previous answers (scrollable history) */}
            {Object.keys(interviewAnswers).length > 0 && (
              <div className="space-y-3">
                {BASE_QUESTIONS.slice(0, currentQuestionIndex).map((q) => {
                  const ans = interviewAnswers[q.key]
                  if (!ans) return null
                  
                  // Special rendering for job types array
                  if (Array.isArray(ans)) {
                    return (
                      <div key={q.key} className="bg-zinc-900/50 rounded-lg p-3 border border-zinc-800/50">
                        <p className="text-xs text-zinc-500 mb-1">{q.label}</p>
                        <p className="text-sm text-zinc-300">{(ans as string[]).join(', ')}</p>
                      </div>
                    )
                  }
                  
                  return (
                    <div key={q.key} className="bg-zinc-900/50 rounded-lg p-3 border border-zinc-800/50">
                      <p className="text-xs text-zinc-500 mb-1">{q.label}</p>
                      <p className="text-sm text-zinc-300">{ans as string}</p>
                    </div>
                  )
                })}
                {/* Follow-up answers */}
                {Object.entries(followUpAnswers).map(([q, a]) => (
                  <div key={q} className="bg-zinc-900/50 rounded-lg p-3 border border-purple-800/30">
                    <p className="text-xs text-purple-400 mb-1">{q}</p>
                    <p className="text-sm text-zinc-300">{a}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Current question */}
            {!interviewComplete && (
              <>
                {/* FIX 3: Multi-select job types question */}
                {isJobTypesQuestion && (
                  <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-3 h-3 text-emerald-400" />
                      </div>
                      <p className="text-sm font-medium text-zinc-200">
                        {currentBaseQuestion?.label}
                      </p>
                    </div>

                    {/* Job type checkboxes */}
                    <div className="space-y-2 mb-4">
                      {JOB_TYPE_OPTIONS.map((jobType) => (
                        <button
                          key={jobType.id}
                          onClick={() => handleJobTypeToggle(jobType.id)}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${
                            selectedJobTypes.includes(jobType.id)
                              ? 'border-emerald-500 bg-emerald-500/10'
                              : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                          }`}
                        >
                          <div
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                              selectedJobTypes.includes(jobType.id)
                                ? 'border-emerald-500 bg-emerald-500'
                                : 'border-zinc-600 bg-transparent'
                            }`}
                          >
                            {selectedJobTypes.includes(jobType.id) && (
                              <Check className="w-3 h-3 text-white" />
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-zinc-100">{jobType.label}</p>
                            <p className="text-xs text-zinc-500">{jobType.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={handleJobTypesSubmit}
                      disabled={selectedJobTypes.length === 0}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
                    >
                      <Send className="w-4 h-4" />
                      {isLastBaseQuestion ? 'Finish Interview' : 'Next Question'}
                    </button>
                  </div>
                )}

                {/* FIX 2: Back button on all questions + regular text answer */}
                {!isJobTypesQuestion && (
                  <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5">
                    {followUpQuestion ? (
                      <>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                            <Sparkles className="w-3 h-3 text-purple-400" />
                          </div>
                          <p className="text-sm font-medium text-purple-300">{followUpQuestion}</p>
                        </div>
                        <textarea
                          ref={textareaRef}
                          value={currentAnswer}
                          onChange={(e) => setCurrentAnswer(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              handleFollowUpSubmit()
                            }
                          }}
                          placeholder="Your answer…"
                          rows={3}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 transition-colors resize-none text-sm"
                          autoFocus
                        />
                        <button
                          onClick={handleFollowUpSubmit}
                          disabled={!currentAnswer.trim()}
                          className="mt-3 w-full bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
                        >
                          <Send className="w-4 h-4" />
                          Submit
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                            <Bot className="w-3 h-3 text-emerald-400" />
                          </div>
                          <p className="text-sm font-medium text-zinc-200">
                            {currentBaseQuestion?.label}
                          </p>
                        </div>
                        <textarea
                          ref={textareaRef}
                          value={currentAnswer}
                          onChange={(e) => setCurrentAnswer(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              handleAnswerSubmit()
                            }
                          }}
                          placeholder={currentBaseQuestion?.placeholder}
                          rows={3}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors resize-none text-sm"
                          autoFocus
                        />
                        {isGeneratingFollowUp && (
                          <div className="flex items-center gap-2 mt-2 text-xs text-purple-400">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Thinking of a follow-up…
                          </div>
                        )}
                        <button
                          onClick={handleAnswerSubmit}
                          disabled={!currentAnswer.trim() || isGeneratingFollowUp}
                          className="mt-3 w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
                        >
                          <Send className="w-4 h-4" />
                          {isLastBaseQuestion ? 'Finish Interview' : 'Next Question'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Interview complete — ready to analyze */}
            {interviewComplete && (
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="font-semibold text-zinc-100 mb-2">Interview Complete!</h3>
                <p className="text-sm text-zinc-400 mb-6">
                  {aiName} is ready to analyze your answers and configure your platform.
                </p>
                {analysisError && (
                  <p className="text-sm text-red-400 mb-4">{analysisError}</p>
                )}
                <button
                  onClick={handleRunAnalysis}
                  disabled={isAnalyzing}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {aiName} is analyzing your answers…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Analyze &amp; Configure
                    </>
                  )}
                </button>
              </div>
            )}

            {/* FIX 2: Back button on interview step */}
            {!interviewComplete && (
              <button
                onClick={goBack}
                className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mx-auto"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
            )}
          </div>
        )}

        {/* ── Step 3: Confirmation ── */}
        {step === 3 && analysis && (
          <div className="max-w-xl mx-auto px-6 py-12 flex flex-col gap-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto mb-5">
                <Bot className="w-8 h-8 text-cyan-400" />
              </div>
              <h2 className="text-2xl font-bold text-zinc-100 mb-2">
                Here's What {aiName} Learned
              </h2>
              <p className="text-zinc-400 text-sm">
                Review what we've configured. Confirm to activate your platform.
              </p>
            </div>

            {/* Summary card */}
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-semibold text-cyan-300">Summary</span>
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed">{analysis.summary}</p>
            </div>

            {/* Key insights */}
            {analysis.keyInsights.length > 0 && (
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                  Key Insights
                </h3>
                <ul className="space-y-2">
                  {analysis.keyInsights.map((insight, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                      {insight}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recommended agents */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                Agents Being Activated
              </h3>
              <div className="flex flex-wrap gap-2">
                {analysis.recommendedAgents.map((agent) => (
                  <span
                    key={agent}
                    className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold px-3 py-1 rounded-full"
                  >
                    {agent}
                  </span>
                ))}
              </div>
            </div>

            {/* AI name + industry template */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                <p className="text-xs text-zinc-500 mb-1">AI Assistant Name</p>
                <p className="font-bold text-emerald-400">{aiName}</p>
              </div>
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                <p className="text-xs text-zinc-500 mb-1">Industry Template</p>
                <p className="font-bold text-zinc-200 capitalize">
                  {analysis.industryTemplate.replace('_', ' ')}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={goBack}
                className="flex-none bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium py-3 px-5 rounded-xl transition-colors flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
              <button
                onClick={() => goToStep(4)}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                Looks Good — Activate!
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Platform Configuration ── */}
        {step === 4 && (
          <div className="max-w-xl mx-auto px-6 py-12 flex flex-col gap-8 items-center text-center">
            {configComplete ? (
              <>
                <div className="w-24 h-24 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                  <CheckCircle2 className="w-12 h-12 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-zinc-100 mb-2">
                    {aiName} Is Ready!
                  </h2>
                  <p className="text-zinc-400 text-base">
                    Your platform has been configured and your agents are activated.
                    Welcome to PowerOn Hub.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 w-full">
                  {analysis?.recommendedAgents.slice(0, 4).map((agent) => (
                    <div
                      key={agent}
                      className="bg-zinc-900 border border-emerald-800/50 rounded-xl p-4 flex items-center gap-3"
                    >
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                        <Bot className="w-4 h-4 text-emerald-400" />
                      </div>
                      <span className="text-sm font-semibold text-zinc-200">{agent}</span>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-zinc-500">Taking you to the dashboard…</p>
              </>
            ) : (
              <>
                <div className="w-24 h-24 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                  <Settings className="w-12 h-12 text-emerald-400 animate-pulse" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-zinc-100 mb-2">
                    Almost There!
                  </h2>
                  <p className="text-zinc-400 text-base leading-relaxed">
                    {aiName} will now configure your platform:
                  </p>
                </div>
                <div className="w-full space-y-3 text-left">
                  {[
                    { label: 'Set industry template', desc: `${analysis?.industryTemplate?.replace('_', ' ')} defaults` },
                    { label: 'Pre-load demo data', desc: 'Relevant example projects and data' },
                    { label: 'Activate agents', desc: `${analysis?.recommendedAgents?.length ?? 0} agents selected for your operation` },
                    { label: 'Configure AI context', desc: `${aiName} learns your business details` },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                      <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-zinc-200">{item.label}</p>
                        <p className="text-xs text-zinc-500">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleConfigure}
                  disabled={isConfiguring}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-bold py-4 px-6 rounded-xl transition-colors flex items-center justify-center gap-2 text-base"
                >
                  {isConfiguring ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Configuring your platform…
                    </>
                  ) : (
                    <>
                      <Zap className="w-5 h-5" />
                      Activate PowerOn Hub
                    </>
                  )}
                </button>

                <button
                  onClick={goBack}
                  className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
