// @ts-nocheck
import { supabase } from '@/lib/supabase'
import { getPageCount } from '@/services/blueprintExtractor'

export type BlueprintLibraryType = 'Full Set' | 'Electrical Only' | 'Reference Sheet' | 'Other'
export type BlueprintLibraryStatus = 'active' | 'archived'

export interface BlueprintSheetIndexItem {
  pageNumber: number
  sheetLabel?: string
  sheetTitle?: string
}

export interface BlueprintLibraryItem {
  id: string
  projectId: string
  projectName: string
  title: string
  type: BlueprintLibraryType
  status: BlueprintLibraryStatus
  source: 'operations_blueprint_ai'
  storagePath: string
  fileName: string
  fileSize: number
  pageCount: number
  pagesWithNotes: number
  sheetIndex: BlueprintSheetIndexItem[]
  annotationsSummary: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export const MAX_BLUEPRINT_FILE_SIZE_BYTES = 512 * 1024 * 1024

function toSafeFileName(name: string): string {
  return name.replace(/[^\w.\-() ]+/g, '_')
}

export function validateBlueprintPdf(file: File): { ok: boolean; error?: string } {
  if (!file) return { ok: false, error: 'Please choose a file.' }
  const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf'
  if (!isPdf) return { ok: false, error: 'Only PDF files are accepted.' }
  if (file.size > MAX_BLUEPRINT_FILE_SIZE_BYTES) {
    return { ok: false, error: 'File too large. Maximum size is 512 MB. Please compress the PDF and try again.' }
  }
  return { ok: true }
}

export async function uploadBlueprintPdfToStorage(params: {
  file: File
  projectId: string
  orgId: string
}): Promise<{ storagePath: string }> {
  const { file, projectId, orgId } = params
  const id = `bp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const storagePath = `${orgId}/${projectId}/blueprints/${id}_${toSafeFileName(file.name)}`

  const { error } = await supabase.storage
    .from('blueprints')
    .upload(storagePath, file, { contentType: 'application/pdf', upsert: false })

  if (error) {
    throw new Error(error.message || 'Supabase Storage upload failed.')
  }

  return { storagePath }
}

export async function createBlueprintLibraryItem(params: {
  file: File
  projectId: string
  projectName: string
  title: string
  type: BlueprintLibraryType
  storagePath: string
}): Promise<BlueprintLibraryItem> {
  const { file, projectId, projectName, title, type, storagePath } = params
  let pageCount = 0
  try {
    pageCount = await getPageCount(file)
  } catch {
    pageCount = 0
  }

  const now = new Date().toISOString()
  return {
    id: `ops_bp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    projectName,
    title: title.trim(),
    type,
    status: 'active',
    source: 'operations_blueprint_ai',
    storagePath,
    fileName: file.name,
    fileSize: file.size,
    pageCount,
    pagesWithNotes: 0,
    sheetIndex: [],
    annotationsSummary: '',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  }
}

export function getOperationsBlueprintLibrary(backup: any): BlueprintLibraryItem[] {
  const items = backup?.blueprintSummaries?.operationsBlueprintLibrary
  return Array.isArray(items) ? items : []
}

export async function saveOperationsBlueprintLibrary(backup: any, items: BlueprintLibraryItem[]): Promise<void> {
  if (!backup.blueprintSummaries || typeof backup.blueprintSummaries !== 'object') {
    backup.blueprintSummaries = {}
  }
  backup.blueprintSummaries.operationsBlueprintLibrary = items
  backup._lastSavedAt = new Date().toISOString()
  const { saveBackupData } = await import('@/services/backupDataService')
  saveBackupData(backup)
}
