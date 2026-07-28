import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readDesktopElectricalToolsOpen,
  writeDesktopElectricalToolsOpen,
} from '../desktopElectricalToolsPreference'

const STORAGE_KEY = 'blueprint.desktopElectricalToolsOpen'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) {
    return this.values.has(key) ? this.values.get(key)! : null
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value))
  }

  clear() {
    this.values.clear()
  }
}

describe('desktopElectricalToolsPreference', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new MemoryStorage(),
    })
    Object.defineProperty(globalThis, 'Storage', {
      configurable: true,
      value: MemoryStorage,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('uses the exact desktop electrical tools storage key', () => {
    writeDesktopElectricalToolsOpen(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  it('returns false when the value is missing', () => {
    expect(readDesktopElectricalToolsOpen()).toBe(false)
  })

  it("returns true only for exact 'true'", () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    expect(readDesktopElectricalToolsOpen()).toBe(true)
  })

  it("returns false for exact 'false'", () => {
    localStorage.setItem(STORAGE_KEY, 'false')
    expect(readDesktopElectricalToolsOpen()).toBe(false)
  })

  it('returns false for garbage values', () => {
    localStorage.setItem(STORAGE_KEY, 'TRUE')
    expect(readDesktopElectricalToolsOpen()).toBe(false)
  })

  it('returns false when storage read fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readDesktopElectricalToolsOpen()).toBe(false)
  })

  it("writes true as 'true'", () => {
    writeDesktopElectricalToolsOpen(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  it("writes false as 'false'", () => {
    writeDesktopElectricalToolsOpen(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false')
  })

  it('does not throw when storage write fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => writeDesktopElectricalToolsOpen(true)).not.toThrow()
  })
})
