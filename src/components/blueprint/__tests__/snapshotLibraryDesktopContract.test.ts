import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const viewer = readFileSync(join(process.cwd(), 'src/components/blueprint/OperationsBlueprintPdfViewer.tsx'), 'utf8')

describe('desktop Snapshot Library entry contract', () => {
  it('keeps one desktop Snapshots & History section with history, capture, and library callbacks', () => {
    expect((viewer.match(/Snapshots &amp; History/g) || []).length).toBe(1)
    const sectionStart = viewer.indexOf('Snapshots &amp; History')
    const section = viewer.slice(sectionStart, viewer.indexOf('{toolbarBucket ===', sectionStart))

    expect(section).toContain("applyAnnotationHistory('undo')")
    expect(section).toContain("applyAnnotationHistory('redo')")
    expect(section).toContain('beginSnapshotAreaSelection')
    expect(section).toContain('handleCaptureSnapshot(null)')
    expect(section).toContain('setIsSnapshotLibraryOpen(true)')
    expect(section.indexOf('aria-label="Capture Area"')).toBeLessThan(section.indexOf('aria-label="Capture Full Page"'))
    expect(section.indexOf('aria-label="Capture Full Page"')).toBeLessThan(section.indexOf('aria-label="Open Snapshot Library"'))
  })

  it('removes duplicate desktop title-strip controls while preserving compact/tablet Library actions', () => {
    const titleStripStart = viewer.indexOf('{/* Title strip */}')
    const titleStrip = viewer.slice(titleStripStart, viewer.indexOf('{!hasStoragePath', titleStripStart))

    expect(titleStrip).not.toContain('aria-label="Capture Area"')
    expect(titleStrip).not.toContain('aria-label="Capture Full Page"')
    expect(titleStrip).not.toContain('aria-label="Open Snapshot Library"')
    expect((viewer.match(/setIsSnapshotLibraryOpen\(true\)/g) || []).length).toBeGreaterThanOrEqual(3)
    expect(viewer).toContain('<SnapshotLibraryDialog')
    expect(viewer).toContain('open={isSnapshotLibraryOpen}')
    expect(viewer).toContain('onClose={() => setIsSnapshotLibraryOpen(false)}')
    expect(viewer).not.toContain('AdminTaskDelegation')
    expect(viewer).not.toContain('navigate(')
  })

  it('desktop Library action mutates only Snapshot Library dialog state', () => {
    const buttonStart = viewer.indexOf('title="Open Snapshot Library"', viewer.indexOf('Snapshots &amp; History'))
    const buttonBody = viewer.slice(viewer.lastIndexOf('<button', buttonStart), viewer.indexOf('</button>', buttonStart))

    expect(buttonBody).toContain('setIsSnapshotLibraryOpen(true)')
    expect(buttonBody).not.toContain('setCurrentPage')
    expect(buttonBody).not.toContain('setRelativeZoom')
    expect(buttonBody).not.toContain('setRotation')
    expect(buttonBody).not.toContain('setToolMode')
    expect(buttonBody).not.toContain('loadPdf')
    expect(buttonBody).not.toContain('setLockView')
  })
})
