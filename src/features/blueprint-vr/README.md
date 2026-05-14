# Blueprint VR Feature

## Overview

The **Blueprint VR** feature enables generation of 3D Virtual Reality (VR) construction scenes from electrical blueprints. It provides infrastructure for extracting electrical items from blueprints, organizing them into construction lifecycle stages, and preparing them for VR rendering.

## Feature Goal

Deliver a deterministic, modular system that:
1. Accepts electrical blueprints (PDF, DWG, or image sources)
2. Extracts electrical items via AI/extraction service (future)
3. Organizes items by construction stage (underground, rough-in, trim, finished)
4. Generates a complete **VR Scene Manifest** with all items, assets, and camera metadata
5. Provides this manifest to the rendering engine for 3D visualization
6. Maintains full traceability of extraction confidence and source pages

## Architecture

### Stage Model

The VR feature organizes construction work into **4 distinct stages**, in order:

| Stage | Label | Description | Typical Work |
|-------|-------|-------------|--------------|
| `underground` | Underground | Foundation and below-grade work | Buried conduits, grounding, foundation sleeves |
| `roughIn` | Rough In | Wall and framing phase | Outlet boxes, conduit, wire runs |
| `trim` | Trim | Final fixture installation | Outlets, switches, covers |
| `finished` | Finished | Completed project | All connections, final inspections |

**Key Properties:**
- Immutable order: defined in `STAGE_ORDER`
- Each stage is a lens through which to view electrical work
- Items can reference a source page for traceability
- Confidence scores (0-100) indicate extraction accuracy

### Type Hierarchy

#### `VRStage` (type)
Union type: `'underground' | 'roughIn' | 'trim' | 'finished'`

Used to categorize electrical work into construction phases.

#### `StageItem` (interface)
Represents one electrical item (conduit run, outlet, breaker, etc.) at a specific stage.

```typescript
interface StageItem {
  id: string                    // unique item identifier
  label: string                 // display name ("Outlet box - Panel A3")
  discipline: Discipline        // currently 'electrical', extensible
  stage: VRStage               // which phase this item belongs to
  sourceConfidence?: number    // 0-100 confidence in extraction accuracy
  sourcePage?: number          // reference page from source blueprint
  notes?: string               // optional extraction notes
  geometry?: {                 // optional 3D placement hints
    position?: { x, y, z }
    scale?: { x, y, z }
  }
}
```

#### `VRSceneManifest` (interface)
Complete descriptor of a VR scene. Produced by the generation pipeline and consumed by the rendering engine.

```typescript
interface VRSceneManifest {
  id: string
  projectId?: string           // reference to project/job
  projectName?: string
  stages: StageItem[]          // all items in all stages
  assets?: {                   // optional 3D/texture asset URLs
    models?: string[]
    textures?: string[]
  }
  cameraDefaults?: {           // VR camera setup
    position: { x, y, z }
    lookAt: { x, y, z }
    fieldOfView?: number
  }
  metadata?: {                 // tracking and versioning
    createdAt?: string
    updatedAt?: string
    version?: string
    description?: string
  }
}
```

#### `VRGenerationJob` (interface)
State machine for the VR generation workflow. Tracks status from blueprint upload through manifest completion.

```typescript
interface VRGenerationJob {
  id: string
  status: VRJobStatus          // 'idle' | 'queued' | 'extracting' | 'generating' | 'rendering' | 'complete' | 'failed'
  projectId?: string
  discipline: Discipline
  stages: VRStage[]            // which stages to generate
  sourceBlueprints: BlueprintSource[]
  outputManifest?: VRSceneManifest  // populated when status === 'complete'
  progress?: number            // 0-100
  error?: string              // populated when status === 'failed'
  createdAt?: string
  startedAt?: string
  completedAt?: string
}
```

## Button Integration Point

The VR generation workflow is triggered from UI buttons (typically in project view or blueprint viewer):

1. **User clicks "Generate VR Scene"** button
2. UI calls `createVRGenerationJob(projectId, discipline, stages, blueprints)`
3. Job transitions through status stages:
   - `idle` → `queued` (awaiting processing)
   - `queued` → `extracting` (AI analyzing blueprint)
   - `extracting` → `generating` (building scene structure)
   - `generating` → `rendering` (preparing 3D assets)
   - `rendering` → `complete` (manifest ready)
4. UI polls or subscribes to job status
5. When `status === 'complete'`, `outputManifest` is available
6. Manifest is passed to VR renderer

**Future integration:** Button event handlers will be wired in the Blueprint command/action layer or project detail view. Current implementation is a placeholder.

## Current State: Mocked & Deterministic

At this phase (BVR0–BVR8), the feature **does not call real AI/extraction services**:

✓ **Implemented (deterministic, type-safe):**
- Type definitions for all VR data structures
- Stage ordering and validation functions
- Stage helper functions (getNextStage, isStageBeforeStage, etc.)
- Barrel exports for public API

✗ **Not yet implemented (pending BVR9+):**
- AI extraction pipeline (Anthropic/OpenAI integration)
- Database persistence (Supabase tables)
- REST API endpoints
- Job queue system
- UI components and button wiring
- 3D rendering engine

## Utilities & Stage Functions

All stage logic lives in `stages.ts`. Key exports:

```typescript
// Constants
STAGE_ORDER: readonly VRStage[]          // ['underground', 'roughIn', 'trim', 'finished']
STAGE_LABELS: Record<VRStage, string>    // labels for UI
STAGE_DESCRIPTIONS: Record<VRStage, string>

// Functions
getStageLabelByType(stage: VRStage) → string
getStageDescription(stage: VRStage) → string
getStageOrder(stage: VRStage) → number
isStageBeforeStage(before, after) → boolean
getNextStage(stage: VRStage) → VRStage | undefined
getPreviousStage(stage: VRStage) → VRStage | undefined
getAllStages() → VRStage[]
isValidStage(value: unknown) → boolean
```

These are 100% deterministic and suitable for unit testing. Use them for:
- Stage sequencing logic
- Validation before API calls
- UI state transitions
- Job progression

## Future AI/Rendering Service Interface

### Extraction Service (Post-BVR8)

Expected interface:
```typescript
// Pseudo-code for future AI service integration
async function extractElectricalItems(
  blueprint: BlueprintSource,
  discipline: Discipline,
  stages: VRStage[]
): Promise<StageItem[]> {
  // Will call Anthropic or OpenAI with blueprint image/PDF
  // Returns array of StageItem with populated confidence/sourcePage
}
```

### Scene Builder (Post-BVR8)

Expected interface:
```typescript
function buildVRSceneManifest(
  projectId: string,
  items: StageItem[],
  assets?: AssetConfig
): VRSceneManifest {
  // Combines items into ordered manifest
  // Assigns camera defaults
  // Validates all stages are present
  // Returns ready-to-render manifest
}
```

### Rendering Engine (Future)

Expected to consume `VRSceneManifest` and produce:
- Three.js scene with stage layers
- Interactive item selection
- Stage filtering UI
- Camera controls

## Safety Constraints

### No Secrets
- ✓ No API keys hardcoded
- ✓ No database credentials in source
- ✓ AI service keys passed via environment variables or secure store

### Type Safety
- ✓ All VR types are strict TypeScript
- ✓ Stage membership validated with `isValidStage()`
- ✓ Confidence scores bounded (0–100)

### Data Integrity
- ✓ StageItem IDs must be unique within a manifest
- ✓ Source page references are hints only (not enforced)
- ✓ Geometry coordinates are optional (defaults used if missing)

### No External Service Coupling
- ✓ Current code has zero dependencies on AI services
- ✓ Future services will be optional/pluggable
- ✓ Manifest generation works with mock data

## Module Organization

```
src/features/blueprint-vr/
├── README.md                  ← You are here
├── index.ts                   ← Public API barrel export
├── types.ts                   ← All TypeScript interfaces & types
├── stages.ts                  ← Stage constants & utility functions
└── __tests__/                 ← (Placeholder; no test framework configured yet)
    └── sceneManifestBuilder.test.ts  ← (Future: when test framework added)
```

## Next Steps (Post-BVR8)

1. **BVR9:** AI extraction service integration
   - Wire Anthropic/OpenAI API
   - Handle blueprint upload/parsing
   - Extract electrical items with confidence scoring

2. **BVR10:** Database schema & persistence
   - Create `vr_generation_jobs` table
   - Create `vr_scene_manifests` table
   - Create `stage_items` table

3. **BVR11:** REST API endpoints
   - `POST /api/vr/generate-job` – create job
   - `GET /api/vr/job/:id` – poll job status
   - `GET /api/vr/manifest/:id` – retrieve manifest

4. **BVR12:** UI components & button wiring
   - "Generate VR Scene" button in project view
   - Job progress modal
   - Manifest preview

5. **BVR13:** 3D rendering engine
   - Three.js scene setup
   - Stage layering
   - Interactive item selection

## Testing Strategy (Future)

When a test framework is added (e.g., Vitest):

1. **Unit Tests for `stages.ts`:**
   - Validate STAGE_ORDER sequence
   - Test `getStageOrder()` returns correct indices
   - Test `isStageBeforeStage()` logic
   - Test `getNextStage()` edge cases (last stage → undefined)
   - Test `isValidStage()` with valid/invalid inputs

2. **Type Tests:**
   - Ensure VRSceneManifest with missing stages is caught at compile time
   - Ensure invalid stage strings are rejected

3. **Integration Tests (when services exist):**
   - Mock extraction service returning StageItems
   - Build complete manifest
   - Validate manifest structure and data

## Resources

- **Types:** `src/features/blueprint-vr/types.ts`
- **Stage utilities:** `src/features/blueprint-vr/stages.ts`
- **Public exports:** `src/features/blueprint-vr/index.ts`
- **Roadmap:** See "Next Steps" above
- **Governance:** Refer to `poweron_app_handoff_spec.md` and `poweron_v2_handoff_complete.md`

---

## Development Notes

- All code is TypeScript with strict mode enabled
- Zero external runtime dependencies (types only)
- Stage order is immutable (defined as readonly const)
- Service integration points are documented but not implemented
- This feature is part of the Blueprint VR generation pipeline (BVR0–BVR∞)
