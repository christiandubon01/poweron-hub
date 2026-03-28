// @ts-nocheck
/**
 * OnboardingModal — 5-step guided setup for new users
 *
 * Steps:
 *   1. Welcome — App overview, what PowerOn Hub does
 *   2. Profile Setup — Name, role, phone
 *   3. Company Info — Org name, license, service area
 *   4. First Project — Quick-create a project to get started
 *   5. Meet Your Agents — Tour of the 11 AI agents
 *
 * Shows only when profiles.onboarding_completed = false
 */

import { useState, useEffect } from 'react'
import {
  Zap, User, Building2, FolderPlus, Bot, Bell,
  ChevronRight, ChevronLeft, X, CheckCircle2, Sparkles,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { requestPermission as requestNotifPermission } from '@/services/notifications'

// ── Types ────────────────────────────────────────────────────────────────────

interface OnboardingStep {
  id: string
  title: string
  subtitle: string
  icon: typeof Zap
  color: string
}

const STEPS: OnboardingStep[] = [
  { id: 'welcome',       title: 'Welcome to PowerOn Hub',   subtitle: 'Your AI-powered operations platform', icon: Zap,        color: 'text-emerald-400' },
  { id: 'profile',       title: 'Set Up Your Profile',      subtitle: 'Tell us about yourself',              icon: User,       color: 'text-cyan-400' },
  { id: 'company',       title: 'Company Information',       subtitle: 'Configure your organization',         icon: Building2,  color: 'text-purple-400' },
  { id: 'first_project', title: 'Create Your First Project', subtitle: 'Get started with a real job',         icon: FolderPlus, color: 'text-orange-400' },
  { id: 'meet_agents',   title: 'Meet Your AI Agents',       subtitle: '11 specialists ready to help',        icon: Bot,        color: 'text-pink-400' },
]

const AGENTS_PREVIEW = [
  { name: 'NEXUS',     role: 'Central command & routing',      color: 'text-emerald-400' },
  { name: 'VAULT',     role: 'Estimating & cost tracking',     color: 'text-yellow-400' },
  { name: 'PULSE',     role: 'Financial dashboard & KPIs',     color: 'text-blue-400' },
  { name: 'BLUEPRINT', role: 'Project management',             color: 'text-purple-400' },
  { name: 'LEDGER',    role: 'Invoicing & payments',           color: 'text-teal-400' },
  { name: 'SPARK',     role: 'Marketing & lead generation',    color: 'text-pink-400' },
  { name: 'CHRONO',    role: 'Scheduling & calendar',          color: 'text-orange-400' },
  { name: 'OHM',       role: 'NEC code lookup & calculator',   color: 'text-lime-400' },
  { name: 'SCOUT',     role: 'Team proposals & code analysis', color: 'text-red-400' },
  { name: 'ECHO',      role: 'Voice assistant',                color: 'text-cyan-400' },
  { name: 'ATLAS',     role: 'Data insights & reporting',      color: 'text-indigo-400' },
]

// ── Component ────────────────────────────────────────────────────────────────

export default function OnboardingModal({ onComplete }: { onComplete: () => void }) {
  const { profile, userId } = useAuth()
  const [currentStep, setCurrentStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Form data
  const [formData, setFormData] = useState({
    fullName: profile?.full_name || '',
    role: profile?.role || 'owner',
    phone: '',
    orgName: '',
    licenseNumber: '',
    serviceArea: '',
    projectName: '',
    projectType: 'residential_remodel',
  })

  const step = STEPS[currentStep]
  const isFirst = currentStep === 0
  const isLast = currentStep === STEPS.length - 1

  function updateField(key: string, value: string) {
    setFormData(prev => ({ ...prev, [key]: value }))
  }

  async function handleNext() {
    if (isLast) {
      await completeOnboarding()
      return
    }
    setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1))
  }

  async function handleSkip() {
    await completeOnboarding(true)
  }

  async function completeOnboarding(skipped = false) {
    setSaving(true)
    try {
      // Update profile
      if (formData.fullName) {
        await supabase
          .from('profiles' as never)
          .update({
            full_name: formData.fullName,
            onboarding_completed: true,
            onboarding_completed_at: new Date().toISOString(),
          })
          .eq('id', userId)
      }

      // Save progress
      await supabase
        .from('onboarding_progress' as never)
        .upsert({
          user_id: userId,
          org_id: profile?.org_id,
          step_welcome: currentStep >= 0,
          step_profile: currentStep >= 1,
          step_company: currentStep >= 2,
          step_first_project: currentStep >= 3,
          step_meet_agents: currentStep >= 4,
          current_step: currentStep,
          completed_at: !skipped ? new Date().toISOString() : null,
          skipped,
        }, { onConflict: 'user_id' })

      // Create first project if filled in
      if (formData.projectName && currentStep >= 3) {
        await supabase
          .from('projects' as never)
          .insert({
            org_id: profile?.org_id,
            name: formData.projectName,
            type: formData.projectType,
            status: 'planning',
            created_by: userId,
          })
      }

      onComplete()
    } catch (err) {
      console.error('[onboarding] Save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  // ── Step Content ───────────────────────────────────────────────────────────

  function renderStepContent() {
    switch (currentStep) {
      case 0: // Welcome
        return (
          <div className="text-center space-y-4">
            <div className="w-20 h-20 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 mx-auto flex items-center justify-center">
              <Zap className="text-emerald-400" size={40} />
            </div>
            <h2 className="text-2xl font-bold text-white">Welcome to PowerOn Hub</h2>
            <p className="text-gray-400 max-w-md mx-auto">
              Your AI-powered operations platform designed for electrical contractors.
              11 specialized agents handle estimating, scheduling, invoicing, marketing, and more —
              so you can focus on the work.
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-emerald-400">
              <Sparkles size={16} />
              <span>Let's get you set up in under 2 minutes</span>
            </div>
          </div>
        )

      case 1: // Profile
        return (
          <div className="space-y-4 max-w-md mx-auto">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Full Name</label>
              <input
                type="text"
                value={formData.fullName}
                onChange={e => updateField('fullName', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                placeholder="Christian Dubon"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Your Role</label>
              <select
                value={formData.role}
                onChange={e => updateField('role', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="owner">Owner / Operator</option>
                <option value="master_electrician">Master Electrician</option>
                <option value="journeyman">Journeyman</option>
                <option value="apprentice">Apprentice</option>
                <option value="office_manager">Office Manager</option>
                <option value="estimator">Estimator</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Phone (optional)</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={e => updateField('phone', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                placeholder="(760) 555-0123"
              />
            </div>
          </div>
        )

      case 2: // Company
        return (
          <div className="space-y-4 max-w-md mx-auto">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Company Name</label>
              <input
                type="text"
                value={formData.orgName}
                onChange={e => updateField('orgName', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                placeholder="Power On Solutions"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">License Number (optional)</label>
              <input
                type="text"
                value={formData.licenseNumber}
                onChange={e => updateField('licenseNumber', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                placeholder="C-10 #123456"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Service Area</label>
              <input
                type="text"
                value={formData.serviceArea}
                onChange={e => updateField('serviceArea', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                placeholder="Coachella Valley, CA"
              />
            </div>
          </div>
        )

      case 3: // First Project
        return (
          <div className="space-y-4 max-w-md mx-auto">
            <p className="text-gray-400 text-sm text-center">
              Create a project to see how BLUEPRINT, VAULT, and PULSE work together.
              You can skip this and add projects later.
            </p>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Project Name</label>
              <input
                type="text"
                value={formData.projectName}
                onChange={e => updateField('projectName', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                placeholder="e.g., Kitchen Remodel — Johnson Residence"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Project Type</label>
              <select
                value={formData.projectType}
                onChange={e => updateField('projectType', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="residential_remodel">Residential Remodel</option>
                <option value="residential_new">New Construction</option>
                <option value="commercial_ti">Commercial TI</option>
                <option value="residential_service">Service Call</option>
                <option value="panel_upgrade">Panel Upgrade</option>
                <option value="ev_charger">EV Charger</option>
                <option value="solar">Solar</option>
              </select>
            </div>
          </div>
        )

      case 4: // Meet Agents
        return (
          <div className="space-y-3 max-w-lg mx-auto">
            <p className="text-gray-400 text-sm text-center mb-4">
              These AI agents work together behind the scenes. Talk to any of them through NEXUS.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {AGENTS_PREVIEW.map(agent => (
                <div
                  key={agent.name}
                  className="flex items-center gap-2 bg-gray-800/50 rounded-lg p-2 border border-gray-700/50"
                >
                  <Bot size={14} className={agent.color} />
                  <div>
                    <span className={`text-xs font-bold ${agent.color}`}>{agent.name}</span>
                    <p className="text-[10px] text-gray-500 leading-tight">{agent.role}</p>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={async () => {
                const granted = await requestNotifPermission()
                if (granted) {
                  console.log('[onboarding] Notification permission granted')
                }
              }}
              className="mx-auto mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600/20 border border-cyan-600/30 text-cyan-400 text-sm hover:bg-cyan-600/30 transition-colors"
            >
              <Bell size={14} />
              Enable Push Notifications
            </button>
          </div>
        )

      default:
        return null
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
        {/* Progress Bar */}
        <div className="flex gap-1 p-3 pb-0">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                i <= currentStep ? 'bg-emerald-500' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Step Header */}
        <div className="flex items-center justify-between px-6 pt-4 pb-2">
          <div className="flex items-center gap-3">
            <step.icon className={step.color} size={20} />
            <div>
              <h3 className="text-white font-semibold text-sm">{step.title}</h3>
              <p className="text-gray-500 text-xs">{step.subtitle}</p>
            </div>
          </div>
          <button
            onClick={handleSkip}
            className="text-gray-500 hover:text-gray-300 text-xs transition-colors"
          >
            Skip setup
          </button>
        </div>

        {/* Step Content */}
        <div className="px-6 py-6 min-h-[280px] flex flex-col justify-center">
          {renderStepContent()}
        </div>

        {/* Footer Navigation */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800">
          <button
            onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
            disabled={isFirst}
            className={`flex items-center gap-1 text-sm px-3 py-2 rounded-lg transition-colors ${
              isFirst
                ? 'text-gray-600 cursor-not-allowed'
                : 'text-gray-300 hover:bg-gray-800'
            }`}
          >
            <ChevronLeft size={16} />
            Back
          </button>

          <span className="text-gray-600 text-xs">
            {currentStep + 1} of {STEPS.length}
          </span>

          <button
            onClick={handleNext}
            disabled={saving}
            className="flex items-center gap-1 text-sm px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : isLast ? (
              <>
                <CheckCircle2 size={16} />
                Get Started
              </>
            ) : (
              <>
                Next
                <ChevronRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
