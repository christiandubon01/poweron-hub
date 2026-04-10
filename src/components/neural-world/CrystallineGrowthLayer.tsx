/**
 * CrystallineGrowthLayer.tsx — NW63: Subscription revenue as growing crystal formations.
 *
 * Each active subscription is rendered as a translucent crystal tower on the
 * east continent (PowerOn Hub software zone, x=20–200).
 *
 * CRYSTAL HEIGHT:
 *   1 world unit per month active, capped at 24 units.
 *
 * CRYSTAL COLOR (tier):
 *   basic  → blue   (#4488ff)
 *   growth → purple (#aa44ff)
 *   pro    → gold   (#ffcc00)
 *
 * GROWTH ANIMATION:
 *   When a new payment lands (last_payment date advances):
 *   - Crystal extends upward over 0.8 s (easeOut cubic)
 *   - Sparkle sprites burst from the top edge and drift upward
 *
 * GEOMETRY:
 *   IcosahedronGeometry (detail=1) for faceted surfaces + custom ShaderMaterial
 *   for internal refraction glow (Fresnel edges + animated shimmer).
 *
 * STATES:
 *   active   — glowing, full opacity, slow shimmer
 *   dormant  — 45+ days since last payment: dims to 30% opacity, crack pattern appears
 *   shattering — cancelled: particle-shard burst for 1.5 s, then fully removed
 *
 * CLUSTER FORMATION:
 *   Multiple subscriptions from the same client_id grow adjacent, offset by 2 u.
 *
 * LOD:
 *   > 30 units from camera → simple CylinderGeometry (no shader, flat material).
 *   ≤ 30 units → full IcosahedronGeometry + ShaderMaterial.
 *
 * PERFORMANCE:
 *   Max 50 crystal objects total. If more subscriptions exist, smallest
 *   monthly_amount are culled from the scene (still tracked in state).
 *
 * DATA SOURCE:
 *   Fetches from Supabase `subscriptions` table directly.
 *   Fields: id, name, tier, monthly_amount, start_date, last_payment,
 *           client_id, cancelled_at.
 *   Falls back gracefully if table does not exist.
 *   Refreshes every 45 seconds.
 */

import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import { supabase } from '@/lib/supabase'

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_CRYSTALS        = 50
const LOD_THRESHOLD       = 30          // units from camera
const HEIGHT_PER_MONTH    = 1.0         // world units
const MAX_HEIGHT          = 24.0        // world units (24 months cap)
const DORMANT_DAYS        = 45          // days before dormant
const SPARKLE_COUNT       = 12          // sparkles per growth event
const SPARKLE_DURATION    = 1.5         // seconds
const SHARD_COUNT         = 10          // shatter shards per crystal
const SHATTER_DURATION    = 1.6         // seconds for shatter animation
const GROWTH_DURATION     = 0.8         // seconds for height growth
const REFRESH_INTERVAL_MS = 45_000      // supabase refresh cadence
const CRYSTAL_RADIUS      = 0.55        // base radius in world units
const PEDESTAL_RADIUS     = 0.8         // ground ring radius
const PEDESTAL_Y          = 0.05        // ground ring hover

// East continent crystal zone: x=35–175, z=-160–160
const ZONE_X_MIN = 35
const ZONE_X_SPAN = 140
const ZONE_Z_HALF = 160

// Tier colors
const TIER_COLORS: Record<string, THREE.Color> = {
  basic:  new THREE.Color(0x4488ff),
  growth: new THREE.Color(0xaa44ff),
  pro:    new THREE.Color(0xffcc00),
}

// ── GLSL Shaders ───────────────────────────────────────────────────────────────

const CRYSTAL_VERT = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying vec2 vUv;

  void main() {
    vNormal  = normalize(normalMatrix * normal);
    vViewPos = (modelViewMatrix * vec4(position, 1.0)).xyz;
    vUv      = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const CRYSTAL_FRAG = /* glsl */`
  uniform float uTime;
  uniform vec3  uColor;
  uniform float uIntensity;
  uniform float uCrackFactor;

  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    // View direction in view space
    vec3 viewDir = normalize(-vViewPos);

    // Fresnel: bright edges, translucent core
    float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 2.2);

    // Animated internal shimmer (refraction bands)
    float shimA = sin(vViewPos.y * 4.5  + uTime * 1.4) * 0.5 + 0.5;
    float shimB = sin(vViewPos.x * 3.0  - uTime * 0.9) * 0.5 + 0.5;
    float shimC = sin(vViewPos.z * 3.8  + uTime * 1.1) * 0.5 + 0.5;
    float shimmer = shimA * shimB * 0.5 + shimC * 0.5;

    // Core refraction glow
    vec3 coreColor = uColor * (0.25 + 0.45 * shimmer);

    // Saturated edge glow with additive fresnel
    vec3 edgeGlow = uColor * (1.0 + fresnel * 2.8);

    // Final crystal color
    vec3 finalColor = mix(coreColor, edgeGlow, fresnel * 0.75 + 0.15);
    finalColor *= uIntensity;

    // Crack pattern: darken along procedural fissure lines
    float crackA = step(0.82, sin(vUv.x * 22.0 + vUv.y * 17.0));
    float crackB = step(0.78, sin(vUv.y * 19.0 - vUv.x * 13.0));
    float crackMask = clamp(crackA + crackB, 0.0, 1.0);
    finalColor *= mix(1.0, 0.18, crackMask * uCrackFactor);

    float alpha = mix(0.48, 0.92, fresnel) * uIntensity;

    gl_FragColor = vec4(finalColor, alpha);
  }
`

// ── Local types ────────────────────────────────────────────────────────────────

type SubscriptionTier = 'basic' | 'growth' | 'pro'
type CrystalState     = 'active' | 'dormant' | 'shattering' | 'gone'

interface NWSubscription {
  id:             string
  name:           string
  tier:           SubscriptionTier
  monthly_amount: number
  start_date:     string | null
  last_payment:   string | null
  client_id:      string | null
  cancelled_at:   string | null
}

interface SparkleParticle {
  mesh:     THREE.Mesh
  vx:       number
  vy:       number
  vz:       number
  age:      number
  maxAge:   number
}

interface ShardParticle {
  mesh:     THREE.Mesh
  vx:       number
  vy:       number
  vz:       number
  rx:       number
  ry:       number
  rz:       number
  age:      number
}

interface CrystalEntry {
  subId:          string
  sub:            NWSubscription
  x:              number
  z:              number
  state:          CrystalState
  monthsActive:   number
  targetHeight:   number
  currentHeight:  number
  growthProgress: number    // 0–1 during growth animation
  isGrowing:      boolean
  dormantProgress:number    // 0–1 crackFactor ramp
  group:          THREE.Group
  detailMesh:     THREE.Mesh        // IcosahedronGeometry
  lodMesh:        THREE.Mesh        // CylinderGeometry (LOD fallback)
  pedestal:       THREE.Mesh
  uniforms:       {
    uTime:        { value: number }
    uColor:       { value: THREE.Color }
    uIntensity:   { value: number }
    uCrackFactor: { value: number }
  }
  sparkles:       SparkleParticle[]
  shards:         ShardParticle[]
  shatterAge:     number
  prevLastPayment:string | null
  pointLight:     THREE.PointLight
  isLOD:          boolean
}

// ── Geometry factory ───────────────────────────────────────────────────────────

function _buildCrystalGeometry(height: number, radius: number): THREE.BufferGeometry {
  // Use IcosahedronGeometry at detail=1 (faceted, low-poly crystalline look)
  // Scale to match crystal dimensions: squash y to be taller than wide
  const geo = new THREE.IcosahedronGeometry(radius, 1)
  // Stretch vertically to form a tall crystal tower
  const positions = geo.attributes.position
  if (positions) {
    const arr = positions.array as Float32Array
    for (let i = 1; i < arr.length; i += 3) {
      // y-coordinate: remap from [-radius,+radius] to [0, height]
      arr[i] = (arr[i] / radius + 1.0) * 0.5 * height
    }
    positions.needsUpdate = true
    geo.computeVertexNormals()
  }
  return geo
}

function _buildLODGeometry(height: number, radius: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radius * 0.5, radius, height, 6, 1)
}

// ── Deterministic position seeding ────────────────────────────────────────────

/** Hash string to 0–1 pair. */
function _hash2(s: string): [number, number] {
  let h1 = 0xdeadc0de
  let h2 = 0xabcdef01
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2246822519)
    h2 = Math.imul(h2 ^ c, 3266489917)
  }
  h1 ^= h1 >>> 17
  h2 ^= h2 >>> 13
  h1 = Math.imul(h1, 2654435761)
  h2 = Math.imul(h2, 1597334677)
  return [(h1 >>> 0) / 0xffffffff, (h2 >>> 0) / 0xffffffff]
}

/** Derive east-continent position for a subscription cluster key (client_id or sub.id). */
function _clusterPosition(key: string): { x: number; z: number } {
  const [n1, n2] = _hash2('cluster_' + key)
  return {
    x: ZONE_X_MIN + n1 * ZONE_X_SPAN,
    z: (n2 - 0.5) * 2 * ZONE_Z_HALF,
  }
}

/** Offset within a cluster for index i. */
function _clusterOffset(index: number): { dx: number; dz: number } {
  // Spiral offsets: 0 at origin, then ring positions at 2-unit spacing
  if (index === 0) return { dx: 0, dz: 0 }
  const angle = (index - 1) * (Math.PI * 2 / 6)
  const ring  = Math.floor((index) / 6) + 1
  return {
    dx: Math.cos(angle) * 2.2 * ring,
    dz: Math.sin(angle) * 2.2 * ring,
  }
}

// ── Utility ────────────────────────────────────────────────────────────────────

function _monthsActive(startDate: string | null): number {
  if (!startDate) return 1
  const start = new Date(startDate).getTime()
  const now   = Date.now()
  const months = (now - start) / (1000 * 60 * 60 * 24 * 30.44)
  return Math.max(1, Math.min(MAX_HEIGHT, Math.floor(months)))
}

function _daysSincePayment(lastPayment: string | null): number {
  if (!lastPayment) return 9999
  return (Date.now() - new Date(lastPayment).getTime()) / (1000 * 60 * 60 * 24)
}

function _tierColor(tier: SubscriptionTier): THREE.Color {
  return (TIER_COLORS[tier] ?? TIER_COLORS.basic).clone()
}

function _easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// ── Component ──────────────────────────────────────────────────────────────────

export interface CrystallineGrowthLayerProps {
  visible?: boolean
}

export function CrystallineGrowthLayer({ visible = true }: CrystallineGrowthLayerProps) {
  const { scene, camera } = useWorldContext()

  // ── Refs ──────────────────────────────────────────────────────────────────
  const rootGroupRef    = useRef<THREE.Group | null>(null)
  const crystalsRef     = useRef<CrystalEntry[]>([])
  const sparkleGroupRef = useRef<THREE.Group | null>(null)
  const shardGroupRef   = useRef<THREE.Group | null>(null)
  const visibleRef      = useRef(visible)
  visibleRef.current    = visible
  const animFrameRef    = useRef<number>(0)
  const timeRef         = useRef(0)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef      = useRef(true)

  // Shared geometries for sparkle and shard particles
  const sparkleSphereGeoRef = useRef<THREE.SphereGeometry | null>(null)
  const shardIcoGeoRef      = useRef<THREE.IcosahedronGeometry | null>(null)

  // ── Sparkle emission ───────────────────────────────────────────────────────

  const emitSparkles = useCallback((entry: CrystalEntry) => {
    const sparkleGroup = sparkleGroupRef.current
    if (!sparkleGroup) return
    const geoSphere = sparkleSphereGeoRef.current
    if (!geoSphere) return

    const color = _tierColor(entry.sub.tier)
    const topY  = entry.currentHeight + 0.5

    for (let i = 0; i < SPARKLE_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity:     0.95,
        depthWrite:  false,
        blending:    THREE.AdditiveBlending,
      })
      const mesh = new THREE.Mesh(geoSphere, mat)
      const angle = (i / SPARKLE_COUNT) * Math.PI * 2
      const speed = 0.6 + Math.random() * 1.2
      const vx = Math.cos(angle) * speed * 0.5
      const vz = Math.sin(angle) * speed * 0.5
      const vy = 0.8 + Math.random() * 1.5
      mesh.position.set(entry.x + vx * 0.2, topY, entry.z + vz * 0.2)
      mesh.scale.setScalar(0.08 + Math.random() * 0.06)
      sparkleGroup.add(mesh)
      entry.sparkles.push({ mesh, vx, vy, vz, age: 0, maxAge: SPARKLE_DURATION })
    }
  }, [])

  // ── Shatter emission ───────────────────────────────────────────────────────

  const emitShatter = useCallback((entry: CrystalEntry) => {
    const shardGroup = shardGroupRef.current
    if (!shardGroup) return
    const icoGeo = shardIcoGeoRef.current
    if (!icoGeo) return

    const color = _tierColor(entry.sub.tier)
    const midY  = entry.currentHeight * 0.5

    for (let i = 0; i < SHARD_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity:     0.85,
        depthWrite:  false,
        blending:    THREE.AdditiveBlending,
        wireframe:   i % 3 === 0,
      })
      const mesh   = new THREE.Mesh(icoGeo, mat)
      const angle  = (i / SHARD_COUNT) * Math.PI * 2
      const speed  = 2.0 + Math.random() * 3.0
      const vx     = Math.cos(angle) * speed
      const vz     = Math.sin(angle) * speed
      const vy     = 1.5 + Math.random() * 3.0
      mesh.position.set(
        entry.x + Math.cos(angle) * 0.3,
        midY + (Math.random() - 0.5) * entry.currentHeight * 0.6,
        entry.z + Math.sin(angle) * 0.3,
      )
      const sScale = 0.1 + Math.random() * 0.2
      mesh.scale.setScalar(sScale)
      shardGroup.add(mesh)
      entry.shards.push({
        mesh, vx, vy, vz,
        rx: (Math.random() - 0.5) * 4,
        ry: (Math.random() - 0.5) * 4,
        rz: (Math.random() - 0.5) * 4,
        age: 0,
      })
    }

    entry.shatterAge = 0
  }, [])

  // ── Crystal builder ────────────────────────────────────────────────────────

  const buildCrystal = useCallback((
    sub: NWSubscription,
    x: number,
    z: number,
    group: THREE.Group,
  ): CrystalEntry => {
    const months      = _monthsActive(sub.start_date)
    const height      = Math.min(months * HEIGHT_PER_MONTH, MAX_HEIGHT)
    const isDormant   = _daysSincePayment(sub.last_payment) >= DORMANT_DAYS
    const color       = _tierColor(sub.tier)

    // Uniforms shared between vertex/fragment
    const uniforms = {
      uTime:        { value: 0 },
      uColor:       { value: color },
      uIntensity:   { value: isDormant ? 0.3 : 1.0 },
      uCrackFactor: { value: isDormant ? 0.6 : 0.0 },
    }

    // ── Detail mesh (IcosahedronGeometry) ──────────────────────────────────
    const detailGeo = _buildCrystalGeometry(height, CRYSTAL_RADIUS)
    const detailMat = new THREE.ShaderMaterial({
      vertexShader:   CRYSTAL_VERT,
      fragmentShader: CRYSTAL_FRAG,
      uniforms,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.DoubleSide,
      blending:       THREE.NormalBlending,
    })
    const detailMesh = new THREE.Mesh(detailGeo, detailMat)

    // ── LOD mesh (CylinderGeometry) ────────────────────────────────────────
    const lodGeo  = _buildLODGeometry(height, CRYSTAL_RADIUS)
    const lodMat  = new THREE.MeshLambertMaterial({
      color,
      transparent: true,
      opacity:     isDormant ? 0.25 : 0.65,
    })
    const lodMesh = new THREE.Mesh(lodGeo, lodMat)
    lodMesh.position.y = height * 0.5   // cylinder is centered; lift it to ground

    // ── Pedestal ring ──────────────────────────────────────────────────────
    const pedestalGeo = new THREE.RingGeometry(PEDESTAL_RADIUS * 0.5, PEDESTAL_RADIUS, 12)
    const pedestalMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity:     isDormant ? 0.2 : 0.55,
      side:        THREE.DoubleSide,
      depthWrite:  false,
      blending:    THREE.NormalBlending,
    })
    const pedestal    = new THREE.Mesh(pedestalGeo, pedestalMat)
    pedestal.rotation.x = -Math.PI / 2
    pedestal.position.y = PEDESTAL_Y

    // ── Point light ────────────────────────────────────────────────────────
    const pointLight = new THREE.PointLight(color, isDormant ? 0.4 : 1.5, 12)
    pointLight.position.set(0, height * 0.5, 0)

    // ── Group ──────────────────────────────────────────────────────────────
    const crystalGroup = new THREE.Group()
    crystalGroup.add(detailMesh, lodMesh, pedestal, pointLight)
    crystalGroup.position.set(x, 0, z)
    group.add(crystalGroup)

    // Start with detail mesh hidden until LOD check runs
    detailMesh.visible = true
    lodMesh.visible    = false

    return {
      subId:           sub.id,
      sub,
      x, z,
      state:           isDormant ? 'dormant' : 'active',
      monthsActive:    months,
      targetHeight:    height,
      currentHeight:   height,
      growthProgress:  1,
      isGrowing:       false,
      dormantProgress: isDormant ? 1 : 0,
      group:           crystalGroup,
      detailMesh,
      lodMesh,
      pedestal,
      uniforms,
      sparkles:        [],
      shards:          [],
      shatterAge:      0,
      prevLastPayment: sub.last_payment,
      pointLight,
      isLOD:           false,
    }
  }, [])

  // ── Re-build entry when height or state changes ───────────────────────────

  const rebuildCrystalGeometry = useCallback((entry: CrystalEntry, newHeight: number) => {
    const oldDetailGeo = entry.detailMesh.geometry
    const oldLodGeo    = entry.lodMesh.geometry

    const newDetailGeo = _buildCrystalGeometry(newHeight, CRYSTAL_RADIUS)
    const newLodGeo    = _buildLODGeometry(newHeight, CRYSTAL_RADIUS)

    entry.detailMesh.geometry = newDetailGeo
    entry.lodMesh.geometry    = newLodGeo
    entry.lodMesh.position.y  = newHeight * 0.5

    entry.pointLight.position.y = newHeight * 0.5

    oldDetailGeo.dispose()
    oldLodGeo.dispose()
  }, [])

  // ── Supabase fetch ─────────────────────────────────────────────────────────

  const fetchSubscriptions = useCallback(async (): Promise<NWSubscription[]> => {
    try {
      const result = await (supabase as any)
        .from('subscriptions')
        .select('id, name, tier, monthly_amount, start_date, last_payment, client_id, cancelled_at')
        .order('monthly_amount', { ascending: false })
        .limit(200)

      if (result.error) {
        // Table may not exist yet — not fatal
        return []
      }
      return ((result.data ?? []) as any[]).map((row: any): NWSubscription => ({
        id:             row.id      ?? String(Math.random()),
        name:           row.name    ?? 'Unknown',
        tier:           (['basic','growth','pro'].includes(row.tier) ? row.tier : 'basic') as SubscriptionTier,
        monthly_amount: typeof row.monthly_amount === 'number' ? row.monthly_amount : 0,
        start_date:     row.start_date   ?? null,
        last_payment:   row.last_payment ?? null,
        client_id:      row.client_id   ?? null,
        cancelled_at:   row.cancelled_at ?? null,
      }))
    } catch {
      return []
    }
  }, [])

  // ── Reconcile live data with current crystal state ─────────────────────────

  const reconcile = useCallback(async () => {
    if (!mountedRef.current) return

    const subs    = await fetchSubscriptions()
    const group   = rootGroupRef.current
    const crystals = crystalsRef.current
    if (!group || !mountedRef.current) return

    // Enforce max 50 — keep highest monthly_amount
    const activeSubs = subs
      .filter(s => !s.cancelled_at)
      .slice(0, MAX_CRYSTALS)

    const cancelledIds = new Set(
      subs.filter(s => !!s.cancelled_at).map(s => s.id),
    )

    // --- Build cluster positions -------------------------------------------
    // Group active subs by client_id (or individual key if no client_id)
    const clusterMap = new Map<string, NWSubscription[]>()
    for (const sub of activeSubs) {
      const key = sub.client_id ?? `solo_${sub.id}`
      const arr = clusterMap.get(key) ?? []
      arr.push(sub)
      clusterMap.set(key, arr)
    }

    // Compute world positions per subscription
    const subPositions = new Map<string, { x: number; z: number }>()
    for (const [clusterKey, clusterSubs] of clusterMap) {
      const base = _clusterPosition(clusterKey)
      clusterSubs.forEach((sub, idx) => {
        const { dx, dz } = _clusterOffset(idx)
        subPositions.set(sub.id, { x: base.x + dx, z: base.z + dz })
      })
    }

    // --- Handle cancellations → trigger shatter ---------------------------
    for (const entry of crystals) {
      if (entry.state !== 'shattering' && entry.state !== 'gone' && cancelledIds.has(entry.subId)) {
        entry.state = 'shattering'
        emitShatter(entry)
      }
    }

    // --- Update or add active subscriptions --------------------------------
    const existingIds = new Set(crystals.map(c => c.subId))

    for (const sub of activeSubs) {
      const pos = subPositions.get(sub.id)
      if (!pos) continue

      const existing = crystals.find(c => c.subId === sub.id)

      if (!existing) {
        // New crystal
        const entry = buildCrystal(sub, pos.x, pos.z, group)
        crystals.push(entry)
      } else if (existing.state !== 'gone') {
        // Update: check for new payment
        const prevPay = existing.prevLastPayment
        const newPay  = sub.last_payment
        if (newPay && newPay !== prevPay) {
          // New payment detected → trigger growth
          const newMonths  = _monthsActive(sub.start_date)
          const newHeight  = Math.min(newMonths * HEIGHT_PER_MONTH, MAX_HEIGHT)
          existing.targetHeight = newHeight
          existing.isGrowing    = true
          existing.growthProgress = 0
          existing.prevLastPayment = newPay
          existing.state = 'active'
          emitSparkles(existing)
        }

        // Check dormant transition
        const days = _daysSincePayment(sub.last_payment)
        if (days >= DORMANT_DAYS && existing.state === 'active') {
          existing.state = 'dormant'
        } else if (days < DORMANT_DAYS && existing.state === 'dormant') {
          existing.state = 'active'
          existing.uniforms.uCrackFactor.value = 0
          existing.dormantProgress = 0
        }

        // Update sub reference
        existing.sub = sub
      }
    }

    // Remove tracking of subs no longer in the active list and not cancelled
    // (they may have been culled by the limit — mark as gone without shatter)
    const activeIds = new Set(activeSubs.map(s => s.id))
    for (const entry of crystals) {
      if (entry.state !== 'gone' && entry.state !== 'shattering' && !activeIds.has(entry.subId) && !cancelledIds.has(entry.subId)) {
        // Quietly remove (outside top-50 limit)
        entry.group.visible = false
        entry.state = 'gone'
      }
    }

    // If no subscriptions in DB, inject demo crystals for visual richness
    if (subs.length === 0 && crystals.length === 0) {
      _injectDemoCrystals(group, crystals, buildCrystal)
    }
  }, [fetchSubscriptions, buildCrystal, emitShatter, emitSparkles])

  // ── Scene setup ────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true

    // Shared particle geometries (tiny — reused for all particles)
    sparkleSphereGeoRef.current = new THREE.SphereGeometry(0.07, 4, 4)
    shardIcoGeoRef.current      = new THREE.IcosahedronGeometry(0.12, 0)

    // Root groups
    const rootGroup   = new THREE.Group()
    rootGroup.name    = 'CrystallineGrowthLayer'
    const sparkleGrp  = new THREE.Group()
    sparkleGrp.name   = 'CrystalSparkles'
    const shardGrp    = new THREE.Group()
    shardGrp.name     = 'CrystalShards'

    scene.add(rootGroup, sparkleGrp, shardGrp)
    rootGroupRef.current    = rootGroup
    sparkleGroupRef.current = sparkleGrp
    shardGroupRef.current   = shardGrp

    // Initial fetch
    reconcile()

    // Periodic refresh
    refreshTimerRef.current = setInterval(() => {
      if (mountedRef.current) reconcile()
    }, REFRESH_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }

      // Dispose all crystals
      for (const entry of crystalsRef.current) {
        _disposeEntry(entry)
      }
      crystalsRef.current = []

      // Dispose shared particle geos
      sparkleSphereGeoRef.current?.dispose()
      shardIcoGeoRef.current?.dispose()

      scene.remove(rootGroup, sparkleGrp, shardGrp)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Animation loop ─────────────────────────────────────────────────────────

  useEffect(() => {
    let lastTime = performance.now()

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate)

      const now   = performance.now()
      const delta = Math.min((now - lastTime) / 1000, 0.1)
      lastTime    = now
      timeRef.current += delta

      const t = timeRef.current

      const root      = rootGroupRef.current
      const sparkleGrp = sparkleGroupRef.current
      const shardGrp   = shardGroupRef.current

      if (root)      root.visible      = visibleRef.current
      if (sparkleGrp) sparkleGrp.visible = visibleRef.current
      if (shardGrp)   shardGrp.visible   = visibleRef.current
      if (!visibleRef.current) return

      const camPos = camera.position

      // Iterate all crystal entries
      const toRemove: number[] = []

      for (let i = 0; i < crystalsRef.current.length; i++) {
        const entry = crystalsRef.current[i]

        if (entry.state === 'gone') continue

        // ── LOD switch ────────────────────────────────────────────────────
        const dx  = entry.x - camPos.x
        const dz  = entry.z - camPos.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        const wantLOD = dist > LOD_THRESHOLD

        if (wantLOD !== entry.isLOD) {
          entry.isLOD = wantLOD
          entry.detailMesh.visible = !wantLOD
          entry.lodMesh.visible    = wantLOD
        }

        // ── Growth animation ──────────────────────────────────────────────
        if (entry.isGrowing) {
          entry.growthProgress = Math.min(1, entry.growthProgress + delta / GROWTH_DURATION)
          const easedH = entry.currentHeight + (entry.targetHeight - entry.currentHeight) * _easeOutCubic(entry.growthProgress / 1)
          if (Math.abs(easedH - entry.currentHeight) > 0.01) {
            rebuildCrystalGeometry(entry, easedH)
            entry.currentHeight = easedH
          }
          if (entry.growthProgress >= 1) {
            entry.isGrowing    = false
            entry.currentHeight = entry.targetHeight
            rebuildCrystalGeometry(entry, entry.targetHeight)
          }
        }

        // ── Dormant ramp ──────────────────────────────────────────────────
        if (entry.state === 'dormant') {
          entry.dormantProgress = Math.min(1, entry.dormantProgress + delta * 0.4)
          const cf = entry.dormantProgress * 0.75
          entry.uniforms.uCrackFactor.value = cf
          entry.uniforms.uIntensity.value   = 1.0 - 0.7 * entry.dormantProgress
          entry.pointLight.intensity        = 1.5  * (1 - 0.7 * entry.dormantProgress)
          const lodMat = entry.lodMesh.material as THREE.MeshLambertMaterial
          lodMat.opacity = 0.65 * (1 - 0.6 * entry.dormantProgress)
        } else if (entry.state === 'active') {
          entry.uniforms.uCrackFactor.value = 0
          entry.uniforms.uIntensity.value   = 1.0
          entry.pointLight.intensity        = 1.5
        }

        // ── Shader time uniform ───────────────────────────────────────────
        entry.uniforms.uTime.value = t

        // ── Shatter animation ─────────────────────────────────────────────
        if (entry.state === 'shattering') {
          entry.shatterAge += delta

          // Hide original crystal
          entry.detailMesh.visible = false
          entry.lodMesh.visible    = false
          entry.pedestal.visible   = false
          entry.pointLight.intensity = Math.max(0, 1.5 - entry.shatterAge / SHATTER_DURATION * 1.5)

          if (entry.shatterAge >= SHATTER_DURATION) {
            entry.group.visible = false
            entry.state         = 'gone'
            toRemove.push(i)
          }
        }

        // ── Animate sparkles ──────────────────────────────────────────────
        for (let s = entry.sparkles.length - 1; s >= 0; s--) {
          const sp = entry.sparkles[s]
          sp.age += delta
          const progress = sp.age / sp.maxAge
          if (progress >= 1) {
            sparkleGroupRef.current?.remove(sp.mesh)
            ;(sp.mesh.material as THREE.Material).dispose()
            entry.sparkles.splice(s, 1)
            continue
          }
          sp.mesh.position.x += sp.vx * delta
          sp.mesh.position.y += sp.vy * delta
          sp.mesh.position.z += sp.vz * delta
          sp.vy -= 0.4 * delta  // gentle gravity
          const mat = sp.mesh.material as THREE.MeshBasicMaterial
          mat.opacity = (1 - progress) * (0.7 + 0.3 * Math.sin(sp.age * 12))
        }
      }

      // ── Animate shards (global) ──────────────────────────────────────────
      for (const entry of crystalsRef.current) {
        for (let s = entry.shards.length - 1; s >= 0; s--) {
          const sh = entry.shards[s]
          sh.age += delta
          const progress = sh.age / SHATTER_DURATION
          if (progress >= 1) {
            shardGroupRef.current?.remove(sh.mesh)
            ;(sh.mesh.material as THREE.Material).dispose()
            entry.shards.splice(s, 1)
            continue
          }
          // Gravity + velocity
          sh.mesh.position.x += sh.vx * delta
          sh.mesh.position.y += sh.vy * delta - 3.0 * sh.age * delta
          sh.mesh.position.z += sh.vz * delta
          // Tumble
          sh.mesh.rotation.x += sh.rx * delta
          sh.mesh.rotation.y += sh.ry * delta
          sh.mesh.rotation.z += sh.rz * delta
          const mat = sh.mesh.material as THREE.MeshBasicMaterial
          mat.opacity = Math.max(0, 1 - progress * 1.2)
        }
      }

      // Cleanup fully gone entries (deferred to avoid index issues in main loop)
      // We just leave them in the array with state='gone' — harmless.
    }

    animate()
    return () => cancelAnimationFrame(animFrameRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, camera])

  // ── Visibility sync ────────────────────────────────────────────────────────

  useEffect(() => {
    if (rootGroupRef.current)    rootGroupRef.current.visible    = visible
    if (sparkleGroupRef.current) sparkleGroupRef.current.visible = visible
    if (shardGroupRef.current)   shardGroupRef.current.visible   = visible
  }, [visible])

  return null
}

// ── Disposal helper ─────────────────────────────────────────────────────────

function _disposeEntry(entry: CrystalEntry): void {
  try {
    entry.detailMesh.geometry.dispose()
    ;(entry.detailMesh.material as THREE.Material).dispose()
    entry.lodMesh.geometry.dispose()
    ;(entry.lodMesh.material as THREE.Material).dispose()
    entry.pedestal.geometry.dispose()
    ;(entry.pedestal.material as THREE.Material).dispose()
    // Sparkle meshes: materials already disposed in animation loop
    // Shard meshes: same
  } catch { /* ignore */ }
}

// ── Demo crystal injector (when no DB data) ─────────────────────────────────

function _injectDemoCrystals(
  group: THREE.Group,
  crystals: CrystalEntry[],
  buildCrystal: (sub: NWSubscription, x: number, z: number, group: THREE.Group) => CrystalEntry,
): void {
  const DEMO_SUBS: NWSubscription[] = [
    { id: 'demo-1', name: 'PowerOn Basic',   tier: 'basic',  monthly_amount: 49,   start_date: '2024-01-15', last_payment: new Date(Date.now() - 5  * 86400_000).toISOString(), client_id: 'client-a', cancelled_at: null },
    { id: 'demo-2', name: 'PowerOn Basic 2', tier: 'basic',  monthly_amount: 49,   start_date: '2024-03-01', last_payment: new Date(Date.now() - 8  * 86400_000).toISOString(), client_id: 'client-a', cancelled_at: null },
    { id: 'demo-3', name: 'Growth Plan',     tier: 'growth', monthly_amount: 149,  start_date: '2023-11-01', last_payment: new Date(Date.now() - 3  * 86400_000).toISOString(), client_id: 'client-b', cancelled_at: null },
    { id: 'demo-4', name: 'Growth Plan 2',   tier: 'growth', monthly_amount: 149,  start_date: '2024-06-01', last_payment: new Date(Date.now() - 12 * 86400_000).toISOString(), client_id: 'client-b', cancelled_at: null },
    { id: 'demo-5', name: 'Pro Enterprise',  tier: 'pro',    monthly_amount: 499,  start_date: '2023-06-01', last_payment: new Date(Date.now() - 2  * 86400_000).toISOString(), client_id: 'client-c', cancelled_at: null },
    { id: 'demo-6', name: 'Pro Dormant',     tier: 'pro',    monthly_amount: 499,  start_date: '2023-08-01', last_payment: new Date(Date.now() - 60 * 86400_000).toISOString(), client_id: 'client-d', cancelled_at: null },
    { id: 'demo-7', name: 'Basic Solo',      tier: 'basic',  monthly_amount: 49,   start_date: '2024-09-01', last_payment: new Date(Date.now() - 20 * 86400_000).toISOString(), client_id: null,       cancelled_at: null },
    { id: 'demo-8', name: 'Growth Solo',     tier: 'growth', monthly_amount: 149,  start_date: '2024-02-15', last_payment: new Date(Date.now() - 50 * 86400_000).toISOString(), client_id: null,       cancelled_at: null },
  ]

  // Build cluster positions
  const clusterMap = new Map<string, NWSubscription[]>()
  for (const sub of DEMO_SUBS) {
    const key = sub.client_id ?? `solo_${sub.id}`
    const arr = clusterMap.get(key) ?? []
    arr.push(sub)
    clusterMap.set(key, arr)
  }

  for (const [clusterKey, clusterSubs] of clusterMap) {
    const base = _clusterPosition(clusterKey)
    clusterSubs.forEach((sub, idx) => {
      const { dx, dz } = _clusterOffset(idx)
      const entry = buildCrystal(sub, base.x + dx, base.z + dz, group)
      crystals.push(entry)
    })
  }
}
