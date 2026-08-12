import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appSrc = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
const authStoreSrc = readFileSync(join(process.cwd(), 'src/store/authStore.ts'), 'utf8')
const backupSrc = readFileSync(join(process.cwd(), 'src/services/backupDataService.ts'), 'utf8')
const appShellSrc = readFileSync(join(process.cwd(), 'src/components/layout/AppShell.tsx'), 'utf8')
const settingsSrc = readFileSync(join(process.cwd(), 'src/components/v15r/V15rSettingsPanel.tsx'), 'utf8')
const blueprintSrc = readFileSync(join(process.cwd(), 'src/services/blueprintLibraryService.ts'), 'utf8')

describe('COMM-1C demo runtime guards', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('window', {
      location: { search: '', href: 'https://app.example.test/', pathname: '/' },
      dispatchEvent: vi.fn(),
      CustomEvent,
    } as any)
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
    } as any)
  })

  it('treats a persisted demo flag as an active demo runtime even without the URL param', async () => {
    localStorage.setItem('poweron-demo-mode', 'true')
    const mod = await import('../services/demoModeSafety')
    expect(mod.isDemoRuntimeActive()).toBe(true)
  })

  it('isolates demo backup storage by industry and resets safely', async () => {
    const mod = await import('../services/demoModeSafety')
    expect(mod.getDemoBackupStorageKey('electrical-supplier')).toBe('poweron_demo_backup_electrical-supplier')
    localStorage.setItem('poweron_demo_backup_electrical-supplier', '{"ok":true}')
    mod.resetDemoBackupStorage('electrical-supplier')
    expect(localStorage.getItem('poweron_demo_backup_electrical-supplier')).toBeNull()
  })
})

describe('COMM-1C source boundaries', () => {
  it('skips auth initialization while demo runtime is active', () => {
    expect(authStoreSrc).toContain("if (isDemoRuntimeActive()) {")
    expect(authStoreSrc).toContain("status: 'unauthenticated'")
    expect(authStoreSrc).toContain('clearActiveTenantUser()')
  })

  it('keeps Demo Mode separate from AuditGate and boot auth', () => {
    expect(appSrc).toContain('if (isDemoRuntimeActive()) return')
    expect(appSrc).toContain('const isDemoParam = isDemoRuntimeActive()')
    expect(appSrc).toContain('if (isDemoRuntimeActive()) return')
  })

  it('routes demo backup reads and writes through isolated local demo state only', () => {
    expect(backupSrc).toContain('if (isDemoRuntimeActive()) {')
    expect(backupSrc).toContain('return getDemoBackupData()')
    expect(backupSrc).toContain('persistDemoBackupData(data)')
    expect(backupSrc).toContain("maybeAutoSnapshot('Demo data saved')")
  })

  it('forces safe demo exit instead of revealing an existing live session', () => {
    expect(appShellSrc).toContain('async function exitDemoModeSafely()')
    expect(appShellSrc).toContain("await supabase.auth.signOut()")
    expect(appShellSrc).toContain('window.location.assign(window.location.pathname)')
    expect(settingsSrc).toContain('async function exitDemoModeSafely()')
  })

  it('adds a resettable demo baseline in the settings controls', () => {
    expect(settingsSrc).toContain('resetDemoData()')
    expect(settingsSrc).toContain('Reset')
  })

  it('blocks live blueprint storage reads and writes in demo mode', () => {
    expect(blueprintSrc).toContain("throw new Error('Blueprint PDF uploads are disabled in Demo Mode.')")
    expect(blueprintSrc).toContain("throw new Error('Blueprint storage deletion is disabled in Demo Mode.')")
    expect(blueprintSrc).toContain("throw new Error('Live blueprint storage is unavailable in Demo Mode.')")
  })

  it('preserves the COMM-1B product-vs-employer identity direction', () => {
    const comm1bInviteSrc = readFileSync(join(process.cwd(), 'netlify/functions/sendEmployeeInvite.ts'), 'utf8')
    expect(comm1bInviteSrc).toContain('invited you to join PowerOn Hub')
  })
})
