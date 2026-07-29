import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dialog = readFileSync(join(process.cwd(), 'src/features/blueprint-snapshots/SnapshotLibraryDialog.tsx'), 'utf8')

function functionBody(name: string): string {
  const start = dialog.indexOf(`const ${name} = useCallback`)
  const next = dialog.indexOf('\n\n  const ', start + 1)
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
    expect(more).toContain('setItems((prev) => [...prev, ...res.snapshots])')
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
})
