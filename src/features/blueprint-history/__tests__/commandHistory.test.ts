import { describe, expect, it, vi } from 'vitest'
import {
  applyAnnotationSnapshotsToList,
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

describe('command history', () => {
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
