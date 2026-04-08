/**
 * WorldEngine.tsx — Three.js scene core for Neural World.
 *
 * - Initializes scene, camera, renderer
 * - ResizeObserver keeps renderer sized to container
 * - Shadow maps (PCFSoftShadowMap)
 * - Animation loop → dispatches 'nw:frame' event each tick
 * - Day/night cycle (8-minute full cycle)
 * - Star field (500 particles, visible only at night)
 * - Ground plane 200×200 subdivided 100×100 + GridHelper
 * - Provides WorldContext to children
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
}

export function WorldEngine({ children }: WorldEngineProps) {
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

  // Ground
  const groundMeshRef = useRef<THREE.Mesh | null>(null)

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

  // Wrap atmosphere/camera mode change handlers to also persist
  const handleAtmosphereModeChange = useCallback((mode: AtmosphereMode) => {
    setAtmosphereMode(mode)
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

    // Directional light (sun/moon)
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0)
    dirLight.position.set(50, 80, 30)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.width = 2048
    dirLight.shadow.mapSize.height = 2048
    dirLight.shadow.camera.near = 1
    dirLight.shadow.camera.far = 500
    dirLight.shadow.camera.left = -120
    dirLight.shadow.camera.right = 120
    dirLight.shadow.camera.top = 120
    dirLight.shadow.camera.bottom = -120
    scene.add(dirLight)
    dirLightRef.current = dirLight

    // Ground plane: 200×200 subdivided 100×100
    const groundGeo = new THREE.PlaneGeometry(200, 200, 100, 100)
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x0a0a14 })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)
    groundMeshRef.current = ground

    // Grid helper — subtle dark overlay
    const grid = new THREE.GridHelper(200, 40, 0x112222, 0x0a1818)
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

    cycleTimeRef.current = (cycleTimeRef.current + delta) % CYCLE_DURATION
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

    // Directional light arc (sun position) — always updated
    if (dirLightRef.current) {
      const sunAngle = t * Math.PI * 2
      dirLightRef.current.position.set(
        Math.cos(sunAngle) * 80,
        Math.sin(sunAngle) * 80,
        30
      )
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

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const cleanup = initScene()
    return () => {
      if (cleanup) cleanup()
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
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
        <WorldContext.Provider value={contextValue}>
          <AtmosphereManager
            activeMode={atmosphereMode}
            onModeChange={handleAtmosphereModeChange}
            ambientLightRef={ambientLightRef}
            dirLightRef={dirLightRef}
            groundMeshRef={groundMeshRef}
            ambientLight2Ref={ambientLight2Ref}
          />
          <CameraController
            mode={cameraMode}
            onModeChange={handleCameraModeChange}
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

      {/* HUD hint overlay */}
      {contextValue && (
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
