// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, CheckCircle2, FileText, Loader2, RotateCcw, Upload } from 'lucide-react'
import { getBackupData } from '@/services/backupDataService'
import OperationsBlueprintPdfViewer from '@/components/blueprint/OperationsBlueprintPdfViewer'
import {
  createBlueprintLibraryItem,
  getOperationsBlueprintAnnotationSummary,
  getOperationsBlueprintLibrary,
  MAX_BLUEPRINT_FILE_SIZE_BYTES,
  saveOperationsBlueprintLibrary,
  uploadBlueprintPdfToStorage,
  validateBlueprintPdf,
  type BlueprintLibraryItem,
  type BlueprintLibraryType,
} from '@/services/blueprintLibraryService'
import {
  createDerivedBlueprintSet,
  MAX_DERIVED_SELECTION_PAGES,
} from '@/services/blueprintDerivedSetService'

const BLUEPRINT_TYPES: BlueprintLibraryType[] = ['Full Set', 'Electrical Only', 'Plumbing Only', 'Mechanical Only', 'Reference Sheet', 'Other']

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

  useEffect(() => {
    setSelectedPages([])
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
              <p className="text-sm text-gray-200">{selectedItem.projectName}</p>
              {selectedItem.sheetIndex?.length > 0 ? (
                <div className="max-h-36 overflow-auto border rounded-md border-gray-800">
                  {selectedItem.sheetIndex.map((s, i) => (
                    <div key={i} className="text-xs px-2 py-2 border-b border-gray-800 last:border-b-0 text-gray-300">
                      Pg {s.pageNumber} {s.sheetLabel ? `• ${s.sheetLabel}` : ''} {s.sheetTitle ? `• ${s.sheetTitle}` : ''}
                      {(selectedAnnotationSummary.byPage[s.pageNumber] || 0) > 0 && (
                        <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-blue-900/30 border border-blue-800/40 text-blue-300">
                          {selectedAnnotationSummary.byPage[s.pageNumber]} annotation{selectedAnnotationSummary.byPage[s.pageNumber] !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-gray-500 border border-dashed border-gray-700 rounded-md p-3 space-y-2">
                  <div>No sheet/page metadata yet. Upload is complete; index extraction can be added in a future phase.</div>
                  {Object.keys(selectedAnnotationSummary.byPage).length > 0 && (
                    <div className="space-y-1">
                      {Object.entries(selectedAnnotationSummary.byPage)
                        .sort((a, b) => Number(a[0]) - Number(b[0]))
                        .map(([page, count]) => (
                          <div key={page} className="text-gray-300">
                            Page {page} — {count} annotation{count !== 1 ? 's' : ''}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Select a blueprint set to view its study index.</p>
          )}
        </div>
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
    </div>
  )
}
