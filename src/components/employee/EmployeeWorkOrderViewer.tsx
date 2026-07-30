import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, FileText, Loader2, RefreshCw, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BlueprintSnapshotPreviewViewport } from '@/features/blueprint-snapshots/BlueprintSnapshotPreviewViewport'
import { PackageAnimationPlaybackControls } from '@/features/blueprint-animation/PackageAnimationPlaybackControls'
import {
  parseEmployeeAnimationPresentation,
  type EmployeeAnimationPresentationV1,
  type EmployeeAnimationRoutePresentation,
} from '@/features/work-orders'
import {
  getMyEmployeeWorkOrder,
  type EmployeeWorkOrderRead,
  type EmployeeWorkOrderSnapshotMetadata,
  type EmployeeWorkOrderVersion,
  type TaskAssignmentStatus,
} from '@/services/employeeTaskAssignmentService'

type SnapshotUrlItem = {
  id: string
  width: number
  height: number
  url: string
  expiresAt: string | null
}

type SnapshotUrlsResponse = {
  snapshots?: Array<{
    id?: unknown
    snapshot_id?: unknown
    snapshotId?: unknown
    width?: unknown
    height?: unknown
    signed_url?: unknown
    signedUrl?: unknown
    expires_at?: unknown
    expiresAt?: unknown
  }>
}

type ParsedPayload = {
  blueprintTitle: string | null
  scope: { title: string; description: string; crewNotes: string }
  workOrderInstructions: string
  labor: Array<{ label: string; value: string }>
  items: Array<{ name: string; quantity: string; unit: string | null }>
  symbols: Array<{ name: string; count: string; pages: string | null; glyph: string }>
  wires: Array<{ profileName: string; measuredLength: string; purchaseLength: string | null; unit: string | null }>
  animationRoute: null | { title: string; steps: string[]; terminals: string[] }
  animationPresentation: EmployeeAnimationPresentationV1 | null
}

const STATUS_PILL: Record<TaskAssignmentStatus, string> = {
  assigned: 'bg-gray-100 text-gray-600 border-gray-200',
  in_progress: 'bg-amber-100 text-amber-700 border-amber-200',
  completed: 'bg-green-100 text-green-700 border-green-200',
}

export function EmployeeWorkOrderViewer({
  assignmentId,
  onClose,
}: {
  assignmentId: string
  onClose: () => void
}) {
  const requestSeq = useRef(0)
  const urlRequestSeq = useRef(0)
  const initialSnapshotUrlRequestKeyRef = useRef<string | null>(null)
  const snapshotsRef = useRef<EmployeeWorkOrderSnapshotMetadata[]>([])
  const [state, setState] = useState<{ loading: boolean; result: EmployeeWorkOrderRead | null; unavailable: boolean }>({
    loading: true,
    result: null,
    unavailable: false,
  })
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null)
  const [snapshotUrls, setSnapshotUrls] = useState<Record<string, SnapshotUrlItem>>({})
  const [snapshotUrlLoading, setSnapshotUrlLoading] = useState(false)
  const [snapshotUrlRequestCompleted, setSnapshotUrlRequestCompleted] = useState(false)
  const [snapshotUrlError, setSnapshotUrlError] = useState(false)
  const [refreshingSnapshotIds, setRefreshingSnapshotIds] = useState<Record<string, boolean>>({})
  const [imageFailures, setImageFailures] = useState<Record<string, number>>({})
  const employeeSelectedSnapshotRef = useRef(false)

  useEffect(() => {
    const seq = ++requestSeq.current
    urlRequestSeq.current += 1
    initialSnapshotUrlRequestKeyRef.current = null
    setState({ loading: true, result: null, unavailable: false })
    setSelectedSnapshotId(null)
    setSnapshotUrls({})
    setSnapshotUrlLoading(false)
    setSnapshotUrlRequestCompleted(false)
    setSnapshotUrlError(false)
    setRefreshingSnapshotIds({})
    setImageFailures({})
    employeeSelectedSnapshotRef.current = false

    getMyEmployeeWorkOrder(assignmentId).then((res) => {
      if (requestSeq.current !== seq) return
      if (!res.success) {
        setState({ loading: false, result: null, unavailable: true })
        return
      }
      const result = res.data
      setState({ loading: false, result, unavailable: !result.available })
    })

    return () => {
      requestSeq.current += 1
    }
  }, [assignmentId])

  const snapshots = useMemo(() => {
    return [...(state.result?.snapshots ?? [])].sort((a, b) => a.displayOrder - b.displayOrder)
  }, [state.result?.snapshots])
  const snapshotIdsKey = useMemo(() => snapshots.map((snapshot) => snapshot.snapshotId).join('|'), [snapshots])
  snapshotsRef.current = snapshots

  const workOrder = state.result?.workOrder ?? null
  const parsedPayload = useMemo(() => parseWorkOrderPayload(workOrder), [workOrder])

  const loadSnapshotUrls = useCallback(async (refreshSnapshotId?: string) => {
    const cleanAssignmentId = assignmentId.trim()
    if (!cleanAssignmentId) return

    const seq = ++urlRequestSeq.current
    const isRefresh = Boolean(refreshSnapshotId)
    setSnapshotUrlLoading(true)
    setSnapshotUrlError(false)
    if (!isRefresh) setSnapshotUrlRequestCompleted(false)
    if (refreshSnapshotId) {
      setRefreshingSnapshotIds((prev) => ({ ...prev, [refreshSnapshotId]: true }))
      setSnapshotUrls((prev) => {
        const { [refreshSnapshotId]: _omitted, ...remaining } = prev
        return remaining
      })
    }
    try {
      // Use a CORS-safe header set. supabase.functions.invoke also sends
      // X-Supabase-Client-Platform* headers that the deployed Allow-Headers
      // list may omit, which makes browsers abort the POST after OPTIONS 200.
      const { data, error } = await fetchAssignmentSnapshotUrls(
        refreshSnapshotId
          ? { assignment_id: cleanAssignmentId, snapshot_id: refreshSnapshotId }
          : { assignment_id: cleanAssignmentId },
      )
      if (urlRequestSeq.current !== seq) return
      if (error) {
        setSnapshotUrlError(true)
        return
      }
      const nextUrls = normalizeSnapshotUrls(data)
      setSnapshotUrls((prev) => ({ ...prev, ...nextUrls }))
      setSelectedSnapshotId((current) => {
        if (current && (employeeSelectedSnapshotRef.current || nextUrls[current])) return current
        const firstUsable = snapshotsRef.current.find((snapshot) => nextUrls[snapshot.snapshotId])
        return firstUsable?.snapshotId ?? current
      })
    } catch {
      if (urlRequestSeq.current !== seq) return
      setSnapshotUrlError(true)
    } finally {
      if (urlRequestSeq.current === seq) {
        setSnapshotUrlLoading(false)
        if (!isRefresh) setSnapshotUrlRequestCompleted(true)
        if (refreshSnapshotId) {
          setRefreshingSnapshotIds((prev) => {
            const { [refreshSnapshotId]: _omitted, ...remaining } = prev
            return remaining
          })
        }
      }
    }
  }, [assignmentId])

  useEffect(() => {
    const cleanAssignmentId = assignmentId.trim()
    if (!cleanAssignmentId || !state.result?.available || snapshots.length === 0) return
    const requestKey = `${cleanAssignmentId}:${snapshotIdsKey}`
    if (initialSnapshotUrlRequestKeyRef.current === requestKey) return
    initialSnapshotUrlRequestKeyRef.current = requestKey
    void loadSnapshotUrls()
  }, [state.result?.available, assignmentId, snapshotIdsKey, snapshots.length, loadSnapshotUrls])

  const selectedSnapshot = snapshots.find((snapshot) => snapshot.snapshotId === selectedSnapshotId) ?? null
  const selectedUrl = selectedSnapshotId ? snapshotUrls[selectedSnapshotId] ?? null : null
  const selectedUrlRefreshing = selectedSnapshotId ? Boolean(refreshingSnapshotIds[selectedSnapshotId]) : false
  const selectedFailureCount = selectedSnapshotId ? imageFailures[selectedSnapshotId] ?? 0 : 0

  const handleSnapshotImageError = useCallback((snapshotId: string) => {
    if (!snapshotId) return
    if (snapshotUrlLoading || refreshingSnapshotIds[snapshotId]) return
    const current = imageFailures[snapshotId] ?? 0
    if (current === 0) {
      setImageFailures((prev) => ({ ...prev, [snapshotId]: 1 }))
      void loadSnapshotUrls(snapshotId)
      return
    }
    setImageFailures((prev) => ({ ...prev, [snapshotId]: 2 }))
  }, [imageFailures, loadSnapshotUrls, refreshingSnapshotIds, snapshotUrlLoading])

  const handlePreviewError = useCallback(() => {
    if (!selectedSnapshotId) return
    handleSnapshotImageError(selectedSnapshotId)
  }, [handleSnapshotImageError, selectedSnapshotId])

  const handleSnapshotImageLoad = useCallback((snapshotId: string) => {
    setImageFailures((prev) => {
      if (!prev[snapshotId]) return prev
      return { ...prev, [snapshotId]: 0 }
    })
  }, [])

  const retrySelectedImage = useCallback(() => {
    if (!selectedSnapshotId) return
    setImageFailures((prev) => ({ ...prev, [selectedSnapshotId]: 0 }))
    void loadSnapshotUrls(selectedSnapshotId)
  }, [loadSnapshotUrls, selectedSnapshotId])

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Work Order">
      <div className="flex max-h-[96vh] w-full flex-col overflow-hidden rounded-t-2xl bg-gray-50 shadow-2xl sm:mx-auto sm:max-w-6xl sm:rounded-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 shrink-0 text-green-600" />
              <h2 className="truncate text-base font-bold text-gray-900">Work Order</h2>
            </div>
            <p className="mt-0.5 truncate text-sm text-gray-500">Read-only reference for this assigned task</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50"
            aria-label="Close Work Order"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {state.loading && (
            <div className="flex min-h-52 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-500">
              <Loader2 size={16} className="mr-2 animate-spin text-green-600" />
              Loading Work Order...
            </div>
          )}

          {!state.loading && state.unavailable && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-sm font-semibold text-amber-800">
                  {state.result?.assignment ? 'No Work Order has been issued for this task yet.' : 'Work Order unavailable.'}
                </p>
              </div>
            </div>
          )}

          {!state.loading && state.result?.available && state.result.assignment && workOrder && parsedPayload && (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
                <div className="space-y-4">
                  <WorkOrderHeader
                    result={state.result}
                    workOrder={workOrder}
                    parsedPayload={parsedPayload}
                  />
                  <WorkOrderSections parsedPayload={parsedPayload} />
                </div>
                <SnapshotGallery
                  snapshots={snapshots}
                  selectedSnapshot={selectedSnapshot}
                  selectedUrl={selectedUrl}
                  selectedUrlRefreshing={selectedUrlRefreshing}
                  selectedFailureCount={selectedFailureCount}
                  snapshotUrls={snapshotUrls}
                  refreshingSnapshotIds={refreshingSnapshotIds}
                  imageFailures={imageFailures}
                  urlRequestCompleted={snapshotUrlRequestCompleted}
                  loading={snapshotUrlLoading}
                  error={snapshotUrlError}
                  onSelect={(snapshotId) => {
                    employeeSelectedSnapshotRef.current = true
                    setSelectedSnapshotId(snapshotId)
                    setImageFailures((prev) => ({ ...prev, [snapshotId]: 0 }))
                  }}
                  onPreviewError={handlePreviewError}
                  onThumbnailError={handleSnapshotImageError}
                  onThumbnailLoad={handleSnapshotImageLoad}
                  onRetryUrls={() => void loadSnapshotUrls()}
                  onRetrySelected={retrySelectedImage}
                />
              </div>
              {parsedPayload.animationPresentation && (
                <EmployeeAnimationRouteSection
                  presentation={parsedPayload.animationPresentation}
                  snapshotUrls={snapshotUrls}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function WorkOrderHeader({
  result,
  workOrder,
  parsedPayload,
}: {
  result: EmployeeWorkOrderRead
  workOrder: EmployeeWorkOrderVersion
  parsedPayload: ParsedPayload
}) {
  const assignment = result.assignment
  if (!assignment) return null
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-lg font-bold text-gray-900">{assignment.workPackageName}</p>
          <p className="text-sm text-gray-500">{assignment.projectName || 'Project'}</p>
          {parsedPayload.blueprintTitle && (
            <p className="mt-1 text-sm font-medium text-gray-700">{parsedPayload.blueprintTitle}</p>
          )}
        </div>
        <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_PILL[assignment.status]}`}>
          {assignment.status.replace('_', ' ')}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-sm text-gray-600 sm:grid-cols-3">
        <Meta label="Due" value={formatDate(assignment.dueDate) || 'No due date'} />
        <Meta label="Version" value={`Work Order ${workOrder.version}`} />
        <Meta label="Issued" value={formatDateTime(workOrder.issuedAt) || 'Issued'} />
      </div>
    </div>
  )
}

function WorkOrderSections({ parsedPayload }: { parsedPayload: ParsedPayload }) {
  return (
    <div className="space-y-4">
      {(parsedPayload.scope.title || parsedPayload.scope.description) && (
        <Section title="Scope">
          {parsedPayload.scope.title && <p className="font-semibold text-gray-900">{parsedPayload.scope.title}</p>}
          {parsedPayload.scope.description && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{parsedPayload.scope.description}</p>}
        </Section>
      )}

      {parsedPayload.scope.crewNotes && (
        <Section title="Crew Notes">
          <p className="whitespace-pre-wrap break-words text-sm text-gray-800">{parsedPayload.scope.crewNotes}</p>
        </Section>
      )}

      {parsedPayload.workOrderInstructions && (
        <Section title="Work Order Instructions">
          <p className="whitespace-pre-wrap break-words text-sm text-gray-800">{parsedPayload.workOrderInstructions}</p>
        </Section>
      )}

      {parsedPayload.labor.length > 0 && (
        <Section title="Labor">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {parsedPayload.labor.map((item) => (
              <div key={item.label} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <p className="text-xs font-semibold text-gray-500">{item.label}</p>
                <p className="mt-1 text-sm font-bold text-gray-900">{item.value}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {parsedPayload.items.length > 0 && (
        <Section title="Items">
          <div className="divide-y divide-gray-100">
            {parsedPayload.items.map((item, index) => (
              <div key={`${item.name}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 py-2 text-sm">
                <span className="min-w-0 text-gray-800">{item.name}</span>
                <span className="font-semibold text-gray-900">{item.quantity}{item.unit ? ` ${item.unit}` : ''}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {parsedPayload.symbols.length > 0 && (
        <Section title="Electrical Symbols">
          <div className="grid gap-2 sm:grid-cols-2">
            {parsedPayload.symbols.map((symbol, index) => (
              <div key={`${symbol.name}-${index}`} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-gray-700 shadow-sm">
                  {symbol.glyph}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900">{symbol.name}</p>
                  <p className="text-xs text-gray-500">
                    Count {symbol.count}{symbol.pages ? ` - Pages ${symbol.pages}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {parsedPayload.wires.length > 0 && (
        <Section title="Wire Quantities">
          <div className="space-y-2">
            {parsedPayload.wires.map((wire, index) => (
              <div key={`${wire.profileName}-${index}`} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
                <p className="font-semibold text-gray-900">{wire.profileName}</p>
                <p className="mt-1 text-gray-600">
                  Measured {wire.measuredLength}{wire.unit ? ` ${wire.unit}` : ''}
                  {wire.purchaseLength ? ` - Purchase ${wire.purchaseLength}${wire.unit ? ` ${wire.unit}` : ''}` : ''}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {!parsedPayload.animationPresentation && parsedPayload.animationRoute && (
        <Section title="Animation Route">
          <p className="text-sm font-semibold text-gray-900">{parsedPayload.animationRoute.title}</p>
          {parsedPayload.animationRoute.steps.length > 0 && (
            <ol className="mt-2 space-y-1 text-sm text-gray-700">
              {parsedPayload.animationRoute.steps.map((step, index) => (
                <li key={`${step}-${index}`}>{index + 1}. {step}</li>
              ))}
            </ol>
          )}
          {parsedPayload.animationRoute.terminals.length > 0 && (
            <p className="mt-2 text-xs font-semibold text-gray-500">Terminals: {parsedPayload.animationRoute.terminals.join(', ')}</p>
          )}
        </Section>
      )}
    </div>
  )
}

function EmployeeAnimationRouteSection({
  presentation,
  snapshotUrls,
}: {
  presentation: EmployeeAnimationPresentationV1
  snapshotUrls: Record<string, SnapshotUrlItem>
}) {
  const [routeIndex, setRouteIndex] = useState(0)
  useEffect(() => setRouteIndex(0), [presentation])
  const route = presentation.routes[routeIndex] ?? presentation.routes[0]
  if (!route) return null
  return (
    <Section title="Animation Route">
      {presentation.routes.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2" aria-label="Animation routes">
          {presentation.routes.map((candidate, index) => (
            <button
              key={`${candidate.title}-${candidate.pageNumber}-${index}`}
              type="button"
              onClick={() => setRouteIndex(index)}
              className={`min-h-10 rounded-lg border px-3 py-2 text-sm font-semibold ${index === routeIndex ? 'border-cyan-500 bg-cyan-50 text-cyan-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {candidate.title}
            </button>
          ))}
        </div>
      )}
      <EmployeeAnimationRoutePlayer
        key={`${routeIndex}-${route.title}-${route.pageNumber}`}
        route={route}
        backgroundUrl={route.background ? snapshotUrls[route.background.snapshotId] ?? null : null}
      />
    </Section>
  )
}

function EmployeeAnimationRoutePlayer({
  route,
  backgroundUrl,
}: {
  route: EmployeeAnimationRoutePresentation
  backgroundUrl: SnapshotUrlItem | null
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 })
  const [active, setActive] = useState(false)
  const displayAspect = backgroundUrl && backgroundUrl.height > 0
    ? backgroundUrl.width / backgroundUrl.height
    : route.pageAspect

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = () => {
      const rect = stage.getBoundingClientRect()
      setStageSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(stage)
    return () => {
      observer?.disconnect()
    }
  }, [])

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{route.title}</p>
          <p className="text-xs text-gray-500">Page {route.pageNumber} · Read-only playback</p>
        </div>
        <div className="rounded-lg bg-gray-950 p-2">
          <PackageAnimationPlaybackControls
            active={active}
            scene={route.playback}
            annotations={route.geometrySources}
            currentPage={route.pageNumber}
            pageWidth={stageSize.width}
            pageHeight={stageSize.height}
            overlayWidth={stageSize.width}
            overlayHeight={stageSize.height}
            overlayTarget={stageRef.current}
            onActivate={() => setActive(true)}
            onDeactivate={() => setActive(false)}
          />
        </div>
      </div>
      <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-xl border border-gray-700 bg-[#080b12]">
        <div
          ref={stageRef}
          className="relative w-full overflow-hidden bg-[linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:24px_24px]"
          style={{ aspectRatio: String(displayAspect) }}
          aria-label={`${route.title} animation playback`}
        >
          {backgroundUrl && (
            <img
              src={backgroundUrl.url}
              alt=""
              className="absolute inset-0 h-full w-full select-none object-fill"
              draggable={false}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
    </div>
  )
}

function SnapshotGallery({
  snapshots,
  selectedSnapshot,
  selectedUrl,
  selectedUrlRefreshing,
  selectedFailureCount,
  snapshotUrls,
  refreshingSnapshotIds,
  imageFailures,
  urlRequestCompleted,
  loading,
  error,
  onSelect,
  onPreviewError,
  onThumbnailError,
  onThumbnailLoad,
  onRetryUrls,
  onRetrySelected,
}: {
  snapshots: EmployeeWorkOrderSnapshotMetadata[]
  selectedSnapshot: EmployeeWorkOrderSnapshotMetadata | null
  selectedUrl: SnapshotUrlItem | null
  selectedUrlRefreshing: boolean
  selectedFailureCount: number
  snapshotUrls: Record<string, SnapshotUrlItem>
  refreshingSnapshotIds: Record<string, boolean>
  imageFailures: Record<string, number>
  urlRequestCompleted: boolean
  loading: boolean
  error: boolean
  onSelect: (snapshotId: string) => void
  onPreviewError: () => void
  onThumbnailError: (snapshotId: string) => void
  onThumbnailLoad: (snapshotId: string) => void
  onRetryUrls: () => void
  onRetrySelected: () => void
}) {
  const selectedUrlUnavailable = Boolean(selectedSnapshot && !selectedUrl && urlRequestCompleted && !selectedUrlRefreshing)
  const noUsableUrls = urlRequestCompleted && snapshots.length > 0 && Object.keys(snapshotUrls).length === 0

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm lg:sticky lg:top-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-gray-900">Snapshots</h3>
        {loading && <Loader2 size={15} className="animate-spin text-green-600" />}
      </div>

      {snapshots.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No snapshots attached.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
            {snapshots.map((snapshot) => (
              <button
                key={snapshot.snapshotId}
                type="button"
                onClick={() => onSelect(snapshot.snapshotId)}
                className={`min-h-32 rounded-lg border p-2 text-left text-xs transition ${selectedSnapshot?.snapshotId === snapshot.snapshotId ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'}`}
              >
                <SnapshotThumbnail
                  snapshot={snapshot}
                  urlItem={snapshotUrls[snapshot.snapshotId] ?? null}
                  loading={(!urlRequestCompleted && loading) || Boolean(refreshingSnapshotIds[snapshot.snapshotId])}
                  unavailable={urlRequestCompleted && !snapshotUrls[snapshot.snapshotId]}
                  failureCount={imageFailures[snapshot.snapshotId] ?? 0}
                  onError={() => onThumbnailError(snapshot.snapshotId)}
                  onLoad={() => onThumbnailLoad(snapshot.snapshotId)}
                />
                <span className="block font-semibold text-gray-900">{snapshot.caption || `Snapshot ${snapshot.displayOrder + 1}`}</span>
                <span className="mt-1 block text-gray-500">{formatSnapshotMeta(snapshot)}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 min-h-[280px]">
            {(error || noUsableUrls || selectedUrlUnavailable) && !selectedUrl && (
              <UnavailablePreview message="Preview unavailable" onRetry={onRetryUrls} />
            )}
            {!error && !selectedUrlUnavailable && selectedSnapshot && (!selectedUrl || selectedUrlRefreshing) && selectedFailureCount < 2 && (
              <div className="flex min-h-[280px] items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500">
                <Loader2 size={16} className="mr-2 animate-spin text-green-600" />
                Loading preview...
              </div>
            )}
            {selectedSnapshot && selectedUrl && !selectedUrlRefreshing && selectedFailureCount < 2 && (
              <div>
                <BlueprintSnapshotPreviewViewport
                  imageUrl={selectedUrl.url}
                  imageWidth={selectedUrl.width}
                  imageHeight={selectedUrl.height}
                  accessibleLabel={selectedSnapshot.caption || 'Work Order snapshot preview'}
                  resetKey={`${selectedSnapshot.snapshotId}-${selectedUrl.expiresAt || selectedUrl.url}`}
                  onError={onPreviewError}
                />
                <p className="mt-2 text-xs text-gray-500">{formatSnapshotMeta(selectedSnapshot)}</p>
              </div>
            )}
            {selectedSnapshot && selectedFailureCount >= 2 && (
              <UnavailablePreview message="Preview unavailable" onRetry={onRetrySelected} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SnapshotThumbnail({
  snapshot,
  urlItem,
  loading,
  unavailable,
  failureCount,
  onError,
  onLoad,
}: {
  snapshot: EmployeeWorkOrderSnapshotMetadata
  urlItem: SnapshotUrlItem | null
  loading: boolean
  unavailable: boolean
  failureCount: number
  onError: () => void
  onLoad: () => void
}) {
  if (failureCount >= 2 || unavailable) {
    return (
      <span className="mb-2 flex aspect-video w-full items-center justify-center rounded-md border border-gray-200 bg-white text-[11px] font-semibold text-gray-500">
        Preview unavailable
      </span>
    )
  }

  if (loading || !urlItem?.url) {
    return (
      <span className="mb-2 flex aspect-video w-full items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400">
        <Loader2 size={15} className="animate-spin text-green-600" />
      </span>
    )
  }

  return (
    <span className="mb-2 block aspect-video w-full overflow-hidden rounded-md border border-gray-200 bg-white">
      <img
        key={`${snapshot.snapshotId}-${urlItem.expiresAt || urlItem.url}`}
        src={urlItem.url}
        alt={snapshot.caption || 'Work Order snapshot thumbnail'}
        className="h-full w-full object-contain"
        onError={onError}
        onLoad={onLoad}
      />
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-gray-900">{title}</h3>
      {children}
    </section>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-gray-400">{label}</p>
      <p className="mt-0.5 font-semibold text-gray-800">{value}</p>
    </div>
  )
}

function UnavailablePreview({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-4 text-center">
      <AlertCircle className="h-5 w-5 text-gray-400" />
      <p className="mt-2 text-sm font-semibold text-gray-700">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
      >
        <RefreshCw size={14} />
        Retry
      </button>
    </div>
  )
}

function parseWorkOrderPayload(workOrder: EmployeeWorkOrderVersion | null): ParsedPayload | null {
  if (!workOrder || !isRecord(workOrder.payload)) return null
  const payload = workOrder.payload
  const identity = asRecord(payload.identity)
  const scope = asRecord(payload.scope)
  const labor = asRecord(payload.labor)

  return {
    blueprintTitle: text(identity.blueprintTitle),
    scope: {
      title: text(scope.title) || '',
      description: text(scope.description) || '',
      crewNotes: text(scope.crewNotes) || '',
    },
    workOrderInstructions: text(payload.workOrderInstructions) || '',
    labor: [
      { label: 'Rough-in', value: hours(labor.roughInHours) },
      { label: 'Trim', value: hours(labor.trimHours) },
      { label: 'Testing', value: hours(labor.testingHours) },
      { label: 'Cleanup', value: hours(labor.cleanupHours) },
      { label: 'Total', value: hours(labor.totalHours) },
    ],
    items: array(payload.items).map((item) => ({
      name: text(item.name) || 'Item',
      quantity: numberText(item.quantity),
      unit: text(item.unit),
    })),
    symbols: array(payload.electricalSymbols).map((symbol) => ({
      name: text(symbol.name) || text(symbol.shapeKind) || 'Symbol',
      count: numberText(symbol.quantity ?? symbol.count),
      pages: pageRefs(symbol.pageReferences ?? symbol.pages ?? symbol.pageNumber),
      glyph: glyphForSymbol(text(symbol.shapeKind) || text(symbol.name)),
    })),
    wires: array(payload.wireQuantities).map((wire) => ({
      profileName: text(wire.profileName) || text(wire.wireProfileType) || text(wire.materialDescription) || 'Wire',
      measuredLength: numberText(wire.length ?? wire.measuredLength),
      purchaseLength: text(wire.purchaseLength) || text(wire.purchaseLengthText),
      unit: text(wire.unit),
    })),
    animationRoute: parseAnimationRoute(payload.animationRoute),
    animationPresentation: parseEmployeeAnimationPresentation(payload.animationPresentation),
  }
}

function parseAnimationRoute(value: unknown): ParsedPayload['animationRoute'] {
  if (!isRecord(value)) return null
  const steps = array(value.steps)
    .map((step) => text(step.label))
    .filter((step): step is string => Boolean(step))
  const terminals = Array.isArray(value.terminalLabels)
    ? value.terminalLabels.map((item) => text(item)).filter((item): item is string => Boolean(item))
    : []
  if (steps.length === 0 && terminals.length === 0 && !text(value.name)) return null
  return {
    title: text(value.name) || text(value.sourceLabel) || 'Route summary',
    steps,
    terminals,
  }
}

async function fetchAssignmentSnapshotUrls(body: {
  assignment_id: string
  snapshot_id?: string
}): Promise<{ data: unknown; error: { message: string } | null }> {
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '')
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const accessToken = session?.access_token
  if (!supabaseUrl || !anonKey || !accessToken) {
    return { data: null, error: { message: 'Authentication required' } }
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/getAssignmentSnapshotUrls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
      'x-client-info': 'poweron-hub-employee-work-order',
    },
    body: JSON.stringify(body),
  })

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const message =
      isRecord(payload) && text(payload.error)
        ? text(payload.error)!
        : `Request failed (${response.status})`
    return { data: null, error: { message } }
  }

  return { data: payload, error: null }
}

function normalizeSnapshotUrls(value: unknown): Record<string, SnapshotUrlItem> {
  const payload = unwrapSnapshotUrlPayload(value)
  if (!isRecord(payload)) return {}
  const out: Record<string, SnapshotUrlItem> = {}
  for (const entry of Array.isArray((payload as SnapshotUrlsResponse).snapshots) ? (payload as SnapshotUrlsResponse).snapshots! : []) {
    const id = text(entry.id ?? entry.snapshot_id ?? entry.snapshotId)
    const url = text(entry.signed_url ?? entry.signedUrl)
    const width = positiveNumber(entry.width)
    const height = positiveNumber(entry.height)
    if (!id || !url || !width || !height) continue
    out[id] = {
      id,
      width,
      height,
      url,
      expiresAt: text(entry.expires_at ?? entry.expiresAt),
    }
  }
  return out
}

function unwrapSnapshotUrlPayload(value: unknown): unknown {
  if (!isRecord(value)) return value
  if (Array.isArray(value.snapshots)) return value
  if (isRecord(value.data) && Array.isArray(value.data.snapshots)) return value.data
  return value
}

function formatDate(value: string | null | undefined): string {
  if (!value) return ''
  const [y, m, d] = value.split('-').map(Number)
  if (y && m && d) {
    return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return formatDateTime(value)
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatSnapshotMeta(snapshot: EmployeeWorkOrderSnapshotMetadata): string {
  const parts = []
  if (snapshot.pageNumber) parts.push(`Page ${snapshot.pageNumber}`)
  if (snapshot.captureMode) parts.push(snapshot.captureMode === 'full-page' ? 'Full page' : 'Area')
  return parts.join(' - ') || `Order ${snapshot.displayOrder + 1}`
}

function pageRefs(value: unknown): string | null {
  if (Array.isArray(value)) {
    const refs = value.map((item) => text(item)).filter(Boolean)
    return refs.length > 0 ? refs.join(', ') : null
  }
  return text(value)
}

function glyphForSymbol(value: string | null): string {
  const lower = (value || '').toLowerCase()
  if (lower.includes('switch')) return 'S'
  if (lower.includes('receptacle') || lower.includes('outlet')) return 'R'
  if (lower.includes('panel')) return 'P'
  if (lower.includes('exit')) return 'E'
  return 'L'
}

function hours(value: unknown): string {
  return `${numberText(value)}h`
}

function numberText(value: unknown): string {
  const next = Number(value)
  if (!Number.isFinite(next)) return '0'
  return Number.isInteger(next) ? String(next) : String(Math.round(next * 100) / 100)
}

function positiveNumber(value: unknown): number | null {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function text(value: unknown): string | null {
  if (value == null) return null
  const next = String(value).trim()
  return next || null
}

function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
