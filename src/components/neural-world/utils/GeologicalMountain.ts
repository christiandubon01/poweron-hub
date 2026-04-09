/**
 * GeologicalMountain.ts — NW38 geological cross-section mountain builder.
 *
 * Replaces single ConeGeometry mountains with 5 stacked CylinderGeometry rings.
 * Each ring represents a different material type with real project data-driven proportions.
 *
 * LAYER ORDER (bottom to top):
 *   1. OBSIDIAN  — Risk / unknowns (open RFIs)
 *   2. RUBY      — Expenses (materials, labor, overhead)
 *   3. EMERALD   — Management effort (hours logged)
 *   4. GOLD      — Billable completed work (billed to date)
 *   5. DIAMOND   — Unbilled potential (contract value remaining)
 *
 * LOD: 8 segments (close), 5 segments (medium, 50+), 3 segments (far, 120+)
 * Gold sparkle: max 3 PointLights per mountain (caller controls which mountains get them)
 * No text labels on layers — user reads from legend.
 *
 * VIDEO GAME UX LAW: no overlapping UI, all transitions animated, zero jerks.
 */

import * as THREE from 'three'
import type { NWProject, NWRFI, NWFieldLog, NWInvoice } from '../DataBridge'
import { contractValueToHeight } from '../DataBridge'

// ── Material colours & properties ────────────────────────────────────────────

export const GEO_COLORS = {
  obsidian: 0x1a1a2e,
  ruby:     0xE0115F,
  emerald:  0x50C878,
  gold:     0xFFD700,
  diamond:  0xB9F2FF,
} as const

export const GEO_EMISSIVES = {
  obsidian: 0x0a0a15,
  ruby:     0x400010,
  emerald:  0x0a2a15,
  gold:     0x3a2a00,
  diamond:  0x2a3a4a,
} as const

// ── Ring fraction computation ─────────────────────────────────────────────────

export interface RingFractions {
  obsidian: number   // all 5 sum to 1.0
  ruby:     number
  emerald:  number
  gold:     number
  diamond:  number
}

/**
 * Compute ring proportions from live project data.
 * Fractions always sum to 1.0.
 */
export function computeRingFractions(
  project: NWProject,
  rfis:      NWRFI[],
  fieldLogs: NWFieldLog[],
  invoices:  NWInvoice[],
): RingFractions {
  const cv = Math.max(1, project.contract_value)

  // ── OBSIDIAN: open RFI ratio (fallback: inverse health_score) ──────────────
  const projectRfis = rfis.filter(r => r.project_id === project.id)
  const openRfis    = projectRfis.filter(r => r.status !== 'closed').length
  const totalRfis   = projectRfis.length
  const rfiRatio    = totalRfis > 0
    ? openRfis / totalRfis
    : Math.max(0, (100 - project.health_score) / 100)

  // At project start RFIs are all open → obsidian up to 65%.
  // Capped so it never eats the whole mountain.
  let obsidian = Math.min(0.65, rfiRatio * 0.65)

  // Give new projects without any RFI data a baseline obsidian layer
  if (totalRfis === 0 && project.status !== 'completed' && project.status !== 'cancelled') {
    const stageRisk: Record<string, number> = {
      lead:      0.60,
      estimate:  0.55,
      pending:   0.45,
      approved:  0.35,
      in_progress: Math.max(0, (1 - project.phase_completion / 100) * 0.30),
    }
    obsidian = stageRisk[project.status] ?? 0.20
  }

  // Completed / cancelled: obsidian zeroed (or tiny remnant)
  if (project.status === 'completed' || project.status === 'cancelled') {
    obsidian = 0
  }

  // ── RUBY: absorbed expenses (material cost + estimated labor cost) ─────────
  // Estimate labor: hours × $75 / hr
  const projectHours = fieldLogs
    .filter(f => f.project_id === project.id)
    .reduce((s, f) => s + f.hours, 0)
  const laborEstimate = projectHours * 75
  const totalExpenses = (project.material_cost ?? 0) + laborEstimate
  // Ruby is bounded 2%–45% — it never disappears
  const ruby = Math.min(0.45, Math.max(0.02, totalExpenses / cv))

  // ── GOLD: earned revenue (paid invoices; fallback: phase_completion) ───────
  const paidAmount = invoices
    .filter(i => i.project_id === project.id && i.status === 'paid')
    .reduce((s, i) => s + i.amount, 0)

  let gold = 0
  if (paidAmount > 0) {
    gold = Math.min(0.80, paidAmount / cv)
  } else if (project.phase_completion > 0) {
    // Use phase as a billing proxy when invoice data is sparse
    gold = Math.min(0.75, project.phase_completion / 100 * 0.75)
  }

  // Completed projects: gold is dominant
  if (project.status === 'completed') {
    gold = Math.max(gold, 0.70)
  }

  // ── EMERALD: management effort ────────────────────────────────────────────
  // Thick during heavy phases (25–65%), thin at start & end
  const phase = project.phase_completion
  const heavyPhase = phase >= 20 && phase < 65
  const emeraldBase = heavyPhase ? 0.14 : 0.06
  // Shrinks as gold grows (less management needed when work is done)
  const emerald = Math.max(0.02, emeraldBase * (1 - gold * 0.7))

  // ── DIAMOND: unbilled potential ────────────────────────────────────────────
  const rawDiamond = Math.max(0, 1 - gold - ruby - emerald - obsidian)
  // Completed projects: diamond is zero
  const diamond = project.status === 'completed' ? 0.01 : Math.max(0.02, rawDiamond)

  // ── Normalise so fractions sum to exactly 1.0 ──────────────────────────────
  const sum = obsidian + ruby + emerald + gold + diamond
  return {
    obsidian: obsidian / sum,
    ruby:     ruby     / sum,
    emerald:  emerald  / sum,
    gold:     gold     / sum,
    diamond:  diamond  / sum,
  }
}

// ── Material factories ────────────────────────────────────────────────────────

function makeObsidianMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color:      new THREE.Color(GEO_COLORS.obsidian),
    emissive:   new THREE.Color(GEO_EMISSIVES.obsidian),
    metalness:  1.0,
    roughness:  0.0,
    transparent: true,
    opacity:    0.85,
  })
}

function makeRubyMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color:    new THREE.Color(GEO_COLORS.ruby),
    emissive: new THREE.Color(GEO_EMISSIVES.ruby),
    metalness: 0.7,
    roughness: 0.2,
  })
}

function makeEmeraldMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color:    new THREE.Color(GEO_COLORS.emerald),
    emissive: new THREE.Color(GEO_EMISSIVES.emerald),
    metalness: 0.5,
    roughness: 0.3,
  })
}

function makeGoldMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color:    new THREE.Color(GEO_COLORS.gold),
    emissive: new THREE.Color(GEO_EMISSIVES.gold),
    metalness: 1.0,
    roughness: 0.2,
  })
}

function makeDiamondMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color:    new THREE.Color(GEO_COLORS.diamond),
    emissive: new THREE.Color(GEO_EMISSIVES.diamond),
    metalness: 0.9,
    roughness: 0.1,
    transparent: true,
    opacity: 0.92,
  })
}

// ── Ring group builder ────────────────────────────────────────────────────────

/** Slot indices for the ring meshes inside the group */
export const RING_IDX = { obsidian: 0, ruby: 1, emerald: 2, gold: 3, diamond: 4 } as const

/**
 * Build a THREE.Group of 5 stacked CylinderGeometry rings.
 * The group origin sits at y=0 (ground level).
 * Each ring is a CylinderGeometry whose top/bottom radii taper to form a cone profile.
 *
 * @param fracs    Normalised ring fractions (must sum to 1.0)
 * @param totalH   Total mountain height (units)
 * @param baseR    Base radius of the mountain at y=0
 * @param segs     Radial segments per ring (use 8, 5, or 3 for LOD)
 */
export function buildRingGroup(
  fracs:  RingFractions,
  totalH: number,
  baseR:  number,
  segs:   number,
): THREE.Group {
  const group = new THREE.Group()

  const names = ['obsidian', 'ruby', 'emerald', 'gold', 'diamond'] as const
  const heights = names.map(n => fracs[n] * totalH)

  // Ensure no ring has zero height (would cause degenerate geometry)
  for (let i = 0; i < heights.length; i++) {
    if (heights[i] < 0.01) heights[i] = 0.01
  }

  const makeMat: Record<string, () => THREE.MeshStandardMaterial> = {
    obsidian: makeObsidianMat,
    ruby:     makeRubyMat,
    emerald:  makeEmeraldMat,
    gold:     makeGoldMat,
    diamond:  makeDiamondMat,
  }

  let cumY = 0

  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    const h    = heights[i]
    const yBot = cumY
    const yTop = cumY + h

    // Cone taper: radius at any height t is baseR * (1 - t/totalH)
    const rBot = baseR * (1 - yBot / totalH)
    const rTop = baseR * (1 - yTop / totalH)

    const geo  = new THREE.CylinderGeometry(
      Math.max(0, rTop),  // radiusTop
      Math.max(0, rBot),  // radiusBottom
      h,                  // height
      segs,               // radialSegments
      1,                  // heightSegments
      false,              // openEnded
    )
    const mat  = makeMat[name]()
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name            = name
    mesh.frustumCulled   = true
    mesh.castShadow      = true
    mesh.receiveShadow   = false
    // Position: CylinderGeometry origin is at its vertical centre
    mesh.position.y      = cumY + h * 0.5

    group.add(mesh)
    cumY += h
  }

  return group
}

// ── LOD builder ───────────────────────────────────────────────────────────────

export interface GeoMtnHandle {
  /** THREE.LOD to add to scene (positioned at x, 0, z) */
  lod: THREE.LOD
  /**
   * Per-frame update: animate obsidian pulse + diamond shimmer.
   * Returns the new emissiveIntensity values for reference.
   */
  animTick: (elapsed: number) => void
  /**
   * Spawn a transformation ripple at the gold/diamond boundary.
   * Call when gold fraction has increased (phase completed).
   * Returns a cleanup callback to remove the ripple after animation.
   */
  spawnTransformRipple: (scene: THREE.Scene, xWorld: number, zWorld: number) => () => void
  /**
   * Add / remove gold sparkle PointLights (call based on camera distance rank).
   * Pass scene to add lights; null to remove them.
   */
  setGoldSparkle: (scene: THREE.Scene | null, xWorld: number, yGold: number, zWorld: number) => void
  /** Cached ring fractions used to build this mountain */
  fracs: RingFractions
  /** Gold frac at last build — used to detect phase transitions */
  prevGoldFrac: number
  /** Raw height of the mountain (total, no pulse) */
  totalHeight: number
  dispose: () => void
}

/**
 * Build a geological mountain LOD object for a single project.
 *
 * The returned `lod` should be positioned at (x, 0, z).
 * Call `animTick(elapsed)` from your frame handler.
 */
export function buildGeologicalMountainLOD(
  project:   NWProject,
  rfis:      NWRFI[],
  fieldLogs: NWFieldLog[],
  invoices:  NWInvoice[],
): GeoMtnHandle {
  const totalHeight = Math.max(0.5, contractValueToHeight(project.contract_value))
  const baseR       = totalHeight * 0.3
  const fracs       = computeRingFractions(project, rfis, fieldLogs, invoices)

  // ── Build LOD levels ────────────────────────────────────────────────────────
  const lod = new THREE.LOD()

  const levelDefs: Array<{ segs: number; dist: number }> = [
    { segs: 8, dist:   0 },
    { segs: 5, dist:  50 },
    { segs: 3, dist: 120 },
  ]

  for (const { segs, dist } of levelDefs) {
    const grp = buildRingGroup(fracs, totalHeight, baseR, segs)
    lod.addLevel(grp, dist)
  }

  lod.frustumCulled = true
  lod.userData.projectId = project.id
  lod.userData.totalHeight = totalHeight
  lod.userData.fracs = fracs

  // ── Sparkle lights (gold layer) ─────────────────────────────────────────────
  let sparkLights: THREE.PointLight[] = []
  const MAX_SPARKS = 3

  const setGoldSparkle = (
    scene: THREE.Scene | null,
    xWorld: number,
    yGold: number,
    zWorld: number,
  ) => {
    // Remove existing
    for (const l of sparkLights) {
      if (l.parent) l.parent.remove(l)
      l.dispose()
    }
    sparkLights = []

    if (!scene) return

    for (let i = 0; i < MAX_SPARKS; i++) {
      const angle = (i / MAX_SPARKS) * Math.PI * 2
      const r     = baseR * 0.5
      const light = new THREE.PointLight(GEO_COLORS.gold, 0, 5)
      light.position.set(
        xWorld + Math.cos(angle) * r,
        yGold,
        zWorld + Math.sin(angle) * r,
      )
      scene.add(light)
      sparkLights.push(light)
    }
  }

  // ── Per-frame animation ─────────────────────────────────────────────────────
  // We animate materials on the HIGH-DETAIL group (lod.levels[0].object)
  const animTick = (elapsed: number) => {
    const highGrp = lod.levels[0]?.object as THREE.Group | undefined
    if (!highGrp) return

    // Obsidian: slow dark shimmer pulse
    const obsMesh = highGrp.children[RING_IDX.obsidian] as THREE.Mesh
    if (obsMesh) {
      const obsMat = obsMesh.material as THREE.MeshStandardMaterial
      obsMat.emissiveIntensity = 0.5 + Math.sin(elapsed * 1.2) * 0.3
    }

    // Diamond: refractive shimmer (sin-wave emissive intensity)
    const diaMesh = highGrp.children[RING_IDX.diamond] as THREE.Mesh
    if (diaMesh) {
      const diaMat = diaMesh.material as THREE.MeshStandardMaterial
      diaMat.emissiveIntensity = 0.4 + Math.sin(elapsed * 2.5) * 0.35
    }

    // Gold sparkle lights: cycle on/off
    for (let i = 0; i < sparkLights.length; i++) {
      const offset = (i / sparkLights.length) * Math.PI * 2
      sparkLights[i].intensity = Math.max(0, Math.sin(elapsed * 3.0 + offset)) * 1.2
    }
  }

  // ── Transformation ripple (diamond → gold wave) ────────────────────────────
  const spawnTransformRipple = (
    scene:  THREE.Scene,
    xWorld: number,
    zWorld: number,
  ): (() => void) => {
    // The gold/diamond boundary is at height = (obsidian + ruby + emerald + gold) * totalHeight
    const boundaryY = (fracs.obsidian + fracs.ruby + fracs.emerald + fracs.gold) * totalHeight
    const ringR     = baseR * (1 - boundaryY / totalHeight) * 1.2

    const geo = new THREE.RingGeometry(ringR * 0.5, ringR, 24)
    const mat = new THREE.MeshBasicMaterial({
      color:       GEO_COLORS.gold,
      transparent: true,
      opacity:     0.85,
      side:        THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(xWorld, boundaryY, zWorld)
    scene.add(mesh)

    let t     = 0
    const DUR = 2.0   // 2 second animation
    const clock = new THREE.Clock()
    clock.start()

    let animId = 0
    const animate = () => {
      t += clock.getDelta()
      const prog = Math.min(1, t / DUR)
      mesh.scale.setScalar(1 + prog * 2.5)
      mat.opacity = 0.85 * (1 - prog)
      if (prog < 1) {
        animId = requestAnimationFrame(animate)
      } else {
        scene.remove(mesh)
        geo.dispose()
        mat.dispose()
      }
    }
    animId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animId)
      scene.remove(mesh)
      geo.dispose()
      mat.dispose()
    }
  }

  // ── Dispose ─────────────────────────────────────────────────────────────────
  const dispose = () => {
    for (const { object } of lod.levels) {
      const grp = object as THREE.Group
      for (const child of grp.children) {
        const m = child as THREE.Mesh
        m.geometry?.dispose()
        if (Array.isArray(m.material)) {
          m.material.forEach(mat => mat.dispose())
        } else {
          m.material?.dispose()
        }
      }
    }
    for (const l of sparkLights) l.dispose()
    sparkLights = []
  }

  return {
    lod,
    animTick,
    spawnTransformRipple,
    setGoldSparkle,
    fracs,
    prevGoldFrac: fracs.gold,
    totalHeight,
    dispose,
  }
}

