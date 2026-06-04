export type AppBrainNodeCategory =
  | 'shell'
  | 'core'
  | 'admin'
  | 'project'
  | 'field'
  | 'blueprint'
  | 'materials'
  | 'ai'
  | 'shared'
  | 'data'

export type AppBrainRiskLevel = 'low' | 'medium' | 'high'

export interface AppBrainNode {
  id: string
  label: string
  ownerArea: string
  category: AppBrainNodeCategory
  description: string
  relatedFiles: string[]
  connectedSystems: string[]
  connections: string[]
  riskLevel: AppBrainRiskLevel
  safeEditGuidance: string
  overlapWarnings: string[]
  nextPhaseNotes: string
  position: [number, number, number]
}

export interface AppBrainEdge {
  from: string
  to: string
  strength: number
}

export const APP_BRAIN_CATEGORY_META: Record<AppBrainNodeCategory, { label: string; color: string; glow: string }> = {
  shell: { label: 'App Shell', color: '#22d3ee', glow: 'rgba(34,211,238,0.32)' },
  core: { label: 'V15r Core', color: '#38bdf8', glow: 'rgba(56,189,248,0.3)' },
  admin: { label: 'Admin Tools', color: '#a78bfa', glow: 'rgba(167,139,250,0.3)' },
  project: { label: 'Projects', color: '#34d399', glow: 'rgba(52,211,153,0.28)' },
  field: { label: 'Field Log', color: '#f59e0b', glow: 'rgba(245,158,11,0.28)' },
  blueprint: { label: 'Blueprint', color: '#60a5fa', glow: 'rgba(96,165,250,0.28)' },
  materials: { label: 'Material Takeoff', color: '#facc15', glow: 'rgba(250,204,21,0.28)' },
  ai: { label: 'AI / NEXUS', color: '#c084fc', glow: 'rgba(192,132,252,0.3)' },
  shared: { label: 'Shared Systems', color: '#2dd4bf', glow: 'rgba(45,212,191,0.28)' },
  data: { label: 'Data / Persistence', color: '#fb7185', glow: 'rgba(251,113,133,0.28)' },
}

export const APP_BRAIN_RISK_META: Record<AppBrainRiskLevel, { label: string; color: string }> = {
  low: { label: 'Low', color: '#34d399' },
  medium: { label: 'Medium', color: '#facc15' },
  high: { label: 'High', color: '#fb7185' },
}

export const APP_BRAIN_NODES: AppBrainNode[] = [
  {
    id: 'app-shell',
    label: 'App Shell',
    ownerArea: 'Application chrome',
    category: 'shell',
    description: 'Top-level layout, lazy route switching, and shared application chrome for Power On Hub.',
    relatedFiles: ['src/components/layout/AppShell.tsx'],
    connectedSystems: ['V15r route switching', 'lazy view loading', 'global overlays', 'admin views'],
    connections: ['v15r-layout', 'admin-tools', 'shared-systems'],
    riskLevel: 'medium',
    safeEditGuidance: 'Keep route additions lazy-loaded and scoped. Avoid changing global shell behavior unless the task explicitly targets app chrome.',
    overlapWarnings: ['Route/view changes can affect every workspace tab.', 'Floating overlays and lazy imports often share this surface.'],
    nextPhaseNotes: 'Generated manifest should identify all AppShell view keys and lazy imports.',
    position: [0, 1.2, 0],
  },
  {
    id: 'v15r-layout',
    label: 'V15r Core',
    ownerArea: 'Workspace navigation',
    category: 'core',
    description: 'Primary V15r workspace shell, admin navigation, owner gating, and shared workspace controls.',
    relatedFiles: ['src/components/v15r/V15rLayout.tsx'],
    connectedSystems: ['admin gating', 'sidebar navigation', 'tenant sync readiness', 'quick capture'],
    connections: ['app-shell', 'projects', 'field-log', 'material-takeoff', 'app-brain'],
    riskLevel: 'medium',
    safeEditGuidance: 'Prefer adding nav entries inside the existing bucket patterns. Preserve owner/admin gates and mobile/sidebar behavior.',
    overlapWarnings: ['Many agents touch nav buckets and top-bar behavior.', 'Changes can accidentally expose admin-only views.'],
    nextPhaseNotes: 'Map admin-only route visibility and role gates as first-class manifest fields.',
    position: [-1.9, 0.25, 0.25],
  },
  {
    id: 'admin-tools',
    label: 'Admin Tools',
    ownerArea: 'Admin command surfaces',
    category: 'admin',
    description: 'Owner-only command surfaces and administrative intelligence tools.',
    relatedFiles: ['src/views/AdminToolsView.tsx', 'src/views/NexusAdminView.tsx'],
    connectedSystems: ['NEXUS admin', 'owner command tools', 'agent intelligence panels'],
    connections: ['app-shell', 'ai-nexus', 'app-brain'],
    riskLevel: 'low',
    safeEditGuidance: 'Keep admin-only behavior behind the existing owner access path. Do not mix customer-facing data into admin intelligence views.',
    overlapWarnings: ['Admin surfaces often share labels with visualization/admin command features.'],
    nextPhaseNotes: 'Add admin command nodes from a generated view registry.',
    position: [1.85, 0.4, -0.15],
  },
  {
    id: 'app-brain',
    label: 'App Brain',
    ownerArea: 'Architecture intelligence',
    category: 'admin',
    description: 'Static architecture brain MVP for visualizing major app areas before generated manifests and git overlays arrive.',
    relatedFiles: ['src/components/v15r/V15rAppBrainTab.tsx', 'src/components/v15r/V15rAppBrainScene.tsx', 'src/components/v15r/appBrainMap.ts'],
    connectedSystems: ['Three.js scene', 'static architecture map', 'admin visualization bucket'],
    connections: ['app-shell', 'v15r-layout', 'admin-tools', 'shared-systems'],
    riskLevel: 'low',
    safeEditGuidance: 'Keep repo intelligence static until generated manifest work is explicitly scoped. Avoid claiming live git or active-agent detection.',
    overlapWarnings: ['Future phases may touch this same map data and scene lifecycle.', 'Avoid copying existing visual systems wholesale.'],
    nextPhaseNotes: 'Phase 4 can replace static map data with a generated repo manifest adapter.',
    position: [0.35, -0.1, 1.35],
  },
  {
    id: 'projects',
    label: 'Projects',
    ownerArea: 'Project operations',
    category: 'project',
    description: 'Project workspace, project records, scheduling context, and active work surfaces.',
    relatedFiles: ['src/components/v15r/V15rProjectsPanel.tsx', 'src/services/backupDataService.ts'],
    connectedSystems: ['backup data', 'project records', 'field logs', 'blueprint records'],
    connections: ['v15r-layout', 'field-log', 'blueprint', 'data-persistence'],
    riskLevel: 'high',
    safeEditGuidance: 'Treat project data as high-blast-radius. Avoid changing project filtering, persistence, or active/archived semantics without explicit scope.',
    overlapWarnings: ['Project filtering affects dashboards, field logs, MTO, and persistence.', 'Archived/active project semantics are a frequent overlap area.'],
    nextPhaseNotes: 'Manifest should distinguish view components from shared project data services.',
    position: [-2.4, -1.05, -0.45],
  },
  {
    id: 'field-log',
    label: 'Field Log',
    ownerArea: 'Field operations',
    category: 'field',
    description: 'Field activity, service logs, daily records, and operational trigger workflows.',
    relatedFiles: ['src/components/v15r/V15rFieldLogPanel.tsx'],
    connectedSystems: ['service logs', 'trigger rules', 'project records', 'AI analysis prompts'],
    connections: ['v15r-layout', 'projects', 'data-persistence', 'ai-nexus'],
    riskLevel: 'high',
    safeEditGuidance: 'Keep Field Log edits isolated. Preserve existing backup sync paths and avoid touching project filters globally from this area.',
    overlapWarnings: ['Current branch history has recent Field Log trigger work.', 'Project/service target logic can overlap with dashboards and service logs.'],
    nextPhaseNotes: 'Add recent-change and active-agent overlap detection before allowing concurrent Field Log work.',
    position: [-1.05, -1.75, 0.65],
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    ownerArea: 'Blueprint editor',
    category: 'blueprint',
    description: 'Blueprint viewers, annotation flows, PDF state, and emerging 3D blueprint surfaces.',
    relatedFiles: ['src/views/BlueprintAI.tsx', 'src/components/blueprint/OperationsBlueprintPdfViewer.tsx', 'src/features/blueprint-vr/Blueprint3DSpaceViewer.tsx'],
    connectedSystems: ['PDF annotations', 'blueprint library', '3D blueprint viewer', 'project documents'],
    connections: ['projects', 'material-takeoff', 'data-persistence'],
    riskLevel: 'high',
    safeEditGuidance: 'Do not touch blueprint editor files from App Brain work. Blueprint annotation state and pointer handling are sensitive.',
    overlapWarnings: ['Blueprint files have recent repair commits.', 'Pointer, opacity, and persistence changes can regress drawing tools.'],
    nextPhaseNotes: 'Use generated manifest tags to flag active editor subsystems and pointer-event surfaces.',
    position: [1.0, -1.55, -0.85],
  },
  {
    id: 'material-takeoff',
    label: 'Material Takeoff',
    ownerArea: 'Materials planning',
    category: 'materials',
    description: 'Material planning, takeoff rows, placement state, and estimate-adjacent operational data.',
    relatedFiles: ['src/components/v15r/V15rMTOTab.tsx'],
    connectedSystems: ['MTO rows', 'blueprint context', 'backup sync', 'project materials'],
    connections: ['v15r-layout', 'blueprint', 'shared-systems'],
    riskLevel: 'medium',
    safeEditGuidance: 'Preserve drag/reorder behavior and backup sync. Avoid broad data model changes unless MTO is explicitly scoped.',
    overlapWarnings: ['MTO drag behavior has been repaired in recent history.', 'Material placement can overlap with blueprint work.'],
    nextPhaseNotes: 'Add activity signals for recent MTO edits once git overlays exist.',
    position: [2.15, -0.9, 0.5],
  },
  {
    id: 'ai-nexus',
    label: 'AI / NEXUS',
    ownerArea: 'AI orchestration',
    category: 'ai',
    description: 'Voice, agent orchestration, visual intelligence surfaces, and admin command tools.',
    relatedFiles: ['src/views/AdminVisualizationLab.tsx', 'src/components/v15r/AIVisualSuite', 'src/services/voice'],
    connectedSystems: ['visual suite', 'voice services', 'agent event bus', 'admin command views'],
    connections: ['admin-tools', 'field-log', 'shared-systems', 'app-brain'],
    riskLevel: 'medium',
    safeEditGuidance: 'Inspect lifecycle and audio/visual side effects before editing. Keep App Brain separate from existing neural visualization systems.',
    overlapWarnings: ['Visual systems have long-running render loops and audio state.', 'Do not clone these designs directly into App Brain.'],
    nextPhaseNotes: 'Future App Brain overlays can show render-loop and audio-lifecycle risk zones.',
    position: [1.45, 1.45, 0.8],
  },
  {
    id: 'shared-systems',
    label: 'Shared Systems',
    ownerArea: 'Cross-cutting services',
    category: 'shared',
    description: 'Cross-cutting services, stores, role permissions, sync utilities, and shared app helpers.',
    relatedFiles: ['src/store', 'src/services', 'src/utils'],
    connectedSystems: ['stores', 'services', 'role permissions', 'sync helpers', 'utility modules'],
    connections: ['app-shell', 'v15r-layout', 'ai-nexus', 'data-persistence', 'material-takeoff'],
    riskLevel: 'medium',
    safeEditGuidance: 'Prefer local component changes before shared helpers. If shared services must change, broaden testing and check all connected views.',
    overlapWarnings: ['Shared helpers can affect unrelated tabs.', 'Role and sync services have admin/security implications.'],
    nextPhaseNotes: 'Generated manifest should calculate fan-out and mark shared systems by import count.',
    position: [-0.35, 1.95, -0.95],
  },
  {
    id: 'data-persistence',
    label: 'Data / Persistence',
    ownerArea: 'Persistence boundary',
    category: 'data',
    description: 'Backup data, local persistence, Supabase sync boundaries, and long-lived user records.',
    relatedFiles: ['src/services/backupDataService.ts', 'src/lib/supabase.ts'],
    connectedSystems: ['backup data service', 'Supabase client', 'local storage', 'tenant sync'],
    connections: ['projects', 'field-log', 'blueprint', 'shared-systems'],
    riskLevel: 'high',
    safeEditGuidance: 'Do not change persistence or Supabase behavior from visual/intelligence tasks. Require explicit scope and validation.',
    overlapWarnings: ['Persistence changes can affect saved projects, field logs, blueprints, and admin data.', 'Tenant sync readiness must be preserved.'],
    nextPhaseNotes: 'Phase 5 should highlight persistence files as agent-safe work-zone blockers.',
    position: [0.05, -2.35, -0.05],
  },
]

export const APP_BRAIN_EDGES: AppBrainEdge[] = [
  { from: 'app-shell', to: 'v15r-layout', strength: 1 },
  { from: 'app-shell', to: 'admin-tools', strength: 0.8 },
  { from: 'app-shell', to: 'shared-systems', strength: 0.9 },
  { from: 'v15r-layout', to: 'projects', strength: 0.9 },
  { from: 'v15r-layout', to: 'field-log', strength: 0.9 },
  { from: 'v15r-layout', to: 'material-takeoff', strength: 0.75 },
  { from: 'v15r-layout', to: 'app-brain', strength: 0.7 },
  { from: 'admin-tools', to: 'ai-nexus', strength: 0.85 },
  { from: 'admin-tools', to: 'app-brain', strength: 0.65 },
  { from: 'app-brain', to: 'shared-systems', strength: 0.65 },
  { from: 'projects', to: 'field-log', strength: 0.8 },
  { from: 'projects', to: 'blueprint', strength: 0.7 },
  { from: 'projects', to: 'data-persistence', strength: 0.85 },
  { from: 'field-log', to: 'data-persistence', strength: 0.85 },
  { from: 'field-log', to: 'ai-nexus', strength: 0.6 },
  { from: 'blueprint', to: 'material-takeoff', strength: 0.75 },
  { from: 'blueprint', to: 'data-persistence', strength: 0.8 },
  { from: 'material-takeoff', to: 'shared-systems', strength: 0.55 },
  { from: 'ai-nexus', to: 'shared-systems', strength: 0.7 },
  { from: 'shared-systems', to: 'data-persistence', strength: 0.75 },
]

export function getAppBrainNode(nodeId: string | null | undefined): AppBrainNode | null {
  if (!nodeId) return null
  return APP_BRAIN_NODES.find((node) => node.id === nodeId) ?? null
}
