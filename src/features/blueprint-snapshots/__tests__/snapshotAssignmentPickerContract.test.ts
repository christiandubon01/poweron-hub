import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const picker = readFileSync(join(process.cwd(), 'src/features/blueprint-snapshots/SnapshotAssignmentPicker.tsx'), 'utf8')
const library = readFileSync(join(process.cwd(), 'src/features/blueprint-snapshots/SnapshotLibraryDialog.tsx'), 'utf8')
const viewport = readFileSync(join(process.cwd(), 'src/features/blueprint-snapshots/BlueprintSnapshotPreviewViewport.tsx'), 'utf8')
const service = readFileSync(join(process.cwd(), 'src/features/blueprint-snapshots/blueprintSnapshotService.ts'), 'utf8')
const panel = readFileSync(join(process.cwd(), 'src/components/admin/AdminTaskDelegationPanel.tsx'), 'utf8')

describe('Snapshot assignment picker UI contract', () => {
  it('renders only in create mode and gates missing assignment context', () => {
    expect(panel).toContain('<SnapshotAssignmentPicker')
    const editBlock = panel.slice(panel.indexOf('{editingId ? ('), panel.indexOf(') : (', panel.indexOf('{editingId ? (')))
    expect(editBlock).not.toContain('SnapshotAssignmentPicker')
    expect(picker).toContain('Select a project, Blueprint, and Work Package before attaching snapshots.')
    expect(picker).toContain('disabled={!contextReady}')
  })

  it('prefilters to matching project, Blueprint, and untagged-or-matching Work Package', () => {
    expect(picker).toContain('mode="select"')
    expect(picker).toContain('projectId,')
    expect(picker).toContain('blueprintSetId,')
    expect(picker).toContain('workPackageId,')
    expect(picker).toContain("workPackageMode: 'untagged-or-matching'")
    expect(service).toContain('work_package_id.is.null')
  })

  it('supports max eight, duplicate prevention through selected set, move up, move down, and remove', () => {
    expect(library).toContain('MAX_SELECTED_SNAPSHOTS = 8')
    expect(library).toContain('selectedSet.has(id)')
    expect(library).toContain('Maximum of 8 snapshots.')
    expect(picker).toContain('ArrowUp')
    expect(picker).toContain('ArrowDown')
    expect(picker).toContain('Move snapshot up')
    expect(picker).toContain('Move snapshot down')
    expect(picker).toContain('Remove snapshot')
  })

  it('preserves selected order on failure and clears only successful or fresh create/reset paths', () => {
    expect(panel).toContain('const [selectedSnapshotIds, setSelectedSnapshotIds] = useState<string[]>([])')
    expect(panel).toContain('if (!res.success) {')
    const createCall = panel.indexOf('const res = await createTaskAssignmentWithWorkOrderAndSnapshots')
    const failureBranch = panel.slice(panel.indexOf('if (!res.success) {', createCall), panel.indexOf('setFormOpen(false)', createCall))
    expect(failureBranch).not.toContain('setSelectedSnapshotIds([])')
    expect(panel).toContain('setSelectedSnapshotIds([])')
    expect(panel).toContain('snapshotIds: selectedSnapshotIds')
  })

  it('shows safe unavailable and caption messages without raw backend payloads', () => {
    expect(library).toContain('Snapshot library is not available yet.')
    expect(library).toContain('No snapshots found.')
    expect(library).toContain('Preview unavailable.')
    expect(library).toContain('onError=')
    expect(library).toContain('forceRefresh: true')
    expect(library).toContain('Retry')
    expect(library).toContain('Could not update caption.')
    expect(library).not.toContain('storage_path')
  })

  it('uses the same shared browser for management and assignment selection metadata', () => {
    expect(library).toContain("type SnapshotBrowserMode = 'manage' | 'select'")
    expect(library).toContain('browserMode === \'select\'')
    expect(library).toContain('browserMode === \'manage\'')
    expect(library).toContain('updateBlueprintSnapshotWorkPackage')
    expect(library).toContain('WorkPackageSnapshotSection')
    expect(picker).toContain('<SnapshotLibraryDialog')
    expect(picker).toContain('projectOptions=')
    expect(picker).toContain('blueprintOptions=')
    expect(picker).toContain('workPackageOptions=')
  })

  it('keeps Delete management-only with tagged and Work Order attachment guards', () => {
    expect(library).toContain("browserMode === 'manage'")
    expect(library).toContain('deleteBlueprintSnapshot')
    expect(library).toContain('requestDelete(item)')
    expect(library).toContain('Attached to an issued Work Order.')
    expect(library).toContain('Return this snapshot to Untagged before deleting it.')
    expect(library).toContain('disabled={Boolean(deleteBlockedReason)}')
    expect(picker).toContain("mode=\"select\"")
    expect(library).not.toContain('assignment_snapshots.update')
  })

  it('uses one shared zoom preview in management and selection modes and keeps signed URL retry behavior', () => {
    expect(library).toContain('BlueprintSnapshotPreviewViewport')
    expect(library).toContain('imageUrl={previewUrl}')
    expect(library).toContain('resetKey={previewId}')
    expect(viewport).toContain('Fit')
    expect(viewport).toContain('100%')
    expect(viewport).toContain('Zoom in')
    expect(viewport).toContain('Zoom out')
    expect(viewport).toContain('onPointerDown={handlePointerDown}')
    expect(viewport).toContain('shrink-0 flex-wrap')
    expect(viewport).toContain('relative min-h-0 flex-1 overflow-hidden bg-white')
    expect(viewport).not.toContain('absolute top-')
    expect(viewport).not.toContain('-mt-')
    expect(library).toContain('forceRefresh: true')
    expect(library).toContain('Preview unavailable.')
    expect((library.match(/<SnapshotLibraryDialog/g) || []).length).toBeGreaterThanOrEqual(1)
  })

  it('routes save, delete, caption, and Work Package updates through exact shared change events', () => {
    expect(service).toContain("notifyBlueprintSnapshotLibraryChanged({ type: 'upsert', snapshot, source: 'save' })")
    expect(service).toContain("notifyBlueprintSnapshotLibraryChanged({ type: 'upsert', snapshot, source: 'caption' })")
    expect(service).toContain("notifyBlueprintSnapshotLibraryChanged({ type: 'upsert', snapshot, source: 'work-package' })")
    expect(service).toContain("notifyBlueprintSnapshotLibraryChanged({ type: 'delete', snapshotId: cleanId, source: 'delete' })")
    expect(library).toContain('applyLibraryChange(event)')
  })
})
