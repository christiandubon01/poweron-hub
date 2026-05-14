/**
 * src/features/blueprint-vr/sceneManifestBuilder.ts
 *
 * Deterministic scene manifest builder for Blueprint VR experiences.
 * Constructs complete VR scene manifests from project metadata and stage data.
 */

import { STAGE_ORDER, STAGE_LABELS } from './stages'
import type { VRStage, Discipline, StageItem, VRSceneManifest, BlueprintSource } from './types'

/**
 * Quality profile options for VR rendering.
 */
export type QualityProfile = 'preview' | 'standard' | 'high'

/**
 * Asset placeholder types for VR scene components.
 */
export interface AssetPlaceholder {
  id: string
  type: 'conduit' | 'box' | 'panel' | 'device' | 'label' | 'room'
  stage: VRStage
  discipline: Discipline
  position?: { x: number; y: number; z: number }
  scale?: { x: number; y: number; z: number }
  metadata?: Record<string, unknown>
}

/**
 * Layout zone derived from page/sheet metadata.
 */
export interface LayoutZone {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  stage: VRStage
  items: string[] // references to asset placeholder IDs
}

/**
 * Extended VR scene manifest with quality profile and asset details.
 */
export interface BlueprintVRSceneManifest extends VRSceneManifest {
  qualityProfile: QualityProfile
  assetPlaceholders?: AssetPlaceholder[]
  layoutZones?: LayoutZone[]
}

/**
 * Input configuration for creating a Blueprint VR scene manifest.
 */
export interface CreateManifestInput {
  projectId: string
  projectName: string
  discipline: Discipline
  stages: VRStage[]
  sourceBlueprints?: BlueprintSource[]
  qualityProfile?: QualityProfile
  pageMetadata?: Array<{
    pageNumber: number
    width?: number
    height?: number
    scale?: number
  }>
  cameraPosition?: { x: number; y: number; z: number }
  cameraLookAt?: { x: number; y: number; z: number }
  cameraFieldOfView?: number
}

/**
 * Create a deterministic Blueprint VR scene manifest from input configuration.
 *
 * @param input - Configuration for the scene manifest
 * @returns A serializable VR scene manifest
 */
export function createBlueprintVRSceneManifest(input: CreateManifestInput): BlueprintVRSceneManifest {
  const {
    projectId,
    projectName,
    discipline,
    stages,
    sourceBlueprints = [],
    qualityProfile = 'standard',
    pageMetadata = [],
    cameraPosition = { x: 0, y: 5, z: 10 },
    cameraLookAt = { x: 0, y: 0, z: 0 },
    cameraFieldOfView = 60,
  } = input

  const manifestId = `manifest-${projectId}-${Date.now()}`
  const now = new Date().toISOString()

  // Build ordered stage items
  const stageItems: StageItem[] = []
  for (const stage of STAGE_ORDER) {
    if (stages.includes(stage)) {
      const stageItem: StageItem = {
        id: `stage-${stage}-${projectId}`,
        label: STAGE_LABELS[stage],
        discipline,
        stage,
        sourceConfidence: 75, // Default confidence for generated items
        sourcePage: sourceBlueprints.length > 0 ? 1 : undefined,
        notes: `${STAGE_LABELS[stage]} phase for ${discipline} discipline`,
      }
      stageItems.push(stageItem)
    }
  }

  // Create asset placeholders for common electrical components
  const assetPlaceholders: AssetPlaceholder[] = createAssetPlaceholders(
    projectId,
    discipline,
    stages,
    sourceBlueprints.length
  )

  // Create layout zones from page metadata
  const layoutZones: LayoutZone[] = createLayoutZones(projectId, stages, pageMetadata, assetPlaceholders)

  // Build the final manifest
  const manifest: BlueprintVRSceneManifest = {
    id: manifestId,
    projectId,
    projectName,
    stages: stageItems,
    qualityProfile,
    assetPlaceholders,
    layoutZones,
    assets: {
      models: [],
      textures: [],
    },
    cameraDefaults: {
      position: cameraPosition,
      lookAt: cameraLookAt,
      fieldOfView: cameraFieldOfView,
    },
    metadata: {
      createdAt: now,
      updatedAt: now,
      version: '1.0.0',
      description: `VR scene manifest for ${projectName} (${discipline})`,
    },
  }

  return manifest
}

/**
 * Create asset placeholders for standard electrical components.
 *
 * @param projectId - The project identifier
 * @param discipline - The discipline type
 * @param stages - Array of stages to generate placeholders for
 * @param hasBlueprintSource - Whether source blueprints are available
 * @returns Array of asset placeholders
 */
function createAssetPlaceholders(
  projectId: string,
  discipline: Discipline,
  stages: VRStage[],
  hasBlueprintSource: number
): AssetPlaceholder[] {
  const placeholders: AssetPlaceholder[] = []

  // Base asset counts per stage
  const assetCountByType: Record<string, number> = {
    conduit: 3,
    box: 4,
    panel: 1,
    device: 2,
    label: 5,
    room: 1,
  }

  let placeholderId = 0

  for (const stage of stages) {
    // Create placeholders for each asset type
    for (const [type, count] of Object.entries(assetCountByType)) {
      for (let i = 0; i < count; i++) {
        const placeholder: AssetPlaceholder = {
          id: `asset-${type}-${stage}-${i}-${projectId}`,
          type: type as AssetPlaceholder['type'],
          stage,
          discipline,
          position: {
            x: (i % 3) * 3,
            y: Math.floor(i / 3) * 2,
            z: (placeholderId % 5) * 2,
          },
          scale: {
            x: 1,
            y: 1,
            z: 1,
          },
          metadata: {
            stageIndex: STAGE_ORDER.indexOf(stage),
            fromBlueprint: hasBlueprintSource > 0,
            confidence: 0.75,
          },
        }
        placeholders.push(placeholder)
        placeholderId++
      }
    }
  }

  return placeholders
}

/**
 * Create layout zones from page metadata.
 *
 * @param projectId - The project identifier
 * @param stages - Array of stages
 * @param pageMetadata - Array of page metadata
 * @param assetPlaceholders - Asset placeholders to assign to zones
 * @returns Array of layout zones
 */
function createLayoutZones(
  projectId: string,
  stages: VRStage[],
  pageMetadata: Array<{ pageNumber: number; width?: number; height?: number; scale?: number }>,
  assetPlaceholders: AssetPlaceholder[]
): LayoutZone[] {
  const zones: LayoutZone[] = []

  if (pageMetadata.length === 0) {
    // Create default zones if no page metadata provided
    stages.forEach((stage, stageIndex) => {
      const zone: LayoutZone = {
        id: `zone-${stage}-default-${projectId}`,
        name: `${STAGE_LABELS[stage]} Layout`,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        stage,
        items: assetPlaceholders
          .filter((p) => p.stage === stage)
          .map((p) => p.id)
          .slice(0, 10), // Limit items per zone
      }
      zones.push(zone)
    })
  } else {
    // Create zones from page metadata
    pageMetadata.forEach((page, pageIndex) => {
      const pageWidth = page.width || 100
      const pageHeight = page.height || 100
      const pageScale = page.scale || 1

      // Create one zone per page per stage
      stages.forEach((stage) => {
        const zone: LayoutZone = {
          id: `zone-page${page.pageNumber}-${stage}-${projectId}`,
          name: `Page ${page.pageNumber} - ${STAGE_LABELS[stage]}`,
          x: (pageIndex % 3) * pageWidth * pageScale,
          y: Math.floor(pageIndex / 3) * pageHeight * pageScale,
          width: pageWidth,
          height: pageHeight,
          stage,
          items: assetPlaceholders
            .filter((p) => p.stage === stage && (p.metadata?.stageIndex as number) === STAGE_ORDER.indexOf(stage))
            .map((p) => p.id)
            .slice(0, 8), // Limit items per zone
        }
        zones.push(zone)
      })
    })
  }

  return zones
}
