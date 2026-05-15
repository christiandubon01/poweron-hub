/**
 * Client helpers for blueprint vision classify / extract Netlify function.
 */

import { getBlueprintSignedUrl } from '@/services/blueprintLibraryService'

export interface BlueprintVisionBoundsFeet {
  x: number
  y: number
  width: number
  height: number
}

export interface BlueprintVisionRoom {
  id: string
  label: string
  role: string
  boundsFeet: BlueprintVisionBoundsFeet
}

export interface BlueprintVisionWall {
  id: string
  startFeet: { x: number; y: number }
  endFeet: { x: number; y: number }
  kind: 'exterior' | 'partition' | 'glass' | string
  thicknessInches: number
}

export interface BlueprintVisionOpening {
  id: string
  wallId: string
  type: 'door' | 'window' | string
  positionFeet: number
  widthFeet: number
  swing: 'left' | 'right' | 'fixed' | 'sliding' | string
}

export interface BlueprintVisionExtractionResult {
  footprint?: { width: number; height: number }
  scale?: string
  rooms?: BlueprintVisionRoom[]
  walls?: BlueprintVisionWall[]
  openings?: BlueprintVisionOpening[]
  error?: string
  reason?: string
}

const VISION_FN = '/.netlify/functions/blueprintVision'
const CLASSIFY_BATCH_SIZE = 10

export type VisionPageRole =
  | 'floor_plan'
  | 'electrical_plan'
  | 'schedule'
  | 'title_sheet'
  | 'elevation'
  | 'rendering'
  | 'demolition_plan'
  | 'reflected_ceiling_plan'
  | 'other'

export interface VisionPageClassification {
  pageNumber: number
  role: VisionPageRole
  confidence: number
  reason: string
}

type VisionFnResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string }

let _pdfjsLib: typeof import('pdfjs-dist') | null = null

export async function getPdfjsLib(): Promise<typeof import('pdfjs-dist')> {
  if (_pdfjsLib) return _pdfjsLib
  const pdfjsLib = await import(/* @vite-ignore */ 'pdfjs-dist')
  if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
  }
  _pdfjsLib = pdfjsLib
  return pdfjsLib
}

export async function loadPdfArrayBuffer(storagePath: string): Promise<ArrayBuffer> {
  const signedUrl = await getBlueprintSignedUrl(storagePath, 1800)
  const res = await fetch(signedUrl)
  if (!res.ok) {
    throw new Error(`Failed to download blueprint PDF (${res.status})`)
  }
  return res.arrayBuffer()
}

export async function openPdfDocument(buffer: ArrayBuffer) {
  const pdfjsLib = await getPdfjsLib()
  const loadingTask = pdfjsLib.getDocument({ data: buffer.slice(0) })
  return loadingTask.promise
}

export async function rasterizePdfPageToBase64(
  pdfDoc: Awaited<ReturnType<typeof openPdfDocument>>,
  pageNumber: number,
  dpi = 150,
): Promise<string> {
  const page = await pdfDoc.getPage(pageNumber)
  const scale = dpi / 72
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  await page.render({ canvasContext: ctx, viewport, canvas }).promise
  const dataUrl = canvas.toDataURL('image/png')
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

export async function hashFile(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function postVision<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(VISION_FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  let parsed: VisionFnResponse<T> & { error?: string }
  try {
    parsed = await res.json()
  } catch {
    throw new Error(`Vision API returned invalid JSON (${res.status})`)
  }

  if (!res.ok || !parsed.success) {
    throw new Error(parsed.error || `Vision API error ${res.status}`)
  }

  return parsed.data
}

export async function callClassify(
  images: string[],
  pageNumbers: number[],
): Promise<VisionPageClassification[]> {
  return postVision<VisionPageClassification[]>({
    mode: 'classify',
    images,
    pageNumbers,
  })
}

export async function callExtract(
  image: string,
  pageNumber: number,
): Promise<BlueprintVisionExtractionResult> {
  return postVision<BlueprintVisionExtractionResult>({
    mode: 'extract',
    images: [image],
    pageNumbers: [pageNumber],
  })
}

/** Classify all pages in sequential batches of 10. */
export async function classifyAllPagesBatched(
  pdfDoc: Awaited<ReturnType<typeof openPdfDocument>>,
  totalPages: number,
  onProgress?: (done: number, total: number) => void,
  classifyDpi = 150,
): Promise<VisionPageClassification[]> {
  const merged: VisionPageClassification[] = []
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)

  for (let i = 0; i < pages.length; i += CLASSIFY_BATCH_SIZE) {
    const batchPages = pages.slice(i, i + CLASSIFY_BATCH_SIZE)
    const images: string[] = []
    for (const pageNumber of batchPages) {
      images.push(await rasterizePdfPageToBase64(pdfDoc, pageNumber, classifyDpi))
    }
    const batchResult = await callClassify(images, batchPages)
    merged.push(...batchResult)
    onProgress?.(Math.min(i + batchPages.length, totalPages), totalPages)
  }

  return merged.sort((a, b) => a.pageNumber - b.pageNumber)
}
