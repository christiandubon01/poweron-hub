// @ts-nocheck
/**
 * V15rTemplatesPanel — Project Templates with usage tracking and phase management
 *
 * Features:
 * - Template count and statistics
 * - Archived jobs linked count
 * - Task seeds total
 * - Template cards grid with:
 *   - Template name and type badge
 *   - Default labor and travel values
 *   - Usage tracking (active and archived projects)
 *   - Phases activated as colored pills
 *   - Risk notes as yellow pills
 *   - Action buttons (Use for New Project, Edit, Duplicate)
 * - "Use for New Project" button opens modal to create new project from template
 * - "AI Estimate Helper" placeholder button
 */

import { useMemo, useState, useCallback } from 'react'
import { Plus, Edit2, Copy, Sparkles } from 'lucide-react'
import {
  getBackupData,
  saveBackupData,
  type BackupTemplate,
  type BackupProject,
  type BackupData,
} from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { callClaude, extractText } from '@/services/claudeProxy'

const PHASE_COLORS: Record<string, string> = {
  'Site Prep': 'bg-red-500/20 text-red-400',
  'Rough-in': 'bg-orange-500/20 text-orange-400',
  'Planning': 'bg-yellow-500/20 text-yellow-400',
  'Trim/Finish': 'bg-blue-500/20 text-blue-400',
  'Estimating': 'bg-purple-500/20 text-purple-400',
}

function getPhaseColor(phase: string): string {
  return PHASE_COLORS[phase] || 'bg-gray-500/20 text-gray-400'
}

function countTasksInTemplate(template: BackupTemplate): number {
  if (!template.tasks) return 0
  return (Object.values(template.tasks) || []).reduce((sum, phaseList) => {
    return sum + (Array.isArray(phaseList) ? phaseList.length : 0)
  }, 0)
}

function getTemplateUsage(
  templateId: string,
  projects: BackupProject[]
): { active: number; archived: number } {
  let active = 0;
  let archived = 0;

  (projects || []).forEach((p) => {
    if (p.templateId === templateId) {
      if (p.status === 'completed') {
        archived++
      } else {
        active++
      }
    }
  })

  return { active, archived }
}

function NoData() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#1a1d27]">
      <div className="text-center">
        <p className="text-gray-400 text-lg">No backup data available</p>
        <p className="text-gray-600 text-sm mt-2">Import a backup to get started</p>
      </div>
    </div>
  )
}

export default function V15rTemplatesPanel() {
  const backup = getBackupData()
  if (!backup) return <NoData />

  const templates = backup.templates || []
  const projects = backup.projects || []
  const completedArchive = backup.completedArchive || []

  const [showUseModal, setShowUseModal] = useState<string | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [aiEstimate, setAiEstimate] = useState<string | null>(null)
  const [aiEstimateLoading, setAiEstimateLoading] = useState(false)

  const stats = useMemo(() => {
    const templateCount = (templates || []).length
    const archivedJobsLinked = (completedArchive || []).length
    const taskSeeds = (templates || []).reduce((sum, t) => sum + countTasksInTemplate(t), 0)
    return { templateCount, archivedJobsLinked, taskSeeds }
  }, [templates, completedArchive])

  function createProjectFromTemplate(templateId: string, projectName: string) {
    if (!projectName.trim()) {
      alert('Please enter a project name')
      return
    }
    const template = templates.find(t => t.id === templateId)
    if (!template) return

    pushState(backup)
    const newProject: any = {
      id: 'proj' + Date.now(),
      name: projectName,
      type: template.type || '',
      templateId: templateId,
      status: 'active',
      contract: 0,
      billed: 0,
      paid: 0,
      phases: {},
      logs: [],
      tasks: template.tasks ? { ...template.tasks } : {},
      activatedPhases: template.activatedPhases || Object.keys(template.tasks || {}),
    }

    backup.projects = [...(projects || []), newProject]
    saveBackupData(backup)
    setShowUseModal(null)
    setNewProjectName('')
    alert(`Project "${projectName}" created from template "${template.name}"`)
  }

  return (
    <div className="min-h-screen bg-[#1a1d27] p-5 space-y-6">
      {/* HEADER */}
      <div>
        <h1 className="text-3xl font-bold text-gray-100 mb-1">Project Templates</h1>
        <p className="text-sm text-gray-400">
          Reusable project blueprints with task seeds and phases
        </p>
      </div>

      {/* STATS CARDS */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[#232738] rounded-lg border border-gray-700 p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Template Count
          </div>
          <div className="text-3xl font-bold text-blue-400">{stats.templateCount}</div>
        </div>

        <div className="bg-[#232738] rounded-lg border border-gray-700 p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Archived Jobs Linked
          </div>
          <div className="text-3xl font-bold text-emerald-400">
            {stats.archivedJobsLinked}
          </div>
        </div>

        <div className="bg-[#232738] rounded-lg border border-gray-700 p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Task Seeds
          </div>
          <div className="text-3xl font-bold text-purple-400">{stats.taskSeeds}</div>
        </div>
      </div>

      {/* TEMPLATES GRID */}
      {(templates || []).length === 0 ? (
        <div className="text-center py-16 bg-[#232738] rounded-lg border border-gray-700">
          <p className="text-gray-400 text-lg">No templates yet</p>
          <p className="text-gray-600 text-sm mt-2">Create a template to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {(templates || []).map((template) => {
            const usage = getTemplateUsage(template.id, projects || [])
            const taskCount = countTasksInTemplate(template)
            const phasesActivated = template.activatedPhases || (Object.keys(template.tasks || {}) || [])

            return (
              <div
                key={template.id}
                className="bg-[#232738] rounded-lg border border-gray-700 p-4 space-y-4 hover:border-gray-600 transition"
              >
                {/* Header: Name + Type Badge */}
                <div>
                  <h3 className="font-bold text-gray-100 text-lg mb-2">
                    {template.name}
                  </h3>
                  {template.type && (
                    <span className="inline-block bg-cyan-500/20 text-cyan-400 text-xs font-semibold px-2.5 py-1 rounded-full">
                      {template.type}
                    </span>
                  )}
                </div>

                {/* Default Labor & Travel */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {template.laborDefault && (
                    <div className="bg-[#1a1d27] rounded px-3 py-2">
                      <div className="text-xs font-semibold text-gray-500 uppercase mb-1">
                        Default Labor
                      </div>
                      <div className="text-blue-400 font-semibold">
                        {template.laborDefault} hrs
                      </div>
                    </div>
                  )}
                  {template.travelDefault && (
                    <div className="bg-[#1a1d27] rounded px-3 py-2">
                      <div className="text-xs font-semibold text-gray-500 uppercase mb-1">
                        Default Travel
                      </div>
                      <div className="text-emerald-400 font-semibold">
                        {template.travelDefault} mi
                      </div>
                    </div>
                  )}
                </div>

                {/* Usage */}
                <div className="text-sm text-gray-400">
                  <span className="font-semibold text-gray-300">Usage:</span>{' '}
                  <span className="text-emerald-400">{usage.active} active</span>,
                  <span className="text-gray-500 ml-1">{usage.archived} archived</span>
                </div>

                {/* Phases Activated */}
                {phasesActivated.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-2">
                      Phases Activated
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {phasesActivated.map((phase) => (
                        <span
                          key={phase}
                          className={`text-xs font-semibold px-2 py-1 rounded-full ${getPhaseColor(phase)}`}
                        >
                          {phase}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Default Tasks Count */}
                <div className="text-sm bg-[#1a1d27] rounded px-3 py-2">
                  <div className="text-xs font-semibold text-gray-500 uppercase mb-1">
                    Default Tasks
                  </div>
                  <div className="text-purple-400 font-semibold">{taskCount}</div>
                </div>

                {/* Risk Notes */}
                {(template.riskNotes || []).length > 0 && (
                  <div>
                    <div className="flex flex-wrap gap-1">
                      {(template.riskNotes || []).map((note, idx) => (
                        <span
                          key={idx}
                          className="text-xs font-semibold px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-400"
                        >
                          {note}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowUseModal(template.id)}
                      className="flex-1 px-3 py-2 bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 rounded-lg text-sm font-medium flex items-center justify-center gap-1 transition"
                    >
                      <Plus size={14} />
                      Use for New Project
                    </button>
                    <button className="p-2 bg-blue-600/30 hover:bg-blue-600/40 text-blue-300 rounded-lg transition">
                      <Edit2 size={14} />
                    </button>
                    <button className="p-2 bg-purple-600/30 hover:bg-purple-600/40 text-purple-300 rounded-lg transition">
                      <Copy size={14} />
                    </button>
                  </div>

                  <button
                    onClick={async () => {
                      setAiEstimateLoading(true)
                      try {
                        const response = await callClaude({
                          system: 'You are VAULT, the estimating agent for Power On Solutions, a C-10 electrical contractor in Coachella Valley, CA. Provide actionable estimate suggestions.',
                          messages: [{ role: 'user', content: `Based on this project template:\nName: ${template?.name || 'Unknown'}\nType: ${template?.type || 'General'}\nPhases: ${JSON.stringify(template?.phases || {})}\n\nSuggest estimate line items, typical labor hours, material categories, and margin targets for this job type in the Coachella Valley electrical market. Keep under 250 words.` }],
                          max_tokens: 640,
                        })
                        setAiEstimate(extractText(response))
                      } catch { setAiEstimate('Analysis unavailable') }
                      setAiEstimateLoading(false)
                    }}
                    disabled={aiEstimateLoading}
                    className="w-full px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1 disabled:opacity-50"
                  >
                    <Sparkles size={14} /> {aiEstimateLoading ? 'Analyzing...' : 'AI Estimate Helper'}
                  </button>

                  {aiEstimate && (
                    <div className="mt-3 p-4 bg-purple-900/20 border border-purple-500/20 rounded-lg">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-purple-400 text-xs font-medium">AI Estimate Suggestions</span>
                        <button onClick={() => setAiEstimate(null)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
                      </div>
                      <p className="text-gray-300 text-sm whitespace-pre-wrap">{aiEstimate}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal: Use for New Project */}
      {showUseModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#232738] rounded-lg border border-gray-700 p-6 max-w-sm w-full">
            <h2 className="text-lg font-bold text-gray-100 mb-4">Create Project from Template</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-2">Project Name</label>
                <input
                  type="text"
                  placeholder="Enter project name"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1a1d27] text-gray-100 border border-gray-700 rounded-lg focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => createProjectFromTemplate(showUseModal, newProjectName)}
                  className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowUseModal(null)
                    setNewProjectName('')
                  }}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-semibold transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
