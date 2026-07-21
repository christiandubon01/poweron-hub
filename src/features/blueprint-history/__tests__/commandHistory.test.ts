import { describe, expect, it, vi } from 'vitest'
import {
  applyAnnotationSnapshotsToList,
  buildAnnotationMutationCommand,
  buildAnnotationRestorePayload,
  clearHistoryScope,
  commitRedo,
  commitUndo,
  createCommandHistory,
  getScopeHistory,
  isHistoryCommandSourceCurrent,
  peekRedo,
  peekUndo,
  pushCommand,
} from '../commandHistory'
import type { AnnotationHistoryCommand, AnnotationHistoryScope } from '../types'
import type { BlueprintAnnotation } from '@/services/blueprintLibraryService'

const scope: AnnotationHistoryScope = {
  blueprintSetId: 'bp-1',
  projectId: 'project-1',
  pageNumber: 1,
}

function annotation(text: string, overrides: Partial<BlueprintAnnotation> = {}): BlueprintAnnotation {
  return {
    id: 'ann-1',
    blueprintSetId: scope.blueprintSetId,
    projectId: scope.projectId,
    pageNumber: scope.pageNumber,
    type: 'note',
    text,
    color: '#fff',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as BlueprintAnnotation
}

function command(
  transactionId: string,
  beforeText: string | null,
  afterText: string | null,
  overrides: Partial<AnnotationHistoryCommand> = {},
): AnnotationHistoryCommand {
  return {
    transactionId,
    label: `Command ${transactionId}`,
    scope,
    affectedAnnotationIds: ['ann-1'],
    before: { 'ann-1': beforeText == null ? null : annotation(beforeText) },
    after: { 'ann-1': afterText == null ? null : annotation(afterText) },
    selectionBefore: null,
    selectionAfter: 'ann-1',
    timestamp: 1,
    ...overrides,
  }
}

function mutationCommand(options: {
  id: string
  type: string
  before?: BlueprintAnnotation | null
  after?: BlueprintAnnotation | null
  label?: string
}): AnnotationHistoryCommand {
  const before = options.before === undefined
    ? null
    : options.before
  const after = options.after === undefined
    ? annotation('after', { id: options.id, type: options.type } as Partial<BlueprintAnnotation>)
    : options.after
  const built = buildAnnotationMutationCommand({
    transactionId: `tx-${options.id}`,
    label: options.label || `Mutate ${options.type}`,
    scope,
    before: { [options.id]: before },
    after: { [options.id]: after },
    selectionAfter: after ? options.id : null,
    timestamp: 10,
  })
  if (!built) throw new Error('Expected a history command')
  return built
}

describe('command history', () => {
  it('builds commands from changed snapshot maps and owns deep-cloned snapshots', () => {
    const before = annotation('before', { meta: { textStyle: { bold: false } } } as any)
    const after = annotation('after', { meta: { textStyle: { bold: true } } } as any)
    const built = buildAnnotationMutationCommand({
      transactionId: 'tx-builder',
      label: 'Edit note',
      scope,
      before: { 'ann-1': before },
      after: { 'ann-1': after },
      selectionBefore: 'ann-1',
      selectionAfter: 'ann-1',
      timestamp: 123,
    })
    expect(built?.affectedAnnotationIds).toEqual(['ann-1'])
    expect(built?.timestamp).toBe(123)
    ;(after as any).meta.textStyle.bold = false
    expect((built?.after['ann-1'] as any).meta.textStyle.bold).toBe(true)
  })

  it('does not create a command when snapshots differ only by persistence timestamps', () => {
    const before = annotation('same', { updatedAt: '2026-01-01T00:00:00.000Z' })
    const after = annotation('same', { updatedAt: '2026-07-20T00:00:00.000Z' })
    expect(buildAnnotationMutationCommand({
      transactionId: 'tx-noop',
      label: 'No-op',
      scope,
      before: { 'ann-1': before },
      after: { 'ann-1': after },
    })).toBeNull()
  })

  it.each([
    ['pen', { points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }], thickness: 3, opacity: 0.9 }],
    ['marker', { points: [{ x: 0.2, y: 0.3 }, { x: 0.5, y: 0.6 }], thickness: 12, opacity: 0.35 }],
    ['highlight', { opacity: 0.35 }],
  ])('round-trips a newly-created %s annotation without losing drawing metadata', (type, meta) => {
    const created = annotation(type, { id: `${type}-1`, type, meta, metadata: meta } as any)
    const historyCommand = mutationCommand({ id: created.id, type, after: created })
    const history = pushCommand(createCommandHistory(), historyCommand)
    expect(isHistoryCommandSourceCurrent(historyCommand, 'undo', [created])).toBe(true)
    const undoneList = applyAnnotationSnapshotsToList([created], historyCommand.affectedAnnotationIds, historyCommand.before)
    expect(undoneList).toEqual([])
    const undoneHistory = commitUndo(history, scope, historyCommand.transactionId)
    const redoneList = applyAnnotationSnapshotsToList(undoneList, historyCommand.affectedAnnotationIds, historyCommand.after)
    expect((redoneList[0] as any).meta).toEqual(meta)
    expect(peekRedo(undoneHistory, scope)?.transactionId).toBe(historyCommand.transactionId)
  })

  it.each([
    ['note', { textStyle: { bold: true }, anchor: { x: 0.2, y: 0.3 } }],
    ['callout', { textStyle: { fontSize: 18, align: 'center' }, box: { x: 0.2, y: 0.3, w: 0.25, h: 0.1 } }],
  ])('restores the complete %s text-edit snapshot', (type, meta) => {
    const before = annotation('before', { id: `${type}-edit`, type, meta, metadata: meta } as any)
    const afterMeta = { ...meta, textStyle: { ...meta.textStyle, italic: true } }
    const after = annotation('after', { id: before.id, type, meta: afterMeta, metadata: afterMeta } as any)
    const historyCommand = mutationCommand({ id: before.id, type, before, after })
    const restored = applyAnnotationSnapshotsToList([after], historyCommand.affectedAnnotationIds, historyCommand.before)
    expect(restored[0].text).toBe('before')
    expect((restored[0] as any).meta).toEqual(meta)
  })

  it.each(['measure-distance', 'measure-perimeter', 'measure-area'])('preserves %s points, labels, and style across replay', (type) => {
    const meta = {
      points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.5 }, { x: 0.7, y: 0.2 }],
      label: '12 ft',
      style: { lineThickness: 4, linePattern: 'dash-dot' },
    }
    const created = annotation('12 ft', { id: `${type}-1`, type, meta, metadata: meta } as any)
    const historyCommand = mutationCommand({ id: created.id, type, after: created })
    const restored = applyAnnotationSnapshotsToList([], historyCommand.affectedAnnotationIds, historyCommand.after)
    expect((restored[0] as any).meta).toEqual(meta)
  })

  it('undoes a paste by removing only the pasted identity', () => {
    const original = annotation('source', { id: 'original' })
    const pasted = annotation('source', { id: 'pasted', rect: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } } as any)
    const pasteCommand = mutationCommand({ id: pasted.id, type: pasted.type, after: pasted, label: 'Paste note' })
    const afterUndo = applyAnnotationSnapshotsToList([original, pasted], pasteCommand.affectedAnnotationIds, pasteCommand.before)
    expect(afterUndo.map((item) => item.id)).toEqual(['original'])
  })

  it('restores Light Output and Kelvin through the standard property-edit snapshot path', () => {
    const beforeMeta = { shapeKind: 'electrical-recessed-light', lightIntensity: 1, lightKelvin: 3000 }
    const afterMeta = { ...beforeMeta, lightIntensity: 4.5, lightKelvin: 4000 }
    const before = annotation('light', { id: 'light-1', type: 'shape', meta: beforeMeta, metadata: beforeMeta } as any)
    const after = annotation('light', { id: 'light-1', type: 'shape', meta: afterMeta, metadata: afterMeta } as any)
    const propertyCommand = mutationCommand({ id: 'light-1', type: 'shape', before, after, label: 'Edit light properties' })
    const undone = applyAnnotationSnapshotsToList([after], propertyCommand.affectedAnnotationIds, propertyCommand.before)
    const redone = applyAnnotationSnapshotsToList(undone, propertyCommand.affectedAnnotationIds, propertyCommand.after)
    expect((undone[0] as any).meta).toEqual(beforeMeta)
    expect((redone[0] as any).meta).toEqual(afterMeta)
  })

  it('records a three-annotation eraser gesture as one command and restores all three together', () => {
    const erased = ['erase-1', 'erase-2', 'erase-3'].map((id, index) => annotation(`item ${index}`, { id }))
    const before = Object.fromEntries(erased.map((item) => [item.id, item]))
    const after = Object.fromEntries(erased.map((item) => [item.id, null]))
    const eraseCommand = buildAnnotationMutationCommand({
      transactionId: 'tx-erase-three',
      label: 'Erase 3 annotations',
      scope,
      before,
      after,
      selectionBefore: erased[0].id,
    })!
    const history = pushCommand(createCommandHistory(), eraseCommand)
    expect(getScopeHistory(history, scope).past).toHaveLength(1)
    expect(peekUndo(history, scope)?.affectedAnnotationIds).toEqual(erased.map((item) => item.id))
    const restored = applyAnnotationSnapshotsToList([], eraseCommand.affectedAnnotationIds, eraseCommand.before)
    expect(restored.map((item) => item.id)).toEqual(erased.map((item) => item.id))
    const deletedAgain = applyAnnotationSnapshotsToList(restored, eraseCommand.affectedAnnotationIds, eraseCommand.after)
    expect(deletedAgain).toEqual([])
  })

  it('rejects an entire grouped undo when one erased annotation has externally reappeared', () => {
    const erased = ['erase-1', 'erase-2', 'erase-3'].map((id) => annotation(id, { id }))
    const eraseCommand = buildAnnotationMutationCommand({
      transactionId: 'tx-stale-erase',
      label: 'Erase 3 annotations',
      scope,
      before: Object.fromEntries(erased.map((item) => [item.id, item])),
      after: Object.fromEntries(erased.map((item) => [item.id, null])),
    })!
    expect(isHistoryCommandSourceCurrent(eraseCommand, 'undo', [])).toBe(true)
    expect(isHistoryCommandSourceCurrent(eraseCommand, 'undo', [erased[1]])).toBe(false)
  })

  it('strips tombstones from every snapshot in a grouped restore', () => {
    const erased = ['erase-1', 'erase-2', 'erase-3'].map((id) => annotation(id, {
      id,
      deletedAt: '2026-07-20T10:00:00.000Z',
      deletedBy: 'user-1',
    } as any))
    const restored = erased.map((item, index) => buildAnnotationRestorePayload(item, `2026-07-20T10:00:0${index}.000Z`)) as any[]
    expect(restored.every((item) => !('deletedAt' in item) && !('deletedBy' in item))).toBe(true)
    expect(restored.map((item) => item.id)).toEqual(erased.map((item) => item.id))
  })

  it('pushes commands and exposes the latest undo', () => {
    const history = pushCommand(createCommandHistory(), command('tx-1', null, 'created'))
    expect(peekUndo(history, scope)?.transactionId).toBe('tx-1')
    expect(peekRedo(history, scope)).toBeNull()
  })

  it('moves commands through undo and redo only after commit', () => {
    const pushed = pushCommand(createCommandHistory(), command('tx-1', 'before', 'after'))
    expect(commitUndo(pushed, scope, 'wrong')).toBe(pushed)
    const undone = commitUndo(pushed, scope, 'tx-1')
    expect(peekUndo(undone, scope)).toBeNull()
    expect(peekRedo(undone, scope)?.transactionId).toBe('tx-1')
    const redone = commitRedo(undone, scope, 'tx-1')
    expect(peekUndo(redone, scope)?.transactionId).toBe('tx-1')
    expect(peekRedo(redone, scope)).toBeNull()
  })

  it('coalesces every pointer-move update from one continuous drag into exactly one entry', () => {
    const updates = [
      command('tx-drag', 'start', 'move-1', { coalesceKey: 'drag:ann-1', timestamp: 1 }),
      command('tx-drag', 'move-1', 'move-2', { coalesceKey: 'drag:ann-1', timestamp: 2 }),
      command('tx-drag', 'move-2', 'move-3', { coalesceKey: 'drag:ann-1', timestamp: 3 }),
      command('tx-drag', 'move-3', 'end', { coalesceKey: 'drag:ann-1', timestamp: 4 }),
    ]
    const history = updates.reduce(
      (current, update, index) => pushCommand(current, update, { coalesce: index > 0 }),
      createCommandHistory(),
    )
    const stack = getScopeHistory(history, scope)
    expect(stack.past).toHaveLength(1)
    expect(stack.past[0].before['ann-1']?.text).toBe('start')
    expect(stack.past[0].after['ann-1']?.text).toBe('end')
  })

  it('clears redo when a new edit is pushed after undo', () => {
    const pushed = pushCommand(createCommandHistory(), command('tx-1', 'a', 'b'))
    const undone = commitUndo(pushed, scope, 'tx-1')
    const branched = pushCommand(undone, command('tx-2', 'a', 'c'))
    expect(peekRedo(branched, scope)).toBeNull()
    expect(peekUndo(branched, scope)?.transactionId).toBe('tx-2')
  })

  it('prevents a page-B undo from executing a page-A command and keeps both stacks isolated', () => {
    const pageTwo = { ...scope, pageNumber: 2 }
    let history = pushCommand(createCommandHistory(), command('tx-1', null, 'page one'))
    expect(commitUndo(history, pageTwo, 'tx-1')).toBe(history)
    history = pushCommand(history, command('tx-2', null, 'page two', { scope: pageTwo }))
    history = commitUndo(history, pageTwo, 'tx-2')
    expect(peekUndo(history, scope)?.transactionId).toBe('tx-1')
    expect(peekUndo(history, pageTwo)).toBeNull()
    expect(peekRedo(history, pageTwo)?.transactionId).toBe('tx-2')
    history = clearHistoryScope(history, scope)
    expect(peekUndo(history, scope)).toBeNull()
    expect(peekRedo(history, pageTwo)?.transactionId).toBe('tx-2')
  })

  it('builds a tombstone-safe restore payload with deletion fields stripped and a fresh timestamp', () => {
    const tombstone = annotation('deleted', {
      updatedAt: '2026-01-02T00:00:00.000Z',
      deletedAt: '2026-01-02T00:00:00.000Z',
      deletedBy: 'user-1',
    } as any)
    const deleteCommand = command('tx-delete', 'deleted', null, {
      before: { 'ann-1': tombstone },
      after: { 'ann-1': null },
    })
    const history = pushCommand(createCommandHistory(), deleteCommand)
    const restoredAt = '2026-07-20T17:00:00.000Z'
    const undoTarget = peekUndo(history, scope)?.before['ann-1']
    expect(undoTarget).toBeTruthy()
    const payload: any = buildAnnotationRestorePayload(undoTarget!, restoredAt)
    const undone = commitUndo(history, scope, 'tx-delete')
    expect(payload.text).toBe('deleted')
    expect(payload.updatedAt).toBe(restoredAt)
    expect(payload).not.toHaveProperty('deletedAt')
    expect(payload).not.toHaveProperty('deletedBy')
    expect(peekRedo(undone, scope)?.transactionId).toBe('tx-delete')
  })

  it('rejects and clears a stale undo command instead of overwriting newer annotation state', () => {
    const historyCommand = command('tx-stale', 'before', 'expected-after')
    const newer = annotation('realtime-newer', { updatedAt: '2026-07-20T18:00:00.000Z' })
    let history = pushCommand(createCommandHistory(), historyCommand)
    expect(isHistoryCommandSourceCurrent(historyCommand, 'undo', [newer])).toBe(false)
    history = clearHistoryScope(history, scope)
    expect(peekUndo(history, scope)).toBeNull()
    expect(newer.text).toBe('realtime-newer')
  })

  it('rolls back optimistic state and leaves both cursors unchanged when persistence rejects', async () => {
    const historyCommand = command('tx-save', 'before', 'after')
    const history = pushCommand(createCommandHistory(), historyCommand)
    const optimisticUndo = applyAnnotationSnapshotsToList(
      [annotation('after')],
      historyCommand.affectedAnnotationIds,
      historyCommand.before as Record<string, BlueprintAnnotation | null>,
    )
    expect(optimisticUndo[0].text).toBe('before')
    const persist = vi.fn().mockRejectedValue(new Error('save rejected'))
    let current = optimisticUndo
    let settledHistory = history
    try {
      await persist()
      settledHistory = commitUndo(history, scope, historyCommand.transactionId)
    } catch {
      current = applyAnnotationSnapshotsToList(
        optimisticUndo,
        historyCommand.affectedAnnotationIds,
        historyCommand.after as Record<string, BlueprintAnnotation | null>,
      )
    }
    expect(current[0].text).toBe('after')
    expect(peekUndo(settledHistory, scope)?.transactionId).toBe('tx-save')
    expect(peekRedo(settledHistory, scope)).toBeNull()
  })

  it('does not coalesce separate drag transactions for the same annotation', () => {
    const first = command('tx-drag-1', 'a', 'b', { coalesceKey: 'drag-1:ann-1' })
    const second = command('tx-drag-2', 'b', 'c', { coalesceKey: 'drag-2:ann-1' })
    const history = pushCommand(pushCommand(createCommandHistory(), first), second, { coalesce: true })
    expect(getScopeHistory(history, scope).past).toHaveLength(2)
  })

  it('caps each page stack without affecting its newest commands', () => {
    let history = createCommandHistory(2)
    history = pushCommand(history, command('tx-1', 'a', 'b'))
    history = pushCommand(history, command('tx-2', 'b', 'c'))
    history = pushCommand(history, command('tx-3', 'c', 'd'))
    expect(getScopeHistory(history, scope).past.map((entry) => entry.transactionId)).toEqual(['tx-2', 'tx-3'])
  })
})
