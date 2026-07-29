import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const viewer = readFileSync(join(process.cwd(), 'src/components/blueprint/OperationsBlueprintPdfViewer.tsx'), 'utf8')

describe('desktop Snapshot Library entry contract', () => {
  it('keeps Library in the desktop three-pane Capture Area / Full Page cluster', () => {
    const desktopBlockStart = viewer.indexOf('ref={snapshotCaptureButtonRef}', viewer.indexOf('Row 2: zoom'))
    const desktopBlock = viewer.slice(desktopBlockStart, viewer.indexOf('{(isLoading || isRendering)', desktopBlockStart))
    const captureCluster = desktopBlock

    expect(captureCluster).toContain('aria-label="Capture Area"')
    expect(captureCluster).toContain('aria-label="Capture Full Page"')
    expect(captureCluster).toContain('title="Open Snapshot Library"')
    expect(captureCluster).toContain('aria-label="Open Snapshot Library"')
    expect(captureCluster).toContain('onClick={() => setIsSnapshotLibraryOpen(true)}')
    expect(captureCluster).toContain('<Layers size={16} />')
    expect(captureCluster).toContain('<span>Library</span>')
    expect(captureCluster.indexOf('aria-label="Capture Area"')).toBeLessThan(captureCluster.indexOf('aria-label="Capture Full Page"'))
    expect(captureCluster.indexOf('aria-label="Capture Full Page"')).toBeLessThan(captureCluster.indexOf('aria-label="Open Snapshot Library"'))
  })

  it('preserves compact/tablet Library actions and opens one shared dialog state', () => {
    expect((viewer.match(/setIsSnapshotLibraryOpen\(true\)/g) || []).length).toBeGreaterThanOrEqual(3)
    expect(viewer).toContain('<SnapshotLibraryDialog')
    expect(viewer).toContain('open={isSnapshotLibraryOpen}')
    expect(viewer).toContain('onClose={() => setIsSnapshotLibraryOpen(false)}')
    expect(viewer).not.toContain('AdminTaskDelegation')
    expect(viewer).not.toContain('navigate(')
  })

  it('desktop Library action mutates only Snapshot Library dialog state', () => {
    const buttonStart = viewer.indexOf('title="Open Snapshot Library"', viewer.indexOf('Row 2: zoom'))
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
