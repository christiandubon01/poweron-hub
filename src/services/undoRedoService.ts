// @ts-nocheck
import { getBackupData, saveBackupData, type BackupData } from '@/services/backupDataService'

interface UndoRedoState {
  undoStack: string[]
  redoStack: string[]
  maxDepth: number
  lastPushedState: string | null
}

let state: UndoRedoState = {
  undoStack: [],
  redoStack: [],
  maxDepth: 50,
  lastPushedState: null,
}

export function initializeUndoRedo(): void {
  state = {
    undoStack: [],
    redoStack: [],
    maxDepth: 50,
    lastPushedState: null,
  }
}

export function setMaxHistoryDepth(depth: number): void {
  state.maxDepth = Math.max(1, depth)
}

export function pushState(): boolean {
  try {
    const current = getBackupData()
    if (!current) return false

    const currentJson = JSON.stringify(current)

    if (currentJson === state.lastPushedState) {
      return false
    }

    state.undoStack.push(currentJson)
    state.redoStack = []
    state.lastPushedState = currentJson

    if (state.undoStack.length > state.maxDepth) {
      state.undoStack.shift()
    }

    return true
  } catch (err) {
    console.error('[undoRedoService] pushState failed:', err)
    return false
  }
}

export function undo(): boolean {
  try {
    if (state.undoStack.length === 0) return false

    const current = getBackupData()
    if (current) {
      const currentJson = JSON.stringify(current)
      state.redoStack.push(currentJson)
    }

    const previous = state.undoStack.pop()
    if (!previous) return false

    const restored = JSON.parse(previous) as BackupData
    saveBackupData(restored)
    state.lastPushedState = previous

    return true
  } catch (err) {
    console.error('[undoRedoService] undo failed:', err)
    return false
  }
}

export function redo(): boolean {
  try {
    if (state.redoStack.length === 0) return false

    const current = getBackupData()
    if (current) {
      const currentJson = JSON.stringify(current)
      state.undoStack.push(currentJson)
    }

    const next = state.redoStack.pop()
    if (!next) return false

    const restored = JSON.parse(next) as BackupData
    saveBackupData(restored)
    state.lastPushedState = next

    return true
  } catch (err) {
    console.error('[undoRedoService] redo failed:', err)
    return false
  }
}

export function canUndo(): boolean {
  return state.undoStack.length > 0
}

export function canRedo(): boolean {
  return state.redoStack.length > 0
}

export function getUndoDepth(): number {
  return state.undoStack.length
}

export function getRedoDepth(): number {
  return state.redoStack.length
}

export function clear(): void {
  initializeUndoRedo()
}
