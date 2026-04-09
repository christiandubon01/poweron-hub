/**
 * CustomerTerritoryLayer.tsx — NW13 Customer Intelligence territories.
 *
 * Each unique client gets a territory on the west continent.
 * Territory size = lifetime value (sum of all project contract values).
 *
 * Features:
 * 1. Territory ground        — PlaneGeometry at seeded position; color/texture
 *                              based on relationship terrain archetype:
 *                              green_rolling  = loyal long-term (#1a4a0a tint)
 *                              rocky_unstable = difficult payment (#3a2a0a tint)
 *                              flat_barren    = dormant 12+ months (#1a1a0a tint)
 * 2. Client structure        — geometry at territory center based on client type:
 *                              residential   = small BoxGeometry house
 *                              commercial    = CylinderGeometry office tower
 *                              solar         = house (Box) + panel array (flat boxes)
 *                              service_only  = small low BoxGeometry shed
 *                              prospect      = WireframeGeometry ghost structure
 * 3. Smoke particles         — Points system above structure for active projects
 * 4. Contact light           — PointLight above territory; intensity = recency
 * 5. Weather particles       — Points system; clear/overcast/storm based on
 *                              RFI count + payment history
 * 6. Territory path          — PlaneGeometry strip from HQ center (0,0) to territory
 *                              opacity = contactFrequency; overgrown green tint
 * 7. Territory label sprite  — client name text above structure
 *
 * Dive Mode (handled in DiveModePanel.tsx):
 * - Dispatches nw:territory-approach when player enters proximity
 * - Dispatches nw:territory-leave when player exits proximity
 *
 * All Three.js objects are properly disposed on unmount.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { makeLabel, type NWLabel } from '../utils/makeLabel'
import {
  subscribeWorldData,
  type NWWorldData,
  type NWClientTerritory,
  type NWTerritoryTerrain,
  type NWTerritoryStructure,
  type NWTerritoryWeather,
} from '../DataBridge'

// ── Constants ─────────────────────────────────────────────────────────────────

const TERRITORY_Y = 0.05          // ground plane Y offset (just above world ground)
const STRUCTURE_Y_OFFSET = 0.5    // structure base above territory plane
const LABEL_Y_OFFSET = 5.5        // sprite height above territory center
const LIGHT_Y_OFFSET = 8          // contact light height
const SMOKE_Y_OFFSET = 3          // smoke emitter start height
const PATH_Y_OFFSET  = 0.08       // path strip just above territory plane
const HQ_X = 0                    // HQ center X (founders valley)
const HQ_Z = 0                    // HQ center Z
const DIVE_PROXIMITY = 28         // units — triggers dive mode
const DIVE_CHECK_INTERVAL = 30    // check every 30 frames

// ── Terrain colours ───────────────────────────────────────────────────────────

const TERRAIN_COLORS: Record<NWTerritoryTerrain, number> = {
  green_rolling:   0x1a4a0a,   // lush dark green
  rocky_unstable:  0x3a2808,   // dark burnt orange-brown
  flat_barren:     0x151510,   // near-black grey
}

const TERRAIN_EMISSIVES: Record<NWTerritoryTerrain, number> = {
  green_rolling:   0x0a1a05,
  rocky_unstable:  0x150a00,
  flat_barren:     0x050505,
}

// ── Weather particle colours ──────────────────────────────────────────────────

const WEATHER_COLORS: Record<NWTerritoryWeather, number> = {
  clear:    0x80d0ff,   // soft sky blue
  overcast: 0x506070,   // grey-blue
  storm:    0x2a1040,   // deep purple-dark
}

const WEATHER_COUNTS: Record<NWTerritoryWeather, number> = {
  clear: 0, overcast: 18, storm: 45,
}

// ── Dispose helper ────────────────────────────────────────────────────────────

function disposeObj(scene: THREE.Scene, obj: THREE.Object3D | null): void {
  if (!obj) return
  scene.remove(obj)
  obj.traverse((child) => {
    if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose()
    const mat = (child as THREE.Mesh).material
    if (mat) {
      if (Array.isArray(mat)) mat.forEach(m => m.dispose())
      else mat.dispose()
    }
  })
}

// NW31b: makeTextSprite replaced by shared makeLabel utility (see utils/makeLabel.ts)

// ── Per-territory mesh group ──────────────────────────────────────────────────

interface TerritoryEntry {
  group: THREE.Group
  terrainMesh: THREE.Mesh
  structure: THREE.Object3D
  label: THREE.Sprite
  contactLight: THREE.PointLight
  smokeMesh:   THREE.Points | null
  weatherMesh: THREE.Points | null
  pathMesh:    THREE.Mesh | null
  animTime: number
  smokeVels: Float32Array | null
  weatherVels: Float32Array | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CustomerTerritoryLayer() {
  const { scene, camera, playerPosition } = useWorldContext()

  const territoriesRef  = useRef<Map<string, TerritoryEntry>>(new Map())
  const frameHandlerRef = useRef<((e: Event) => void) | null>(null)
  const elapsedRef      = useRef(0)
  const frameCountRef   = useRef(0)
  const activeDiveKeyRef = useRef<string | null>(null)

  // ── Build territory terrain plane ────────────────────────────────────────

  function buildTerrainPlane(t: NWClientTerritory): THREE.Mesh {
    const size = t.territoryRadius * 2
    const geo  = new THREE.PlaneGeometry(size, size, 4, 4)
    const mat  = new THREE.MeshLambertMaterial({
      color:    TERRAIN_COLORS[t.terrain],
      emissive: new THREE.Color(TERRAIN_EMISSIVES[t.terrain]),
      side:     THREE.DoubleSide,
      transparent: t.terrain === 'flat_barren',
      opacity: t.terrain === 'flat_barren' ? 0.7 : 1,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(0, TERRITORY_Y, 0)
    return mesh
  }

  // ── Build client structure ───────────────────────────────────────────────

  function buildStructure(t: NWClientTerritory): THREE.Object3D {
    const group = new THREE.Group()
    group.position.set(0, STRUCTURE_Y_OFFSET, 0)

    const structureColor   = t.structure === 'prospect' ? 0x334433 : 0x2a2a3a
    const structureEmissive = t.structure === 'prospect' ? 0x112211 : 0x0a0a14

    switch (t.structure as NWTerritoryStructure) {
      case 'residential': {
        // Small house: box body + pyramid roof
        const bodyGeo  = new THREE.BoxGeometry(1.5, 1.2, 1.5)
        const bodyMat  = new THREE.MeshLambertMaterial({ color: 0x2a2a4a, emissive: 0x080810 })
        const body     = new THREE.Mesh(bodyGeo, bodyMat)
        body.position.y = 0.6

        const roofGeo  = new THREE.ConeGeometry(1.2, 0.8, 4)
        const roofMat  = new THREE.MeshLambertMaterial({ color: 0x4a2a1a, emissive: 0x100808 })
        const roof     = new THREE.Mesh(roofGeo, roofMat)
        roof.position.y = 1.6
        roof.rotation.y = Math.PI / 4

        group.add(body, roof)
        break
      }
      case 'commercial': {
        // Office tower: tall cylinder with flat top
        const height   = Math.max(2, Math.min(6, t.lifetimeValue / 20000))
        const towerGeo = new THREE.CylinderGeometry(0.6, 0.8, height, 8)
        const towerMat = new THREE.MeshLambertMaterial({ color: 0x1a2a3a, emissive: 0x060810 })
        const tower    = new THREE.Mesh(towerGeo, towerMat)
        tower.position.y = height / 2

        const topGeo   = new THREE.BoxGeometry(1.4, 0.2, 1.4)
        const topMat   = new THREE.MeshLambertMaterial({ color: 0x00aacc, emissive: 0x002244 })
        const top      = new THREE.Mesh(topGeo, topMat)
        top.position.y = height + 0.1

        group.add(tower, top)
        break
      }
      case 'solar': {
        // House body + panel array (flat boxes)
        const bodyGeo  = new THREE.BoxGeometry(1.4, 1.0, 1.4)
        const bodyMat  = new THREE.MeshLambertMaterial({ color: 0x2a2a3a, emissive: 0x080810 })
        const body     = new THREE.Mesh(bodyGeo, bodyMat)
        body.position.y = 0.5

        const panelPositions = [
          [-1.4, 0.3, 0], [-1.4, 0.3, 1], [-1.4, 0.3, -1],
          [1.4, 0.3, 0],  [1.4, 0.3, 1],  [1.4, 0.3, -1],
        ]
        for (const [px, py, pz] of panelPositions) {
          const panelGeo = new THREE.BoxGeometry(0.9, 0.06, 0.5)
          const panelMat = new THREE.MeshLambertMaterial({ color: 0x0a1a3a, emissive: 0x001a22 })
          const panel    = new THREE.Mesh(panelGeo, panelMat)
          panel.position.set(px, py, pz)
          panel.rotation.x = -0.3
          group.add(panel)
        }
        group.add(body)
        break
      }
      case 'service_only': {
        // Small low shed
        const shedGeo  = new THREE.BoxGeometry(1.8, 0.8, 1.0)
        const shedMat  = new THREE.MeshLambertMaterial({ color: 0x282018, emissive: 0x080600 })
        const shed     = new THREE.Mesh(shedGeo, shedMat)
        shed.position.y = 0.4

        const doorGeo  = new THREE.BoxGeometry(0.4, 0.6, 0.05)
        const doorMat  = new THREE.MeshLambertMaterial({ color: 0x4a3018 })
        const door     = new THREE.Mesh(doorGeo, doorMat)
        door.position.set(0, 0.3, 0.53)
        group.add(shed, door)
        break
      }
      case 'prospect': {
        // Wireframe ghost structure
        const ghostGeo  = new THREE.BoxGeometry(1.2, 1.5, 1.2)
        const ghostMat  = new THREE.MeshBasicMaterial({
          color: structureColor,
          wireframe: true,
          transparent: true,
          opacity: 0.45,
        })
        const ghost     = new THREE.Mesh(ghostGeo, ghostMat)
        ghost.position.y = 0.75
        group.add(ghost)
        break
      }
      default: {
        // Fallback simple box
        const defGeo = new THREE.BoxGeometry(1, 1, 1)
        const defMat = new THREE.MeshLambertMaterial({ color: structureColor, emissive: structureEmissive })
        const defMsh = new THREE.Mesh(defGeo, defMat)
        defMsh.position.y = 0.5
        group.add(defMsh)
      }
    }

    return group
  }

  // ── Build smoke particles (active project indicator) ─────────────────────

  function buildSmoke(t: NWClientTerritory): THREE.Points | null {
    if (t.activeProjectCount === 0) return null

    const count  = Math.min(t.activeProjectCount * 8, 60)
    const pos    = new Float32Array(count * 3)
    const vels   = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 0.6
      pos[i * 3 + 1] = SMOKE_Y_OFFSET + Math.random() * 2
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.6
      vels[i * 3]     = (Math.random() - 0.5) * 0.008
      vels[i * 3 + 1] = 0.012 + Math.random() * 0.010
      vels[i * 3 + 2] = (Math.random() - 0.5) * 0.008
    }

    const geo  = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.userData.velocities = vels

    const mat  = new THREE.PointsMaterial({
      color: 0x888899,
      size: 0.22,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
    const pts  = new THREE.Points(geo, mat)
    return pts
  }

  // ── Build weather particles ──────────────────────────────────────────────

  function buildWeather(t: NWClientTerritory, radius: number): THREE.Points | null {
    const count = WEATHER_COUNTS[t.weather]
    if (count === 0) return null

    const spread = radius * 0.9
    const pos    = new Float32Array(count * 3)
    const vels   = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * spread * 2
      pos[i * 3 + 1] = 5 + Math.random() * 4
      pos[i * 3 + 2] = (Math.random() - 0.5) * spread * 2
      vels[i * 3]     = (Math.random() - 0.5) * 0.005
      vels[i * 3 + 1] = -(0.008 + Math.random() * 0.006)
      vels[i * 3 + 2] = (Math.random() - 0.5) * 0.005
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.userData.velocities = vels
    geo.userData.spread     = spread

    const mat = new THREE.PointsMaterial({
      color: WEATHER_COLORS[t.weather],
      size: t.weather === 'storm' ? 0.28 : 0.18,
      transparent: true,
      opacity: t.weather === 'storm' ? 0.70 : 0.40,
      depthWrite: false,
    })
    return new THREE.Points(geo, mat)
  }

  // ── Build path strip from HQ to territory ────────────────────────────────

  function buildPath(t: NWClientTerritory): THREE.Mesh | null {
    if (t.contactFrequency < 0.05) return null   // fully dormant — no path

    // Direction from HQ (0,0) to territory
    const dx     = t.worldX - HQ_X
    const dz     = t.worldZ - HQ_Z
    const dist   = Math.sqrt(dx * dx + dz * dz)
    if (dist < 5) return null

    const pathWidth = 0.5 + t.contactFrequency * 1.0   // wider = more contact

    // Build path as thin PlaneGeometry along the vector
    const geo  = new THREE.PlaneGeometry(pathWidth, dist)
    const mat  = new THREE.MeshLambertMaterial({
      color:       0x0a2a06,
      emissive:    new THREE.Color(0x030d02),
      transparent: true,
      opacity:     0.12 + t.contactFrequency * 0.45,
      side:        THREE.DoubleSide,
      depthWrite:  false,
    })
    const mesh = new THREE.Mesh(geo, mat)

    // Rotate to lie flat
    mesh.rotation.x = -Math.PI / 2

    // Rotate around Y to point from HQ to territory
    const angle = Math.atan2(dx, dz)
    mesh.rotation.z = angle

    // Position midpoint between HQ and territory
    mesh.position.set(
      HQ_X + dx * 0.5,
      PATH_Y_OFFSET,
      HQ_Z + dz * 0.5,
    )

    return mesh
  }

  // ── Build or rebuild all territories ────────────────────────────────────

  function buildTerritories(territories: NWClientTerritory[]) {
    // Dispose existing
    for (const [, entry] of territoriesRef.current) {
      disposeObj(scene, entry.group)
      scene.remove(entry.contactLight)
      if (entry.pathMesh) disposeObj(scene, entry.pathMesh)
    }
    territoriesRef.current.clear()

    for (const t of territories) {
      const group = new THREE.Group()
      group.position.set(t.worldX, 0, t.worldZ)

      // 1. Terrain plane
      const terrainMesh = buildTerrainPlane(t)
      group.add(terrainMesh)

      // 2. Structure
      const structure = buildStructure(t)
      group.add(structure)

      // 3. Label sprite — NW31b: teal accent, sized to content
      const label = makeLabel(t.clientName.toUpperCase(), '#aaffd8')
      label.position.set(0, LABEL_Y_OFFSET, 0)
      group.add(label)

      // 4. Contact light — intensity mapped to recency
      const lightIntensity = t.daysSinceContact < 7   ? 1.4
                           : t.daysSinceContact < 30  ? 0.9
                           : t.daysSinceContact < 90  ? 0.5
                           : t.daysSinceContact < 365 ? 0.2
                           : 0.05
      const lightColor = t.terrain === 'green_rolling'  ? 0x55ff88
                       : t.terrain === 'rocky_unstable' ? 0xff8833
                       : 0x333344
      const contactLight = new THREE.PointLight(lightColor, lightIntensity, t.territoryRadius * 3.5)
      contactLight.position.set(t.worldX, LIGHT_Y_OFFSET, t.worldZ)
      scene.add(contactLight)

      // 5. Smoke particles
      const smokeMesh = buildSmoke(t)
      let smokeVels: Float32Array | null = null
      if (smokeMesh) {
        smokeVels = smokeMesh.geometry.userData.velocities as Float32Array
        group.add(smokeMesh)
      }

      // 6. Weather particles
      const weatherMesh = buildWeather(t, t.territoryRadius)
      let weatherVels: Float32Array | null = null
      if (weatherMesh) {
        weatherVels = weatherMesh.geometry.userData.velocities as Float32Array
        group.add(weatherMesh)
      }

      scene.add(group)

      // 7. Path (placed directly in scene with absolute coords)
      const pathMesh = buildPath(t)
      if (pathMesh) scene.add(pathMesh)

      territoriesRef.current.set(t.clientKey, {
        group,
        terrainMesh,
        structure,
        label,
        contactLight,
        smokeMesh,
        weatherMesh,
        pathMesh,
        animTime: Math.random() * 100,   // randomize phase
        smokeVels,
        weatherVels,
      })
    }
  }

  // ── Animation frame handler ───────────────────────────────────────────────

  function setupFrameHandler() {
    if (frameHandlerRef.current) {
      window.removeEventListener('nw:frame', frameHandlerRef.current)
    }

    const handler = () => {
      const dt = 0.016
      elapsedRef.current   += dt
      frameCountRef.current += 1

      for (const [clientKey, entry] of territoriesRef.current) {
        entry.animTime += dt

        // Sway label slightly
        entry.label.position.y = LABEL_Y_OFFSET + Math.sin(entry.animTime * 0.6) * 0.12

        // Pulse contact light
        entry.contactLight.intensity += (Math.sin(entry.animTime * 1.8) * 0.05)

        // Animate smoke particles
        if (entry.smokeMesh && entry.smokeVels) {
          const pos     = entry.smokeMesh.geometry.attributes.position as THREE.BufferAttribute
          const vels    = entry.smokeVels
          const cnt     = pos.count
          const maxY    = SMOKE_Y_OFFSET + 5
          const minY    = SMOKE_Y_OFFSET

          for (let i = 0; i < cnt; i++) {
            pos.array[i * 3]     += vels[i * 3]     * dt * 60
            pos.array[i * 3 + 1] += vels[i * 3 + 1] * dt * 60
            pos.array[i * 3 + 2] += vels[i * 3 + 2] * dt * 60
            // Reset if too high
            if ((pos.array[i * 3 + 1] as number) > maxY) {
              pos.array[i * 3]     = (Math.random() - 0.5) * 0.6
              pos.array[i * 3 + 1] = minY + Math.random() * 0.5
              pos.array[i * 3 + 2] = (Math.random() - 0.5) * 0.6
            }
          }
          pos.needsUpdate = true
        }

        // Animate weather particles
        if (entry.weatherMesh && entry.weatherVels) {
          const pos    = entry.weatherMesh.geometry.attributes.position as THREE.BufferAttribute
          const vels   = entry.weatherVels
          const spread = entry.weatherMesh.geometry.userData.spread as number
          const cnt    = pos.count
          const minY   = TERRITORY_Y + 0.5
          const maxY   = 10

          for (let i = 0; i < cnt; i++) {
            pos.array[i * 3]     += vels[i * 3]     * dt * 60
            pos.array[i * 3 + 1] += vels[i * 3 + 1] * dt * 60
            pos.array[i * 3 + 2] += vels[i * 3 + 2] * dt * 60
            // Reset if below ground
            if ((pos.array[i * 3 + 1] as number) < minY) {
              pos.array[i * 3]     = (Math.random() - 0.5) * spread * 2
              pos.array[i * 3 + 1] = maxY - 1 + Math.random()
              pos.array[i * 3 + 2] = (Math.random() - 0.5) * spread * 2
            }
          }
          pos.needsUpdate = true
        }

        // Dive proximity check (every N frames)
        if (frameCountRef.current % DIVE_CHECK_INTERVAL === 0) {
          const pp  = playerPosition.current
          const dx  = pp.x - entry.group.position.x
          const dz  = pp.z - entry.group.position.z
          const d2  = dx * dx + dz * dz
          const r   = DIVE_PROXIMITY

          if (d2 < r * r) {
            // Player is near this territory
            if (activeDiveKeyRef.current !== clientKey) {
              activeDiveKeyRef.current = clientKey
              window.dispatchEvent(new CustomEvent('nw:territory-approach', {
                detail: { clientKey },
              }))
            }
          } else if (activeDiveKeyRef.current === clientKey) {
            activeDiveKeyRef.current = null
            window.dispatchEvent(new CustomEvent('nw:territory-leave', {
              detail: { clientKey },
            }))
          }
        }
      }

      // NW31b: Frustum cull + distance fade territory labels
      const _wp = new THREE.Vector3()
      for (const [, entry] of territoriesRef.current) {
        entry.label.getWorldPosition(_wp)
        ;(entry.label as NWLabel).updateVisibility(camera, _wp)
      }
    }

    window.addEventListener('nw:frame', handler)
    frameHandlerRef.current = handler
  }

  // ── Mount / unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    setupFrameHandler()

    const unsub = subscribeWorldData((data: NWWorldData) => {
      buildTerritories(data.clientTerritories)
    })

    return () => {
      unsub()

      // Dispose all territory meshes
      for (const [, entry] of territoriesRef.current) {
        disposeObj(scene, entry.group)
        scene.remove(entry.contactLight)
        if (entry.pathMesh) disposeObj(scene, entry.pathMesh)
      }
      territoriesRef.current.clear()

      // Remove frame handler
      if (frameHandlerRef.current) {
        window.removeEventListener('nw:frame', frameHandlerRef.current)
        frameHandlerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  return null
}
