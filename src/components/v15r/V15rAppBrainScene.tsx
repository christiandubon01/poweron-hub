import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import {
  APP_BRAIN_CATEGORY_META,
  APP_BRAIN_EDGES,
  APP_BRAIN_NODES,
  type AppBrainNode,
} from './appBrainMap'

interface V15rAppBrainSceneProps {
  selectedNodeId: string | null
  hoveredNodeId: string | null
  visibleNodeIds: string[]
  onSelectNode: (nodeId: string) => void
  onHoverNode: (nodeId: string | null) => void
}

interface NodeRenderState {
  node: AppBrainNode
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  glow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  hit: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  label: THREE.Sprite
  baseScale: number
}

interface EdgePulse {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  from: THREE.Vector3
  to: THREE.Vector3
  speed: number
  offset: number
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

function makeLabelTexture(label: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.font = '700 34px Inter, Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = color
  ctx.shadowBlur = 18
  ctx.fillStyle = 'rgba(6,10,18,0.72)'
  const x = 36
  const y = 34
  const w = 440
  const h = 58
  const r = 24
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
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 1)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export default function V15rAppBrainScene({
  selectedNodeId,
  hoveredNodeId,
  visibleNodeIds,
  onSelectNode,
  onHoverNode,
}: V15rAppBrainSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const selectedRef = useRef<string | null>(selectedNodeId)
  const hoveredRef = useRef<string | null>(hoveredNodeId)
  const visibleNodeIdsRef = useRef<Set<string>>(new Set(visibleNodeIds))
  const onSelectRef = useRef(onSelectNode)
  const onHoverRef = useRef(onHoverNode)

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
  }, [onSelectNode, onHoverNode])

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
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100)
    const root = new THREE.Group()
    const nodeGroup = new THREE.Group()
    const edgeGroup = new THREE.Group()
    const pulseGroup = new THREE.Group()
    const labelGroup = new THREE.Group()
    const starGroup = new THREE.Group()
    const nodeStates: NodeRenderState[] = []
    const edgePulses: EdgePulse[] = []
    const hitTargets: THREE.Object3D[] = []

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

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

      const width = Math.max(mount.clientWidth, 320)
      const height = Math.max(mount.clientHeight, 280)

      camera.aspect = width / height
      camera.position.set(0, 0.2, 7.2)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setSize(width, height)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setClearColor(0x020712, 0)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      renderer.domElement.style.display = 'block'
      renderer.domElement.style.cursor = 'grab'
      mount.appendChild(renderer.domElement)

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
      const edgePositions: number[] = []
      const edgeColors: number[] = []

      APP_BRAIN_EDGES.forEach((edge, index) => {
        const from = nodeById.get(edge.from)
        const to = nodeById.get(edge.to)
        if (!from || !to) return

        const fromVector = new THREE.Vector3(...from.position)
        const toVector = new THREE.Vector3(...to.position)
        const fromColor = new THREE.Color(APP_BRAIN_CATEGORY_META[from.category].color)
        const toColor = new THREE.Color(APP_BRAIN_CATEGORY_META[to.category].color)
        edgePositions.push(...from.position, ...to.position)
        edgeColors.push(fromColor.r, fromColor.g, fromColor.b, toColor.r, toColor.g, toColor.b)

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
        edgePulses.push({
          mesh: pulse,
          from: fromVector,
          to: toVector,
          speed: 0.08 + edge.strength * 0.045,
          offset: index * 0.071,
        })
      })

      const edgeGeo = new THREE.BufferGeometry()
      edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3))
      edgeGeo.setAttribute('color', new THREE.Float32BufferAttribute(edgeColors, 3))
      const edgeMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      edgeGroup.add(new THREE.LineSegments(edgeGeo, edgeMat))

      APP_BRAIN_NODES.forEach((node) => {
        const meta = APP_BRAIN_CATEGORY_META[node.category]
        const position = new THREE.Vector3(...node.position)
        const riskScale = node.riskLevel === 'high' ? 1.18 : node.riskLevel === 'medium' ? 1.08 : 1
        const baseScale = 0.12 * riskScale
        const color = new THREE.Color(meta.color)

        const core = new THREE.Mesh(
          new THREE.SphereGeometry(baseScale, 28, 28),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
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

        const ring = new THREE.Mesh(
          new THREE.RingGeometry(baseScale * 1.55, baseScale * 1.8, 40),
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
          new THREE.SphereGeometry(baseScale * 2.7, 16, 16),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
        )
        hit.position.copy(position)
        hit.userData.nodeId = node.id
        nodeGroup.add(hit)
        hitTargets.push(hit)

        const labelTexture = makeLabelTexture(node.label, meta.color)
        const label = new THREE.Sprite(new THREE.SpriteMaterial({
          map: labelTexture,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
        }))
        label.position.copy(position).add(new THREE.Vector3(0, baseScale * 3.2, 0))
        label.scale.set(0.85, 0.22, 1)
        labelGroup.add(label)

        nodeStates.push({ node, core, glow, ring, hit, label, baseScale })
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
        const nodeId = pickNode(event)
        if (nodeId !== hoveredRef.current) onHoverRef.current(nodeId)
        if (renderer) renderer.domElement.style.cursor = nodeId ? 'pointer' : 'grab'
      }

      function onPointerLeave(): void {
        if (hoveredRef.current) onHoverRef.current(null)
        if (renderer) renderer.domElement.style.cursor = 'grab'
      }

      function onClick(event: MouseEvent): void {
        const nodeId = pickNode(event)
        if (nodeId) onSelectRef.current(nodeId)
      }

      renderer.domElement.addEventListener('pointermove', onPointerMove)
      renderer.domElement.addEventListener('pointerleave', onPointerLeave)
      renderer.domElement.addEventListener('click', onClick)

      resizeObserver = new ResizeObserver(() => {
        if (!renderer || !mount) return
        const nextWidth = mount.clientWidth
        const nextHeight = mount.clientHeight
        if (!nextWidth || !nextHeight) return
        camera.aspect = nextWidth / nextHeight
        camera.updateProjectionMatrix()
        renderer.setSize(nextWidth, nextHeight)
      })
      resizeObserver.observe(mount)

      let lastTime = performance.now()
      function animate(now: number): void {
        animationFrame = requestAnimationFrame(animate)
        if (!renderer) return
        const dt = Math.min((now - lastTime) / 1000, 0.05)
        lastTime = now
        const t = now / 1000

        root.rotation.y += dt * 0.16
        root.rotation.x = Math.sin(t * 0.35) * 0.07
        starGroup.rotation.y -= dt * 0.035
        starGroup.rotation.x = Math.sin(t * 0.12) * 0.04

        edgePulses.forEach((pulse) => {
          const pct = (t * pulse.speed + pulse.offset) % 1
          pulse.mesh.position.copy(pulse.from).lerp(pulse.to, pct)
          const fade = Math.sin(pct * Math.PI)
          pulse.mesh.material.opacity = 0.24 + fade * 0.68
          const pulseScale = 0.85 + fade * 0.6
          pulse.mesh.scale.setScalar(pulseScale)
        })

        nodeStates.forEach((state, index) => {
          const isVisible = visibleNodeIdsRef.current.has(state.node.id)
          const isSelected = selectedRef.current === state.node.id
          const isHovered = hoveredRef.current === state.node.id
          const pulse = Math.sin(t * 2.1 + index * 0.75) * 0.5 + 0.5
          const emphasis = isSelected && isVisible ? 1.85 : isHovered && isVisible ? 1.45 : isVisible ? 1 : 0.42
          const coreScale = emphasis * (1 + pulse * 0.12)
          state.core.scale.setScalar(coreScale)
          state.glow.scale.setScalar(emphasis * (1.05 + pulse * 0.18))
          state.ring.scale.setScalar(emphasis * (1.05 + pulse * 0.1))
          state.ring.lookAt(camera.position)
          state.ring.rotation.z += dt * (isSelected ? 1.7 : 0.6)
          state.core.material.opacity = !isVisible ? 0.16 : isSelected ? 1 : isHovered ? 0.98 : 0.86
          state.glow.material.opacity = !isVisible ? 0.025 : isSelected ? 0.28 : isHovered ? 0.22 : 0.1 + pulse * 0.05
          state.ring.material.opacity = !isVisible ? 0.04 : isSelected ? 0.75 : isHovered ? 0.55 : 0.18
          state.hit.visible = isVisible
          state.label.material.opacity = !isVisible ? 0.12 : isSelected || isHovered ? 0.92 : 0.72
        })

        renderer.render(scene, camera)
      }
      animationFrame = requestAnimationFrame(animate)

      cleanupRendererEvents = () => {
        if (!renderer) return
        renderer.domElement.removeEventListener('pointermove', onPointerMove)
        renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
        renderer.domElement.removeEventListener('click', onClick)
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
    <div className="relative w-full h-full min-h-[420px] rounded-xl overflow-hidden">
      <div ref={mountRef} className="absolute inset-0" />
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
        Static architecture MVP / Three.js
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
