// @ts-nocheck
import { PDFDocument } from 'pdf-lib'
import { supabase } from '@/lib/supabase'
import {
  getBlueprintSignedUrl,
  type BlueprintLibraryItem,
  type BlueprintLibraryType,
} from '@/services/blueprintLibraryService'

export const MAX_DERIVED_SELECTION_PAGES = 40

function toSafeFileName(name: string): string {
  return String(name || '').replace(/[^\w.\-() ]+/g, '_')
}

function normalizeSelectedPages(pages: number[]): number[] {
  const clean = Array.isArray(pages)
    ? pages
      .map((p) => Math.floor(Number(p)))
      .filter((p) => Number.isFinite(p) && p >= 1)
    : []
  const seen = new Set<number>()
  const ordered: number[] = []
  for (const p of clean) {
    if (seen.has(p)) continue
    seen.add(p)
    ordered.push(p)
  }
  return ordered
}

async function resolveOrgIdFromAuth(): Promise<string> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  const userId = userData?.user?.id || null
  if (userError || !userId) {
    throw new Error('Could not verify user for derived blueprint creation.')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', userId)
    .maybeSingle()

  if (profileError || !profile?.org_id) {
    throw new Error('Could not resolve organization for derived blueprint creation.')
  }

  return String(profile.org_id)
}

export async function createDerivedBlueprintSet(params: {
  sourceBlueprint: BlueprintLibraryItem
  selectedPageNumbers: number[]
  title: string
  type: BlueprintLibraryType
}): Promise<BlueprintLibraryItem> {
  const sourceBlueprint = params?.sourceBlueprint
  if (!sourceBlueprint?.id) {
    throw new Error('Missing source blueprint set.')
  }
  if (!sourceBlueprint?.storagePath) {
    throw new Error('Source blueprint has no storage path.')
  }

  const title = String(params?.title || '').trim()
  if (!title) {
    throw new Error('Derived set title is required.')
  }

  const selected = normalizeSelectedPages(params?.selectedPageNumbers || [])
  if (selected.length < 1) {
    throw new Error('Select at least one page.')
  }
  if (selected.length > MAX_DERIVED_SELECTION_PAGES) {
    throw new Error(`You can select up to ${MAX_DERIVED_SELECTION_PAGES} pages in MVP.`)
  }

  const signedUrl = await getBlueprintSignedUrl(sourceBlueprint.storagePath, 1800)
  const sourceResponse = await fetch(signedUrl)
  if (!sourceResponse.ok) {
    throw new Error('Failed to download source blueprint PDF.')
  }

  const sourceBytes = await sourceResponse.arrayBuffer()
  const sourceDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true })
  const sourcePageCount = sourceDoc.getPageCount()
  const bounded = selected.filter((p) => p >= 1 && p <= sourcePageCount)
  if (bounded.length < 1) {
    throw new Error('No valid selected pages in source document.')
  }

  const derivedDoc = await PDFDocument.create()
  const copied = await derivedDoc.copyPages(sourceDoc, bounded.map((p) => p - 1))
  for (const page of copied) derivedDoc.addPage(page)
  const derivedBytes = await derivedDoc.save()

  const orgId = await resolveOrgIdFromAuth()
  const cleanProjectId = String(sourceBlueprint.projectId || '').trim()
  if (!cleanProjectId) {
    throw new Error('Source blueprint has no project id.')
  }

  const derivedId = `ops_bp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const baseName = toSafeFileName(title).replace(/\s+/g, '_')
  const fileName = `${baseName || 'derived_blueprint'}.pdf`
  const storagePath = `${orgId}/${cleanProjectId}/blueprints/${derivedId}_${fileName}`

  const blob = new Blob([derivedBytes], { type: 'application/pdf' })
  const { error: uploadError } = await supabase.storage
    .from('blueprints')
    .upload(storagePath, blob, {
      contentType: 'application/pdf',
      upsert: false,
    })

  if (uploadError) {
    throw new Error(uploadError.message || 'Failed to upload derived blueprint PDF.')
  }

  const now = new Date().toISOString()
  return {
    id: derivedId,
    projectId: sourceBlueprint.projectId,
    projectName: sourceBlueprint.projectName,
    title,
    type: params.type,
    status: 'active',
    source: 'operations_blueprint_ai',
    storagePath,
    fileName,
    fileSize: derivedBytes.byteLength,
    pageCount: bounded.length,
    pagesWithNotes: 0,
    sheetIndex: [],
    annotationsSummary: '',
    parentBlueprintSetId: sourceBlueprint.id,
    sourcePageNumbers: bounded,
    derivedFrom: 'operations_blueprint_ai',
    derivationKind: 'subset_pages',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  }
}

