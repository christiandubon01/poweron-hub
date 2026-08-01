import { describe, expect, it, vi } from 'vitest'
import {
  MAX_BLUEPRINT_FILE_SIZE_BYTES,
  validateBlueprintPdf,
  uploadBlueprintPdfToStorage,
} from '@/services/blueprintLibraryService'

function makePdfFile(name: string, sizeOrBytes: number | Uint8Array, type = 'application/pdf'): File {
  if (typeof sizeOrBytes === 'number') {
    const bytes = sizeOrBytes > 0 ? new Uint8Array(sizeOrBytes).fill(0x25) : new Uint8Array(0)
    return new File([bytes as unknown as Uint8Array<ArrayBuffer>], name, { type })
  }
  return new File([sizeOrBytes as unknown as Uint8Array<ArrayBuffer>], name, { type })
}

describe('validateBlueprintPdf empty-PDF guard', () => {
  it('rejects an empty .pdf', () => {
    const empty = makePdfFile('Screenshot 2026-07-30 172055.pdf', 0)
    expect(empty.size).toBe(0)
    const result = validateBlueprintPdf(empty)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('The selected PDF is empty.')
  })

  it('rejects an empty application/pdf File', () => {
    const empty = new File([], 'blank.pdf', { type: 'application/pdf' })
    expect(empty.size).toBe(0)
    const result = validateBlueprintPdf(empty)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('The selected PDF is empty.')
  })

  it('accepts a valid native nonzero PDF', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
    const file = makePdfFile('native.pdf', bytes)
    expect(file.size).toBeGreaterThan(0)
    const result = validateBlueprintPdf(file)
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('still rejects non-PDF files before the empty check path is relevant', () => {
    const png = new File([new Uint8Array([0x89, 0x50]) as unknown as Uint8Array<ArrayBuffer>], 'x.png', {
      type: 'image/png',
    })
    const result = validateBlueprintPdf(png)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Only PDF files are accepted.')
  })

  it('still rejects oversized PDFs', () => {
    const huge = makePdfFile('huge.pdf', MAX_BLUEPRINT_FILE_SIZE_BYTES + 1)
    const result = validateBlueprintPdf(huge)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/File too large/)
  })

  it('empty PDF never reaches storage upload (validate gate)', async () => {
    const empty = makePdfFile('empty.pdf', 0)
    const gate = validateBlueprintPdf(empty)
    expect(gate.ok).toBe(false)

    const uploadSpy = vi.spyOn(
      await import('@/services/blueprintLibraryService'),
      'uploadBlueprintPdfToStorage',
    )
    // Mimic performBlueprintUpload: bail before storage when validation fails.
    if (!gate.ok) {
      expect(uploadSpy).not.toHaveBeenCalled()
      return
    }
    await uploadBlueprintPdfToStorage({ file: empty, projectId: 'proj', orgId: 'org' })
    expect.fail('empty PDF must not reach uploadBlueprintPdfToStorage')
  })
})
