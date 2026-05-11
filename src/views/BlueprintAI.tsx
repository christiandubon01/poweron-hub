// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, CheckCircle2, FileText, Loader2, RotateCcw, Upload } from 'lucide-react'
import { getBackupData } from '@/services/backupDataService'
import OperationsBlueprintPdfViewer from '@/components/blueprint/OperationsBlueprintPdfViewer'
import {
  createBlueprintLibraryItem,
  deleteBlueprintSheetIndexItem,
  getBlueprintSheetIndex,
  getBlueprintSheetIndexSummary,
  mergeDetectedSheetIndexRows,
  getOperationsBlueprintAnnotationSummary,
  getOperationsBlueprintLibrary,
  MAX_BLUEPRINT_FILE_SIZE_BYTES,
  saveOperationsBlueprintLibrary,
  upsertBlueprintSheetIndexItem,
  uploadBlueprintPdfToStorage,
  validateBlueprintPdf,
  type BlueprintSheetIndexItem,
  type BlueprintLibraryItem,
  type BlueprintLibraryType,
} from '@/services/blueprintLibraryService'
import { extractSheetIndexCandidatesFromStorage, type DetectedSheetIndexRow } from '@/services/blueprintExtractor'
import {
  createDerivedBlueprintSet,
  MAX_DERIVED_SELECTION_PAGES,
} from '@/services/blueprintDerivedSetService'
import { exportAnnotatedBlueprintPdf } from '@/services/blueprintAnnotationExportService'

const BLUEPRINT_TYPES: BlueprintLibraryType[] = ['Full Set', 'Electrical Only', 'Plumbing Only', 'Mechanical Only', 'Reference Sheet', 'Other']
const DISCIPLINES = ['General', 'Architectural', 'Electrical', 'Plumbing', 'Mechanical', 'Fire Alarm', 'Structural', 'Civil', 'Other'] as const

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function statusPill(status: 'active' | 'archived') {
  return status === 'active'
    ? 'bg-green-900/30 text-green-300 border-green-800/50'
    : 'bg-gray-800/60 text-gray-300 border-gray-700/50'
}

export default function BlueprintAI() {
  const backup = useMemo(() => getBackupData() || { projects: [], settings: {}, blueprintSummaries: {} }, [])
  const projects = Array.isArray(backup?.projects) ? backup.projects : []
  const orgId = backup?.settings?.orgId || 'local'

  const [library, setLibrary] = useState<BlueprintLibraryItem[]>(() => getOperationsBlueprintLibrary(backup))
  const [selectedId, setSelectedId] = useState<string>(() => getOperationsBlueprintLibrary(backup)[0]?.id || '')
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id || '')
  const [title, setTitle] = useState('')
  const [bpType, setBpType] = useState<BlueprintLibraryType>('Electrical Only')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [annotationRefreshToken, setAnnotationRefreshToken] = useState(0)
  const [selectedPages, setSelectedPages] = useState<number[]>([])
  const [derivedTitle, setDerivedTitle] = useState('')
  const [derivedType, setDerivedType] = useState<BlueprintLibraryType>('Electrical Only')
  const [creatingDerived, setCreatingDerived] = useState(false)
  const [currentViewerPage, setCurrentViewerPage] = useState(1)
  const [sheetSearch, setSheetSearch] = useState('')
  const [sheetEditorOpen, setSheetEditorOpen] = useState(false)
  const [sheetEditor, setSheetEditor] = useState<{
    pageNumber: number
    sheetNumber: string
    sheetTitle: string
    discipline: string
  }>({ pageNumber: 1, sheetNumber: '', sheetTitle: '', discipline: 'General' })
  const [savingSheet, setSavingSheet] = useState(false)
  const [detectingSheets, setDetectingSheets] = useState(false)
  const [detectionProgress, setDetectionProgress] = useState<{ processed: number; total: number; pageNumber: number } | null>(null)
  const [detectionRangeMode, setDetectionRangeMode] = useState<'first30' | 'current' | 'custom' | 'all'>('first30')
  const [customRangeStart, setCustomRangeStart] = useState(1)
  const [customRangeEnd, setCustomRangeEnd] = useState(30)
  const [detectedPreviewRows, setDetectedPreviewRows] = useState<DetectedSheetIndexRow[] | null>(null)
  const [sheetMergeMode, setSheetMergeMode] = useState<'fill-empty' | 'replace-auto' | 'replace-manual'>('fill-empty')
  const [confirmReplaceManual, setConfirmReplaceManual] = useState(false)
  const [applyingDetectedRows, setApplyingDetectedRows] = useState(false)
  const [exportMode, setExportMode] = useState<'annotated-pages' | 'all-pages'>('annotated-pages')
  const [exportingPdf, setExportingPdf] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const selectedItem = library.find(x => x.id === selectedId) || null
  const totals = useMemo(() => {
    const uploaded = library.length
    const active = library.filter(x => x.status === 'active').length
    const archived = library.filter(x => x.status === 'archived').length
    return { uploaded, active, archived }
  }, [library])

  const selectedAnnotationSummary = useMemo(() => {
    if (!selectedItem?.id) return { total: 0, pagesWithAnnotations: 0, byPage: {} as Record<number, number> }
    const freshBackup = getBackupData() || backup
    return getOperationsBlueprintAnnotationSummary(freshBackup, selectedItem.id)
  }, [selectedItem?.id, annotationRefreshToken, backup])
  const sheetIndexRows = useMemo(() => getBlueprintSheetIndex(selectedItem), [selectedItem?.id, selectedItem?.sheetIndex])
  const sheetSummary = useMemo(() => getBlueprintSheetIndexSummary(selectedItem), [selectedItem?.id, selectedItem?.sheetIndex])
  const filteredSheetRows = useMemo(() => {
    const q = sheetSearch.trim().toLowerCase()
    if (!q) return sheetIndexRows
    return sheetIndexRows.filter((row: any) =>
      String(row.pageNumber).includes(q) ||
      String(row.sheetNumber || row.sheetLabel || '').toLowerCase().includes(q) ||
      String(row.sheetTitle || '').toLowerCase().includes(q) ||
      String(row.discipline || '').toLowerCase().includes(q)
    )
  }, [sheetSearch, sheetIndexRows])

  useEffect(() => {
    setSelectedPages([])
    setDetectedPreviewRows(null)
    setDetectionProgress(null)
    setSheetSearch('')
  }, [selectedId])

  async function persist(next: BlueprintLibraryItem[]) {
    setLibrary(next)
    await saveOperationsBlueprintLibrary(backup, next)
  }

  async function handleUpload() {
    setError(null)
    setSuccess(null)
    if (!selectedProjectId) {
      setError('Select a project first.')
      return
    }
    if (!title.trim()) {
      setError('Blueprint title is required.')
      return
    }
    if (!file) {
      setError('Choose a PDF to upload.')
      return
    }

    const valid = validateBlueprintPdf(file)
    if (!valid.ok) {
      setError(valid.error || 'Invalid file.')
      return
    }

    const project = projects.find((p: any) => p.id === selectedProjectId)
    if (!project) {
      setError('Selected project not found.')
      return
    }

    setUploading(true)
    try {
      const { storagePath } = await uploadBlueprintPdfToStorage({
        file,
        projectId: selectedProjectId,
        orgId,
      })

      const item = await createBlueprintLibraryItem({
        file,
        projectId: selectedProjectId,
        projectName: project.name || selectedProjectId,
        title,
        type: bpType,
        storagePath,
      })

      const next = [item, ...library]
      await persist(next)
      setSelectedId(item.id)
      setTitle('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setSuccess('Blueprint uploaded and linked successfully.')
    } catch (e: any) {
      setError(e?.message || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function setArchiveState(item: BlueprintLibraryItem, archived: boolean) {
    const now = new Date().toISOString()
    const next = library.map(x => {
      if (x.id !== item.id) return x
      return {
        ...x,
        status: archived ? 'archived' : 'active',
        archivedAt: archived ? now : null,
        updatedAt: now,
      }
    })
    await persist(next)
  }

  function removeSelectedPage(pageNumber: number) {
    setSelectedPages((prev) => prev.filter((p) => p !== pageNumber))
  }

  function clearSelectedPages() {
    setSelectedPages([])
  }

  function openSheetEditor(row?: BlueprintSheetIndexItem) {
    const page = Math.max(1, Math.floor(Number(row?.pageNumber || currentViewerPage || 1)))
    setSheetEditor({
      pageNumber: page,
      sheetNumber: String(row?.sheetNumber || row?.sheetLabel || ''),
      sheetTitle: String(row?.sheetTitle || ''),
      discipline: String(row?.discipline || 'General'),
    })
    setSheetEditorOpen(true)
  }

  async function saveSheetEditor() {
    setError(null)
    if (!selectedItem?.id) {
      setError('Select a blueprint set first.')
      return
    }
    const pageNumber = Math.max(1, Math.floor(Number(sheetEditor.pageNumber) || 1))
    const pageMax = Math.max(1, Number(selectedItem.pageCount || 1))
    if (pageNumber < 1 || pageNumber > pageMax) {
      setError(`Page number must be between 1 and ${pageMax}.`)
      return
    }
    const sheetNumber = String(sheetEditor.sheetNumber || '').trim()
    const sheetTitle = String(sheetEditor.sheetTitle || '').trim()
    if (!sheetNumber && !sheetTitle) {
      setError('Provide at least a Sheet Number or Sheet Title.')
      return
    }
    if (savingSheet) return
    setSavingSheet(true)
    try {
      const freshBackup = getBackupData() || backup
      await upsertBlueprintSheetIndexItem(freshBackup, selectedItem.id, {
        pageNumber,
        sheetNumber,
        sheetLabel: sheetNumber || undefined,
        sheetTitle,
        discipline: String(sheetEditor.discipline || 'General'),
        source: 'manual',
        updatedAt: new Date().toISOString(),
      })
      const freshLibrary = getOperationsBlueprintLibrary(getBackupData() || freshBackup)
      setLibrary(freshLibrary)
      setSheetEditorOpen(false)
      setSuccess('Sheet label saved.')
    } catch (e: any) {
      setError(e?.message || 'Failed to save sheet label.')
    } finally {
      setSavingSheet(false)
    }
  }

  async function deleteSheetRow(pageNumber: number) {
    setError(null)
    if (!selectedItem?.id) return
    try {
      const freshBackup = getBackupData() || backup
      await deleteBlueprintSheetIndexItem(freshBackup, selectedItem.id, pageNumber)
      const freshLibrary = getOperationsBlueprintLibrary(getBackupData() || freshBackup)
      setLibrary(freshLibrary)
      setSuccess(`Cleared sheet label for page ${pageNumber}.`)
    } catch (e: any) {
      setError(e?.message || 'Failed to clear sheet label.')
    }
  }

  function resolveDetectionRange(): { startPage: number; endPage: number } | null {
    if (!selectedItem) return null
    const maxPage = Math.max(1, Number(selectedItem.pageCount || 1))
    if (detectionRangeMode === 'current') {
      const p = Math.max(1, Math.min(maxPage, currentViewerPage || 1))
      return { startPage: p, endPage: p }
    }
    if (detectionRangeMode === 'custom') {
      const start = Math.max(1, Math.min(maxPage, Math.floor(Number(customRangeStart) || 1)))
      const end = Math.max(1, Math.min(maxPage, Math.floor(Number(customRangeEnd) || maxPage)))
      if (start > end) return null
      return { startPage: start, endPage: end }
    }
    if (detectionRangeMode === 'all') {
      return { startPage: 1, endPage: maxPage }
    }
    return { startPage: 1, endPage: Math.min(30, maxPage) }
  }

  async function handleAutoDetectSheetIndex() {
    setError(null)
    setSuccess(null)
    setDetectedPreviewRows(null)
    if (!selectedItem?.storagePath) {
      setError('Select a blueprint with a valid storagePath first.')
      return
    }
    const range = resolveDetectionRange()
    if (!range) {
      setError('Invalid page range for detection.')
      return
    }
    if (detectingSheets) return
    setDetectingSheets(true)
    setDetectionProgress(null)
    try {
      const result = await extractSheetIndexCandidatesFromStorage({
        storagePath: selectedItem.storagePath,
        startPage: range.startPage,
        endPage: range.endPage,
        maxPages: detectionRangeMode === 'first30' ? 30 : undefined,
        onProgress: (p) => setDetectionProgress(p),
      })
      setDetectedPreviewRows(result.rows || [])
      if (!result.rows?.length) {
        setSuccess('Auto-detect completed, no candidates found in selected range.')
      }
    } catch (e: any) {
      setError(e?.message || 'Auto-detect failed.')
    } finally {
      setDetectingSheets(false)
    }
  }

  function cancelDetectedPreview() {
    setDetectedPreviewRows(null)
    setDetectionProgress(null)
  }

  async function applyDetectedSheetRows() {
    setError(null)
    if (!selectedItem?.id) {
      setError('Select a blueprint set first.')
      return
    }
    if (!detectedPreviewRows?.length) {
      setError('No detected rows to apply.')
      return
    }
    if (sheetMergeMode === 'replace-manual' && !confirmReplaceManual) {
      setError('Confirm manual row replacement before applying this mode.')
      return
    }
    if (applyingDetectedRows) return
    setApplyingDetectedRows(true)
    try {
      const freshBackup = getBackupData() || backup
      await mergeDetectedSheetIndexRows(
        freshBackup,
        selectedItem.id,
        detectedPreviewRows,
        sheetMergeMode,
        { confirmReplaceManual }
      )
      const freshLibrary = getOperationsBlueprintLibrary(getBackupData() || freshBackup)
      setLibrary(freshLibrary)
      setDetectedPreviewRows(null)
      setDetectionProgress(null)
      setConfirmReplaceManual(false)
      setSheetMergeMode('fill-empty')
      setSuccess('Detected sheet labels applied.')
    } catch (e: any) {
      setError(e?.message || 'Failed to apply detected labels.')
    } finally {
      setApplyingDetectedRows(false)
    }
  }

  async function handleExportAnnotatedPdf() {
    setError(null)
    setSuccess(null)
    if (!selectedItem) {
      setError('Select a blueprint set first.')
      return
    }
    if (!selectedItem.storagePath) {
      setError('Selected blueprint is missing storagePath.')
      return
    }
    if (exportingPdf) return

    const backupNow = getBackupData() || backup
    const allAnns = Array.isArray(backupNow?.blueprintSummaries?.operationsBlueprintAnnotations?.[selectedItem.id])
      ? backupNow.blueprintSummaries.operationsBlueprintAnnotations[selectedItem.id]
      : []
    if (!allAnns.length) {
      setError('No annotations available to export for this blueprint set.')
      return
    }
    if (exportMode === 'all-pages' && Number(selectedItem.fileSize || 0) > 100 * 1024 * 1024) {
      setSuccess('Large file warning: all-pages export may take longer for large blueprint sets.')
    }

    setExportingPdf(true)
    try {
      const result = await exportAnnotatedBlueprintPdf({
        blueprint: selectedItem,
        annotations: allAnns,
        mode: exportMode,
      })
      if (result.warning) setSuccess(`Exported ${result.fileName}. ${result.warning}`)
      else setSuccess(`Exported ${result.fileName}.`)
    } catch (e: any) {
      setError(e?.message || 'Failed to export annotated PDF.')
    } finally {
      setExportingPdf(false)
    }
  }

  async function handleCreateDerivedSet() {
    setError(null)
    setSuccess(null)
    if (!selectedItem) {
      setError('Select a source blueprint set first.')
      return
    }
    if (!selectedItem.storagePath) {
      setError('Selected blueprint is missing storagePath.')
      return
    }
    if (!derivedTitle.trim()) {
      setError('Derived set title is required.')
      return
    }
    if (selectedPages.length < 1) {
      setError('Select at least one page for the derived set.')
      return
    }
    if (selectedPages.length > MAX_DERIVED_SELECTION_PAGES) {
      setError(`You can select up to ${MAX_DERIVED_SELECTION_PAGES} pages for MVP.`)
      return
    }
    if (creatingDerived) return

    setCreatingDerived(true)
    try {
      const derivedItem = await createDerivedBlueprintSet({
        sourceBlueprint: selectedItem,
        selectedPageNumbers: selectedPages,
        title: derivedTitle.trim(),
        type: derivedType,
      })

      const next = [derivedItem, ...library]
      await persist(next)
      setSelectedId(derivedItem.id)
      setSelectedPages([])
      setDerivedTitle('')
      setDerivedType('Electrical Only')
      setSuccess('Derived blueprint set created successfully.')
    } catch (e: any) {
      setError(e?.message || 'Failed to create derived set. If upload succeeded but metadata sync failed, retry and verify library sync.')
    } finally {
      setCreatingDerived(false)
    }
  }

  return (
    <div className="w-full max-w-none min-w-0 px-6 py-6 flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <FileText size={18} className="text-green-400" />
        <h1 className="text-lg font-semibold text-gray-100">Blueprint AI</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border p-4" style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Blueprint Totals</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-400">Total Prints Uploaded</span><span className="text-gray-100 font-semibold">{totals.uploaded}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Total Prints Active</span><span className="text-green-300 font-semibold">{totals.active}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Total Prints Archived</span><span className="text-gray-300 font-semibold">{totals.archived}</span></div>
          </div>
        </div>

        <div className="rounded-xl border p-4" style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Open Blueprint Set</p>
          {selectedItem ? (
            <div className="space-y-2 text-sm">
              <div><p className="text-gray-500">Blueprint Title</p><p className="text-gray-100 font-semibold">{selectedItem.title}</p></div>
              <div><p className="text-gray-500">Linked Project Name</p><p className="text-gray-200">{selectedItem.projectName}</p></div>
              <div className="flex justify-between"><span className="text-gray-400">Pages Total</span><span className="text-gray-100">{selectedItem.pageCount || 0}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Pages With Notes or Highlights</span><span className="text-gray-100">{selectedAnnotationSummary.pagesWithAnnotations}</span></div>
              <div className="pt-1">
                <span className={`text-xs px-2 py-1 rounded-md border ${statusPill(selectedItem.status)}`}>
                  Status: {selectedItem.status === 'active' ? 'Active' : 'Archived'}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No blueprint set selected.</p>
          )}
        </div>

        <div className="rounded-xl border p-4" style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Sheet Breakdown / Study Index</p>
          {selectedItem ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-gray-200">{selectedItem.projectName}</p>
                <button
                  onClick={() => openSheetEditor()}
                  className="text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 hover:text-white"
                >
                  Add Sheet Label
                </button>
              </div>
              <div className="text-xs text-gray-500">Rows: {sheetSummary.total}</div>
              <input
                value={sheetSearch}
                onChange={(e) => setSheetSearch(e.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-900/50 text-gray-100 text-xs px-2 py-1"
                placeholder="Search page, sheet #, title, discipline..."
              />
              <div className="rounded border border-gray-800 p-2 space-y-2">
                <div className="text-xs text-gray-400">Auto Detect Sheet Index</div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={detectionRangeMode}
                    onChange={(e) => setDetectionRangeMode(e.target.value as any)}
                    className="rounded border border-gray-700 bg-gray-900/50 text-gray-100 text-xs px-2 py-1"
                  >
                    <option value="first30">First 30 Pages</option>
                    <option value="current">Current Page</option>
                    <option value="custom">Custom Range</option>
                    <option value="all">All Pages</option>
                  </select>
                  <button
                    disabled={detectingSheets || !selectedItem?.storagePath}
                    onClick={() => void handleAutoDetectSheetIndex()}
                    className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-200 disabled:opacity-50"
                  >
                    {detectingSheets ? 'Detecting...' : 'Auto Detect'}
                  </button>
                </div>
                {detectionRangeMode === 'custom' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, Number(selectedItem?.pageCount || 1))}
                      value={customRangeStart}
                      onChange={(e) => setCustomRangeStart(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                      className="rounded border border-gray-700 bg-gray-900/50 text-gray-100 text-xs px-2 py-1"
                      placeholder="Start"
                    />
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, Number(selectedItem?.pageCount || 1))}
                      value={customRangeEnd}
                      onChange={(e) => setCustomRangeEnd(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                      className="rounded border border-gray-700 bg-gray-900/50 text-gray-100 text-xs px-2 py-1"
                      placeholder="End"
                    />
                  </div>
                )}
                {detectionRangeMode === 'all' && (
                  <div className="text-[11px] text-amber-300">
                    All-pages detection may be slower for large plan sets.
                  </div>
                )}
                {detectionProgress && detectingSheets && (
                  <div className="text-[11px] text-blue-300">
                    Processing page {detectionProgress.pageNumber} ({detectionProgress.processed}/{detectionProgress.total})
                  </div>
                )}
              </div>
              {filteredSheetRows.length > 0 ? (
                <div className="max-h-44 overflow-auto border rounded-md border-gray-800 divide-y divide-gray-800">
                  {filteredSheetRows.map((s) => (
                    <div key={s.pageNumber} className="text-xs px-2 py-2 text-gray-300 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate">
                          Pg {s.pageNumber} - {s.sheetNumber || s.sheetLabel || '(no #)'} - {s.sheetTitle || '(no title)'}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setCurrentViewerPage(s.pageNumber)}
                            className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300"
                          >
                            Jump
                          </button>
                          <button
                            onClick={() => openSheetEditor(s)}
                            className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => void deleteSheetRow(s.pageNumber)}
                            className="px-1.5 py-0.5 rounded border border-red-800/50 text-red-300"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">{s.discipline || 'General'}</span>
                        {(selectedAnnotationSummary.byPage[s.pageNumber] || 0) > 0 && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-900/30 border border-blue-800/40 text-blue-300">
                            {selectedAnnotationSummary.byPage[s.pageNumber]} notes
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-gray-500 border border-dashed border-gray-700 rounded-md p-3">
                  No sheet labels yet. Add manual labels to organize pages.
                </div>
              )}
              {detectedPreviewRows && (
                <div className="border border-blue-900/40 rounded-md p-2 space-y-2">
                  <div className="text-xs text-blue-300">Auto-detect preview ({detectedPreviewRows.length} rows)</div>
                  {detectedPreviewRows.length > 0 ? (
                    <div className="max-h-40 overflow-auto border border-gray-800 rounded divide-y divide-gray-800">
                      {detectedPreviewRows.map((r) => (
                        <div key={`${r.pageNumber}-${r.sheetNumber || ''}`} className="text-xs px-2 py-1 text-gray-300">
                          Pg {r.pageNumber} - {r.sheetNumber || '(no #)'} - {r.sheetTitle || '(no title)'} - {r.discipline || 'General'} - {r.confidence}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">No candidates detected in selected range.</div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <select
                      value={sheetMergeMode}
                      onChange={(e) => setSheetMergeMode(e.target.value as any)}
                      className="rounded border border-gray-700 bg-gray-900/50 text-gray-100 text-xs px-2 py-1"
                    >
                      <option value="fill-empty">Fill Empty Only</option>
                      <option value="replace-auto">Replace Auto Rows</option>
                      <option value="replace-manual">Replace Manual Rows</option>
                    </select>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={applyingDetectedRows || detectedPreviewRows.length === 0}
                        onClick={() => void applyDetectedSheetRows()}
                        className="text-xs px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                      >
                        {applyingDetectedRows ? 'Applying...' : 'Apply Detected Labels'}
                      </button>
                      <button
                        onClick={cancelDetectedPreview}
                        className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  {sheetMergeMode === 'replace-manual' && (
                    <label className="flex items-center gap-2 text-[11px] text-amber-300">
                      <input
                        type="checkbox"
                        checked={confirmReplaceManual}
                        onChange={(e) => setConfirmReplaceManual(e.target.checked)}
                      />
                      I confirm replacing manual rows.
                    </label>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Select a blueprint set to view its study index.</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-gray-200">Export Annotated PDF</p>
          <span className="text-xs text-gray-500">Local download only</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Export Mode</label>
            <select
              value={exportMode}
              onChange={(e) => setExportMode(e.target.value as 'annotated-pages' | 'all-pages')}
              className="w-full rounded-lg border border-gray-700 bg-gray-900/50 text-gray-100 text-sm px-3 py-2"
              disabled={exportingPdf}
            >
              <option value="annotated-pages">Annotated Pages Only</option>
              <option value="all-pages">All Pages</option>
            </select>
          </div>
          <div className="md:col-span-2 flex items-end">
            <button
              onClick={() => void handleExportAnnotatedPdf()}
              disabled={exportingPdf || !selectedItem}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60"
            >
              {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : null}
              {exportingPdf ? 'Exporting...' : 'Export Annotated PDF'}
            </button>
          </div>
        </div>
        {selectedItem && selectedAnnotationSummary.total === 0 && (
          <p className="text-xs text-amber-300">
            This blueprint has no notes/highlights yet. Add annotations before exporting.
          </p>
        )}
      </div>

      <div className="rounded-xl border p-5 flex flex-col gap-4" style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}>
        <p className="text-xs text-gray-500 uppercase tracking-wide">Upload Blueprint</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Select Project</label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900/50 text-gray-100 text-sm px-3 py-2"
            >
              <option value="">Select a project</option>
              {projects.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name || p.id}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Blueprint Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900/50 text-gray-100 text-sm px-3 py-2"
              placeholder="Example: Riverside Main Panel Set"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Blueprint Type</label>
            <select
              value={bpType}
              onChange={(e) => setBpType(e.target.value as BlueprintLibraryType)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900/50 text-gray-100 text-sm px-3 py-2"
            >
              {BLUEPRINT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Upload PDF</label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900/50 text-gray-100 text-sm px-3 py-2"
            />
            <p className="text-xs text-gray-500 mt-1">Max size: {formatBytes(MAX_BLUEPRINT_FILE_SIZE_BYTES)}</p>
          </div>
        </div>

        {file && (
          <div className="text-xs text-gray-400">
            Selected file: <span className="text-gray-200">{file.name}</span> ({formatBytes(file.size)})
          </div>
        )}

        {error && <div className="text-sm text-red-300 bg-red-900/20 border border-red-800/40 rounded-md px-3 py-2">{error}</div>}
        {success && <div className="text-sm text-green-300 bg-green-900/20 border border-green-800/40 rounded-md px-3 py-2">{success}</div>}

        <button
          onClick={handleUpload}
          disabled={uploading}
          className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold bg-green-600 hover:bg-green-500 text-white disabled:opacity-60"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {uploading ? 'Uploading...' : 'Upload Blueprint'}
        </button>
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}>
        <div className="px-4 py-3 border-b border-gray-800 text-sm font-semibold text-gray-200">Blueprint Library</div>
        {library.length === 0 ? (
          <div className="px-4 py-8 text-sm text-gray-500">No blueprint sets uploaded yet.</div>
        ) : (
          <div className="divide-y divide-gray-800">
            {library.map((item) => (
              <div key={item.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <button onClick={() => setSelectedId(item.id)} className="text-left flex-1 min-w-0">
                  <p className="text-sm text-gray-100 font-medium truncate">{item.title}</p>
                  <p className="text-xs text-gray-500 truncate">{item.projectName} • {item.type} • {item.fileName}</p>
                </button>
                <span className={`text-xs px-2 py-1 rounded-md border ${statusPill(item.status)}`}>
                  {item.status === 'active' ? 'Active' : 'Archived'}
                </span>
                {item.status === 'active' ? (
                  <button
                    onClick={() => setArchiveState(item, true)}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 hover:text-white"
                  >
                    <Archive size={12} />
                    Archive
                  </button>
                ) : (
                  <button
                    onClick={() => setArchiveState(item, false)}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 hover:text-white"
                  >
                    <RotateCcw size={12} />
                    Restore
                  </button>
                )}
                {selectedId === item.id && <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="w-full max-w-none min-w-0">
        <div className="mb-2 text-sm font-semibold text-gray-200">Blueprint Viewer</div>
        <OperationsBlueprintPdfViewer
          blueprint={selectedItem}
          onAnnotationsChanged={() => setAnnotationRefreshToken((v) => v + 1)}
          externalPage={currentViewerPage}
          onPageChange={(page) => setCurrentViewerPage(page)}
          selectedPageNumbers={selectedPages}
          onSelectedPagesChange={(pages) => {
            const clean = Array.isArray(pages)
              ? pages.map((p) => Math.floor(Number(p))).filter((p) => Number.isFinite(p) && p >= 1)
              : []
            const seen = new Set<number>()
            const ordered: number[] = []
            for (const p of clean) {
              if (seen.has(p)) continue
              seen.add(p)
              ordered.push(p)
            }
            setSelectedPages(ordered)
          }}
        />
      </div>

      <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-gray-200">Selected Pages for Derived Set</p>
          <div className="text-xs text-gray-400">
            {selectedPages.length} selected (max {MAX_DERIVED_SELECTION_PAGES})
          </div>
        </div>

        {selectedPages.length === 0 ? (
          <div className="text-xs text-gray-500">Use “Add Current Page” in the viewer to build a focused page set.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selectedPages.map((p) => (
              <button
                key={p}
                onClick={() => removeSelectedPage(p)}
                className="text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-200 hover:bg-gray-800"
              >
                Page {p} ×
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={clearSelectedPages}
            disabled={selectedPages.length === 0}
            className="text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-300 disabled:opacity-50"
          >
            Clear Selection
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="text-xs text-gray-500 block mb-1">Derived Set Title</label>
            <input
              value={derivedTitle}
              onChange={(e) => setDerivedTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900/50 text-gray-100 text-sm px-3 py-2"
              placeholder="Example: Electrical Focused"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Derived Set Type</label>
            <select
              value={derivedType}
              onChange={(e) => setDerivedType(e.target.value as BlueprintLibraryType)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900/50 text-gray-100 text-sm px-3 py-2"
            >
              {BLUEPRINT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div>
          <button
            onClick={handleCreateDerivedSet}
            disabled={creatingDerived || selectedPages.length < 1 || selectedPages.length > MAX_DERIVED_SELECTION_PAGES || !selectedItem}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60"
          >
            {creatingDerived ? <Loader2 size={14} className="animate-spin" /> : null}
            {creatingDerived ? 'Creating Derived Set...' : 'Create Derived Set'}
          </button>
        </div>
      </div>

      {sheetEditorOpen && (
        <div className="fixed inset-0 z-40 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-800 bg-[#0d0e14] p-4 space-y-3">
            <div className="text-sm font-semibold text-gray-100">Sheet Label Editor</div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Page Number</label>
              <input
                type="number"
                min={1}
                max={Math.max(1, Number(selectedItem?.pageCount || 1))}
                value={sheetEditor.pageNumber}
                onChange={(e) => setSheetEditor((prev) => ({ ...prev, pageNumber: Math.floor(Number(e.target.value) || 1) }))}
                className="w-full rounded border border-gray-700 bg-gray-900/50 text-gray-100 text-sm px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Sheet Number</label>
              <input
                value={sheetEditor.sheetNumber}
                onChange={(e) => setSheetEditor((prev) => ({ ...prev, sheetNumber: e.target.value }))}
                className="w-full rounded border border-gray-700 bg-gray-900/50 text-gray-100 text-sm px-3 py-2"
                placeholder="E1.0"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Sheet Title</label>
              <input
                value={sheetEditor.sheetTitle}
                onChange={(e) => setSheetEditor((prev) => ({ ...prev, sheetTitle: e.target.value }))}
                className="w-full rounded border border-gray-700 bg-gray-900/50 text-gray-100 text-sm px-3 py-2"
                placeholder="Electrical Cover Sheet"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Discipline</label>
              <select
                value={sheetEditor.discipline}
                onChange={(e) => setSheetEditor((prev) => ({ ...prev, discipline: e.target.value }))}
                className="w-full rounded border border-gray-700 bg-gray-900/50 text-gray-100 text-sm px-3 py-2"
              >
                {DISCIPLINES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setSheetEditorOpen(false)}
                className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300"
              >
                Cancel
              </button>
              <button
                disabled={savingSheet}
                onClick={() => void saveSheetEditor()}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-60"
              >
                {savingSheet ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

