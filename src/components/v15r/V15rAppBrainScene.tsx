import { memo, useEffect, useRef } from 'react'
import * as THREE from 'three'
import {
  APP_BRAIN_CATEGORY_META,
  APP_BRAIN_EDGES,
  APP_BRAIN_NODES,
  type AppBrainNode,
} from './appBrainMap'
import type { AppBrainSceneOverlay, AppBrainSceneOverlayMode } from './app-brain/appBrainSceneOverlayTypes'
import { edgeHintKey } from './app-brain/appBrainSceneOverlayTypes'
import { DEFAULT_ARCHITECTURE_SCENE_OVERLAY } from './app-brain/appBrainSceneOverlayAdapter'
import {
  OPERATIONAL_CAMERA_FOV,
  OPERATIONAL_CAMERA_LOOK_AT,
  OPERATIONAL_CAMERA_POSITION,
  OPERATIONAL_CAMERA_Z,
  OPERATIONAL_HUB_RING_SCALE,
  OPERATIONAL_NODE_SCALE_CAP,
  labelWeightFor,
  operationalEdgeControl,
  operationalEdgeOpacity,
  operationalEdgeSamples,
  operationalLabelNudge,
  operationalLabelWorldScale,
  operationalNodeDepthScale,
  operationalNodePosition,
  type LabelWeight,
} from './app-brain/control-tower/operationalBrainLayout'

interface V15rAppBrainSceneProps {
  operational?: boolean
  activityNodeIds?: string[]
  failedNodeIds?: string[]
  /** ATB-3: app nodes the Verifier is actively CHECKING (read-only path — visually quieter than implementer writes). */
  verifierNodeIds?: string[]
  /** ATB-3: app nodes the Architect is PLANNING (soft conceptual emphasis, never a write pulse). */
  plannedNodeIds?: string[]
  resetViewKey?: number
  /** Static architecture presentation for preview panels; never implies task telemetry. */
  staticPresentation?: boolean
  selectedNodeId: string | null
  hoveredNodeId: string | null
  visibleNodeIds: string[]
  overlayMode?: AppBrainSceneOverlayMode
  sceneOverlay?: AppBrainSceneOverlay
  onSelectNode: (nodeId: string) => void
  onHoverNode: (nodeId: string | null) => void
  /** Operational-only: clear the current selection when empty canvas is clicked. */
  onDeselect?: () => void
  /** ATB-6: rest keeps the Brain alive; active adds work motion; halted stops execution travel. */
  motionMode?: 'rest' | 'active' | 'halted'
}

const OVERLAY_MODE_LABEL: Record<AppBrainSceneOverlayMode, string> = {
  architecture: 'Architecture Map',
  'import-graph': 'Import Graph',
  'active-work': 'Active Work',
}

interface NodeRenderState {
  node: AppBrainNode
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  glow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  hit: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  label: THREE.Sprite
  baseScale: number
  labelWeight: LabelWeight
  nodeZ: number
}

interface EdgePulse {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  from: THREE.Vector3
  mid: THREE.Vector3
  to: THREE.Vector3
  baseSpeed: number
  speedScale: number
  offset: number
}

interface ArchitectureEdgeLine {
  from: string
  to: string
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  restOpacity: number
}

function sceneNodePosition(node: AppBrainNode, operational: boolean): THREE.Vector3 {
  return new THREE.Vector3(...operationalNodePosition(node, operational))
}

function bezier3(from: THREE.Vector3, mid: THREE.Vector3, to: THREE.Vector3, t: number, target: THREE.Vector3): THREE.Vector3 {
  const inv = 1 - t
  target.set(
    inv * inv * from.x + 2 * inv * t * mid.x + t * t * to.x,
    inv * inv * from.y + 2 * inv * t * mid.y + t * t * to.y,
    inv * inv * from.z + 2 * inv * t * mid.z + t * t * to.z,
  )
  return target
}

function applyOperationalCamera(camera: THREE.PerspectiveCamera, zoom = OPERATIONAL_CAMERA_Z): void {
  camera.position.set(OPERATIONAL_CAMERA_POSITION[0], OPERATIONAL_CAMERA_POSITION[1], zoom)
  camera.lookAt(...OPERATIONAL_CAMERA_LOOK_AT)
  camera.updateProjectionMatrix()
}

function disposeObjectTree(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    const disposeMaterial = (mat: THREE.Material) => {
      const materialWithMap = mat as THREE.Material & { map?: THREE.Texture | null }
      materialWithMap.map?.dispose()
      mat.dispose()
    }
    if (Array.isArray(material)) material.forEach(disposeMaterial)
    else if (material) disposeMaterial(material)
  })
}

function makeLabelTexture(label: string, color: string, operational = false, weight: LabelWeight = 'normal'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const fontSize = operational ? (weight === 'primary' ? 56 : weight === 'quiet' ? 50 : 52) : 56
  ctx.font = `${operational ? '600' : '700'} ${fontSize}px Inter, Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = color
  ctx.shadowBlur = operational ? 0 : 18
  ctx.fillStyle = 'rgba(6,10,18,0.72)'
  const textW = Math.min(ctx.measureText(label).width, 800)
  const padX = operational ? 36 : 72
  const w = Math.min(880, Math.max(textW + padX * 2, operational ? 420 : 220))
  const h = operational ? 96 : 116
  const x = (canvas.width - w) / 2
  const y = (canvas.height - h) / 2
  const r = operational ? 28 : 40
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = color
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = '#e5f7ff'
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 2, 840)

  const texture = new THREE.CanvasTexture(canvas)
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

function V15rAppBrainScene({
  operational = false,
  activityNodeIds = [],
  failedNodeIds = [],
  verifierNodeIds = [],
  plannedNodeIds = [],
  resetViewKey = 0,
  staticPresentation = false,
  selectedNodeId,
  hoveredNodeId,
  visibleNodeIds,
  overlayMode = 'architecture',
  sceneOverlay = DEFAULT_ARCHITECTURE_SCENE_OVERLAY,
  onSelectNode,
  onHoverNode,
  onDeselect,
  motionMode = 'rest',
}: V15rAppBrainSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const selectedRef = useRef<string | null>(selectedNodeId)
  const hoveredRef = useRef<string | null>(hoveredNodeId)
  const visibleNodeIdsRef = useRef<Set<string>>(new Set(visibleNodeIds))
  const overlayModeRef = useRef<AppBrainSceneOverlayMode>(overlayMode)
  const sceneOverlayRef = useRef<AppBrainSceneOverlay>(sceneOverlay)
  const onSelectRef = useRef(onSelectNode)
  const onHoverRef = useRef(onHoverNode)
  const onDeselectRef = useRef(onDeselect)
  const staticPresentationRef = useRef(staticPresentation)
  const operationRef = useRef({ operational, activityNodeIds, failedNodeIds, verifierNodeIds, plannedNodeIds, resetViewKey, motionMode })
  operationRef.current = { operational, activityNodeIds, failedNodeIds, verifierNodeIds, plannedNodeIds, resetViewKey, motionMode }
  staticPresentationRef.current = staticPresentation

  overlayModeRef.current = overlayMode
  sceneOverlayRef.current = sceneOverlay

  useEffect(() => {
    selectedRef.current = selectedNodeId
  }, [selectedNodeId])

  useEffect(() => {
    hoveredRef.current = hoveredNodeId
  }, [hoveredNodeId])

  useEffect(() => {
    visibleNodeIdsRef.current = new Set(visibleNodeIds)
  }, [visibleNodeIds])

  useEffect(() => {
    onSelectRef.current = onSelectNode
    onHoverRef.current = onHoverNode
    onDeselectRef.current = onDeselect
  }, [onSelectNode, onHoverNode, onDeselect])

  useEffect(() => {
    const mountElement = mountRef.current
    if (!mountElement) return
    const mount: HTMLDivElement = mountElement

    let animationFrame = 0
    let deferredInitFrame = 0
    let renderer: THREE.WebGLRenderer | null = null
    let resizeObserver: ResizeObserver | null = null
    let cleanupRendererEvents: (() => void) | null = null
    let didDispose = false
    let didInit = false

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(OPERATIONAL_CAMERA_FOV, 1, 0.1, 100)
    const root = new THREE.Group()
    const nodeGroup = new THREE.Group()
    const edgeGroup = new THREE.Group()
    const pulseGroup = new THREE.Group()
    const labelGroup = new THREE.Group()
    const starGroup = new THREE.Group()
    const nodeStates: NodeRenderState[] = []
    const edgePulses: EdgePulse[] = []
    const edgePulseByKey = new Map<string, EdgePulse>()
    const hitTargets: THREE.Object3D[] = []
    const architectureEdges: ArchitectureEdgeLine[] = []

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const pulsePoint = new THREE.Vector3()
    const labelWorld = new THREE.Vector3()

    scene.add(root)
    root.add(edgeGroup, pulseGroup, nodeGroup, labelGroup)
    scene.add(starGroup)

    const ambient = new THREE.AmbientLight(0x88ccff, 0.65)
    const key = new THREE.PointLight(0x22d3ee, 2.4, 16)
    key.position.set(1.6, 2.4, 4.5)
    const violet = new THREE.PointLight(0xa78bfa, 1.4, 14)
    violet.position.set(-3, -1.2, 3)
    scene.add(ambient, key, violet)

    function init(): void {
      if (didInit || didDispose) return
      if (mount.clientWidth === 0 || mount.clientHeight === 0) {
        deferredInitFrame = requestAnimationFrame(init)
        return
      }
      didInit = true
      if (didDispose) return

      const width = Math.max(mount.clientWidth, 320)
      const height = Math.max(mount.clientHeight, 280)

      camera.aspect = width / height
      if (operationRef.current.operational) {
        applyOperationalCamera(camera)
      } else {
        camera.position.set(0, 0.2, 7.2)
        camera.lookAt(0, 0, 0)
        camera.updateProjectionMatrix()
      }

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
      renderer.setSize(width, height)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5))
      renderer.setClearColor(0x020712, 0)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      renderer.domElement.style.display = 'block'
      renderer.domElement.style.cursor = 'grab'
      mount.appendChild(renderer.domElement)
      renderer.domElement.style.touchAction = 'none'
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
      let drag: { id: number; x: number; y: number; moved: boolean } | null = null
      let suppressClick = false
      let yaw = 0, pitch = 0, yawVelocity = 0, pitchVelocity = 0
      let lastReset = operationRef.current.resetViewKey
      let resetting = false
      const focusLines: { from: string; to: string; line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> }[] = []

      const starPositions: number[] = []
      for (let i = 0; i < 260; i += 1) {
        const radius = 4 + Math.random() * 7
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(2 * Math.random() - 1)
        starPositions.push(
          radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta),
        )
      }
      const starGeo = new THREE.BufferGeometry()
      starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3))
      const starMat = new THREE.PointsMaterial({
        color: 0x6ee7f9,
        size: 0.025,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      })
      starGroup.add(new THREE.Points(starGeo, starMat))

      const nodeById = new Map(APP_BRAIN_NODES.map((node) => [node.id, node]))
      const operationalScene = operationRef.current.operational

      APP_BRAIN_EDGES.forEach((edge, index) => {
        const from = nodeById.get(edge.from)
        const to = nodeById.get(edge.to)
        if (!from || !to) return

        const fromVector = sceneNodePosition(from, operationalScene)
        const toVector = sceneNodePosition(to, operationalScene)
        const chord: [number, number, number] = [
          (fromVector.x + toVector.x) / 2,
          (fromVector.y + toVector.y) / 2,
          (fromVector.z + toVector.z) / 2,
        ]
        const controlTuple = operationalScene
          ? operationalEdgeControl(edge.from, edge.to, [fromVector.x, fromVector.y, fromVector.z], [toVector.x, toVector.y, toVector.z], edge.strength)
          : chord
        const control = new THREE.Vector3(...controlTuple)
        const samples = operationalScene
          ? operationalEdgeSamples([fromVector.x, fromVector.y, fromVector.z], controlTuple, [toVector.x, toVector.y, toVector.z], 8)
          : [[fromVector.x, fromVector.y, fromVector.z] as [number, number, number], chord, [toVector.x, toVector.y, toVector.z] as [number, number, number]]
        const fromColor = new THREE.Color(APP_BRAIN_CATEGORY_META[from.category].color)
        const toColor = new THREE.Color(APP_BRAIN_CATEGORY_META[to.category].color)
        const prominence = operationalScene ? 0.72 + edge.strength * 0.28 : 1
        const edgeGeo = new THREE.BufferGeometry().setFromPoints(samples.map((point) => new THREE.Vector3(...point)))
        const edgeColor = new Float32Array(samples.length * 3)
        samples.forEach((_, sampleIndex) => {
          const t = samples.length === 1 ? 0 : sampleIndex / (samples.length - 1)
          const color = fromColor.clone().lerp(toColor, t).multiplyScalar(prominence)
          edgeColor[sampleIndex * 3] = color.r
          edgeColor[sampleIndex * 3 + 1] = color.g
          edgeColor[sampleIndex * 3 + 2] = color.b
        })
        edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeColor, 3))
        const restOpacity = operationalScene ? operationalEdgeOpacity(edge.strength) : 0.34
        const edgeLine = new THREE.Line(edgeGeo, new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: restOpacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }))
        edgeGroup.add(edgeLine)
        architectureEdges.push({ from: edge.from, to: edge.to, line: edgeLine, restOpacity })

        const pulseMeta = APP_BRAIN_CATEGORY_META[to.category]
        const pulse = new THREE.Mesh(
          new THREE.SphereGeometry(0.035 + edge.strength * 0.012, 14, 14),
          new THREE.MeshBasicMaterial({
            color: pulseMeta.color,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
          }),
        )
        pulseGroup.add(pulse)
        const pulseEntry: EdgePulse = {
          mesh: pulse,
          from: fromVector,
          mid: control,
          to: toVector,
          baseSpeed: 0.08 + edge.strength * 0.045,
          speedScale: 1,
          offset: index * 0.071,
        }
        edgePulses.push(pulseEntry)
        edgePulseByKey.set(edgeHintKey(edge.from, edge.to), pulseEntry)
        const focusLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(samples.map((point) => new THREE.Vector3(...point))), new THREE.LineBasicMaterial({ color: 0x83cbd3, transparent: true, opacity: 0, depthWrite: false }))
        edgeGroup.add(focusLine)
        focusLines.push({ from: edge.from, to: edge.to, line: focusLine })
      })

      APP_BRAIN_NODES.forEach((node) => {
        const meta = APP_BRAIN_CATEGORY_META[node.category]
        const position = sceneNodePosition(node, operationRef.current.operational)
        const riskScale = node.riskLevel === 'high' ? 1.1 : node.riskLevel === 'medium' ? 1.04 : 1
        const baseScale = 0.12 * riskScale
        const color = new THREE.Color(meta.color)

        const core = new THREE.Mesh(
          new THREE.SphereGeometry(baseScale, 28, 28),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: true }),
        )
        core.position.copy(position)
        nodeGroup.add(core)

        const glow = new THREE.Mesh(
          new THREE.SphereGeometry(baseScale * 3.1, 28, 28),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        )
        glow.position.copy(position)
        nodeGroup.add(glow)

        const hubRing = operationalScene && node.id === 'app-brain' ? OPERATIONAL_HUB_RING_SCALE : 1
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(baseScale * 1.55 * hubRing, baseScale * 1.8 * hubRing, 40),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.26,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        )
        ring.position.copy(position)
        ring.lookAt(camera.position)
        nodeGroup.add(ring)

        const hit = new THREE.Mesh(
          new THREE.SphereGeometry(baseScale * 3.2, 16, 16),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
        )
        hit.position.copy(position)
        hit.userData.nodeId = node.id
        nodeGroup.add(hit)
        hitTargets.push(hit)

        const labelWeight = labelWeightFor(node.category)
        const labelTexture = makeLabelTexture(node.label, meta.color, operationRef.current.operational, labelWeight)
        const label = new THREE.Sprite(new THREE.SpriteMaterial({
          map: labelTexture,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          depthTest: false,
          sizeAttenuation: true,
        }))
        const [nudgeX, nudgeY] = operationalScene ? operationalLabelNudge(node.id) : [0, 0]
        label.position.copy(position).add(new THREE.Vector3(nudgeX, baseScale * 3.2 + nudgeY, 0))
        if (operationRef.current.operational) {
          const distance = camera.position.distanceTo(label.position)
          const [labelW, labelH] = operationalLabelWorldScale(labelWeight, distance, position.z)
          label.scale.set(labelW, labelH, 1)
        } else {
          label.scale.set(0.85, 0.22, 1)
        }
        labelGroup.add(label)

        nodeStates.push({ node, core, glow, ring, hit, label, baseScale, labelWeight, nodeZ: position.z })
      })

      function setPointerFromEvent(event: PointerEvent | MouseEvent): void {
        if (!renderer) return
        const rect = renderer.domElement.getBoundingClientRect()
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      }

      function pickNode(event: PointerEvent | MouseEvent): string | null {
        setPointerFromEvent(event)
        raycaster.setFromCamera(pointer, camera)
        const visibleTargets = hitTargets.filter((target) => {
          const nodeId = target.userData.nodeId
          return typeof nodeId === 'string' && visibleNodeIdsRef.current.has(nodeId)
        })
        const hit = raycaster.intersectObjects(visibleTargets, false)[0]
        return typeof hit?.object?.userData?.nodeId === 'string' ? hit.object.userData.nodeId : null
      }

      function onPointerMove(event: PointerEvent): void {
        if (drag) {
          const dx = event.clientX - drag.x, dy = event.clientY - drag.y
          if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true
          yawVelocity = dx * 0.006; pitchVelocity = dy * 0.004
          yaw += yawVelocity; pitch = Math.max(-0.55, Math.min(0.55, pitch + pitchVelocity))
          drag.x = event.clientX; drag.y = event.clientY
          if (renderer) renderer.domElement.style.cursor = 'grabbing'
          return
        }
        const nodeId = pickNode(event)
        if (nodeId !== hoveredRef.current) onHoverRef.current(nodeId)
        if (renderer) renderer.domElement.style.cursor = nodeId ? 'pointer' : 'grab'
      }

      function onPointerLeave(): void {
        if (hoveredRef.current) onHoverRef.current(null)
        if (renderer) renderer.domElement.style.cursor = 'grab'
      }

      function onClick(event: MouseEvent): void {
        if (suppressClick) { suppressClick = false; return }
        const nodeId = pickNode(event)
        // A deliberate click (drags are suppressed above) on empty canvas clears
        // the current selection; a node click selects it.
        if (nodeId) onSelectRef.current(nodeId)
        else if (operationRef.current.operational) onDeselectRef.current?.()
      }

      function onPointerDown(event: PointerEvent) {
        if (!operationRef.current.operational || event.button !== 0) return
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
        yawVelocity = 0; pitchVelocity = 0; resetting = false
        renderer?.domElement.setPointerCapture(event.pointerId)
      }
      function onPointerUp(event: PointerEvent) {
        if (!drag) return
        suppressClick = drag.moved
        drag = null
        if (renderer?.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId)
        if (renderer) renderer.domElement.style.cursor = 'grab'
      }

      renderer.domElement.addEventListener('pointermove', onPointerMove)
      renderer.domElement.addEventListener('pointerleave', onPointerLeave)
      renderer.domElement.addEventListener('click', onClick)
      renderer.domElement.addEventListener('pointerdown', onPointerDown)
      renderer.domElement.addEventListener('pointerup', onPointerUp)
      renderer.domElement.addEventListener('pointercancel', onPointerUp)

      resizeObserver = new ResizeObserver(() => {
        if (!renderer || !mount) return
        const nextWidth = mount.clientWidth
        const nextHeight = mount.clientHeight
        if (!nextWidth || !nextHeight) return
        camera.aspect = nextWidth / nextHeight
        camera.updateProjectionMatrix()
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5))
        renderer.setSize(nextWidth, nextHeight)
      })
      resizeObserver.observe(mount)

      let lastTime = performance.now()
      let rootYaw = root.rotation.y
      let starYaw = starGroup.rotation.y
      let motionScale = 1
      let zoom = operationRef.current.operational ? OPERATIONAL_CAMERA_Z : 7.2
      function onWheel(event: WheelEvent) {
        if (!operationRef.current.operational) return
        event.preventDefault()
        zoom = Math.max(5.4, Math.min(9.4, zoom + event.deltaY * 0.004))
        if (operationRef.current.operational) applyOperationalCamera(camera, zoom)
        else {
          camera.position.z = zoom
          camera.updateProjectionMatrix()
        }
      }
      renderer.domElement.addEventListener('wheel', onWheel, { passive: false })
      let lastStaticFrame = ''
      let lastStaticOverlay: AppBrainSceneOverlay | null = null
      function animate(now: number): void {
        if (didDispose) return
        animationFrame = requestAnimationFrame(animate)
        if (!renderer) return
        const operation = operationRef.current
        const isStatic = staticPresentationRef.current && !operation.operational
        if (isStatic) {
          // Redraw the preview only for inspection or resize, never as an activity loop.
          const frameKey = `${selectedRef.current}|${hoveredRef.current}|${[...visibleNodeIdsRef.current].join(',')}|${mount.clientWidth}x${mount.clientHeight}|${renderer.domElement.width}x${renderer.domElement.height}`
          if (lastStaticFrame === frameKey && lastStaticOverlay === sceneOverlayRef.current) return
          lastStaticFrame = frameKey
          lastStaticOverlay = sceneOverlayRef.current
        } else {
          lastStaticFrame = ''
        }
        const dt = isStatic ? 0 : Math.min((now - lastTime) / 1000, 0.05)
        lastTime = now
        const t = isStatic || reducedMotion.matches ? 0 : now / 1000
        pulseGroup.visible = !isStatic && !reducedMotion.matches && operation.motionMode === 'active'

        // Reduced motion: no ambient, travel, or breathing. Owner orbit still works.
        if (!reducedMotion.matches && !operation.operational) {
          rootYaw += dt * 0.16
          root.rotation.y = rootYaw
          root.rotation.x = Math.sin(t * 0.35) * 0.07
          starYaw -= dt * 0.035
          starGroup.rotation.y = starYaw
          starGroup.rotation.x = Math.sin(t * 0.12) * 0.04
        }
        const hasActiveWork = operation.motionMode === 'active'
        const ambientOn = !reducedMotion.matches && (operation.motionMode === 'rest' || operation.motionMode === 'halted' || !hasActiveWork)
        const motionTarget = reducedMotion.matches ? 0 : hasActiveWork ? 1 : 0.18
        motionScale = reducedMotion.matches ? 0 : motionScale + (motionTarget - motionScale) * Math.min(1, dt * 3)
        if (operation.operational) {
          if (lastReset !== operation.resetViewKey) {
            resetting = true
            lastReset = operation.resetViewKey
            yawVelocity = 0
            pitchVelocity = 0
            zoom = OPERATIONAL_CAMERA_Z
            applyOperationalCamera(camera, zoom)
          }
          const damping = Math.pow(0.88, dt * 60)
          if (resetting) {
            yaw *= reducedMotion.matches ? 0 : damping; pitch *= reducedMotion.matches ? 0 : damping
            if (Math.abs(yaw) + Math.abs(pitch) < 0.001) { yaw = 0; pitch = 0; resetting = false }
          } else if (!drag && !reducedMotion.matches) {
            yaw += yawVelocity * dt * 60; pitch = Math.max(-0.55, Math.min(0.55, pitch + pitchVelocity * dt * 60))
            yawVelocity *= damping; pitchVelocity *= damping
          }
          yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw))
          const live = !reducedMotion.matches && (ambientOn || hasActiveWork)
          const driftGain = hasActiveWork ? 1.28 : 1
          const driftY = live ? Math.sin(t * 0.038) * 0.05 * driftGain : 0
          const driftX = live ? Math.sin(t * 0.026) * 0.028 * driftGain : 0
          const driftRoll = live ? Math.sin(t * 0.019) * 0.01 : 0
          root.rotation.set(pitch + driftX, yaw + driftY, driftRoll)
          starGroup.rotation.set(ambientOn ? Math.sin(t * 0.02) * 0.03 : 0, ambientOn ? t * 0.012 : 0, 0)
          starMat.opacity = ambientOn ? 0.2 : 0.12
        }

        const overlay = sceneOverlayRef.current
        const overlayActive = overlayModeRef.current !== 'architecture'

        edgePulses.forEach((pulse) => {
          pulse.speedScale = 1
        })

        for (const [key, hint] of Object.entries(overlay.edgeHints)) {
          const pulse = edgePulseByKey.get(key)
          if (!pulse) continue
          pulse.speedScale = 1 + hint.pulse * 1.5
        }

        edgePulses.forEach((pulse) => {
          const speed = pulse.baseSpeed * pulse.speedScale
          const pct = (t * speed + pulse.offset) % 1
          bezier3(pulse.from, pulse.mid, pulse.to, pct, pulsePoint)
          pulse.mesh.position.copy(pulsePoint)
          const fade = Math.sin(pct * Math.PI)
          pulse.mesh.material.opacity = 0.24 + fade * 0.68
          const pulseScale = 0.85 + fade * 0.6
          pulse.mesh.scale.setScalar(pulseScale)
        })

        architectureEdges.forEach((entry) => {
          entry.line.material.opacity = overlayActive ? entry.restOpacity * 0.82 : entry.restOpacity
        })

        for (const [key, hint] of Object.entries(overlay.edgeHints)) {
          const pulse = edgePulseByKey.get(key)
          if (!pulse) continue
          const fade = Math.sin(((t * pulse.baseSpeed * pulse.speedScale + pulse.offset) % 1) * Math.PI)
          pulse.mesh.material.opacity = Math.min(1, 0.3 + hint.intensity * 0.35 + fade * 0.2)
        }

        if (operation.operational) {
          const focus = hoveredRef.current ?? selectedRef.current
          architectureEdges.forEach((entry) => {
            const related = focus === entry.from || focus === entry.to
            entry.line.material.opacity = focus && !related ? entry.restOpacity * 0.42 : entry.restOpacity
          })
          focusLines.forEach(({ from, to, line }) => {
            const related = focus === from || focus === to
            // A moving edge requires BOTH endpoints in reported active planned areas.
            const active = operation.activityNodeIds.includes(from) && operation.activityNodeIds.includes(to)
            line.material.opacity = active ? 0.65 : related ? 0.5 : 0
            const pulse = edgePulseByKey.get(edgeHintKey(from, to))
            if (pulse) pulse.mesh.visible = active && operation.motionMode === 'active'
          })
        }

        nodeStates.forEach((state, index) => {
          const isVisible = visibleNodeIdsRef.current.has(state.node.id)
          const isSelected = selectedRef.current === state.node.id
          const isHovered = hoveredRef.current === state.node.id
          const hint = overlay.nodeHints[state.node.id]
          const activeNode = operation.operational && operation.activityNodeIds.includes(state.node.id)
          const failedNode = operation.operational && operation.failedNodeIds.includes(state.node.id)
          // ATB-3 role paths: the Verifier CHECKS (distinct violet, never a write
          // pulse); the Architect PLANS (soft conceptual emphasis). Neither may
          // look like implementer write activity.
          const verifierNode = operation.operational && !activeNode && operation.verifierNodeIds.includes(state.node.id)
          const plannedNode = operation.operational && !activeNode && !verifierNode && operation.plannedNodeIds.includes(state.node.id)
          const restBreathe = operation.operational && !reducedMotion.matches && !activeNode ? Math.sin(t * 0.55 + index * 0.4) * 0.5 + 0.5 : 0
          const pulseBase = reducedMotion.matches ? 0 : activeNode ? Math.sin(t * (2.1 + (hint?.pulse ?? 0) * 1.4) + index * 0.75) * 0.5 + 0.5 : restBreathe * 0.35
          const overlayBoost = hint ? 1 + hint.intensity * 0.35 : 1
          const dimFactor = overlayActive && !hint ? 0.72 : 1
          const emphasis =
            (isSelected && isVisible ? 1.85 : isHovered && isVisible ? 1.45 : isVisible ? 1 : 0.42) *
            overlayBoost *
            dimFactor
          const depthScale = operation.operational ? operationalNodeDepthScale(state.nodeZ) : 1
          const activeDepth = operation.operational && (activeNode || verifierNode) ? 1.05 : 1
          const coreScale = emphasis * depthScale * activeDepth * (1 + pulseBase * (0.12 + (hint?.pulse ?? 0) * 0.18))
          state.core.scale.setScalar(operation.operational ? Math.min(OPERATIONAL_NODE_SCALE_CAP, coreScale) : coreScale)
          state.glow.scale.setScalar(operation.operational
            ? Math.min(OPERATIONAL_NODE_SCALE_CAP, emphasis * depthScale * (1.02 + pulseBase * 0.12))
            : emphasis * (1.05 + pulseBase * (0.18 + (hint?.pulse ?? 0) * 0.12)))
          state.ring.scale.setScalar(operation.operational
            ? Math.min(OPERATIONAL_NODE_SCALE_CAP, emphasis * depthScale * (1.04 + pulseBase * 0.08) * (hint?.ring ? 1.08 : 1))
            : emphasis * (1.05 + pulseBase * 0.1) * (hint?.ring ? 1.12 : 1))
          state.ring.lookAt(camera.position)
          const ringSpeed =
            hint?.status === 'blocked'
              ? 2.4
              : hint?.status === 'running'
                ? 1.9
                : isSelected
                  ? 1.7
                  : 0.6
          state.ring.rotation.z += dt * ringSpeed * motionScale
          state.core.material.opacity = !isVisible ? 0.16 : isSelected ? 1 : isHovered ? 0.98 : 0.86
          state.glow.material.opacity = !isVisible
            ? 0.025
            : isSelected
              ? 0.28
              : isHovered
                ? 0.22
                : 0.1 + pulseBase * (0.05 + (hint?.intensity ?? 0) * 0.12)
          state.ring.material.opacity = !isVisible
            ? 0.04
            : hint?.ring
              ? 0.65 + pulseBase * 0.2
              : isSelected
                ? 0.75
                : isHovered
                  ? 0.55
                  : 0.18
          state.hit.visible = isVisible
          state.label.material.opacity = !isVisible ? 0.12 : isSelected || isHovered ? 0.92 : 0.72
          if (operation.operational) {
            state.label.getWorldPosition(labelWorld)
            const [labelW, labelH] = operationalLabelWorldScale(state.labelWeight, camera.position.distanceTo(labelWorld), state.nodeZ)
            state.label.scale.set(labelW, labelH, 1)
            const focus = hoveredRef.current ?? selectedRef.current
            const related = focusLines.some(edge => (edge.from === focus && edge.to === state.node.id) || (edge.to === focus && edge.from === state.node.id))
            const color = failedNode ? '#e99a9f' : verifierNode ? '#b8a7f5' : APP_BRAIN_CATEGORY_META[state.node.category].color
            const depthCue = operationalNodeDepthScale(state.nodeZ)
            state.core.material.color.set(color)
            state.ring.material.color.set(color)
            state.glow.material.opacity = isSelected ? 0.22 : isHovered ? 0.17 : activeNode ? 0.15 + pulseBase * 0.1 : verifierNode ? 0.12 : plannedNode ? 0.08 : 0.045 + depthCue * 0.02
            const hubRingBoost = state.node.id === 'app-brain' ? 0.06 : 0
            state.ring.material.opacity = isSelected || isHovered || activeNode || failedNode ? 0.7 : verifierNode ? 0.45 : plannedNode ? 0.3 : 0.14 + depthCue * 0.05 + hubRingBoost
            const restLabel = 0.7 + depthCue * 0.08
            state.label.material.opacity = isSelected || isHovered || related ? 0.96 : focus ? 0.38 : restLabel
            state.core.material.opacity = !focus || isSelected || isHovered || related ? 0.88 + depthCue * 0.06 : 0.34
          }
        })

        renderer.render(scene, camera)
      }
      if (didDispose) {
        disposeObjectTree(scene)
        scene.clear()
        if (renderer) {
          renderer.dispose()
          if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
        }
        return
      }

      animationFrame = requestAnimationFrame(animate)

      cleanupRendererEvents = () => {
        if (!renderer) return
        renderer.domElement.removeEventListener('wheel', onWheel)
        renderer.domElement.removeEventListener('pointermove', onPointerMove)
        renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
        renderer.domElement.removeEventListener('click', onClick)
        renderer.domElement.removeEventListener('pointerdown', onPointerDown)
        renderer.domElement.removeEventListener('pointerup', onPointerUp)
        renderer.domElement.removeEventListener('pointercancel', onPointerUp)
      }
    }

    deferredInitFrame = requestAnimationFrame(init)

    return () => {
      didDispose = true
      if (deferredInitFrame) cancelAnimationFrame(deferredInitFrame)
      if (animationFrame) cancelAnimationFrame(animationFrame)
      if (resizeObserver) resizeObserver.disconnect()
      cleanupRendererEvents?.()
      disposeObjectTree(scene)
      scene.clear()
      if (renderer) {
        renderer.dispose()
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <div className={`relative w-full h-full min-h-[420px] rounded-xl overflow-hidden ${operational ? 'ct-operational-scene' : ''}`} data-motion-mode={motionMode}>
      <div ref={mountRef} className="absolute inset-0" />
      {operational && <div className="ct-node-keyboard" aria-label="Architecture nodes">{APP_BRAIN_NODES.map(node => <button type="button" key={node.id} aria-pressed={selectedNodeId === node.id} onFocus={() => onHoverNode(node.id)} onBlur={() => onHoverNode(null)} onClick={() => onSelectNode(node.id)}>{node.label}</button>)}</div>}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, transparent 0%, transparent 48%, rgba(6,10,18,0.34) 100%), linear-gradient(180deg, rgba(34,211,238,0.06), transparent 38%, rgba(167,139,250,0.06))',
        }}
      />
      <div
        className="absolute left-3 bottom-3 text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 rounded-full pointer-events-none"
        style={{
          color: '#67e8f9',
          background: 'rgba(3,7,18,0.72)',
          border: '1px solid rgba(34,211,238,0.25)',
          boxShadow: '0 0 20px rgba(34,211,238,0.12)',
        }}
      >
        {operational ? 'Drag to orbit' : staticPresentation ? 'Architecture snapshot' : `${OVERLAY_MODE_LABEL[overlayMode]} · generated snapshot hints`}
      </div>
      <div
        className="absolute right-3 top-3 text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 rounded-full pointer-events-none"
        style={{
          color: '#c4b5fd',
          background: 'rgba(3,7,18,0.68)',
          border: '1px solid rgba(167,139,250,0.24)',
        }}
      >
        Click nodes to inspect
      </div>
    </div>
  )
}

export default memo(V15rAppBrainScene)
