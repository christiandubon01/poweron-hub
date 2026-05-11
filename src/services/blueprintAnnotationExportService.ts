// @ts-nocheck
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
import {
  getBlueprintSignedUrl,
  type BlueprintAnnotation,
  type BlueprintLibraryItem,
} from '@/services/blueprintLibraryService'

type ExportMode = 'annotated-pages' | 'all-pages'

interface ExportParams {
  blueprint: BlueprintLibraryItem
  annotations: BlueprintAnnotation[]
  mode: ExportMode
}

interface ExportResult {
  fileName: string
  warning?: string
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number(v) || 0))
}

function parseHexColor(hex?: string): { r: number; g: number; b: number } {
  const fallback = { r: 0.98, g: 0.8, b: 0.08 }
  const clean = String(hex || '').trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return fallback
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return { r, g, b }
}

function safeBaseName(name?: string): string {
  return String(name || 'blueprint')
    .replace(/[^\w.\-() ]+/g, '_')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'blueprint'
}

function shortNote(text?: string): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > 60 ? `${t.slice(0, 57)}...` : t
}

function normalizeAnn(a: any): BlueprintAnnotation | null {
  if (!a || typeof a !== 'object') return null
  const pageNumber = Math.floor(Number(a.pageNumber) || 0)
  if (pageNumber < 1) return null
  return {
    id: String(a.id || ''),
    blueprintSetId: String(a.blueprintSetId || ''),
    projectId: String(a.projectId || ''),
    pageNumber,
    type: String(a.type || ''),
    rect: a.rect
      ? {
        x: clamp01(a.rect.x),
        y: clamp01(a.rect.y),
        w: clamp01(a.rect.w),
        h: clamp01(a.rect.h),
      }
      : undefined,
    path: Array.isArray(a.path) ? a.path : undefined,
    text: a.text == null ? undefined : String(a.text),
    color: String(a.color || '#facc15'),
    createdAt: String(a.createdAt || ''),
    updatedAt: String(a.updatedAt || ''),
  } as BlueprintAnnotation
}

function drawHighlight(page: any, ann: BlueprintAnnotation) {
  if (!ann.rect) return
  const { width, height } = page.getSize()
  const x = clamp01(ann.rect.x) * width
  const yTop = clamp01(ann.rect.y) * height
  const w = Math.max(1, clamp01(ann.rect.w) * width)
  const h = Math.max(1, clamp01(ann.rect.h) * height)
  const y = height - yTop - h
  const c = parseHexColor(ann.color)

  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: rgb(c.r, c.g, c.b),
    opacity: 0.25,
    borderColor: rgb(c.r, c.g, c.b),
    borderWidth: 1,
  })
}

function drawNote(page: any, ann: BlueprintAnnotation, noteIndex: number, font: any) {
  if (!ann.rect) return
  const { width, height } = page.getSize()
  const x = clamp01(ann.rect.x) * width
  const y = height - (clamp01(ann.rect.y) * height)
  const c = parseHexColor(ann.color)
  const markerSize = Math.max(8, Math.min(16, width * 0.01))
  const boxW = Math.min(width * 0.45, 260)
  const text = `Note ${noteIndex}: ${shortNote(ann.text)}`

  page.drawRectangle({
    x: Math.max(0, x - markerSize / 2),
    y: Math.max(0, y - markerSize / 2),
    width: markerSize,
    height: markerSize,
    color: rgb(c.r, c.g, c.b),
    opacity: 0.9,
  })

  const textX = Math.min(width - boxW - 4, x + markerSize + 4)
  const textY = Math.max(2, y - 8)
  page.drawRectangle({
    x: Math.max(2, textX - 2),
    y: Math.max(0, textY - 2),
    width: boxW,
    height: 12,
    color: rgb(1, 1, 1),
    opacity: 0.8,
  })
  page.drawText(text, {
    x: Math.max(2, textX),
    y: Math.max(2, textY),
    size: 8,
    font,
    color: rgb(0.1, 0.1, 0.1),
    maxWidth: boxW - 4,
  })
}

export async function exportAnnotatedBlueprintPdf(params: ExportParams): Promise<ExportResult> {
  const blueprint = params?.blueprint
  if (!blueprint?.id) throw new Error('No blueprint selected for export.')
  if (!blueprint?.storagePath) throw new Error('Selected blueprint has no storagePath.')

  const all = (Array.isArray(params?.annotations) ? params.annotations : [])
    .map(normalizeAnn)
    .filter(Boolean) as BlueprintAnnotation[]
  const relevant = all.filter((a) => a.blueprintSetId === blueprint.id)
  if (relevant.length < 1) {
    throw new Error('No annotations found for this blueprint set.')
  }

  const signedUrl = await getBlueprintSignedUrl(blueprint.storagePath, 1800)
  const response = await fetch(signedUrl)
  if (!response.ok) throw new Error('Failed to download source PDF for export.')
  const sourceBytes = await response.arrayBuffer()

  const sourceDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true })
  const exportDoc = await PDFDocument.create()
  const font = await exportDoc.embedFont(StandardFonts.Helvetica)

  const srcPageCount = sourceDoc.getPageCount()
  const byPage = new Map<number, BlueprintAnnotation[]>()
  for (const ann of relevant) {
    if (ann.pageNumber < 1 || ann.pageNumber > srcPageCount) continue
    const list = byPage.get(ann.pageNumber) || []
    list.push(ann)
    byPage.set(ann.pageNumber, list)
  }

  const mode: ExportMode = params?.mode === 'all-pages' ? 'all-pages' : 'annotated-pages'
  const pagesToInclude =
    mode === 'all-pages'
      ? Array.from({ length: srcPageCount }, (_, i) => i + 1)
      : Array.from(byPage.keys()).sort((a, b) => a - b)

  if (pagesToInclude.length < 1) {
    throw new Error('No annotated pages found to export.')
  }

  const copied = await exportDoc.copyPages(sourceDoc, pagesToInclude.map((p) => p - 1))
  let rotationWarning = false
  for (let i = 0; i < copied.length; i += 1) {
    const srcPageNum = pagesToInclude[i]
    const page = copied[i]
    const rotation = Number(page.getRotation()?.angle || 0)
    if ((rotation % 360) !== 0) rotationWarning = true
    exportDoc.addPage(page)

    const anns = byPage.get(srcPageNum) || []
    let noteIdx = 1
    for (const ann of anns) {
      if (ann.type === 'highlight') {
        drawHighlight(page, ann)
        continue
      }
      if (ann.type === 'note') {
        drawNote(page, ann, noteIdx, font)
        noteIdx += 1
        continue
      }
      // Unsupported types intentionally ignored for MVP.
    }
  }

  const outBytes = await exportDoc.save()
  const modeSuffix = mode === 'all-pages' ? 'annotated-all-pages' : 'annotated-pages'
  const fileName = `${safeBaseName(blueprint.title || blueprint.fileName)}-${modeSuffix}.pdf`

  const blob = new Blob([outBytes], { type: 'application/pdf' })
  const objectUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = fileName
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }

  return {
    fileName,
    warning: rotationWarning ? 'Some pages are rotated; annotation placement may be approximate on rotated pages.' : undefined,
  }
}

