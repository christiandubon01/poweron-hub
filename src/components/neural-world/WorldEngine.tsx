/**
 * WorldEngine.tsx — Three.js scene core for Neural World.
 *
 * - Initializes scene, camera, renderer
 * - ResizeObserver keeps renderer sized to container
 * - Shadow maps (PCFSoftShadowMap)
 * - Animation loop → dispatches 'nw:frame' event each tick
 * - Day/night cycle (8-minute full cycle)
 * - Star field (500 particles, visible only at night)
 * - Ground plane 400×400 — three continent zones + GridHelper
 * - Provides WorldContext to children
 *
 * NW8: Two continents (400×400 world)
 * - West continent x=-200 to -20: Power On Solutions LLC (desert rock #2a1a0a)
 * - Central channel x=-20 to 20: master cash flow river (#050a14)
 * - East continent x=20 to 200: PowerOn Hub software (dark crystal #0a0a1a)
 * - Dual sun system: Sun1 amber-orange #ff8040 (west/Solutions),
 *                    Sun2 cold blue-white #80c0ff (east/Hub)
 * - Both sun intensities driven by nw:revenue-health events
 * - Founders valley x=-20..20 y=0 lit by both suns
 *
 * NW12: Founders Valley + Dual Sun Polish
 * - Founders valley golden shimmer ground (blends both sun colors)
 * - Valley glow point light: amber-blue blend driven by both suns
 * - Dual sun polish: Sun1 rises at x=-300 (dawn), Sun2 at x=300 (later)
 * - Synchronized dusk: both suns set simultaneously at cycle t=0.75
 * - Throttled nw:player-position + nw:cycle-state events for HUD
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react'
import * as THREE from 'three'
import { WorldContext } from './WorldContext'
import { AtmosphereManager, AtmosphereMode } from './AtmosphereManager'
import { CameraController, CameraMode } from './CameraController'
import { CollisionSystem } from './CollisionSystem'
import { TerrainGenerator } from './TerrainGenerator'
import { supabase } from '@/lib/supabase'

// ── Day/Night cycle config ────────────────────────────────────────────────────

const CYCLE_DURATION = 8 * 60  // 8 minutes in seconds

interface SkyKeyframe {
  t: number        // 0–1 in cycle
  sky: THREE.Color
  dirColor: THREE.Color
  dirIntensity: number
  ambIntensity: number
}

const SKY_KEYFRAMES: SkyKeyframe[] = [
  // Pre-dawn: deep crimson-purple #401020
  {
    t: 0,
    sky: new THREE.Color(0x401020),
    dirColor: new THREE.Color(0xff4422),
    dirIntensity: 0.12,
    ambIntensity: 0.08,
  },
  // Dawn peak: warm orange-pink #ff8040 (0–2 min phase)
  {
    t: 0.14,
    sky: new THREE.Color(0xff8040),
    dirColor: new THREE.Color(0xffcc88),
    dirIntensity: 0.85,
    ambIntensity: 0.48,
  },
  // Noon: bright blue-white #80c0ff (2–4 min phase)
  {
    t: 0.375,
    sky: new THREE.Color(0x80c0ff),
    dirColor: new THREE.Color(0xffffff),
    dirIntensity: 1.85,
    ambIntensity: 0.92,
  },
  // Mid-afternoon (still in noon phase)
  {
    t: 0.50,
    sky: new THREE.Color(0x80c0ff),
    dirColor: new THREE.Color(0xffeedd),
    dirIntensity: 1.55,
    ambIntensity: 0.78,
  },
  // Dusk start: deep amber #c06020 (4–6 min phase)
  {
    t: 0.575,
    sky: new THREE.Color(0xc06020),
    dirColor: new THREE.Color(0xff8830),
    dirIntensity: 0.92,
    ambIntensity: 0.50,
  },
  // Dusk deep: purple-amber blend
  {
    t: 0.68,
    sky: new THREE.Color(0x802040),
    dirColor: new THREE.Color(0xff5500),
    dirIntensity: 0.50,
    ambIntensity: 0.30,
  },
  // Night onset: deep purple #200840 (transition 4–6 min end)
  {
    t: 0.75,
    sky: new THREE.Color(0x200840),
    dirColor: new THREE.Color(0x182850),
    dirIntensity: 0.14,
    ambIntensity: 0.12,
  },
  // Night: near black #050508 (6–8 min phase)
  {
    t: 0.87,
    sky: new THREE.Color(0x050508),
    dirColor: new THREE.Color(0x101828),
    dirIntensity: 0.05,
    ambIntensity: 0.07,
  },
  // Late night (wraps to pre-dawn)
  {
    t: 1.0,
    sky: new THREE.Color(0x050508),
    dirColor: new THREE.Color(0x080818),
    dirIntensity: 0.05,
    ambIntensity: 0.07,
  },
]

function lerpKeyframes(t: number): Omit<SkyKeyframe, 't'> {
  const frames = SKY_KEYFRAMES
  let a = frames[frames.length - 1]
  let b = frames[0]

  for (let i = 0; i < frames.length - 1; i++) {
    if (t >= frames[i].t && t <= frames[i + 1].t) {
      a = frames[i]
      b = frames[i + 1]
      break
    }
  }

  const span = b.t - a.t
  const local = span > 0 ? (t - a.t) / span : 0

  const sky = a.sky.clone().lerp(b.sky, local)
  const dirColor = a.dirColor.clone().lerp(b.dirColor, local)
  const dirIntensity = THREE.MathUtils.lerp(a.dirIntensity, b.dirIntensity, local)
  const ambIntensity = THREE.MathUtils.lerp(a.ambIntensity, b.ambIntensity, local)

  return { sky, dirColor, dirIntensity, ambIntensity }
}

// ── WorldEngine component ─────────────────────────────────────────────────────

interface WorldEngineProps {
  children?: React.ReactNode
  /** Pass true to make child layers apply scenario overrides (NW6) */
  applyScenario?: boolean
  /** NW7: When true, suppress built-in AtmosphereManager and CameraController UI (replaced by CommandHUD) */
  hideBuiltinHUD?: boolean
}

export function WorldEngine({ children, applyScenario = false, hideBuiltinHUD = false }: WorldEngineProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Three.js core refs
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const animFrameRef = useRef<number>(0)

  // Lights
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null)
  const ambientLight2Ref = useRef<THREE.AmbientLight | null>(null)
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null)
  // NW8: dual sun lights
  const sun1Ref = useRef<THREE.DirectionalLight | null>(null)   // amber-orange, west/Solutions
  const sun2Ref = useRef<THREE.DirectionalLight | null>(null)   // blue-white, east/Hub
  const sun1HealthRef = useRef<number>(0.75)   // revenue health 0–1
  const sun2HealthRef = useRef<number>(0.75)

  // Ground
  const groundMeshRef = useRef<THREE.Mesh | null>(null)
  // NW8: additional continent ground meshes
  const centralGroundRef = useRef<THREE.Mesh | null>(null)
  const eastGroundRef = useRef<THREE.Mesh | null>(null)
  // NW12: valley golden shimmer material + glow
  const valleyMatRef = useRef<THREE.MeshLambertMaterial | null>(null)
  const valleyGlowRef = useRef<THREE.PointLight | null>(null)
  // NW12: throttled position dispatch
  const lastPosDispatchTimeRef = useRef<number>(0)

  // Stars
  const starsRef = useRef<THREE.Points | null>(null)

  // Shooting star (NW5)
  const shootingStarRef      = useRef<THREE.Line | null>(null)
  const shootingStarLifeRef  = useRef<number>(0)
  const shootingStarNextRef  = useRef<number>(30 + Math.random() * 60)  // seconds until first fire
  const shootingStarVelRef   = useRef(new THREE.Vector3())

  // Day/night cycle timer
  const cycleTimeRef = useRef<number>(0)
  const clockRef = useRef(new THREE.Clock())

  // Player position (shared with CollisionSystem)
  const playerPosition = useRef(new THREE.Vector3(0, 2, 10))
  const playerYaw = useRef<number>(0)

  // Atmosphere + camera mode state
  const [atmosphereMode, setAtmosphereMode] = useState<AtmosphereMode>(AtmosphereMode.SCIFI_V1)
  const [cameraMode, setCameraMode] = useState<CameraMode>(CameraMode.FIRST_PERSON)
  // NW14: ref for animation-loop access (avoids stale closure)
  const atmosphereModeRef = useRef<AtmosphereMode>(AtmosphereMode.SCIFI_V1)

  // ── NW2: neural_world_settings save/restore ────────────────────────────────
  const nwSettingsOrgIdRef = useRef<string | null>(null)
  const nwSettingsSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load settings from Supabase on mount
  useEffect(() => {
    async function loadNWSettings() {
      try {
        const { data: { user } } = await (supabase as any).auth.getUser()
        if (!user) return

        // Resolve org_id via profiles
        const { data: profile } = await (supabase as any)
          .from('profiles')
          .select('org_id')
          .eq('id', user.id)
          .maybeSingle()

        const orgId: string | null = profile?.org_id ?? null
        if (!orgId) return
        nwSettingsOrgIdRef.current = orgId

        const { data: settings } = await (supabase as any)
          .from('neural_world_settings')
          .select('atmosphere_mode, camera_mode, last_position')
          .eq('org_id', orgId)
          .maybeSingle()

        if (!settings) return

        if (settings.atmosphere_mode && Object.values(AtmosphereMode).includes(settings.atmosphere_mode)) {
          setAtmosphereMode(settings.atmosphere_mode as AtmosphereMode)
        }
        if (settings.camera_mode && Object.values(CameraMode).includes(settings.camera_mode)) {
          setCameraMode(settings.camera_mode as CameraMode)
        }
        if (settings.last_position && typeof settings.last_position === 'object') {
          const pos = settings.last_position as { x?: number; y?: number; z?: number }
          if (typeof pos.x === 'number' && typeof pos.y === 'number' && typeof pos.z === 'number') {
            playerPosition.current.set(pos.x, pos.y, pos.z)
          }
        }
        // NW7: Notify CommandHUD of persisted modes
        window.dispatchEvent(new CustomEvent('nw:mode-init', {
          detail: {
            atmosphereMode: settings.atmosphere_mode ?? AtmosphereMode.SCIFI_V1,
            cameraMode: settings.camera_mode ?? CameraMode.FIRST_PERSON,
          },
        }))
      } catch (err) {
        console.warn('[WorldEngine] loadNWSettings error (non-blocking):', err)
      }
    }
    loadNWSettings()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced save to neural_world_settings
  const saveNWSettings = useCallback((
    atmoMode: AtmosphereMode,
    camMode: CameraMode,
  ) => {
    if (nwSettingsSaveTimeoutRef.current) clearTimeout(nwSettingsSaveTimeoutRef.current)
    nwSettingsSaveTimeoutRef.current = setTimeout(async () => {
      try {
        const orgId = nwSettingsOrgIdRef.current
        if (!orgId) return
        const pos = playerPosition.current
        await (supabase as any)
          .from('neural_world_settings')
          .upsert(
            {
              org_id: orgId,
              atmosphere_mode: atmoMode,
              camera_mode: camMode,
              last_position: { x: pos.x, y: pos.y, z: pos.z },
            },
            { onConflict: 'org_id' }
          )
      } catch (err) {
        console.warn('[WorldEngine] saveNWSettings error (non-blocking):', err)
      }
    }, 1000)
  }, [playerPosition])

  // NW7: Listen for CommandHUD mode-change requests
  useEffect(() => {
    function onRequestAtmo(e: Event) {
      const ev = e as CustomEvent<{ mode: AtmosphereMode }>
      if (ev.detail?.mode) {
        setAtmosphereMode(ev.detail.mode)
        saveNWSettings(ev.detail.mode, cameraMode)
      }
    }
    function onRequestCam(e: Event) {
      const ev = e as CustomEvent<{ mode: CameraMode }>
      if (ev.detail?.mode) {
        setCameraMode(ev.detail.mode)
        saveNWSettings(atmosphereMode, ev.detail.mode)
      }
    }
    window.addEventListener('nw:request-atmosphere-mode', onRequestAtmo)
    window.addEventListener('nw:request-camera-mode', onRequestCam)
    return () => {
      window.removeEventListener('nw:request-atmosphere-mode', onRequestAtmo)
      window.removeEventListener('nw:request-camera-mode', onRequestCam)
    }
  }, [atmosphereMode, cameraMode, saveNWSettings])

  // NW14: Keep atmosphereModeRef in sync with state for animation loop
  useEffect(() => {
    atmosphereModeRef.current = atmosphereMode
  }, [atmosphereMode])

  // Wrap atmosphere/camera mode change handlers to also persist
  const handleAtmosphereModeChange = useCallback((mode: AtmosphereMode) => {
    setAtmosphereMode(mode)
    atmosphereModeRef.current = mode
    saveNWSettings(mode, cameraMode)
  }, [cameraMode, saveNWSettings])

  const handleCameraModeChange = useCallback((mode: CameraMode) => {
    setCameraMode(mode)
    saveNWSettings(atmosphereMode, mode)
  }, [atmosphereMode, saveNWSettings])

  // Context value — memoized to avoid recreating each render
  // We'll store in a ref and only re-create when scene/camera/renderer init
  const [contextValue, setContextValue] = useState<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    renderer: THREE.WebGLRenderer
    playerPosition: React.MutableRefObject<THREE.Vector3>
    playerYaw: React.MutableRefObject<number>
    applyScenario: boolean
  } | null>(null)

  // ── Init Three.js ─────────────────────────────────────────────────────────
  const initScene = useCallback(() => {
    if (!containerRef.current) return
    const container = containerRef.current
    const rect = container.getBoundingClientRect()
    const width = rect.width || window.innerWidth
    const height = rect.height || window.innerHeight - 56

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0a14)
    scene.fog = new THREE.FogExp2(0x0a0a14, 0.008)
    sceneRef.current = scene

    // Camera
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 1000)
    camera.position.set(0, 2, 10)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    try {
      // Modern Three.js color space
      if ('outputColorSpace' in renderer) {
        (renderer as unknown as { outputColorSpace: string }).outputColorSpace = 'srgb'
      }
    } catch {
      // fallback — ignore
    }
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Ambient light
    const ambient = new THREE.AmbientLight(0x00e5cc, 0.5)
    scene.add(ambient)
    ambientLightRef.current = ambient

    // Second ambient for dual-light biomes
    const ambient2 = new THREE.AmbientLight(0x440066, 0)
    scene.add(ambient2)
    ambientLight2Ref.current = ambient2

    // ── NW12: Dual sun system (polished arcs, synchronized dusk) ─────────────
    // Sun1: amber-orange #ff8040 — Power On Solutions LLC (west/Solutions)
    // Rises first at x=-300 (dawn), arcs overhead, sets at x=+300 at dusk (t=0.75)
    const sun1 = new THREE.DirectionalLight(0xff8040, 0)
    sun1.position.set(-300, 5, 0)
    sun1.castShadow = true
    sun1.shadow.mapSize.width = 2048
    sun1.shadow.mapSize.height = 2048
    sun1.shadow.camera.near = 1
    sun1.shadow.camera.far = 700
    sun1.shadow.camera.left = -250
    sun1.shadow.camera.right = 250
    sun1.shadow.camera.top = 250
    sun1.shadow.camera.bottom = -250
    scene.add(sun1)
    sun1Ref.current = sun1
    dirLightRef.current = sun1  // keep dirLightRef pointing to primary for AtmosphereManager

    // Sun2: cold blue-white #80c0ff — PowerOn Hub software (east/Hub)
    // Rises later at x=+300 (t=0.12), arcs overhead, ALSO sets at t=0.75 simultaneously
    const sun2 = new THREE.DirectionalLight(0x80c0ff, 0)
    sun2.position.set(300, 5, 0)
    sun2.castShadow = false
    scene.add(sun2)
    sun2Ref.current = sun2

    // ── NW12 + NW8: Three continent ground planes (world 400×400) ────────────
    // West continent: x=-200 to -20 (width 180), desert rock #2a1a0a
    const westGeo = new THREE.PlaneGeometry(180, 400, 90, 200)
    const westMat = new THREE.MeshLambertMaterial({ color: 0x2a1a0a })
    const westGround = new THREE.Mesh(westGeo, westMat)
    westGround.rotation.x = -Math.PI / 2
    westGround.position.set(-110, 0, 0)
    westGround.receiveShadow = true
    scene.add(westGround)
    groundMeshRef.current = westGround  // AtmosphereManager targets this

    // Founders Valley: x=-20 to 20 — NW12 golden shimmer material, blends both sun colors
    // Slightly elevated above the surrounding water channel for visual distinction
    const centralGeo = new THREE.PlaneGeometry(40, 400, 20, 200)
    const valleyMat = new THREE.MeshLambertMaterial({
      color: 0x1a1208,          // dark golden earth tone — base under shimmer
      emissive: new THREE.Color(0xc8a028),  // warm gold emissive
      emissiveIntensity: 0.04,
    })
    valleyMatRef.current = valleyMat
    const centralGround = new THREE.Mesh(centralGeo, valleyMat)
    centralGround.rotation.x = -Math.PI / 2
    centralGround.position.set(0, 0.01, 0)   // slightly above water level
    centralGround.receiveShadow = true
    scene.add(centralGround)
    centralGroundRef.current = centralGround

    // Valley ambient glow — amber-blue blend point light hovering above valley floor
    // Color and intensity shift with sun dominance in NW12 update loop
    const valleyGlow = new THREE.PointLight(0xe0a060, 0.5, 65)
    valleyGlow.position.set(0, 2.0, 0)
    scene.add(valleyGlow)
    valleyGlowRef.current = valleyGlow

    // East continent: x=20 to 200 (width 180), dark crystal #0a0a1a
    const eastGeo = new THREE.PlaneGeometry(180, 400, 90, 200)
    const eastMat = new THREE.MeshLambertMaterial({ color: 0x0a0a1a })
    const eastGround = new THREE.Mesh(eastGeo, eastMat)
    eastGround.rotation.x = -Math.PI / 2
    eastGround.position.set(110, 0, 0)
    eastGround.receiveShadow = true
    scene.add(eastGround)
    eastGroundRef.current = eastGround

    // Grid helper — subtle dark overlay, expanded to 400×400
    const grid = new THREE.GridHelper(400, 80, 0x112222, 0x0a1818)
    grid.position.y = 0.01
    scene.add(grid)

    // Stars: 500 point particles
    const starGeo = new THREE.BufferGeometry()
    const starPositions = new Float32Array(500 * 3)
    for (let i = 0; i < 500; i++) {
      // Distribute on upper hemisphere
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI * 0.45 // upper hemisphere
      const r = 450
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      starPositions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 100
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const starMat = new THREE.PointsMaterial({
      size: 1.2,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const stars = new THREE.Points(starGeo, starMat)
    scene.add(stars)
    starsRef.current = stars

    // Expose to context
    setContextValue({
      scene,
      camera,
      renderer,
      playerPosition,
      playerYaw,
      applyScenario,
    })

    // Start animation
    clockRef.current.start()
    startLoop(scene, camera, renderer)

    // ResizeObserver
    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return
      const r = containerRef.current.getBoundingClientRect()
      const w = r.width
      const h = r.height
      if (w > 0 && h > 0) {
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      }
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  // ── Animation loop ─────────────────────────────────────────────────────────
  function startLoop(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer
  ) {
    function animate() {
      animFrameRef.current = requestAnimationFrame(animate)

      const delta = clockRef.current.getDelta()

      // Day/night cycle
      updateDayNight(delta, scene)

      // Dispatch frame event — children subscribe to this
      window.dispatchEvent(new Event('nw:frame'))

      renderer.render(scene, camera)
    }
    animate()
  }

  function updateDayNight(delta: number, scene: THREE.Scene) {
    // NW5 polish: day cycle always controls sky + lights.
    // Phase map (8-min cycle):
    //   0–2 min  (t 0.00–0.25)  Dawn  — warm orange-pink  #ff8040
    //   2–4 min  (t 0.25–0.50)  Noon  — bright blue-white #80c0ff
    //   4–6 min  (t 0.50–0.75)  Dusk  — deep amber-purple #c06020 → #200840
    //   6–8 min  (t 0.75–1.00)  Night — near black        #050508

    // NW14: V5 ENTERPRISE forces permanent deep-night phase
    if (atmosphereModeRef.current === AtmosphereMode.V5_ENTERPRISE) {
      cycleTimeRef.current = 0.87 * CYCLE_DURATION
    } else {
      cycleTimeRef.current = (cycleTimeRef.current + delta) % CYCLE_DURATION
    }
    const t = cycleTimeRef.current / CYCLE_DURATION

    // Apply sky colour + lighting from keyframes (always active)
    const frame = lerpKeyframes(t)
    scene.background = frame.sky
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = frame.ambIntensity
    }
    if (dirLightRef.current) {
      dirLightRef.current.color.copy(frame.dirColor)
      dirLightRef.current.intensity = frame.dirIntensity
    }

    // Stars: visible ONLY during night phase (t 0.75–1.0 + brief wrap at dawn)
    if (starsRef.current) {
      const starMat  = starsRef.current.material as THREE.PointsMaterial
      const nightness =
        (t >= 0.87) ? 1.0 :
        (t >= 0.75) ? (t - 0.75) / 0.12 :
        (t <= 0.02) ? (1.0 - t / 0.02) :
        0
      starMat.opacity = Math.min(0.92, nightness)
      starsRef.current.visible = starMat.opacity > 0.01
    }

    // ── NW12: Polished dual sun arcs — synchronized dusk ─────────────────────
    // DAY PHASE: t=0 to t=0.75 (dawn through dusk), NIGHT: t=0.75 to 1.0
    //
    // Sun1 (Solutions/amber): rises at x=-300 y=0 z=0 (dawn, t=0)
    //   → arcs west-to-east, peaks overhead ~t=0.375
    //   → sets at x=+300 at t=0.75 (dusk)
    //   Dawn amber light illuminates west continent first.
    //
    // Sun2 (Hub/blue): rises at x=+300 y=0 z=0 (t=SUN2_RISE=0.12)
    //   → arcs east-to-west, peaks overhead ~t=0.44
    //   → ALSO sets at t=0.75 simultaneously with Sun1 — most beautiful moment
    //   Cold blue light hits east continent after Solutions dawn.
    //
    // Simultaneous dusk: both suns approach horizon together at t=0.75.

    const SUN2_RISE = 0.12   // Sun2 rises 12% into cycle (~58s after dawn)
    const DAY_END   = 0.75   // Both suns set here

    let sun1IntensityNow = 0
    let sun2IntensityNow = 0

    // Sun1: Power On Solutions — amber, rises first
    if (sun1Ref.current) {
      const health1 = sun1HealthRef.current
      const baseIntensity1 = 0.5 + health1 * 1.3   // 0.5–1.8

      if (t <= DAY_END) {
        const norm1 = t / DAY_END                    // 0 at dawn → 1 at dusk
        const angle1 = norm1 * Math.PI               // 0 → π
        const sinH1 = Math.sin(angle1)               // height factor: 0→1→0

        sun1Ref.current.position.set(
          -300 * Math.cos(angle1),                   // x: -300 at dawn → 0 → +300 at dusk
          Math.max(2, sinH1 * 220),                  // y: rises to 220 at noon
          0
        )
        // Soft dawn/dusk ramp: multiply by clamped sinH1 for natural fade at horizon
        sun1IntensityNow = baseIntensity1 * Math.min(1, sinH1 * 5)
        sun1Ref.current.intensity = sun1IntensityNow
      } else {
        // Night: parked below horizon
        sun1Ref.current.intensity = 0
        sun1Ref.current.position.set(-300, -20, 0)
      }
    }

    // Sun2: PowerOn Hub — blue-white, rises later from east
    if (sun2Ref.current) {
      const health2 = sun2HealthRef.current
      const baseIntensity2 = 0.38 + health2 * 0.92  // 0.38–1.3

      if (t >= SUN2_RISE && t <= DAY_END) {
        const norm2 = (t - SUN2_RISE) / (DAY_END - SUN2_RISE)  // 0 at rise → 1 at dusk
        const angle2 = norm2 * Math.PI
        const sinH2 = Math.sin(angle2)

        sun2Ref.current.position.set(
          300 * Math.cos(angle2),                    // x: +300 at rise → 0 → -300 at set
          Math.max(2, sinH2 * 180),
          0
        )
        sun2IntensityNow = baseIntensity2 * Math.min(1, sinH2 * 5)
        sun2Ref.current.intensity = sun2IntensityNow
      } else {
        // Before rise or after dusk
        sun2Ref.current.intensity = 0
        sun2Ref.current.position.set(300, -20, 0)
      }
    }

    // NW12: Founders Valley golden shimmer — blends both sun intensities
    if (valleyMatRef.current) {
      const shimmer = 0.025 + Math.sin(cycleTimeRef.current * 1.1) * 0.012
                    + Math.sin(cycleTimeRef.current * 3.4 + 0.8) * 0.007
      const sunContrib = (sun1IntensityNow + sun2IntensityNow) * 0.016
      valleyMatRef.current.emissiveIntensity = shimmer + sunContrib
    }

    // NW12: Valley glow point light — color shifts with sun dominance
    if (valleyGlowRef.current) {
      const totalInt = sun1IntensityNow + sun2IntensityNow
      valleyGlowRef.current.intensity = 0.15 + totalInt * 0.25
      if (totalInt > 0.01) {
        const ambW = sun1IntensityNow / totalInt   // 0=all-blue, 1=all-amber
        const blueW = 1 - ambW
        valleyGlowRef.current.color.setRGB(
          0.55 * ambW + 0.42 * blueW,   // r
          0.55 * ambW + 0.58 * blueW,   // g
          0.22 * ambW + 0.95 * blueW    // b
        )
      }
    }

    // NW12: Dispatch player position + cycle state (throttled ~10 Hz) ──────
    const nowMs = Date.now()
    if (nowMs - lastPosDispatchTimeRef.current > 100) {
      lastPosDispatchTimeRef.current = nowMs
      const px = playerPosition.current.x
      const py = playerPosition.current.y
      const pz = playerPosition.current.z
      const inValley = px >= -20 && px <= 20
      window.dispatchEvent(new CustomEvent('nw:player-position', {
        detail: { x: px, y: py, z: pz, inValley }
      }))
      window.dispatchEvent(new CustomEvent('nw:cycle-state', {
        detail: {
          cycleT: t,
          sun1Intensity: sun1IntensityNow,
          sun2Intensity: sun2IntensityNow,
          sun1Health: sun1HealthRef.current,
          sun2Health: sun2HealthRef.current,
        }
      }))
    }

    // ── Shooting star — night phase only (t 0.75–1.0 or wrap 0–0.02) ────────
    const isNight = t >= 0.75 || t <= 0.02
    if (isNight) {
      shootingStarNextRef.current -= delta
      if (shootingStarNextRef.current <= 0 && shootingStarRef.current === null) {
        // Spawn a shooting star at a random sky position
        const angle = Math.random() * Math.PI * 2
        const elev  = Math.PI * 0.25 + Math.random() * Math.PI * 0.20
        const r     = 380
        const sx = r * Math.sin(elev) * Math.cos(angle)
        const sy = r * Math.cos(elev) * 0.5 + 160
        const sz = r * Math.sin(elev) * Math.sin(angle)
        const spd = 80 + Math.random() * 65
        const vx  = (Math.random() - 0.5) * spd
        const vy  = -(8  + Math.random() * 16)
        const vz  = (Math.random() - 0.5) * spd
        const trailScale = 0.26
        const ssPts = [
          new THREE.Vector3(sx, sy, sz),
          new THREE.Vector3(sx - vx * trailScale, sy - vy * trailScale, sz - vz * trailScale),
        ]
        const ssGeo = new THREE.BufferGeometry().setFromPoints(ssPts)
        const ssMat = new THREE.LineBasicMaterial({
          color:       0xffffff,
          transparent: true,
          opacity:     1.0,
        })
        const ssLine = new THREE.Line(ssGeo, ssMat)
        scene.add(ssLine)
        shootingStarRef.current     = ssLine
        shootingStarLifeRef.current = 0.6 + Math.random() * 0.5
        shootingStarVelRef.current.set(vx, vy, vz)
        // Next shooting star in 30–90 seconds
        shootingStarNextRef.current = 30 + Math.random() * 60
      }
    }

    // Animate active shooting star (regardless of current phase, to finish cleanly)
    if (shootingStarRef.current) {
      shootingStarLifeRef.current -= delta
      if (shootingStarLifeRef.current <= 0) {
        scene.remove(shootingStarRef.current)
        shootingStarRef.current.geometry.dispose()
        ;(shootingStarRef.current.material as THREE.Material).dispose()
        shootingStarRef.current = null
      } else {
        shootingStarRef.current.position.x += shootingStarVelRef.current.x * delta
        shootingStarRef.current.position.y += shootingStarVelRef.current.y * delta
        shootingStarRef.current.position.z += shootingStarVelRef.current.z * delta
        ;(shootingStarRef.current.material as THREE.LineBasicMaterial).opacity =
          Math.min(shootingStarLifeRef.current * 2, 1.0)
      }
    }
  }

  // ── NW8: Revenue health listener — drives dual sun intensities ───────────
  useEffect(() => {
    function onRevenueHealth(e: Event) {
      const ev = e as CustomEvent<{ solutionsHealth?: number; hubHealth?: number }>
      if (typeof ev.detail?.solutionsHealth === 'number') {
        sun1HealthRef.current = Math.max(0, Math.min(1, ev.detail.solutionsHealth))
      }
      if (typeof ev.detail?.hubHealth === 'number') {
        sun2HealthRef.current = Math.max(0, Math.min(1, ev.detail.hubHealth))
      }
    }
    window.addEventListener('nw:revenue-health', onRevenueHealth)
    return () => window.removeEventListener('nw:revenue-health', onRevenueHealth)
  }, [])

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const cleanup = initScene()
    return () => {
      if (cleanup) cleanup()
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      // NW12: Clean up valley glow
      if (valleyGlowRef.current && sceneRef.current) {
        sceneRef.current.remove(valleyGlowRef.current)
        valleyGlowRef.current = null
      }
      valleyMatRef.current = null

      // Clean up shooting star if still active
      if (shootingStarRef.current && sceneRef.current) {
        sceneRef.current.remove(shootingStarRef.current)
        shootingStarRef.current.geometry.dispose()
        ;(shootingStarRef.current.material as THREE.Material).dispose()
        shootingStarRef.current = null
      }
      if (rendererRef.current) {
        const canvas = rendererRef.current.domElement
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
        rendererRef.current.dispose()
      }
      sceneRef.current = null
      cameraRef.current = null
      rendererRef.current = null
    }
  }, [initScene])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {contextValue && (
        <WorldContext.Provider value={{ ...contextValue, applyScenario }}>
          <AtmosphereManager
            activeMode={atmosphereMode}
            onModeChange={handleAtmosphereModeChange}
            ambientLightRef={ambientLightRef}
            dirLightRef={dirLightRef}
            groundMeshRef={groundMeshRef}
            ambientLight2Ref={ambientLight2Ref}
            showUI={!hideBuiltinHUD}
          />
          <CameraController
            mode={cameraMode}
            onModeChange={handleCameraModeChange}
            showUI={!hideBuiltinHUD}
          />
          <CollisionSystem playerPosition={playerPosition} />
          <TerrainGenerator />
          {children}
        </WorldContext.Provider>
      )}

      {/* Loading veil before Three.js context ready */}
      {!contextValue && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#050a08',
            color: 'rgba(0,229,204,0.6)',
            fontSize: 13,
            letterSpacing: 2,
          }}
        >
          INITIALIZING NEURAL WORLD…
        </div>
      )}

      {/* HUD hint overlay — hidden when CommandHUD is active */}
      {contextValue && !hideBuiltinHUD && (
        <div
          style={{
            position: 'absolute',
            bottom: 56,
            left: 16,
            fontSize: 10,
            color: 'rgba(255,255,255,0.25)',
            pointerEvents: 'none',
            letterSpacing: 0.5,
            lineHeight: 1.8,
          }}
        >
          WASD / drag to navigate · QE up/down · Shift to sprint
        </div>
      )}
    </div>
  )
}
