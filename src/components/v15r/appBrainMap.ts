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
  category: AppBrainNodeCategory
  description: string
  relatedFiles: string[]
  connections: string[]
  riskLevel: AppBrainRiskLevel
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
    category: 'shell',
    description: 'Top-level layout, lazy route switching, and shared application chrome for Power On Hub.',
    relatedFiles: ['src/components/layout/AppShell.tsx'],
    connections: ['v15r-layout', 'admin-tools', 'shared-systems'],
    riskLevel: 'medium',
    position: [0, 1.2, 0],
  },
  {
    id: 'v15r-layout',
    label: 'V15r Core',
    category: 'core',
    description: 'Primary V15r workspace shell, admin navigation, owner gating, and shared workspace controls.',
    relatedFiles: ['src/components/v15r/V15rLayout.tsx'],
    connections: ['app-shell', 'projects', 'field-log', 'material-takeoff', 'app-brain'],
    riskLevel: 'medium',
    position: [-1.9, 0.25, 0.25],
  },
  {
    id: 'admin-tools',
    label: 'Admin Tools',
    category: 'admin',
    description: 'Owner-only command surfaces and administrative intelligence tools.',
    relatedFiles: ['src/views/AdminToolsView.tsx', 'src/views/NexusAdminView.tsx'],
    connections: ['app-shell', 'ai-nexus', 'app-brain'],
    riskLevel: 'low',
    position: [1.85, 0.4, -0.15],
  },
  {
    id: 'app-brain',
    label: 'App Brain',
    category: 'admin',
    description: 'Static architecture brain MVP for visualizing major app areas before generated manifests and git overlays arrive.',
    relatedFiles: ['src/components/v15r/V15rAppBrainTab.tsx', 'src/components/v15r/V15rAppBrainScene.tsx', 'src/components/v15r/appBrainMap.ts'],
    connections: ['app-shell', 'v15r-layout', 'admin-tools', 'shared-systems'],
    riskLevel: 'low',
    position: [0.35, -0.1, 1.35],
  },
  {
    id: 'projects',
    label: 'Projects',
    category: 'project',
    description: 'Project workspace, project records, scheduling context, and active work surfaces.',
    relatedFiles: ['src/components/v15r/V15rProjectsPanel.tsx', 'src/services/backupDataService.ts'],
    connections: ['v15r-layout', 'field-log', 'blueprint', 'data-persistence'],
    riskLevel: 'high',
    position: [-2.4, -1.05, -0.45],
  },
  {
    id: 'field-log',
    label: 'Field Log',
    category: 'field',
    description: 'Field activity, service logs, daily records, and operational trigger workflows.',
    relatedFiles: ['src/components/v15r/V15rFieldLogPanel.tsx'],
    connections: ['v15r-layout', 'projects', 'data-persistence', 'ai-nexus'],
    riskLevel: 'high',
    position: [-1.05, -1.75, 0.65],
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    category: 'blueprint',
    description: 'Blueprint viewers, annotation flows, PDF state, and emerging 3D blueprint surfaces.',
    relatedFiles: ['src/views/BlueprintAI.tsx', 'src/components/blueprint/OperationsBlueprintPdfViewer.tsx', 'src/features/blueprint-vr/Blueprint3DSpaceViewer.tsx'],
    connections: ['projects', 'material-takeoff', 'data-persistence'],
    riskLevel: 'high',
    position: [1.0, -1.55, -0.85],
  },
  {
    id: 'material-takeoff',
    label: 'Material Takeoff',
    category: 'materials',
    description: 'Material planning, takeoff rows, placement state, and estimate-adjacent operational data.',
    relatedFiles: ['src/components/v15r/V15rMTOTab.tsx'],
    connections: ['v15r-layout', 'blueprint', 'shared-systems'],
    riskLevel: 'medium',
    position: [2.15, -0.9, 0.5],
  },
  {
    id: 'ai-nexus',
    label: 'AI / NEXUS',
    category: 'ai',
    description: 'Voice, agent orchestration, visual intelligence surfaces, and admin command tools.',
    relatedFiles: ['src/views/AdminVisualizationLab.tsx', 'src/components/v15r/AIVisualSuite', 'src/services/voice'],
    connections: ['admin-tools', 'field-log', 'shared-systems', 'app-brain'],
    riskLevel: 'medium',
    position: [1.45, 1.45, 0.8],
  },
  {
    id: 'shared-systems',
    label: 'Shared Systems',
    category: 'shared',
    description: 'Cross-cutting services, stores, role permissions, sync utilities, and shared app helpers.',
    relatedFiles: ['src/store', 'src/services', 'src/utils'],
    connections: ['app-shell', 'v15r-layout', 'ai-nexus', 'data-persistence', 'material-takeoff'],
    riskLevel: 'medium',
    position: [-0.35, 1.95, -0.95],
  },
  {
    id: 'data-persistence',
    label: 'Data / Persistence',
    category: 'data',
    description: 'Backup data, local persistence, Supabase sync boundaries, and long-lived user records.',
    relatedFiles: ['src/services/backupDataService.ts', 'src/lib/supabase.ts'],
    connections: ['projects', 'field-log', 'blueprint', 'shared-systems'],
    riskLevel: 'high',
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
