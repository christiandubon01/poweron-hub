/**
 * src/features/blueprint-vr/types.ts
 *
 * Type definitions for the Blueprint VR feature.
 * Defines VR lifecycle stages, job states, stage items, and scene manifests.
 */

/**
 * VR lifecycle stages representing phases of a construction project.
 */
export type VRStage = 'underground' | 'roughIn' | 'trim' | 'finished'

/**
 * Discipline categories for VR generation.
 * Extensible for future discipline types (HVAC, plumbing, etc.).
 */
export type Discipline = 'electrical' // | 'hvac' | 'plumbing' (for future extension)

/**
 * Blueprint source reference shape.
 * Represents a PDF or drawing document that serves as source for VR generation.
 */
export interface BlueprintSource {
  id: string
  name: string
  filePath?: string
  fileSize?: number
  uploadedAt?: string
  format?: 'pdf' | 'dwg' | 'image' | 'other'
}

/**
 * VR generation job lifecycle states.
 */
export type VRJobStatus = 'idle' | 'queued' | 'extracting' | 'generating' | 'rendering' | 'complete' | 'failed'

/**
 * A stage item representing a construction phase with associated metadata.
 */
export interface StageItem {
  id: string
  label: string
  discipline: Discipline
  stage: VRStage
  sourceConfidence?: number // 0-100, confidence in extraction accuracy
  sourcePage?: number // page reference if multi-page source
  notes?: string
  geometry?: {
    // Optional placement/geometry hints for VR positioning
    position?: { x: number; y: number; z: number }
    scale?: { x: number; y: number; z: number }
  }
}

/**
 * VR scene manifest describing a complete VR scene with all stages and metadata.
 */
export interface VRSceneManifest {
  id: string
  projectId?: string
  projectName?: string
  stages: StageItem[]
  assets?: {
    // Optional asset references
    models?: string[]
    textures?: string[]
  }
  cameraDefaults?: {
    position: { x: number; y: number; z: number }
    lookAt: { x: number; y: number; z: number }
    fieldOfView?: number
  }
  metadata?: {
    createdAt?: string
    updatedAt?: string
    version?: string
    description?: string
  }
}

/**
 * VR generation job configuration and state.
 */
export interface VRGenerationJob {
  id: string
  status: VRJobStatus
  projectId?: string
  discipline: Discipline
  stages: VRStage[]
  sourceBlueprints: BlueprintSource[]
  outputManifest?: VRSceneManifest
  progress?: number // 0-100
  error?: string
  createdAt?: string
  startedAt?: string
  completedAt?: string
}
