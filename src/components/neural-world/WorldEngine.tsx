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
  // Dawn
  {
    t: 0,
    sky: new THREE.Color(0x331505),
    dirColor: new THREE.Color(0xff8844),
    dirIntensity: 0.4,
    ambIntensity: 0.2,
  },
  // Sunrise
  {
    t: 0.12,
    sky: new THREE.Color(0xff7733),
    dirColor: new THREE.Color(0xffcc88),
    dirIntensity: 0.9,
    ambIntensity: 0.5,
  },
  // Noon
  {
    t: 0.3,
    sky: new THREE.Color(0x6699ee),
    dirColor: new THREE.Color(0xffffff),
    dirIntensity: 1.8,
    ambIntensity: 0.8,
  },
  // Afternoon
  {
    t: 0.55,
    sky: new THREE.Color(0x4477cc),
    dirColor: new THREE.Color(0xffe0aa),
    dirIntensity: 1.4,
    ambIntensity: 0.6,
  },
  // Dusk
  {
    t: 0.7,
    sky: new THREE.Color(0x552200),
    dirColor: new THREE.Color(0xff6600),
    dirIntensity: 0.6,
    ambIntensity: 0.3,
  },
  // Night
  {
    t: 0.85,
    sky: new THREE.Color(0x050510),
    dirColor: new THREE.Color(0x203060),
    dirIntensity: 0.1,
    ambIntensity: 0.1,
  },
  // Late night (wraps to dawn)
  {
    t: 1.0,
    sky: new THREE.Color(0x020208),
    dirColor: new THREE.Color(0x102030),
    dirIntensity: 0.05,
    ambIntensity: 0.08,
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

  // Day/night cycle timer
  const cycleTimeRef = useRef<number>(0)
  const clockRef = useRef(new THREE.Clock())

  // Player position (shared with CollisionSystem)
  const playerPosition = useRef(new THREE.Vector3(0, 2, 10))
  const playerYaw = useRef<number>(0)

  // Atmosphere + camera mode state
  const [atmosphereMode, setAtmosphereMode] = useState<AtmosphereMode>(AtmosphereMode.SCIFI_V1)
  const [cameraMode, setCameraMode] = useState<CameraMode>(CameraMode.FIRST_PERSON)

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
    // Only apply day/night if NOT in a custom biome that overrides sky
    const nonCycleAtmospheres = [
      AtmosphereMode.MOJAVE,
      AtmosphereMode.OCEAN,
      AtmosphereMode.COASTAL_FOG,
      AtmosphereMode.SCIFI_V1,
      AtmosphereMode.SCIFI_V2_SUBSTRATE,
      AtmosphereMode.RESERVED,
    ]

    // Day/night cycle doesn't override biome atmosphere — it's additive to star visibility
    // Stars are the key visual of the night cycle, visible regardless of biome
    cycleTimeRef.current = (cycleTimeRef.current + delta) % CYCLE_DURATION
    const t = cycleTimeRef.current / CYCLE_DURATION

    // Stars: visible at t > 0.75 or t < 0.1 (night phases)
    if (starsRef.current) {
      const starMat = starsRef.current.material as THREE.PointsMaterial
      const nightness =
        t > 0.8 ? (t - 0.8) / 0.2 :
        t < 0.1 ? 1 - t / 0.1 :
        t > 0.7 ? (t - 0.7) / 0.1 :
        0
      starMat.opacity = Math.min(0.9, nightness * 1.2)
      starsRef.current.visible = starMat.opacity > 0.01
    }

    // Only apply sky/light color cycle if NO custom atmosphere override
    // The AtmosphereManager handles sky/fog/lights for biome modes;
    // day/night cycle is the default "no biome selected" behavior.
    // In NW1 the initial biome is SCIFI_V1, so cycle colors are suppressed
    // except for the directional light position (sun arc).
    if (!nonCycleAtmospheres.includes(atmosphereMode as AtmosphereMode)) {
      const frame = lerpKeyframes(t)
      scene.background = frame.sky
      if (ambientLightRef.current) {
        ambientLightRef.current.intensity = frame.ambIntensity
      }
      if (dirLightRef.current) {
        dirLightRef.current.color.copy(frame.dirColor)
        dirLightRef.current.intensity = frame.dirIntensity
      }
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
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const cleanup = initScene()
    return () => {
      if (cleanup) cleanup()
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
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
            onModeChange={setAtmosphereMode}
            ambientLightRef={ambientLightRef}
            dirLightRef={dirLightRef}
            groundMeshRef={groundMeshRef}
            ambientLight2Ref={ambientLight2Ref}
          />
          <CameraController
            mode={cameraMode}
            onModeChange={setCameraMode}
          />
          <CollisionSystem playerPosition={playerPosition} />
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
