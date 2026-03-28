/**
 * ProjectPanel — Dark-themed project list with status tabs.
 *
 * Features:
 * - Filter by status tabs (estimate, approved, in_progress, punch_list, completed, canceled)
 * - Status badges with color coding
 * - Phase progress bar
 * - Contract value display
 * - Click to expand project detail
 */

import { useState, useEffect, useCallback } from 'react'
import { Folder, Plus, Loader2, ChevronRight, DollarSign } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { getBackupData, mapBackupProjects, isSupabaseConfigured } from '@/services/backupDataService'

// ── Types ───────────────────────────────────────────────────────────────────

export interface Project {
  id: string
  name: string
  type: string
  status: 'estimate' | 'approved' | 'in_progress' | 'punch_list' | 'completed' | 'canceled'
  contract_value: number | null
  estimated_value: number | null
  phases: Array<{ name: string; status: string }> | null
  client_id: string | null
  created_at: string
  clients?: { name: string }
}

type ProjectStatus = Project['status'] | 'all'

const STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string; bgColor: string }> = {
  all: { label: 'All', color: 'text-gray-300', bgColor: 'bg-gray-700/30' },
  estimate: { label: 'Estimate', color: 'text-cyan-400', bgColor: 'bg-cyan-400/10' },
  approved: { label: 'Approved', color: 'text-emerald-400', bgColor: 'bg-emerald-400/10' },
  in_progress: { label: 'In Progress', color: 'text-blue-400', bgColor: 'bg-blue-400/10' },
  punch_list: { label: 'Punch List', color: 'text-yellow-400', bgColor: 'bg-yellow-400/10' },
  completed: { label: 'Completed', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
  canceled: { label: 'Canceled', color: 'text-red-400', bgColor: 'bg-red-400/10' },
}

// ── Component ───────────────────────────────────────────────────────────────

export interface ProjectPanelProps {
  onSelectProject?: (projectId: string) => void
  selectedProjectId?: string | null
  onCreateProject?: () => void
}

export function ProjectPanel({
  onSelectProject,
  selectedProjectId,
  onCreateProject,
}: ProjectPanelProps) {
  const { profile } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [filterStatus, setFilterStatus] = useState<ProjectStatus>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const orgId = profile?.org_id

  // ── Fetch projects ─────────────────────────────────────────────────────────
  const fetchProjects = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)

    try {
      let query = supabase
        .from('projects')
        .select(
          `
          id,
          name,
          type,
          status,
          contract_value,
          estimated_value,
          phases,
          client_id,
          created_at,
          clients ( name )
        `
        )
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })

      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus)
      }

      const { data, error: queryError } = await query

      if (queryError) {
        throw new Error(queryError.message)
      }

      const results = (data || []) as Project[]
      // If Supabase returned nothing, try backup data
      if (results.length === 0) {
        const backup = getBackupData()
        if (backup && backup.projects.length > 0) {
          setProjects(mapBackupProjects(backup) as any)
          setLoading(false)
          return
        }
      }
      setProjects(results)
    } catch (err) {
      // On error, fall back to backup data if available
      const backup = getBackupData()
      if (backup && backup.projects.length > 0) {
        setProjects(mapBackupProjects(backup) as any)
        setError(null)
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load projects')
      }
    } finally {
      setLoading(false)
    }
  }, [orgId, filterStatus])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // ── Calculate phase progress ───────────────────────────────────────────────
  const getPhaseProgress = (phases: any): number => {
    if (!Array.isArray(phases) || phases.length === 0) return 0
    const completed = phases.filter((p: any) => p.status === 'completed').length
    return Math.round((completed / phases.length) * 100)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading && projects.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-900 rounded-lg border border-gray-800">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    )
  }

  const filteredProjects = filterStatus === 'all' ? projects : projects.filter((p) => p.status === filterStatus)

  return (
    <div className="space-y-4">
      {/* Header with create button */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-100">Projects</h2>
        {onCreateProject && (
          <button
            onClick={onCreateProject}
            className="flex items-center gap-2 px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        )}
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 border-b border-gray-800">
        {(['all', 'estimate', 'approved', 'in_progress', 'punch_list', 'completed', 'canceled'] as const).map(
          (status) => {
            const config = STATUS_CONFIG[status]
            const isActive = filterStatus === status
            return (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={clsx(
                  'px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                  isActive ? `${config.bgColor} ${config.color}` : 'text-gray-400 hover:text-gray-300'
                )}
              >
                {config.label}
              </button>
            )
          }
        )}
      </div>

      {/* Projects list */}
      {error && <div className="p-3 bg-red-900/20 text-red-300 rounded-lg">{error}</div>}

      {filteredProjects.length === 0 ? (
        <div className="p-8 text-center text-gray-400 bg-gray-800/30 rounded-lg border border-gray-700">
          <Folder className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No projects found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredProjects.map((project) => {
            const statusConfig = STATUS_CONFIG[project.status]
            const progress = getPhaseProgress(project.phases)
            const isSelected = selectedProjectId === project.id

            return (
              <button
                key={project.id}
                onClick={() => onSelectProject?.(project.id)}
                className={clsx(
                  'w-full p-4 rounded-lg border transition-colors text-left',
                  isSelected
                    ? 'bg-gray-800 border-cyan-400/30 shadow-lg shadow-cyan-400/10'
                    : 'bg-gray-800/50 border-gray-700 hover:bg-gray-800 hover:border-gray-600'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Project name and type */}
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-gray-100 truncate">{project.name}</h3>
                      <span className={clsx('px-2 py-1 text-xs rounded', statusConfig.bgColor, statusConfig.color)}>
                        {statusConfig.label}
                      </span>
                    </div>

                    {/* Client name */}
                    {project.clients && (
                      <p className="text-sm text-gray-400 mb-2">{project.clients.name}</p>
                    )}

                    {/* Phase progress bar */}
                    <div className="mb-2">
                      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={clsx(
                            'h-full transition-all',
                            progress === 100 ? 'bg-emerald-500' : progress > 50 ? 'bg-cyan-400' : 'bg-yellow-400'
                          )}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-400 mt-1">{progress}% phases complete</p>
                    </div>

                    {/* Contract value */}
                    {project.contract_value && (
                      <div className="flex items-center gap-1 text-sm text-emerald-400">
                        <DollarSign className="w-3 h-3" />
                        {project.contract_value.toLocaleString('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          minimumFractionDigits: 0,
                        })}
                      </div>
                    )}
                  </div>

                  {/* Chevron */}
                  <ChevronRight
                    className={clsx(
                      'w-5 h-5 text-gray-500 flex-shrink-0 transition-transform',
                      isSelected && 'text-cyan-400 rotate-90'
                    )}
                  />
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
