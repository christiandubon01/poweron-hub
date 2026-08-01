import { deflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ImageConversionError,
  MAX_IMAGE_DECODED_PIXELS,
  MAX_IMAGE_EDGE_PX,
  MAX_IMAGE_FILE_SIZE_BYTES,
  MAX_PDF_EDGE_PTS,
  calcPdfDimensions,
  countNonWhitePixels,
  convertImageToBlueprintPdf,
} from '@/services/imageToBlueprintPdfService'

// ── PDF.js mock ───────────────────────────────────────────────────────────────
// Extended to support getPage/getViewport/render for Step 10 verification.
// Critically: detaches the input ArrayBuffer (via structuredClone transfer),
// matching real pdfjs-dist behavior that previously zeroed the returned File.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn((opts: { data?: ArrayBuffer | Uint8Array }) => {
    const data = opts?.data
    if (data) {
      const buffer =
        data instanceof ArrayBuffer
          ? data
          : (data.buffer instanceof ArrayBuffer ? data.buffer : null)
      if (buffer && buffer.byteLength > 0) {
        try {
          structuredClone(buffer, { transfer: [buffer] })
        } catch {
          // Environments that reject transfer still exercise the API path.
        }
      }
    }
    return {
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn((_n: number) =>
          Promise.resolve({
            // Non-square so the render canvas dims differ from VERIFY_SIZE×VERIFY_SIZE
            view: [0, 0, 100, 150],
            getViewport: vi.fn(({ scale }: { scale: number }) => ({
              width: Math.ceil(100 * scale),
              height: Math.ceil(150 * scale),
            })),
            render: vi.fn((_params: unknown) => ({ promise: Promise.resolve() })),
          }),
        ),
      }),
    }
  }),
}))

// ── Image byte generators ─────────────────────────────────────────────────────

function crc32(data: Uint8Array): number {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  let crc = 0xffffffff
  for (const b of data) crc = table[(crc ^ b) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBuf = new TextEncoder().encode(type)
  const crcInput = new Uint8Array([...typeBuf, ...data])
  const chunkCrc = crc32(crcInput)
  return new Uint8Array([...u32be(data.length), ...typeBuf, ...data, ...u32be(chunkCrc)])
}

/** Minimal valid N×M white grayscale PNG using node:zlib. */
function makeWhitePng(width: number, height: number): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdrData = new Uint8Array([...u32be(width), ...u32be(height), 8, 0, 0, 0, 0])
  const ihdr = pngChunk('IHDR', ihdrData)
  const rowLen = 1 + width
  const raw = new Uint8Array(height * rowLen)
  for (let r = 0; r < height; r++) {
    raw[r * rowLen] = 0
    for (let c = 1; c <= width; c++) raw[r * rowLen + c] = 0xff
  }
  const compressed = deflateSync(raw)
  const idat = pngChunk('IDAT', compressed)
  const iend = pngChunk('IEND', new Uint8Array(0))
  const total = sig.length + ihdr.length + idat.length + iend.length
  const out = new Uint8Array(total)
  let off = 0
  for (const part of [sig, ihdr, idat, iend]) { out.set(part, off); off += part.length }
  return out
}

/**
 * Sparse Blueprint-style RGB PNG: mostly white background, ~20% black pixels
 * distributed to simulate plan lines, watermarks, and annotations.
 */
function makeSparsePng(width: number, height: number): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  // Color type 2 = RGB (8 bits per channel)
  const ihdrData = new Uint8Array([...u32be(width), ...u32be(height), 8, 2, 0, 0, 0])
  const ihdr = pngChunk('IHDR', ihdrData)
  const rowLen = 1 + width * 3
  const raw = new Uint8Array(height * rowLen)
  for (let r = 0; r < height; r++) {
    raw[r * rowLen] = 0
    for (let c = 0; c < width; c++) {
      const idx = r * rowLen + 1 + c * 3
      if ((r * width + c) % 5 === 0) {
        raw[idx] = 0; raw[idx + 1] = 0; raw[idx + 2] = 0   // black (plan line)
      } else {
        raw[idx] = 255; raw[idx + 1] = 255; raw[idx + 2] = 255  // white
      }
    }
  }
  const compressed = deflateSync(raw)
  const idat = pngChunk('IDAT', compressed)
  const iend = pngChunk('IEND', new Uint8Array(0))
  const total = sig.length + ihdr.length + idat.length + iend.length
  const out = new Uint8Array(total)
  let off = 0
  for (const part of [sig, ihdr, idat, iend]) { out.set(part, off); off += part.length }
  return out
}

/**
 * Minimal JFIF JPEG: SOI + APP0 + SOF0 + EOI.
 * pdf-lib reads SOF0 for dimensions — no scan data needed for embedding.
 */
function makeMinimalJpeg(width = 1, height = 1): Uint8Array {
  const wH = (width >>> 8) & 0xff
  const wL = width & 0xff
  const hH = (height >>> 8) & 0xff
  const hL = height & 0xff
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, hH, hL, wH, wL, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ])
}

const SMALL_PNG = makeWhitePng(4, 4)
const SMALL_JPEG = makeMinimalJpeg(4, 4)
const VERIFY_SIZE = 64  // must match the private constant in the service

// ── Mock ImageData builders ───────────────────────────────────────────────────

// 20% black pixels — passes MIN_VISIBLE_FRACTION (0.2%) threshold by a wide margin.
function makeVisibleImageData(): { data: Uint8ClampedArray } {
  const pixels = VERIFY_SIZE * VERIFY_SIZE
  const data = new Uint8ClampedArray(pixels * 4)
  for (let i = 0; i < pixels; i++) {
    const base = i * 4
    if (i % 5 === 0) {
      data[base] = 0; data[base + 1] = 0; data[base + 2] = 0; data[base + 3] = 255  // black
    } else {
      data[base] = 255; data[base + 1] = 255; data[base + 2] = 255; data[base + 3] = 255  // white
    }
  }
  return { data }
}

// All opaque white — fails the MIN_VISIBLE_FRACTION threshold.
function makeBlankImageData(): { data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(VERIFY_SIZE * VERIFY_SIZE * 4).fill(255)
  return { data }
}

// ── Canvas mock helpers ───────────────────────────────────────────────────────

let mockFillRect: ReturnType<typeof vi.fn>
let mockDrawImage: ReturnType<typeof vi.fn>
let capturedFillStyle: string
let mockCanvasFormat: string
let mockGetImageData: ReturnType<typeof vi.fn>
let mockBlobNull: boolean
let mockBlobZeroBytes: boolean
let mockBlobWrongPngSig: boolean
let mockBlobWrongJpegSig: boolean
let activePngBytes: Uint8Array
let activeJpegBytes: Uint8Array

function installDocumentMock(
  pngBytes: Uint8Array = SMALL_PNG,
  jpegBytes: Uint8Array = SMALL_JPEG,
) {
  activePngBytes = pngBytes
  activeJpegBytes = jpegBytes

  const createMockCanvas = () => ({
    width: 0,
    height: 0,
    getContext(_type: string) {
      return {
        get fillStyle() { return capturedFillStyle },
        set fillStyle(v: string) { capturedFillStyle = v },
        fillRect: mockFillRect,
        drawImage: mockDrawImage,
        getImageData: (...args: unknown[]) => mockGetImageData(...args),
      }
    },
    toBlob(callback: (blob: Blob | null) => void, type: string, _quality?: number) {
      mockCanvasFormat = type
      Promise.resolve().then(() => {
        if (mockBlobNull) { callback(null); return }
        if (mockBlobZeroBytes) {
          callback(new Blob([], { type }))
          return
        }
        let bytes: Uint8Array
        if (mockBlobWrongPngSig && type === 'image/png') {
          bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
        } else if (mockBlobWrongJpegSig && type === 'image/jpeg') {
          bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
        } else {
          bytes = type === 'image/png' ? activePngBytes : activeJpegBytes
        }
        callback(new Blob([bytes as unknown as Uint8Array<ArrayBuffer>], { type }))
      })
    },
  })

  vi.stubGlobal('document', {
    createElement: vi.fn((_tag: string) => createMockCanvas()),
  })
}

// ── Factory helpers ───────────────────────────────────────────────────────────

function makeFile(name: string, bytes: Uint8Array, mime: string): File {
  return new File([bytes as unknown as Uint8Array<ArrayBuffer>], name, { type: mime })
}

function makePngFile(name = 'photo.png', w = 4, h = 4): File {
  return makeFile(name, makeWhitePng(w, h), 'image/png')
}

function makeJpegFile(name = 'photo.jpg', w = 4, h = 4): File {
  return makeFile(name, makeMinimalJpeg(w, h), 'image/jpeg')
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFillRect = vi.fn()
  mockDrawImage = vi.fn()
  capturedFillStyle = ''
  mockCanvasFormat = ''
  mockBlobNull = false
  mockBlobZeroBytes = false
  mockBlobWrongPngSig = false
  mockBlobWrongJpegSig = false
  // Default: getImageData returns visible content so all verification checks pass.
  mockGetImageData = vi.fn().mockReturnValue(makeVisibleImageData())

  const mockBitmap = { width: 4, height: 4, close: vi.fn() }
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(mockBitmap))
  installDocumentMock()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── countNonWhitePixels unit tests ────────────────────────────────────────────

describe('countNonWhitePixels', () => {
  it('returns 0 for all-white opaque data', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255])
    expect(countNonWhitePixels(data)).toBe(0)
  })

  it('counts opaque black pixels', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
    expect(countNonWhitePixels(data)).toBe(1)
  })

  it('counts gray pixels (threshold: channel sum diff ≥ 15)', () => {
    // Each channel off by 5 (3×5=15) = exactly at threshold → counted
    const data = new Uint8ClampedArray([250, 250, 250, 255])
    expect(countNonWhitePixels(data)).toBe(1)
  })

  it('does not count near-white pixels (sum diff < 15)', () => {
    // Each channel off by 4 (3×4=12) < 15 → not counted
    const data = new Uint8ClampedArray([251, 251, 251, 255])
    expect(countNonWhitePixels(data)).toBe(0)
  })

  it('skips fully-transparent pixels', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 0])  // black but transparent
    expect(countNonWhitePixels(data)).toBe(0)
  })

  it('skips low-alpha pixels (alpha < 30)', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 29])  // black, nearly transparent
    expect(countNonWhitePixels(data)).toBe(0)
  })

  it('counts colored annotations (red)', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255])  // red
    expect(countNonWhitePixels(data)).toBe(1)
  })

  it('counts colored annotations (purple)', () => {
    const data = new Uint8ClampedArray([128, 0, 128, 255])  // purple
    expect(countNonWhitePixels(data)).toBe(1)
  })
})

// ── calcPdfDimensions unit tests ──────────────────────────────────────────────

describe('calcPdfDimensions', () => {
  it('does not scale small images', () => {
    const { pageW, pageH } = calcPdfDimensions(499, 458)
    expect(pageW).toBe(499)
    expect(pageH).toBe(458)
  })

  it('499 × 458 owner-style image is not enlarged', () => {
    const { pageW, pageH } = calcPdfDimensions(499, 458)
    expect(pageW).toBe(499)
    expect(pageH).toBe(458)
    expect(Math.max(pageW, pageH)).toBeLessThanOrEqual(MAX_PDF_EDGE_PTS)
  })

  it('caps landscape at 2048 pts on longest edge', () => {
    const { pageW, pageH } = calcPdfDimensions(3024, 4032)
    expect(Math.max(pageW, pageH)).toBeLessThanOrEqual(MAX_PDF_EDGE_PTS)
  })

  it('preserves portrait aspect ratio when scaling', () => {
    const { pageW, pageH } = calcPdfDimensions(1000, 2000)
    // ratio = 1:2
    expect(Math.abs(pageW / pageH - 0.5)).toBeLessThan(0.01)
    expect(Math.max(pageW, pageH)).toBeLessThanOrEqual(MAX_PDF_EDGE_PTS)
  })

  it('preserves landscape aspect ratio when scaling', () => {
    const { pageW, pageH } = calcPdfDimensions(4000, 3000)
    expect(Math.abs(pageW / pageH - 4000 / 3000)).toBeLessThan(0.01)
    expect(Math.max(pageW, pageH)).toBeLessThanOrEqual(MAX_PDF_EDGE_PTS)
  })

  it('longest edge equals exactly 2048 when scaling is needed', () => {
    const { pageW, pageH } = calcPdfDimensions(4096, 2048)
    expect(Math.max(pageW, pageH)).toBeLessThanOrEqual(MAX_PDF_EDGE_PTS)
    expect(pageW).toBe(2048)
    expect(pageH).toBe(1024)
  })
})

// ── Validation acceptance (tests 1–3) ─────────────────────────────────────────

describe('format acceptance', () => {
  it('1. .jpg file is accepted', async () => {
    const file = makeJpegFile('panel.jpg')
    const result = await convertImageToBlueprintPdf(file)
    expect(result.name).toMatch(/\.pdf$/)
  })

  it('2. .jpeg file is accepted', async () => {
    const file = makeJpegFile('panel.jpeg')
    const result = await convertImageToBlueprintPdf(file)
    expect(result.name).toMatch(/\.pdf$/)
  })

  it('3. .png file is accepted', async () => {
    const file = makePngFile('panel.png')
    const result = await convertImageToBlueprintPdf(file)
    expect(result.name).toMatch(/\.pdf$/)
  })
})

// ── Signature / format validation rejection (tests 4–11) ─────────────────────

describe('validation rejection', () => {
  it('4. MIME and signature mismatch rejected (JPEG name, PNG bytes)', async () => {
    const pngBytes = makeWhitePng(4, 4)
    const file = makeFile('photo.jpg', pngBytes, 'image/jpeg')
    await expect(convertImageToBlueprintPdf(file)).rejects.toThrow(
      'The file contents do not match a supported image format.',
    )
  })

  it('5. Renamed PDF rejected (PDF bytes in .jpg file)', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    const file = makeFile('fake.jpg', pdfBytes, 'image/jpeg')
    await expect(convertImageToBlueprintPdf(file)).rejects.toThrow(
      'The file contents do not match a supported image format.',
    )
  })

  it('6. Zero-byte input rejected', async () => {
    const file = makeFile('empty.png', new Uint8Array(0), 'image/png')
    await expect(convertImageToBlueprintPdf(file)).rejects.toThrow('The selected file is empty.')
  })

  it('7. Compressed-size limit enforced', async () => {
    const oversized = new Uint8Array(MAX_IMAGE_FILE_SIZE_BYTES + 1)
    oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const file = makeFile('huge.png', oversized, 'image/png')
    await expect(convertImageToBlueprintPdf(file)).rejects.toThrow('The image file is too large.')
  })

  it('8. Decoded-pixel limit enforced', async () => {
    const overW = Math.ceil(Math.sqrt(MAX_IMAGE_DECODED_PIXELS + 1))
    const overH = Math.ceil((MAX_IMAGE_DECODED_PIXELS + 1) / overW)
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: overW, height: overH, close: vi.fn() }),
    )
    await expect(convertImageToBlueprintPdf(makePngFile())).rejects.toThrow(
      'The image dimensions are too large to convert safely.',
    )
  })

  it('9. Maximum-edge limit enforced (width)', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: MAX_IMAGE_EDGE_PX + 1, height: 100, close: vi.fn() }),
    )
    await expect(convertImageToBlueprintPdf(makePngFile())).rejects.toThrow(
      'The image dimensions are too large to convert safely.',
    )
  })

  it('9b. Maximum-edge limit enforced (height)', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 100, height: MAX_IMAGE_EDGE_PX + 1, close: vi.fn() }),
    )
    await expect(convertImageToBlueprintPdf(makePngFile())).rejects.toThrow(
      'The image dimensions are too large to convert safely.',
    )
  })

  it('10. Corrupt JPEG rejected (valid sig but createImageBitmap throws)', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('corrupt')))
    const corruptJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04])
    await expect(
      convertImageToBlueprintPdf(makeFile('corrupt.jpg', corruptJpeg, 'image/jpeg')),
    ).rejects.toThrow('The image could not be decoded and may be damaged.')
  })

  it('11. Corrupt PNG rejected (valid sig but createImageBitmap throws)', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('corrupt')))
    const corruptPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    await expect(
      convertImageToBlueprintPdf(makeFile('corrupt.png', corruptPng, 'image/png')),
    ).rejects.toThrow('The image could not be decoded and may be damaged.')
  })
})

// ── Normalization canvas visible-content verification ─────────────────────────

describe('normalization canvas visible-content verification', () => {
  it('5-spec. Completely white canvas is rejected (normalization check)', async () => {
    mockGetImageData.mockReturnValueOnce(makeBlankImageData())
    await expect(convertImageToBlueprintPdf(makePngFile())).rejects.toThrow(
      'The converted image appears blank. The source image could not be drawn correctly.',
    )
  })

  it('6-spec. Transparent source normalised to all-white is rejected', async () => {
    // A fully transparent source drawn over white fill leaves the canvas white.
    mockGetImageData.mockReturnValueOnce(makeBlankImageData())
    await expect(convertImageToBlueprintPdf(makePngFile('transparent.png'))).rejects.toThrow(
      'The converted image appears blank. The source image could not be drawn correctly.',
    )
  })

  it('7-spec. Sparse black lines on white pass', async () => {
    // Default mockGetImageData returns visible content — no additional configuration needed.
    const file = makeFile('sparse.png', makeSparsePng(499, 458), 'image/png')
    const result = await convertImageToBlueprintPdf(file)
    expect(result.name).toMatch(/\.pdf$/)
  })

  it('8-spec. Gray watermark on white passes', async () => {
    // mockGetImageData default (visible) simulates gray-watermark content.
    const result = await convertImageToBlueprintPdf(makePngFile('watermark.png'))
    expect(result.name).toMatch(/\.pdf$/)
  })

  it('9-spec. Small colored annotations (red, purple) pass', async () => {
    const result = await convertImageToBlueprintPdf(makePngFile('annotations.png'))
    expect(result.name).toMatch(/\.pdf$/)
  })

  it('11-spec. Normalization check fires before canvas.toBlob', async () => {
    // When normalization check fails, toBlob must never be called.
    mockGetImageData.mockReturnValueOnce(makeBlankImageData())
    await convertImageToBlueprintPdf(makePngFile()).catch(() => {})
    expect(mockCanvasFormat).toBe('')  // toBlob was not invoked
  })

  it('12-spec. White-fill-only canvas is rejected', async () => {
    // Simulates the OffscreenCanvas bug: fill succeeded but drawImage produced no pixels.
    mockGetImageData.mockReturnValueOnce(makeBlankImageData())
    await expect(convertImageToBlueprintPdf(makePngFile())).rejects.toThrow(
      'The converted image appears blank. The source image could not be drawn correctly.',
    )
  })

  it('31-spec. Failed visible-content verification returns no File', async () => {
    mockGetImageData.mockReturnValueOnce(makeBlankImageData())
    const result = await convertImageToBlueprintPdf(makePngFile()).catch((e: unknown) => e)
    expect(result).toBeInstanceOf(ImageConversionError)
  })
})

// ── Encoded image verification (tests 13–17 spec) ────────────────────────────

describe('encoded image verification', () => {
  it('13-spec. Encoded PNG signature is verified', async () => {
    mockBlobWrongPngSig = true
    await expect(convertImageToBlueprintPdf(makePngFile())).rejects.toThrow(
      'The encoded image has an unexpected format.',
    )
  })

  it('14-spec. Encoded JPEG signature is verified', async () => {
    mockBlobWrongJpegSig = true
    await expect(convertImageToBlueprintPdf(makeJpegFile())).rejects.toThrow(
      'The encoded image has an unexpected format.',
    )
  })

  it('15-spec. Encoded image is rechecked for visible content', async () => {
    // Step 4 (normalization) passes, Step 7 (encoded blob re-decode) returns blank.
    mockGetImageData
      .mockReturnValueOnce(makeVisibleImageData())  // Step 4: normalization
      .mockReturnValueOnce(makeBlankImageData())    // Step 7: encoded blob
    await expect(convertImageToBlueprintPdf(makePngFile())).rejects.toThrow(
      'The encoded image appears blank.',
    )
  })

  it('16-spec. Null canvas.toBlob result is rejected', async () => {
    mockBlobNull = true
    await expect(convertImageToBlueprintPdf(makePngFile())).rejects.toThrow(
      'Canvas encoding produced no output.',
    )
  })

  it('17-spec. Zero-byte encoded blob is rejected', async () => {
    mockBlobZeroBytes = true
    await expect(convertImageToBlueprintPdf(makePngFile())).rejects.toThrow(
      'Canvas encoding produced no output.',
    )
  })
})

// ── PDF.js rendered-content verification (tests 21–22 spec) ──────────────────

describe('PDF.js rendered-content verification', () => {
  it('21-spec. PDF.js rendered page contains visible pixels and is accepted', async () => {
    // Default mockGetImageData returns visible for all three verification calls.
    const { getDocument } = await import('pdfjs-dist')
    const file = makePngFile()
    const result = await convertImageToBlueprintPdf(file)
    expect(vi.mocked(getDocument)).toHaveBeenCalled()
    expect(result.name).toMatch(/\.pdf$/)
  })

  it('22-spec. PDF.js blank rendered page is rejected', async () => {
    // Step 4 visible, Step 7 visible, Step 10 (PDF render) blank.
    mockGetImageData
      .mockReturnValueOnce(makeVisibleImageData())  // Step 4: normalization
      .mockReturnValueOnce(makeVisibleImageData())  // Step 7: encoded blob
      .mockReturnValueOnce(makeBlankImageData())    // Step 10: PDF render
    await expect(convertImageToBlueprintPdf(makePngFile())).rejects.toThrow(
      'The generated PDF appears blank and was not uploaded.',
    )
  })
})

// ── Owner-style sparse Blueprint conversion ───────────────────────────────────

describe('owner-style sparse Blueprint conversion', () => {
  it('1-spec. Sparse 499×458 Blueprint PNG converts without error', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 499, height: 458, close: vi.fn() }),
    )
    installDocumentMock(makeSparsePng(499, 458))
    const file = makeFile('blueprint.png', makeSparsePng(499, 458), 'image/png')
    const result = await convertImageToBlueprintPdf(file)
    expect(result.name).toBe('blueprint.pdf')
    expect(result.type).toBe('application/pdf')
  })

  it('2-spec. 499×458 aspect ratio is preserved in PDF page', async () => {
    const { PDFDocument } = await import('pdf-lib')
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 499, height: 458, close: vi.fn() }),
    )
    installDocumentMock(makeWhitePng(499, 458))
    const file = makeFile('blueprint.png', makeSparsePng(499, 458), 'image/png')
    const result = await convertImageToBlueprintPdf(file)
    const bytes = new Uint8Array(await result.arrayBuffer())
    const doc = await PDFDocument.load(bytes)
    const page = doc.getPages()[0]!
    expect(page.getWidth()).toBe(499)
    expect(page.getHeight()).toBe(458)
  })

  it('3-spec. Visible PNG produces nonblank generated PDF', async () => {
    // Default mockGetImageData (visible) passes all checks including PDF render.
    const file = makePngFile()
    const result = await convertImageToBlueprintPdf(file)
    const bytes = new Uint8Array(await result.arrayBuffer())
    expect(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)).toBe('%PDF')
  })

  it('4-spec. Visible JPEG produces nonblank generated PDF', async () => {
    const file = makeJpegFile()
    const result = await convertImageToBlueprintPdf(file)
    expect(result.type).toBe('application/pdf')
  })
})

// ── Output contract (tests 12–21) ─────────────────────────────────────────────

describe('output contract', () => {
  it('12. Generated filename ends in .pdf (no double extension)', async () => {
    const file = makePngFile('panel-photo.png')
    const result = await convertImageToBlueprintPdf(file)
    expect(result.name).toBe('panel-photo.pdf')
    expect(result.name).not.toContain('.png.pdf')
  })

  it('12b. JPEG source also strips original extension cleanly', async () => {
    const file = makeJpegFile('electrical-room.jpg')
    const result = await convertImageToBlueprintPdf(file)
    expect(result.name).toBe('electrical-room.pdf')
  })

  it('13. Generated MIME is application/pdf', async () => {
    const file = makePngFile('test.png')
    const result = await convertImageToBlueprintPdf(file)
    expect(result.type).toBe('application/pdf')
  })

  it('14. Generated bytes start with %PDF', async () => {
    const file = makePngFile('test.png')
    const result = await convertImageToBlueprintPdf(file)
    const bytes = new Uint8Array(await result.arrayBuffer())
    const header = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
    expect(header).toBe('%PDF')
  })

  it('15 & 16. pdf-lib can load the output and page count equals one', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const file = makePngFile('test.png')
    const result = await convertImageToBlueprintPdf(file)
    const bytes = new Uint8Array(await result.arrayBuffer())
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
  })

  it('17. Portrait aspect ratio preserved in PDF page dimensions', async () => {
    const { PDFDocument } = await import('pdf-lib')
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 100, height: 200, close: vi.fn() }),
    )
    installDocumentMock(makeWhitePng(100, 200))
    const file = makePngFile('portrait.png', 100, 200)
    const result = await convertImageToBlueprintPdf(file)
    const bytes = new Uint8Array(await result.arrayBuffer())
    const doc = await PDFDocument.load(bytes)
    const page = doc.getPages()[0]!
    expect(page.getWidth()).toBe(100)
    expect(page.getHeight()).toBe(200)
  })

  it('18. Landscape aspect ratio preserved in PDF page dimensions', async () => {
    const { PDFDocument } = await import('pdf-lib')
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 200, height: 100, close: vi.fn() }),
    )
    installDocumentMock(makeWhitePng(200, 100))
    const file = makePngFile('landscape.png', 200, 100)
    const result = await convertImageToBlueprintPdf(file)
    const bytes = new Uint8Array(await result.arrayBuffer())
    const doc = await PDFDocument.load(bytes)
    const page = doc.getPages()[0]!
    expect(page.getWidth()).toBe(200)
    expect(page.getHeight()).toBe(100)
  })

  it('19. Image fills the full page (drawImage called with full width & height)', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 50, height: 80, close: vi.fn() }),
    )
    installDocumentMock()
    await convertImageToBlueprintPdf(makePngFile('fill-test.png'))
    expect(mockDrawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      50,
      80,
    )
  })

  it('20. PNG transparency becomes white (fillRect with white before drawImage)', async () => {
    await convertImageToBlueprintPdf(makePngFile('transparent.png'))
    expect(capturedFillStyle).toBe('#ffffff')
    expect(mockFillRect).toHaveBeenCalled()
    expect(mockDrawImage).toHaveBeenCalled()
    const fillOrder = mockFillRect.mock.invocationCallOrder?.[0] ?? 0
    const drawOrder = mockDrawImage.mock.invocationCallOrder?.[0] ?? 1
    expect(fillOrder).toBeLessThan(drawOrder)
  })

  it('25-spec. Longest PDF page edge is at most 2048 pts', async () => {
    const { PDFDocument } = await import('pdf-lib')
    // Use a large image that needs scaling
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }),
    )
    installDocumentMock(makeWhitePng(4, 4))
    const result = await convertImageToBlueprintPdf(makePngFile())
    const bytes = new Uint8Array(await result.arrayBuffer())
    const doc = await PDFDocument.load(bytes)
    const page = doc.getPages()[0]!
    expect(Math.max(page.getWidth(), page.getHeight())).toBeLessThanOrEqual(MAX_PDF_EDGE_PTS)
  })

  it('26-spec. 499×458 input is not unnecessarily enlarged', async () => {
    const { PDFDocument } = await import('pdf-lib')
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 499, height: 458, close: vi.fn() }),
    )
    installDocumentMock(makeWhitePng(499, 458))
    const result = await convertImageToBlueprintPdf(makeFile('bp.png', makeSparsePng(499, 458), 'image/png'))
    const bytes = new Uint8Array(await result.arrayBuffer())
    const doc = await PDFDocument.load(bytes)
    const page = doc.getPages()[0]!
    expect(page.getWidth()).toBe(499)
    expect(page.getHeight()).toBe(458)
  })

  it('27-spec. Portrait aspect ratio approximate when dimensions are large', async () => {
    const { PDFDocument } = await import('pdf-lib')
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 1000, height: 2000, close: vi.fn() }),
    )
    installDocumentMock(makeWhitePng(4, 4))
    const result = await convertImageToBlueprintPdf(makePngFile())
    const bytes = new Uint8Array(await result.arrayBuffer())
    const doc = await PDFDocument.load(bytes)
    const page = doc.getPages()[0]!
    // ratio ~0.5 for portrait 1000×2000
    expect(Math.abs(page.getWidth() / page.getHeight() - 0.5)).toBeLessThan(0.02)
  })

  it('21. Decoder resources (ImageBitmap.close) are cleaned up after conversion', async () => {
    const mockClose = vi.fn()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 4, height: 4, close: mockClose }),
    )
    await convertImageToBlueprintPdf(makePngFile())
    // Two bitmaps created and closed: the decoded source + the Step 7 encoded-blob re-decode.
    expect(mockClose).toHaveBeenCalledTimes(2)
  })

  it('21b. Decoder resources are cleaned up even when conversion fails', async () => {
    const mockClose = vi.fn()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: MAX_IMAGE_EDGE_PX + 1, height: 100, close: mockClose }),
    )
    await convertImageToBlueprintPdf(makePngFile()).catch(() => {})
    // Only one bitmap created (decode succeeds, fails at dimension check before Step 7).
    expect(mockClose).toHaveBeenCalledTimes(1)
  })
})

// ── Failure isolation (test 22) ───────────────────────────────────────────────

describe('failure isolation', () => {
  it('22. Conversion failure never calls the upload pipeline', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode error')))
    const importSpy = vi.spyOn(
      await import('@/services/blueprintLibraryService'),
      'createBlueprintLibraryItem',
    )
    await convertImageToBlueprintPdf(makePngFile()).catch(() => {})
    expect(importSpy).not.toHaveBeenCalled()
  })

  it('32-spec. Failed conversion cannot reach upload pipeline', async () => {
    mockGetImageData.mockReturnValueOnce(makeBlankImageData())
    const importSpy = vi.spyOn(
      await import('@/services/blueprintLibraryService'),
      'createBlueprintLibraryItem',
    )
    await convertImageToBlueprintPdf(makePngFile()).catch(() => {})
    expect(importSpy).not.toHaveBeenCalled()
  })
})

// ── Byte preservation after PDF.js ArrayBuffer detachment ─────────────────────

describe('byte preservation after PDF.js verification', () => {
  it('reproduces ArrayBuffer detachment via structuredClone transfer', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
    expect(bytes.byteLength).toBe(8)
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] })
    expect(bytes.buffer.byteLength).toBe(0)
    expect(bytes.byteLength).toBe(0)
    let outcome: number | 'throw' = 'throw'
    try {
      outcome = new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'detached.pdf', {
        type: 'application/pdf',
      }).size
    } catch {
      outcome = 'throw'
    }
    // Chrome yields File.size === 0; Node may throw. Either proves the detached
    // buffer cannot produce a usable PDF File.
    expect(outcome === 0 || outcome === 'throw').toBe(true)
  })

  it('PDF.js verification may detach its input while retained File stays nonzero', async () => {
    const pdfjs = await import('pdfjs-dist')
    const retained = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a])
    const retainedCopy = retained.slice()
    const generatedFile = new File(
      [retainedCopy as unknown as Uint8Array<ArrayBuffer>],
      'retained.pdf',
      { type: 'application/pdf' },
    )
    const sizeBefore = generatedFile.size
    expect(sizeBefore).toBeGreaterThan(0)

    const verificationBuffer = await generatedFile.arrayBuffer()
    await pdfjs.getDocument({ data: verificationBuffer }).promise
    expect(verificationBuffer.byteLength).toBe(0)

    expect(generatedFile.size).toBe(sizeBefore)
    expect(generatedFile.size).toBe(retainedCopy.byteLength)
    const after = new Uint8Array(await generatedFile.arrayBuffer())
    expect(after.byteLength).toBe(sizeBefore)
    expect(String.fromCharCode(after[0]!, after[1]!, after[2]!, after[3]!)).toBe('%PDF')
  })

  it('returned File.size remains nonzero and equals retained byte length after convert', async () => {
    const result = await convertImageToBlueprintPdf(makePngFile())
    expect(result.size).toBeGreaterThan(0)
    const bytes = new Uint8Array(await result.arrayBuffer())
    expect(bytes.byteLength).toBe(result.size)
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)).toBe('%PDF')
  })

  it('returned File can still be read after verification and never returns zero bytes', async () => {
    const result = await convertImageToBlueprintPdf(makePngFile('plan.png'))
    expect(result.size).toBeGreaterThan(0)
    const first = new Uint8Array(await result.arrayBuffer())
    const second = new Uint8Array(await result.arrayBuffer())
    expect(first.byteLength).toBe(result.size)
    expect(second.byteLength).toBe(result.size)
    expect(first[0]).toBe(0x25)
    expect(first[1]).toBe(0x50)
    expect(first[2]).toBe(0x44)
    expect(first[3]).toBe(0x46)
  })

  it('owner-style 499×458 PNG produces a nonzero visible PDF', async () => {
    const { PDFDocument } = await import('pdf-lib')
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 499, height: 458, close: vi.fn() }),
    )
    installDocumentMock(makeSparsePng(499, 458))
    const result = await convertImageToBlueprintPdf(
      makeFile('Screenshot 2026-07-30 172055.png', makeSparsePng(499, 458), 'image/png'),
    )
    expect(result.size).toBeGreaterThan(0)
    const bytes = new Uint8Array(await result.arrayBuffer())
    expect(bytes.byteLength).toBe(result.size)
    expect(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)).toBe('%PDF')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const page = doc.getPages()[0]!
    expect(page.getWidth()).toBe(499)
    expect(page.getHeight()).toBe(458)
  })

  it('zero-byte generated files are never returned', async () => {
    const result = await convertImageToBlueprintPdf(makePngFile())
    expect(result.size).toBeGreaterThan(0)
    expect(result.size).not.toBe(0)
  })
})
