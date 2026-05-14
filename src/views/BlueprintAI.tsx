// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, CheckCircle2, FileText, Loader2, RotateCcw, Trash2, Upload } from 'lucide-react'
import { getBackupData } from '@/services/backupDataService'
import OperationsBlueprintPdfViewer from '@/components/blueprint/OperationsBlueprintPdfViewer'
import {
  cleanupBlueprintStorageObject,
  createBlueprintLibraryItem,
  deleteBlueprintStorageObjectStrict,
  deleteOperationsBlueprintSet,
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
  cleanupDerivedBlueprintStorageObject,
  createDerivedBlueprintSet,
  MAX_DERIVED_SELECTION_PAGES,
} from '@/services/blueprintDerivedSetService'
import { exportAnnotatedBlueprintPdf } from '@/services/blueprintAnnotationExportService'
import BlueprintVRExperiencePanel from '@/features/blueprint-vr/BlueprintVRExperiencePanel'
import type { BlueprintActivePageScanSnapshot } from '@/features/blueprint-vr/blueprintPlanScanner'
import { useBlueprintVRGeneration } from '@/features/blueprint-vr/useBlueprintVRGeneration'
import { createBlueprintVRSceneManifest } from '@/features/blueprint-vr/sceneManifestBuilder'
import { STAGE_ORDER } from '@/features/blueprint-vr/stages'
import type { BlueprintVRSourceSet } from '@/features/blueprint-vr/blueprintPlanScanner'

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
  const [activePageScanSnapshot, setActivePageScanSnapshot] = useState<BlueprintActivePageScanSnapshot | null>(null)
  const [viewerJumpPage, setViewerJumpPage] = useState<number | null>(null)
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
  const [detectionRangeMode, setDetectionRangeMode] = useState<'current' | 'custom' | 'all'>('all')
  const [customRangeStart, setCustomRangeStart] = useState(1)
  const [customRangeEnd, setCustomRangeEnd] = useState(30)
  const [detectedPreviewRows, setDetectedPreviewRows] = useState<DetectedSheetIndexRow[] | null>(null)
  const [sheetMergeMode, setSheetMergeMode] = useState<'fill-empty' | 'replace-auto' | 'replace-manual'>('fill-empty')
  const [confirmReplaceManual, setConfirmReplaceManual] = useState(false)
  const [applyingDetectedRows, setApplyingDetectedRows] = useState(false)
  const [exportMode, setExportMode] = useState<'annotated-pages' | 'all-pages'>('annotated-pages')
  const [exportingPdf, setExportingPdf] = useState(false)
  const [deletingBlueprintId, setDeletingBlueprintId] = useState<string | null>(null)
  const [libraryModalOpen, setLibraryModalOpen] = useState(false)
  const [sheetIndexModalOpen, setSheetIndexModalOpen] = useState(false)
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false)
  const [exportPanelOpen, setExportPanelOpen] = useState(false)
  const [derivedPanelOpen, setDerivedPanelOpen] = useState(false)
  const [libraryProjectFilter, setLibraryProjectFilter] = useState<string>('all')
  const [librarySearch, setLibrarySearch] = useState('')
  const [vrPanelOpen, setVrPanelOpen] = useState(false)
  const [vrGeneratingError, setVrGeneratingError] = useState<string | null>(null)
  const [vrSourceSetIdByProject, setVrSourceSetIdByProject] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const vrState = useBlueprintVRGeneration()

  const selectedItem = library.find(x => x.id === selectedId) || null
  const totals = useMemo(() => {
    const uploaded = library.length
    const active = library.filter(x => x.status === 'active').length
    const archived = library.filter(x => x.status === 'archived').length
    const projectArchived = projects.filter((p: any) =>
      p?.status === 'archived' || p?.archived === true || !!p?.archivedAt
    ).length
    const projectActive = Math.max(0, projects.length - projectArchived)
    return { uploaded, active, archived, projectActive, projectArchived }
  }, [library, projects])

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

  const selectedProjectSetCount = useMemo(() => {
    if (!selectedItem?.projectId) return 0
    return library.filter((item) => item.projectId === selectedItem.projectId).length
  }, [library, selectedItem?.projectId])

  // Build a BlueprintVRSourceSet[] for the currently-selected project so the
  // Generate VR experience can offer source-set selection.
  const projectVRSourceSets = useMemo<BlueprintVRSourceSet[]>(() => {
    if (!selectedItem?.projectId) return []
    const projectItems = library.filter(
      (item) => item.projectId === selectedItem.projectId && item.status !== 'archived',
    )
    return projectItems.map((item) => {
      const sheetIndex = getBlueprintSheetIndex(item) || []
      return {
        id: item.id,
        name: item.title || item.fileName || 'Untitled Set',
        type: item.type,
        projectId: item.projectId,
        projectName: item.projectName,
        filePath: item.storagePath || item.fileName,
        totalPages: Number(item.pageCount || 0),
        sheets: sheetIndex.map((row: any) => ({
          pageNumber: Number(row.pageNumber || 0),
          sheetNumber: row.sheetNumber,
          sheetTitle: row.sheetTitle,
          sheetLabel: row.sheetLabel,
          label: row.sheetLabel || row.sheetNumber,
          discipline: row.discipline,
          fileName: item.fileName,
          sourceSetName: item.title,
          sourceSetType: item.type,
          blueprintTitle: item.title,
        })),
      }
    })
  }, [library, selectedItem?.projectId])

  // Determine the current VR source set id: explicit user choice for this
  // project → otherwise auto-pick a Full Set when available.
  const currentVRSourceSetId = useMemo<string | null>(() => {
    if (!selectedItem?.projectId) return null
    const explicit = vrSourceSetIdByProject[selectedItem.projectId]
    if (explicit && projectVRSourceSets.some((s) => s.id === explicit)) return explicit
    const fullSet = projectVRSourceSets.find((s) =>
      (s.type || '').toLowerCase().includes('full set'),
    )
    return fullSet?.id || projectVRSourceSets[0]?.id || null
  }, [projectVRSourceSets, vrSourceSetIdByProject, selectedItem?.projectId])
  const currentVRSourceSet = useMemo(
    () => projectVRSourceSets.find((s) => s.id === currentVRSourceSetId) || null,
    [projectVRSourceSets, currentVRSourceSetId],
  )

  const runtimeSourceIdentity = useMemo(() => ({
    projectId: selectedItem?.projectId,
    blueprintId: selectedItem?.id,
    sourceSetId: selectedItem?.id,
    sourceSetName: selectedItem?.title || selectedItem?.fileName || currentVRSourceSet?.name,
    fileName: selectedItem?.fileName || selectedItem?.storagePath || selectedItem?.title || currentVRSourceSet?.filePath,
    currentPageNumber: currentViewerPage,
    pageCount: Number(selectedItem?.pageCount || currentVRSourceSet?.totalPages || 0) || undefined,
  }), [
    selectedItem?.projectId,
    selectedItem?.id,
    selectedItem?.title,
    selectedItem?.fileName,
    selectedItem?.storagePath,
    selectedItem?.pageCount,
    currentVRSourceSet?.name,
    currentVRSourceSet?.filePath,
    currentVRSourceSet?.totalPages,
    currentViewerPage,
  ])

  const filteredLibraryItems = useMemo(() => {
    const q = librarySearch.trim().toLowerCase()
    return library.filter((item) => {
      const matchesProject = libraryProjectFilter === 'all' || item.projectId === libraryProjectFilter
      const haystack = `${item.title || ''} ${item.projectName || ''} ${item.type || ''} ${item.fileName || ''}`.toLowerCase()
      const matchesSearch = !q || haystack.includes(q)
      return matchesProject && matchesSearch
    })
  }, [library, libraryProjectFilter, librarySearch])

  useEffect(() => {
    setSelectedPages([])
    setDetectedPreviewRows(null)
    setDetectionProgress(null)
    setSheetSearch('')
  }, [selectedId])

  async function persist(next: BlueprintLibraryItem[]) {
    await saveOperationsBlueprintLibrary(backup, next)
    const freshBackup = getBackupData() || backup
    setLibrary(getOperationsBlueprintLibrary(freshBackup))
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
    let uploadedStoragePath: string | null = null
    try {
      const { storagePath } = await uploadBlueprintPdfToStorage({
        file,
        projectId: selectedProjectId,
        orgId,
      })
      uploadedStoragePath = storagePath

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
      if (uploadedStoragePath) {
        await cleanupBlueprintStorageObject(uploadedStoragePath)
      }
      const freshBackup = getBackupData() || backup
      setLibrary(getOperationsBlueprintLibrary(freshBackup))
      setError(e?.message || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function setArchiveState(item: BlueprintLibraryItem, archived: boolean) {
    setError(null)
    setSuccess(null)
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
    try {
      await persist(next)
      setSuccess(`Blueprint ${archived ? 'archived' : 'restored'} successfully.`)
    } catch (e: any) {
      const freshLibrary = getOperationsBlueprintLibrary(getBackupData() || backup)
      setLibrary(freshLibrary)
      setError(e?.message || `Failed to ${archived ? 'archive' : 'restore'} blueprint.`)
    }
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
        maxPages: undefined,
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
    let derivedStoragePath: string | null = null
    try {
      const derivedItem = await createDerivedBlueprintSet({
        sourceBlueprint: selectedItem,
        selectedPageNumbers: selectedPages,
        title: derivedTitle.trim(),
        type: derivedType,
      })
      derivedStoragePath = derivedItem.storagePath

      const next = [derivedItem, ...library]
      await persist(next)
      setSelectedId(derivedItem.id)
      setSelectedPages([])
      setDerivedTitle('')
      setDerivedType('Electrical Only')
      setSuccess('Derived blueprint set created successfully.')
    } catch (e: any) {
      if (derivedStoragePath) {
        await cleanupDerivedBlueprintStorageObject(derivedStoragePath)
      }
      const freshLibrary = getOperationsBlueprintLibrary(getBackupData() || backup)
      setLibrary(freshLibrary)
      setError(e?.message || 'Failed to create derived set. If upload succeeded but metadata sync failed, retry and verify library sync.')
    } finally {
      setCreatingDerived(false)
    }
  }

  async function handleDeleteBlueprintSet(item: BlueprintLibraryItem) {
    setError(null)
    setSuccess(null)
    if (!item?.id) return
    if (deletingBlueprintId) return

    const hasDerivedChildren = library.some((x) => x.parentBlueprintSetId === item.id)
    const confirmMessage =
      `Permanently delete blueprint set "${item.title}"? This will remove the PDF file, annotations, sheet index, and library record. This cannot be undone.` +
      (hasDerivedChildren ? `\n\nDerived sets will remain, but this original set will be deleted.` : '')

    const confirmed = window.confirm(confirmMessage)
    if (!confirmed) return

    setDeletingBlueprintId(item.id)
    let storageWarning: string | null = null
    let storageDeleted = false
    try {
      if (item.storagePath) {
        await deleteBlueprintStorageObjectStrict(item.storagePath)
        storageDeleted = true
      } else {
        storageWarning = 'Warning: storagePath missing. Metadata was deleted, but storage file path was unavailable for cleanup.'
        console.warn('[BlueprintAI] Delete requested for item with missing storagePath:', item.id)
      }

      await deleteOperationsBlueprintSet(backup, item.id)
      const freshBackup = getBackupData() || backup
      const freshLibrary = getOperationsBlueprintLibrary(freshBackup)
      setLibrary(freshLibrary)

      if (selectedId === item.id) {
        const nextSelected = freshLibrary.find((x) => x.status === 'active')?.id || freshLibrary[0]?.id || ''
        setSelectedId(nextSelected)
        setCurrentViewerPage(1)
      }

      setSelectedPages([])
      setDetectedPreviewRows(null)
      setDetectionProgress(null)
      setSheetSearch('')

      setSuccess(storageWarning || 'Blueprint set deleted permanently.')
    } catch (e: any) {
      const freshBackup = getBackupData() || backup
      const freshLibrary = getOperationsBlueprintLibrary(freshBackup)
      setLibrary(freshLibrary)
      if (storageDeleted) {
        setError(`Blueprint PDF was deleted from storage, but metadata deletion failed to sync: ${e?.message || 'Unknown error'}`)
      } else {
        setError(e?.message || 'Failed to delete blueprint set.')
      }
    } finally {
      setDeletingBlueprintId(null)
    }
  }

  function getAnnotationTotalForLibraryItem(item: BlueprintLibraryItem) {
    if (!item?.id) return 0
    const freshBackup = getBackupData() || backup
    return getOperationsBlueprintAnnotationSummary(freshBackup, item.id).total || 0
  }

  function openLibraryItem(item: BlueprintLibraryItem) {
    setSelectedId(item.id)
    setCurrentViewerPage(1)
    setLibraryModalOpen(false)
  }

  function jumpToSheetPage(pageNumber: number) {
    const maxPage = Math.max(1, Number(selectedItem?.pageCount || 1))
    const page = Math.max(1, Math.min(maxPage, Math.floor(Number(pageNumber) || 1)))

    setCurrentViewerPage(page)
    setViewerJumpPage(null)
    setSheetIndexModalOpen(false)

    window.requestAnimationFrame(() => {
      setViewerJumpPage(page)
    })
  }

  async function handleGenerateVR() {
    setVrGeneratingError(null)
    
    if (!selectedItem) {
      setVrGeneratingError('Select a blueprint set first.')
      return
    }

    try {
      // Create the scene manifest from selected blueprint
      const manifest = createBlueprintVRSceneManifest({
        projectId: selectedItem.projectId || 'unknown',
        projectName: selectedItem.projectName || selectedItem.title || 'Unknown Project',
        discipline: 'electrical',
        stages: STAGE_ORDER,
        sourceBlueprints: [
          {
            id: selectedItem.id,
            name: selectedItem.title,
            filePath: selectedItem.storagePath,
            fileSize: selectedItem.fileSize,
            uploadedAt: selectedItem.uploadedAt,
            format: 'pdf',
          },
        ],
        qualityProfile: 'standard',
      })

      // Start the VR generation (manifest attached immediately so panel has data on open)
      vrState.startGeneration({
        projectId: selectedItem.projectId,
        projectName: selectedItem.projectName || selectedItem.title,
        sourceBlueprints: [
          {
            id: selectedItem.id,
            name: selectedItem.title,
          },
        ],
        stages: STAGE_ORDER,
        outputManifest: manifest,
      })

      // Open the VR panel
      setVrPanelOpen(true)
    } catch (e: any) {
      setVrGeneratingError(e?.message || 'Failed to generate VR experience.')
    }
  }

  return (
    <div className="w-full max-w-none min-w-0 px-6 py-6 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-green-400" />
          <h1 className="text-lg font-semibold text-gray-100">Blueprint AI</h1>
        </div>
        {selectedItem && (
          <div className="hidden md:flex items-center gap-2 text-xs text-gray-500">
            <span>Current Set</span>
            <span className="px-2 py-1 rounded-md border border-gray-800 text-gray-200 bg-[#0d0e14]">
              {selectedItem.title}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border p-4" style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Blueprint / Project Totals</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-400">Total Prints Uploaded</span><span className="text-gray-100 font-semibold">{totals.uploaded}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Total Prints Active</span><span className="text-green-300 font-semibold">{totals.active}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Total Prints Archived</span><span className="text-gray-300 font-semibold">{totals.archived}</span></div>
            <div className="border-t border-gray-800 my-2" />
            <div className="flex justify-between"><span className="text-gray-400">Total Projects Active</span><span className="text-green-300 font-semibold">{totals.projectActive}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Total Projects Archived</span><span className="text-gray-300 font-semibold">{totals.projectArchived}</span></div>
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
              <div className="flex justify-between"><span className="text-gray-400">Sets Total</span><span className="text-gray-100">{selectedProjectSetCount}</span></div>
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
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-200 truncate">{selectedItem.projectName}</p>
                  <p className="text-xs text-gray-500">Rows: {sheetSummary.total}</p>
                </div>
                <button
                  onClick={() => setSheetIndexModalOpen(true)}
                  className="text-xs px-3 py-1.5 rounded-md border border-blue-700/70 text-blue-200 bg-blue-900/20 hover:bg-blue-900/30"
                >
                  Open Sheet Index
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => openSheetEditor()}
                  className="px-2 py-2 rounded-md border border-gray-700 text-gray-300 hover:text-white"
                >
                  Add Sheet Label
                </button>
                <button
                  disabled={detectingSheets || !selectedItem?.storagePath}
                  onClick={() => {
                    setSheetIndexModalOpen(true)
                    void handleAutoDetectSheetIndex()
                  }}
                  className="px-2 py-2 rounded-md border border-gray-700 text-gray-300 hover:text-white disabled:opacity-50"
                >
                  {detectingSheets ? 'Detecting...' : 'Auto Detect'}
                </button>
              </div>
              <div className="text-xs text-gray-500 border border-dashed border-gray-800 rounded-md p-2">
                Open the index modal to search, jump pages, edit labels, and apply detected sheet rows.
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Select a blueprint set to view its study index.</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border p-3" style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,1.25fr)_repeat(3,minmax(160px,0.75fr))] gap-3">
          <button
            onClick={() => setLibraryModalOpen(true)}
            className="group text-left rounded-xl border border-emerald-700/60 bg-emerald-950/20 hover:bg-emerald-950/35 px-4 py-3 min-h-[76px]"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-emerald-200">Blueprint Library Index</p>
                <p className="text-xs text-emerald-400/80 mt-1">
                  {totals.active} active sets - {library.reduce((sum, item) => sum + Number(item.pageCount || 0), 0)} pages - {selectedAnnotationSummary.total} current notes
                </p>
              </div>
              <span className="text-xs px-2 py-1 rounded-md border border-emerald-700/70 text-emerald-200 group-hover:text-white">
                Open
              </span>
            </div>
          </button>

          <button
            onClick={() => setUploadPanelOpen((v) => !v)}
            className={`rounded-xl border px-4 py-3 text-left ${uploadPanelOpen ? 'border-green-700 bg-green-950/20 text-green-200' : 'border-gray-800 text-gray-300 hover:text-white'}`}
          >
            <p className="text-sm font-semibold">Upload Blueprint</p>
            <p className="text-xs text-gray-500 mt-1">Add a new PDF set</p>
          </button>

          <button
            onClick={() => setExportPanelOpen((v) => !v)}
            className={`rounded-xl border px-4 py-3 text-left ${exportPanelOpen ? 'border-blue-700 bg-blue-950/20 text-blue-200' : 'border-gray-800 text-gray-300 hover:text-white'}`}
          >
            <p className="text-sm font-semibold">Export PDF</p>
            <p className="text-xs text-gray-500 mt-1">Download annotated file</p>
          </button>

          <button
            onClick={() => setDerivedPanelOpen((v) => !v)}
            className={`rounded-xl border px-4 py-3 text-left ${derivedPanelOpen ? 'border-purple-700 bg-purple-950/20 text-purple-200' : 'border-gray-800 text-gray-300 hover:text-white'}`}
          >
            <p className="text-sm font-semibold">Create Derived Set</p>
            <p className="text-xs text-gray-500 mt-1">{selectedPages.length} selected pages</p>
          </button>

          <button
            onClick={handleGenerateVR}
            disabled={!selectedItem}
            className={`rounded-xl border px-4 py-3 text-left ${!selectedItem ? 'border-gray-800/50 text-gray-600 cursor-not-allowed' : 'border-cyan-700 bg-cyan-950/20 text-cyan-200 hover:bg-cyan-950/35'}`}
          >
            <p className="text-sm font-semibold">Generate VR</p>
            <p className="text-xs text-gray-500 mt-1">
              {(() => {
                const sourceSet = projectVRSourceSets.find((s) => s.id === currentVRSourceSetId)
                if (sourceSet) {
                  const tag = sourceSet.type || 'Set'
                  return `Source: ${tag} · ${sourceSet.name}`
                }
                if (selectedItem) return 'Source: current set (inferred)'
                return '3D construction landscape'
              })()}
            </p>
          </button>
        </div>
      </div>

      {(error || success) && (
        <div className="space-y-2">
          {error && <div className="text-sm text-red-300 bg-red-900/20 border border-red-800/40 rounded-md px-3 py-2">{error}</div>}
          {success && <div className="text-sm text-green-300 bg-green-900/20 border border-green-800/40 rounded-md px-3 py-2">{success}</div>}
        </div>
      )}

      {exportPanelOpen && (
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
      )}

      {uploadPanelOpen && (
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

          <button
            onClick={handleUpload}
            disabled={uploading}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold bg-green-600 hover:bg-green-500 text-white disabled:opacity-60"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? 'Uploading...' : 'Upload Blueprint'}
          </button>
        </div>
      )}

      <div className="w-full max-w-none min-w-0">
        <div className="mb-2 text-sm font-semibold text-gray-200">Blueprint Viewer</div>
        <OperationsBlueprintPdfViewer
          blueprint={selectedItem}
          onAnnotationsChanged={() => setAnnotationRefreshToken((v) => v + 1)}
          externalPage={viewerJumpPage ?? undefined}
          onPageChange={(page) => {
            setCurrentViewerPage(page)
            if (viewerJumpPage === page) setViewerJumpPage(null)
          }}
          onActivePageScanSnapshotChange={setActivePageScanSnapshot}
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

      {derivedPanelOpen && (
        <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-gray-200">Selected Pages for Derived Set</p>
            <div className="text-xs text-gray-400">
              {selectedPages.length} selected (max {MAX_DERIVED_SELECTION_PAGES})
            </div>
          </div>

          {selectedPages.length === 0 ? (
            <div className="text-xs text-gray-500">Use Add Current Page in the viewer to build a focused page set.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedPages.map((p) => (
                <button
                  key={p}
                  onClick={() => removeSelectedPage(p)}
                  className="text-xs px-2 py-1 rounded-md border border-gray-700 text-gray-200 hover:bg-gray-800"
                >
                  Page {p} x
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
      )}

      {libraryModalOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl max-h-[86vh] rounded-xl border border-gray-800 bg-[#0d0e14] shadow-2xl flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-100">Blueprint Library Index</p>
                <p className="text-xs text-gray-500">Open, archive, restore, or delete plan sets by project.</p>
              </div>
              <button
                onClick={() => setLibraryModalOpen(false)}
                className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="p-4 border-b border-gray-800 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Project</label>
                <select
                  value={libraryProjectFilter}
                  onChange={(e) => setLibraryProjectFilter(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-900/50 text-gray-100 text-sm px-3 py-2"
                >
                  <option value="all">All Projects</option>
                  {projects.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name || p.id}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-500 block mb-1">Search Sets</label>
                <input
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-900/50 text-gray-100 text-sm px-3 py-2"
                  placeholder="Search title, project, type, or file..."
                />
              </div>
            </div>

            <div className="overflow-auto p-4 space-y-3">
              {filteredLibraryItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-700 p-6 text-sm text-gray-500">
                  No blueprint sets match this project/search filter.
                </div>
              ) : (
                filteredLibraryItems.map((item) => {
                  const annTotal = getAnnotationTotalForLibraryItem(item)
                  const isSelected = selectedId === item.id
                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border p-4 ${isSelected ? 'border-emerald-700/70 bg-emerald-950/15' : 'border-gray-800 bg-[#10131c]'}`}
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <button onClick={() => openLibraryItem(item)} className="text-left flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-gray-100 font-semibold truncate">{item.title}</p>
                            {isSelected && <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />}
                          </div>
                          <p className="text-xs text-gray-500 truncate mt-1">{item.projectName} - {item.type} - {item.fileName}</p>
                          <div className="flex flex-wrap gap-2 mt-2 text-xs">
                            <span className="px-2 py-1 rounded border border-gray-700 text-gray-300">{item.pageCount || 0} pages</span>
                            <span className="px-2 py-1 rounded border border-gray-700 text-gray-300">{annTotal} annotations</span>
                            <span className={`px-2 py-1 rounded border ${statusPill(item.status)}`}>{item.status === 'active' ? 'Active' : 'Archived'}</span>
                          </div>
                        </button>
                        <div className="flex items-center gap-2 flex-wrap lg:justify-end">
                          <button
                            onClick={() => openLibraryItem(item)}
                            className="text-xs px-3 py-1.5 rounded-md border border-blue-700/70 text-blue-200 bg-blue-900/20"
                          >
                            Open
                          </button>
                          {item.status === 'active' ? (
                            <button
                              onClick={() => setArchiveState(item, true)}
                              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-gray-700 text-gray-300 hover:text-white"
                            >
                              <Archive size={12} /> Archive
                            </button>
                          ) : (
                            <button
                              onClick={() => setArchiveState(item, false)}
                              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-gray-700 text-gray-300 hover:text-white"
                            >
                              <RotateCcw size={12} /> Restore
                            </button>
                          )}
                          <button
                            onClick={() => void handleDeleteBlueprintSet(item)}
                            disabled={deletingBlueprintId === item.id}
                            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-red-800/60 text-red-300 hover:text-red-200 disabled:opacity-60"
                          >
                            {deletingBlueprintId === item.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {sheetIndexModalOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-6xl max-h-[88vh] rounded-xl border border-gray-800 bg-[#0d0e14] shadow-2xl flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-100">Sheet Index - {selectedItem?.title || 'No Set Selected'}</p>
                <p className="text-xs text-gray-500">Search sheets, auto-detect labels, edit rows, and jump the viewer to a page.</p>
              </div>
              <button
                onClick={() => setSheetIndexModalOpen(false)}
                className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="p-4 border-b border-gray-800 space-y-3">
              <div className="flex flex-col md:flex-row gap-3 md:items-end">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 block mb-1">Search Index</label>
                  <input
                    value={sheetSearch}
                    onChange={(e) => setSheetSearch(e.target.value)}
                    className="w-full rounded border border-gray-700 bg-gray-900/50 text-gray-100 text-sm px-3 py-2"
                    placeholder="Search page, sheet #, title, discipline..."
                  />
                </div>
                <button
                  onClick={() => openSheetEditor()}
                  className="text-xs px-3 py-2 rounded-md border border-gray-700 text-gray-300 hover:text-white"
                >
                  Add Sheet Label
                </button>
              </div>

              <div className="rounded border border-gray-800 p-3 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <div className="text-xs text-gray-400">Auto Detect Sheet Index</div>
                    <div className="text-[11px] text-gray-500">Rows: {sheetSummary.total}</div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[180px_140px] gap-2">
                    <select
                      value={detectionRangeMode}
                      onChange={(e) => setDetectionRangeMode(e.target.value as any)}
                      className="rounded border border-gray-700 bg-gray-900/50 text-gray-100 text-xs px-2 py-2"
                    >
                      <option value="all">All Pages</option>
                      <option value="current">Current Page</option>
                      <option value="custom">Custom Range</option>
                    </select>
                    <button
                      disabled={detectingSheets || !selectedItem?.storagePath}
                      onClick={() => void handleAutoDetectSheetIndex()}
                      className="text-xs px-2 py-2 rounded border border-gray-700 text-gray-200 disabled:opacity-50"
                    >
                      {detectingSheets ? 'Detecting...' : 'Auto Detect'}
                    </button>
                  </div>
                </div>
                {detectionRangeMode === 'custom' && (
                  <div className="grid grid-cols-2 gap-2 max-w-sm">
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
                  <div className="text-[11px] text-amber-300">All-pages detection may be slower for large plan sets.</div>
                )}
                {detectionProgress && detectingSheets && (
                  <div className="text-[11px] text-blue-300">
                    Processing page {detectionProgress.pageNumber} ({detectionProgress.processed}/{detectionProgress.total})
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-auto p-4 space-y-3">
              {filteredSheetRows.length > 0 ? (
                <div className="border rounded-md border-gray-800 divide-y divide-gray-800 overflow-hidden">
                  {filteredSheetRows.map((s) => (
                    <div key={s.pageNumber} className="text-xs px-3 py-3 text-gray-300 space-y-1 bg-[#10131c]">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                        <div className="truncate">
                          Pg {s.pageNumber} - {s.sheetNumber || s.sheetLabel || '(no #)'} - {s.sheetTitle || '(no title)'}
                        </div>
                        <div className="flex items-center gap-1 flex-wrap">
                          <button onClick={() => jumpToSheetPage(s.pageNumber)} className="px-2 py-1 rounded border border-blue-800/60 text-blue-300">Jump</button>
                          <button onClick={() => openSheetEditor(s)} className="px-2 py-1 rounded border border-gray-700 text-gray-300">Edit</button>
                          <button onClick={() => void deleteSheetRow(s.pageNumber)} className="px-2 py-1 rounded border border-red-800/50 text-red-300">Clear</button>
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
                <div className="text-xs text-gray-500 border border-dashed border-gray-700 rounded-md p-4">
                  No sheet labels yet. Add manual labels or run Auto Detect to organize pages.
                </div>
              )}

              {detectedPreviewRows && (
                <div className="border border-blue-900/40 rounded-md p-3 space-y-2">
                  <div className="text-xs text-blue-300">Auto-detect preview ({detectedPreviewRows.length} rows)</div>
                  {detectedPreviewRows.length > 0 ? (
                    <div className="max-h-56 overflow-auto border border-gray-800 rounded divide-y divide-gray-800">
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
                      <button onClick={cancelDetectedPreview} className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-300">Cancel</button>
                    </div>
                  </div>
                  {sheetMergeMode === 'replace-manual' && (
                    <label className="flex items-center gap-2 text-[11px] text-amber-300">
                      <input type="checkbox" checked={confirmReplaceManual} onChange={(e) => setConfirmReplaceManual(e.target.checked)} />
                      I confirm replacing manual rows.
                    </label>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {sheetEditorOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
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
              <button onClick={() => setSheetEditorOpen(false)} className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300">Cancel</button>
              <button disabled={savingSheet} onClick={() => void saveSheetEditor()} className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-60">
                {savingSheet ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {vrGeneratingError && (
        <div className="fixed top-4 right-4 z-50 max-w-sm rounded-lg border border-red-800/40 bg-red-900/20 p-3">
          <p className="text-sm text-red-300">{vrGeneratingError}</p>
        </div>
      )}

      {vrPanelOpen && vrState.currentJob && (
        <BlueprintVRExperiencePanel
          job={vrState.currentJob}
          sourceBlueprint={{
            id: selectedItem?.id || 'unknown',
            name: selectedItem?.title || 'Unknown',
          }}
          projectId={selectedItem?.projectId}
          projectName={selectedItem?.projectName}
          availableSourceSets={projectVRSourceSets}
          initialSourceSetId={currentVRSourceSetId}
          runtimeSourceIdentity={runtimeSourceIdentity}
          activePageScanSnapshot={activePageScanSnapshot}
          onSelectSourceSet={(setId) => {
            if (!selectedItem?.projectId) return
            setVrSourceSetIdByProject((prev) => ({
              ...prev,
              [selectedItem.projectId as string]: setId,
            }))
          }}
          onClose={() => {
            setVrPanelOpen(false)
            vrState.resetGeneration()
          }}
        />
      )}
    </div>
  )
}



