import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const picker = readFileSync(join(process.cwd(), 'src/features/blueprint-snapshots/SnapshotAssignmentPicker.tsx'), 'utf8')
const library = readFileSync(join(process.cwd(), 'src/features/blueprint-snapshots/SnapshotLibraryDialog.tsx'), 'utf8')
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
    expect(library).toContain('Could not update caption.')
    expect(library).not.toContain('storage_path')
  })
})
