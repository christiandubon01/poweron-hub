import { PDFDocument } from 'pdf-lib'

export const MAX_IMAGE_FILE_SIZE_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_DECODED_PIXELS = 16_000_000
export const MAX_IMAGE_EDGE_PX = 12_000
export const MAX_PDF_EDGE_PTS = 2048

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

// A 64×64 sample is large enough to detect sparse Blueprint plan lines,
// watermarks, and annotations while remaining cheap to allocate.
const VERIFY_SIZE = 64

// Require at least 0.2% non-white pixels — tolerates sparse Blueprint images
// with mostly-white backgrounds and thin plan lines.
const MIN_VISIBLE_FRACTION = 0.002

type ImageFormat = 'jpeg' | 'png'
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export class ImageConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageConversionError'
  }
}

interface DrawableSource {
  width: number
  height: number
  drawable: CanvasImageSource
  cleanup(): void
}

// ── PDF.js lazy loader ────────────────────────────────────────────────────────

let _pdfjsLib: typeof import('pdfjs-dist') | null = null

async function getPdfjsLib(): Promise<typeof import('pdfjs-dist')> {
  if (_pdfjsLib) return _pdfjsLib
  const lib = await import(/* @vite-ignore */ 'pdfjs-dist')
  if (typeof window !== 'undefined' && !lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
  }
  _pdfjsLib = lib
  return lib
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function detectDeclaredFormat(file: File): ImageFormat | null {
  const ext = (file.name.match(/\.([^.]+)$/) ?? [])[1]?.toLowerCase() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg'
  if (ext === 'png') return 'png'
  if (file.type === 'image/jpeg') return 'jpeg'
  if (file.type === 'image/png') return 'png'
  return null
}

function safePdfFileName(imageName: string): string {
  const noExt = imageName.replace(/\.[^.]+$/, '')
  return noExt.replace(/[^\w.\-() ]+/g, '_') + '.pdf'
}

// Exported for unit testing. A pixel is "visible" when alpha ≥ 30 and the
// total deviation from pure white (255,255,255) is ≥ 15. This catches thin
// plan lines, gray watermarks, red circuit paths, and purple electrical symbols
// while tolerating JPEG compression artifacts on near-white pixels.
export function countNonWhitePixels(data: Uint8ClampedArray): number {
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 30) continue
    if ((255 - data[i]!) + (255 - data[i + 1]!) + (255 - data[i + 2]!) >= 15) count++
  }
  return count
}

// Exported for unit testing. Caps the longest PDF page edge at MAX_PDF_EDGE_PTS
// while preserving exact aspect ratio. Images smaller than the cap are
// unchanged (no upscaling). The embedded image bytes remain full-resolution.
export function calcPdfDimensions(w: number, h: number): { pageW: number; pageH: number } {
  const longest = Math.max(w, h)
  if (longest <= MAX_PDF_EDGE_PTS) return { pageW: w, pageH: h }
  const scale = MAX_PDF_EDGE_PTS / longest
  return { pageW: Math.round(w * scale), pageH: Math.round(h * scale) }
}

// ── Canvas creation ───────────────────────────────────────────────────────────

// HTMLCanvasElement is used as the primary surface because its drawImage
// implementation is more reliable across browsers than OffscreenCanvas, which
// can silently produce blank output for certain image sources and configurations.
function makeCanvas(w: number, h: number): { canvas: AnyCanvas; ctx: AnyCtx } {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas') as HTMLCanvasElement
    c.width = w
    c.height = h
    const ctx = c.getContext('2d') as CanvasRenderingContext2D | null
    if (ctx) return { canvas: c, ctx }
  }
  // OffscreenCanvas fallback: worker context or environments without document.
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h)
    const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D | null
    if (ctx) return { canvas: c, ctx }
  }
  throw new ImageConversionError('Canvas context unavailable.')
}

async function canvasToBlob(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  const htmlCanvas = canvas as HTMLCanvasElement
  if (typeof htmlCanvas.toBlob === 'function') {
    return new Promise<Blob>((resolve, reject) => {
      htmlCanvas.toBlob(
        (b) => {
          if (!b) reject(new ImageConversionError('Canvas encoding produced no output.'))
          else resolve(b)
        },
        type,
        quality,
      )
    })
  }
  // OffscreenCanvas fallback uses convertToBlob.
  const offscreen = canvas as OffscreenCanvas
  const blob = await offscreen.convertToBlob({ type, quality })
  if (!blob) throw new ImageConversionError('Canvas encoding produced no output.')
  return blob
}

// ── Visible-content verification ──────────────────────────────────────────────

// Returns -1 when the environment cannot run this check (no document).
function sampleNonWhitePixels(srcCanvas: AnyCanvas): number {
  if (typeof document === 'undefined') return -1
  const vc = document.createElement('canvas') as HTMLCanvasElement
  vc.width = VERIFY_SIZE
  vc.height = VERIFY_SIZE
  const vctx = vc.getContext('2d') as CanvasRenderingContext2D | null
  if (!vctx) return -1
  vctx.drawImage(srcCanvas as CanvasImageSource, 0, 0, VERIFY_SIZE, VERIFY_SIZE)
  return countNonWhitePixels(vctx.getImageData(0, 0, VERIFY_SIZE, VERIFY_SIZE).data)
}

// Re-decodes the encoded blob and checks for visible pixels. Returns -1 when
// the environment cannot run this check.
async function sampleEncodedBlobNonWhitePixels(blob: Blob): Promise<number> {
  if (typeof createImageBitmap !== 'function') return -1
  if (typeof document === 'undefined') return -1
  let bm: ImageBitmap | null = null
  try {
    bm = await createImageBitmap(blob)
    const vc = document.createElement('canvas') as HTMLCanvasElement
    vc.width = VERIFY_SIZE
    vc.height = VERIFY_SIZE
    const vctx = vc.getContext('2d') as CanvasRenderingContext2D | null
    if (!vctx) return -1
    vctx.drawImage(bm, 0, 0, VERIFY_SIZE, VERIFY_SIZE)
    return countNonWhitePixels(vctx.getImageData(0, 0, VERIFY_SIZE, VERIFY_SIZE).data)
  } catch {
    return -1
  } finally {
    bm?.close()
  }
}

// ── Image decode ──────────────────────────────────────────────────────────────

async function decodeImageSafely(file: File): Promise<DrawableSource> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return {
      width: bitmap.width,
      height: bitmap.height,
      drawable: bitmap,
      cleanup: () => bitmap.close(),
    }
  }

  // HTMLImageElement fallback for environments without createImageBitmap.
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('No image decode API available.')
  }
  const objectUrl = URL.createObjectURL(file)
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('HTMLImageElement failed'))
    img.src = objectUrl
  })
  if (img.decode) await img.decode().catch(() => {})
  if (!img.naturalWidth || !img.naturalHeight) {
    URL.revokeObjectURL(objectUrl)
    throw new Error('HTMLImageElement returned zero dimensions.')
  }
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    drawable: img,
    cleanup: () => URL.revokeObjectURL(objectUrl),
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function convertImageToBlueprintPdf(file: File): Promise<File> {
  // 1. Format check
  const format = detectDeclaredFormat(file)
  if (!format) throw new ImageConversionError('Select a JPG, JPEG, or PNG image.')

  // 2. Empty file check
  if (file.size === 0) throw new ImageConversionError('The selected file is empty.')

  // 3. Compressed size limit
  if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
    throw new ImageConversionError('The image file is too large.')
  }

  // 4. Signature check — extension/MIME and magic bytes must agree
  const headerBuf = await file.slice(0, 8).arrayBuffer()
  const header = new Uint8Array(headerBuf)
  if (format === 'jpeg') {
    if (
      header[0] !== JPEG_SIGNATURE[0] ||
      header[1] !== JPEG_SIGNATURE[1] ||
      header[2] !== JPEG_SIGNATURE[2]
    ) {
      throw new ImageConversionError('The file contents do not match a supported image format.')
    }
  } else {
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
      if (header[i] !== PNG_SIGNATURE[i]) {
        throw new ImageConversionError('The file contents do not match a supported image format.')
      }
    }
  }

  let decoded: DrawableSource | null = null

  try {
    // 5. Decode with EXIF orientation baked in
    decoded = await decodeImageSafely(file).catch(() => {
      throw new ImageConversionError('The image could not be decoded and may be damaged.')
    })

    const { width, height, drawable } = decoded

    // 6. Dimension validation before canvas allocation
    if (width <= 0 || height <= 0) {
      throw new ImageConversionError('The image could not be decoded and may be damaged.')
    }
    if (width > MAX_IMAGE_EDGE_PX || height > MAX_IMAGE_EDGE_PX) {
      throw new ImageConversionError('The image dimensions are too large to convert safely.')
    }
    if (width * height > MAX_IMAGE_DECODED_PIXELS) {
      throw new ImageConversionError('The image dimensions are too large to convert safely.')
    }

    // 7. Normalization canvas — white background then source image
    const { canvas, ctx } = makeCanvas(width, height)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(drawable, 0, 0, width, height)

    // 8. Verify source pixels reached the canvas before encoding
    const normCount = sampleNonWhitePixels(canvas)
    if (normCount >= 0 && normCount < VERIFY_SIZE * VERIFY_SIZE * MIN_VISIBLE_FRACTION) {
      throw new ImageConversionError(
        'The converted image appears blank. The source image could not be drawn correctly.',
      )
    }

    // 9. Encode canvas to image bytes
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg'
    const encodedBlob = await canvasToBlob(canvas, mimeType, format === 'jpeg' ? 0.92 : undefined)
    if (encodedBlob.size === 0) {
      throw new ImageConversionError('Canvas encoding produced no output.')
    }
    const imageBytes = new Uint8Array(await encodedBlob.arrayBuffer())
    const embedFormat: 'jpeg' | 'png' = format

    // 10. Verify encoded bytes signature
    if (embedFormat === 'png') {
      for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (imageBytes[i] !== PNG_SIGNATURE[i]) {
          throw new ImageConversionError('The encoded image has an unexpected format.')
        }
      }
    } else {
      if (
        imageBytes[0] !== JPEG_SIGNATURE[0] ||
        imageBytes[1] !== JPEG_SIGNATURE[1] ||
        imageBytes[2] !== JPEG_SIGNATURE[2]
      ) {
        throw new ImageConversionError('The encoded image has an unexpected format.')
      }
    }

    // 11. Re-verify encoded blob still contains visible pixels
    const encodedCount = await sampleEncodedBlobNonWhitePixels(encodedBlob)
    if (encodedCount >= 0 && encodedCount < VERIFY_SIZE * VERIFY_SIZE * MIN_VISIBLE_FRACTION) {
      throw new ImageConversionError('The encoded image appears blank.')
    }

    // 12. PDF generation with bounded page dimensions
    const { pageW, pageH } = calcPdfDimensions(width, height)
    const pdfDoc = await PDFDocument.create()
    const embedded =
      embedFormat === 'png'
        ? await pdfDoc.embedPng(imageBytes)
        : await pdfDoc.embedJpg(imageBytes)
    const page = pdfDoc.addPage([pageW, pageH])
    page.drawImage(embedded, { x: 0, y: 0, width: pageW, height: pageH })
    const pdfBytes = await pdfDoc.save()

    if (pdfBytes.byteLength <= 0) {
      throw new ImageConversionError('The generated PDF is empty.')
    }

    // 13. Verify %PDF header on the generated bytes before retaining them.
    if (
      pdfBytes[0] !== 0x25 ||
      pdfBytes[1] !== 0x50 ||
      pdfBytes[2] !== 0x44 ||
      pdfBytes[3] !== 0x46
    ) {
      throw new ImageConversionError('The generated PDF could not be verified.')
    }

    // Retain an independent copy for the returned File. PDF.js verification
    // must never receive the ArrayBuffer that backs these retained bytes.
    const retainedFileBytes = pdfBytes.slice()
    const generatedFile = new File(
      [retainedFileBytes as unknown as Uint8Array<ArrayBuffer>],
      safePdfFileName(file.name),
      { type: 'application/pdf' },
    )

    if (
      generatedFile.size <= 0 ||
      generatedFile.size !== retainedFileBytes.byteLength
    ) {
      throw new ImageConversionError(
        'The generated PDF could not be preserved correctly.',
      )
    }

    const sizeBeforeVerify = generatedFile.size

    // 14. PDF.js verification on a SEPARATE buffer only (may be detached).
    try {
      const pdfjsLib = await getPdfjsLib()
      const verificationBuffer = await generatedFile.arrayBuffer()
      const loadingTask = pdfjsLib.getDocument({
        data: verificationBuffer,
      })
      const pdfJsDoc = await loadingTask.promise
      if (pdfJsDoc.numPages !== 1) {
        throw new ImageConversionError('The generated PDF could not be verified.')
      }

      // Render page 1 to a bounded canvas and check for visible pixels.
      if (typeof document !== 'undefined') {
        const pdfPage = await pdfJsDoc.getPage(1)
        const view = pdfPage.view
        const vw = (view[2] ?? 100) - (view[0] ?? 0)
        const vh = (view[3] ?? 100) - (view[1] ?? 0)
        const scale = Math.min(VERIFY_SIZE / (vw || 1), VERIFY_SIZE / (vh || 1), 1)
        const viewport = pdfPage.getViewport({ scale })
        const rc = document.createElement('canvas') as HTMLCanvasElement
        rc.width = Math.max(1, Math.ceil(viewport.width))
        rc.height = Math.max(1, Math.ceil(viewport.height))
        const rctx = rc.getContext('2d') as CanvasRenderingContext2D | null
        if (rctx) {
          await pdfPage.render({ canvas: rc, viewport }).promise
          const rd = rctx.getImageData(0, 0, rc.width, rc.height)
          const renderCount = countNonWhitePixels(rd.data)
          const threshold = (rd.data.length / 4) * MIN_VISIBLE_FRACTION
          if (renderCount < threshold) {
            throw new ImageConversionError(
              'The generated PDF appears blank and was not uploaded.',
            )
          }
        }
      }

      // Post-verify: retained File must still be intact after PDF.js may have
      // detached verificationBuffer.
      if (generatedFile.size !== sizeBeforeVerify || generatedFile.size <= 0) {
        throw new ImageConversionError(
          'The generated PDF could not be preserved correctly.',
        )
      }
      const postBytes = new Uint8Array(await generatedFile.arrayBuffer())
      if (
        postBytes.byteLength <= 0 ||
        postBytes.byteLength !== generatedFile.size ||
        postBytes[0] !== 0x25 ||
        postBytes[1] !== 0x50 ||
        postBytes[2] !== 0x44 ||
        postBytes[3] !== 0x46
      ) {
        throw new ImageConversionError(
          'The generated PDF could not be preserved correctly.',
        )
      }
    } catch (err: unknown) {
      if (err instanceof ImageConversionError) throw err
      throw new ImageConversionError('The generated PDF could not be verified.')
    }

    return generatedFile
  } finally {
    decoded?.cleanup()
  }
}
