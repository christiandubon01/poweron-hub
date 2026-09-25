import type { PlanReviewModel, PlanReviewTask } from './controlTowerAdapter'

/** Mirrors agent-host CANONICAL_PROTECTED_REPO_PATHS. Browser code does not import the host policy module. */
const PROTECTED_PATHS = [
  'netlify.toml',
  'src/store/authStore.ts',
  'src/services/backupDataService.ts',
  'vite.config.ts',
  'src/components/v15r/charts/SVGCharts.tsx',
]

const DEPENDENCY_MANIFESTS = new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'])

export type ElevatedChange =
  | 'Migration'
  | 'New dependency'
  | 'Protected-path touch'
  | 'Authentication/security change'
  | 'Remote mutation'
  | 'Owner decision required'

export function formatPlanningElapsed(ms: number): string {
  return `Planning · ${formatDuration(ms)}`
}

export function formatArchitectElapsed(ms: number): string {
  return `Architect working · ${formatDuration(ms)}`
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`
}

export function planSummaryLines(plan: PlanReviewModel): string[] {
  const objective = clip(plan.objective.trim() || 'No objective was reported.', 220)
  const first = plan.tasks[0]
  const approach = first
    ? `${first.role}: ${clip(first.title || first.goal, 160)}`
    : 'No implementation tasks.'
  const risk = plan.riskSummary?.trim()
    ? clip(plan.riskSummary.trim(), 220)
    : 'No risk summary was reported.'
  const elevated = elevatedChanges(plan)
  const owner = elevated.length > 0
    ? `Before approval: ${elevated.join(', ')}.`
    : 'Before approval: no elevated changes were found in this plan.'
  return [objective, approach, risk, owner].slice(0, 5)
}

export function planFactChips(plan: PlanReviewModel): string[] {
  const paths = writePaths(plan)
  const migrations = paths.filter(isMigrationPath)
  const chips = [
    plan.tasks.length === 1 ? '1 task' : `${plan.tasks.length} tasks`,
    migrations.length === 1 ? '1 local migration' : `${migrations.length} local migrations`,
    paths.some(isDependencyManifest) ? 'Dependency manifest in scope' : 'No dependency manifest changes',
    paths.some(isProtectedPath) ? 'Protected path in scope' : 'No protected paths',
  ]
  const verifiers = plan.tasks.filter(task => task.role === 'Verifier')
  if (verifiers.length > 0 && verifiers.every(task => task.authorizedWritePaths.length === 0)) {
    chips.push('Verifier read-only')
  }
  return chips
}

export function elevatedChanges(plan: PlanReviewModel): ElevatedChange[] {
  const paths = writePaths(plan)
  const found: ElevatedChange[] = []
  if (paths.some(isMigrationPath)) found.push('Migration')
  if (paths.some(isDependencyManifest)) found.push('New dependency')
  if (paths.some(isProtectedPath)) found.push('Protected-path touch')
  if (paths.some(isAuthPath)) found.push('Authentication/security change')
  if (paths.some(isRemotePath)) found.push('Remote mutation')
  if (plan.approval?.requiresOwnerReview || plan.approval?.requiresStaleAcknowledgment) found.push('Owner decision required')
  return found
}

export function verificationRequirements(plan: PlanReviewModel): string[] {
  return plan.tasks.flatMap(task => task.validationRequirements.map(check => `${task.role}: ${check}`))
}

function writePaths(plan: PlanReviewModel): string[] {
  return plan.tasks.flatMap(task => task.authorizedWritePaths)
}

function normalize(file: string): string {
  return file.split('\\').join('/').replace(/^\.\//, '')
}

function isMigrationPath(file: string): boolean {
  const path = normalize(file).toLowerCase()
  return path.startsWith('supabase/migrations/') && path.endsWith('.sql')
}

function isDependencyManifest(file: string): boolean {
  const base = normalize(file).split('/').pop() ?? ''
  return DEPENDENCY_MANIFESTS.has(base)
}

function isProtectedPath(file: string): boolean {
  const path = normalize(file).toLowerCase()
  return PROTECTED_PATHS.some(protectedPath => path === protectedPath.toLowerCase())
}

function isAuthPath(file: string): boolean {
  const path = normalize(file).toLowerCase()
  return path.includes('authstore') || path.includes('/security/') || path.endsWith('/auth.ts')
}

function isRemotePath(file: string): boolean {
  const path = normalize(file).toLowerCase()
  return path === 'netlify.toml' || path.startsWith('supabase/functions/')
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

export function taskPathCount(task: PlanReviewTask): number {
  return task.authorizedWritePaths.length
}
