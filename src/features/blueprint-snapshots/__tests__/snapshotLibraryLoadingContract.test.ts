import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dialog = readFileSync(join(process.cwd(), 'src/features/blueprint-snapshots/SnapshotLibraryDialog.tsx'), 'utf8')

function functionBody(name: string): string {
  const start = dialog.indexOf(`const ${name} = useCallback`)
  const next = dialog.indexOf('\n\n  const ', start + 1)
  return dialog.slice(start, next === -1 ? undefined : next)
}

function namedFunctionBody(name: string): string {
  const start = dialog.indexOf(`function ${name}`)
  const next = dialog.indexOf('\n\nfunction ', start + 1)
  return dialog.slice(start, next === -1 ? undefined : next)
}

describe('SnapshotLibraryDialog loading contract', () => {
  it('separates initial/filter load from cursor-based Load More', () => {
    const initial = functionBody('loadInitialSnapshots')
    const more = functionBody('loadMoreSnapshots')

    expect(initial).toContain('cursor: null')
    expect(initial).toContain('setItems(res.snapshots)')
    expect(initial).not.toContain('cursor: nextCursor')
    expect(initial).not.toContain('...prev')

    expect(more).toContain('if (!nextCursor || loadingRef.current) return')
    expect(more).toContain('cursor: nextCursor')
    expect(more).toContain('setItems((prev) => dedupeSnapshotItems([...prev, ...res.snapshots]))')
  })

  it('does not let nextCursor changes retrigger the initial fetch', () => {
    const initial = functionBody('loadInitialSnapshots')
    const initialDeps = initial.slice(initial.lastIndexOf('}, ['))

    expect(initialDeps).toContain('[filters]')
    expect(initialDeps).not.toContain('nextCursor')
    expect(dialog).toContain('void loadInitialSnapshots()')
    expect(dialog).not.toContain('void load(false)')
    expect(dialog).not.toContain('[load, open]')
  })

  it('preserves stale-request protection and disables Load More while busy', () => {
    expect(dialog).toContain('requestRef.current += 1')
    expect(dialog).toContain('if (requestRef.current !== requestId) return')
    expect(dialog).toContain('loadingRef.current')
    expect(dialog).toContain('disabled={status === \'loading\' || status === \'loading-more\'}')
    expect(dialog).toContain('clearBlueprintSnapshotPreviewUrlCache()')
  })

  it('keeps one shared subscription while exact mutations update mounted state before any refresh', () => {
    expect(dialog).toContain('subscribeBlueprintSnapshotLibraryChanges')
    expect(dialog).toContain("event.type === 'refresh'")
    expect(dialog).toContain("event.type === 'upsert'")
    expect(dialog).toContain("event.type === 'delete'")
    expect(dialog).toContain('applyLibraryChange(event)')
    expect(dialog).toContain('void loadInitialSnapshots()')
  })

  it('removes successful deletes from shared state and clears the active preview without reload', () => {
    const changeBlock = dialog.slice(dialog.indexOf('const applyLibraryChange'), dialog.indexOf('useEffect(() => {', dialog.indexOf('const applyLibraryChange')))
    const confirmBlock = dialog.slice(dialog.indexOf('const confirmDelete'), dialog.indexOf('const projectFilterOptions'))

    expect(confirmBlock).toContain("res.status === 'deleted'")
    expect(confirmBlock).not.toContain('setItems((prev) => prev.filter')
    expect(changeBlock).toContain('setItems((prev) => prev.filter((row) => row.id !== event.snapshotId))')
    expect(changeBlock).toContain('delete next[event.snapshotId]')
    expect(changeBlock).toContain('current !== event.snapshotId')
    expect(changeBlock).toContain('setPreviewUrl(null)')
    expect(changeBlock).toContain('setPreviewStatus(\'idle\')')
    expect(changeBlock).not.toContain('window.location')
  })

  it('upserts matching capture or metadata rows immediately and dedupes repeated notifications', () => {
    const changeBlock = dialog.slice(dialog.indexOf('const applyLibraryChange'), dialog.indexOf('useEffect(() => {', dialog.indexOf('const applyLibraryChange')))

    expect(changeBlock).toContain('snapshotMatchesFilters(event.snapshot, filtersRef.current)')
    expect(changeBlock).toContain('const without = prev.filter((row) => row.id !== event.snapshot.id)')
    expect(changeBlock).toContain('return matches ? [event.snapshot, ...without] : without')
    expect(dialog).toContain('function dedupeSnapshotItems')
    expect(dialog).toContain('function snapshotMatchesFilters')
  })

  it('uses one shared full-width filter toolbar with the required responsive grid', () => {
    const toolbarMarker = 'data-snapshot-filter-toolbar="shared"'
    const filterBar = namedFunctionBody('FilterBar')
    const mainMarkup = dialog.slice(dialog.indexOf('return ('), dialog.indexOf('function FilterBar'))

    expect((dialog.match(new RegExp(toolbarMarker, 'g')) || []).length).toBe(1)
    expect(mainMarkup.indexOf('<FilterBar')).toBeLessThan(mainMarkup.indexOf('grid min-h-0 flex-1 grid-cols-1'))
    expect(filterBar).toContain('grid w-full grid-cols-2 items-end gap-x-3 gap-y-3 md:grid-cols-3 xl:grid-cols-6')
    expect(filterBar).not.toContain('browserMode')
  })

  it('keeps filter controls ordered, equal-height, and label-aligned', () => {
    const filterBar = namedFunctionBody('FilterBar')
    const selectFilter = namedFunctionBody('SelectFilter')
    const textFilter = namedFunctionBody('TextFilter')
    const order = [
      'label="Project"',
      'label="Blueprint"',
      'label="Page"',
      'Work Package',
      'Mode',
      'Reset',
    ].map((token) => filterBar.indexOf(token))

    expect(order.every((index) => index > -1)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(filterBar).toContain('className="h-10 w-full min-w-0 truncate rounded-md border border-gray-700 bg-[#0b111d] px-2 text-xs text-gray-100"')
    expect(filterBar).toContain('className="inline-flex h-10 w-full min-w-0 items-center justify-center gap-1 rounded-md border border-gray-700 px-2 text-xs font-semibold text-gray-300 hover:text-white"')
    expect(selectFilter).toContain('className="h-10 w-full min-w-0 truncate rounded-md border border-gray-700 bg-[#0b111d] px-2 text-xs text-gray-100"')
    expect(textFilter).toContain('className="h-10 w-full min-w-0 rounded-md border border-gray-700 bg-[#0b111d] px-2 text-xs text-gray-100"')
    expect(filterBar).toContain('className="mb-1 h-4 whitespace-nowrap leading-4">Work Package</span>')
    expect(filterBar).toContain('className="mb-1 h-4 whitespace-nowrap leading-4">Mode</span>')
    expect(selectFilter).toContain('className="mb-1 h-4 whitespace-nowrap leading-4">{label}</span>')
    expect(textFilter).toContain('className="mb-1 h-4 whitespace-nowrap leading-4">{label}</span>')
    expect(filterBar).toContain('Work Package</span>')
    expect(filterBar).toContain('whitespace-nowrap')
    expect(filterBar).toContain('aria-hidden="true"')
    expect(filterBar).toContain('<RotateCcw size={13} /> Reset')
  })
})
