/**
 * COMM-PROD-1 Step 9 — production Contractor #1 smoke-test blockers.
 *
 * Source boundaries for the three Gate A regressions found on a brand-new
 * external contractor owner account:
 *   A. Power On Solutions branding leaked into the authenticated owner shell.
 *   B. A fresh organization landed on "No backup data loaded / Import Backup".
 *   C. A saved 6-digit PIN was not recognised after reload.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (relPath: string) => readFileSync(join(ROOT, relPath), 'utf8')

const authStoreSrc = read('src/store/authStore.ts')
const initialSetupSrc = read('src/components/auth/InitialSetupFlow.tsx')
const passcodeSrc = read('src/lib/auth/passcode.ts')
const homeSrc = read('src/components/v15r/V15rHome.tsx')
const layoutSrc = read('src/components/v15r/V15rLayout.tsx')
const betaOnboardingSrc = read('src/components/onboarding/BetaOnboarding.tsx')
const backupSrc = read('src/services/backupDataService.ts')
const appSrc = read('src/App.tsx')

describe('COMM-PROD-1 A — new contractor bootstrap', () => {
  it('routes first-run setup completion through the auth store bootstrap', () => {
    expect(initialSetupSrc).toContain('completeInitialSetup')
    expect(authStoreSrc).toContain('completeInitialSetup: async () => {')
    expect(authStoreSrc).toContain('async function establishOwnerSession(')
    expect(authStoreSrc).toContain('await bootstrapAuthenticatedUser(user.id, isCurrent)')
  })

  it('never publishes authenticated straight from the onboarding screen', () => {
    // The regression: InitialSetupFlow wrote status: 'authenticated' into the
    // store itself, skipping tenant activation and app-session creation.
    expect(initialSetupSrc).not.toContain('useAuthStore')
    expect(initialSetupSrc).not.toContain('.setState(')
  })

  it('holds the password-login path in hydration until the tenant workspace is ready', () => {
    expect(authStoreSrc).toContain('await bootstrapAuthenticatedUser(user.id, isCurrent)')
    expect(authStoreSrc).toContain("apply({ status: 'authenticated', tenantDataReady: true, tenantUserId: user.id })")
    // The old fast path published authenticated first and hydrated afterwards.
    expect(authStoreSrc).not.toContain("apply({ tenantDataReady: true })")
  })

  it('seeds a brand-new tenant from the canonical empty backup constructor', () => {
    expect(authStoreSrc).toContain('async function seedEmptyBackupIfNeeded(userId: string)')
    expect(authStoreSrc).toContain('if (hasBackupData(userId)) return')
    expect(authStoreSrc).toContain('const empty = createEmptyBackup()')
    expect(authStoreSrc).toContain('saveBackupData(empty, userId)')
    // Cloud-side counterpart: a missing remote row seeds the tenant-local empty
    // cache; an existing local backup is never erased by it.
    expect(backupSrc).toContain('const empty = attachTenantOwner(createEmptyBackup(), userId)')
    expect(backupSrc).toContain('existing local backup kept (empty seed skipped)')
  })

  it('renders the normal application on an empty workspace instead of the Import Backup screen', () => {
    expect(homeSrc).toContain('getActiveTenantUserId')
    expect(homeSrc).toContain('const _storedBackup = getBackupData()')
    expect(homeSrc).toContain('_storedBackup ?? (getActiveTenantUserId() ? createEmptyBackup() : null)')
    // The recovery screen survives for the genuinely unresolvable case only.
    expect(homeSrc).toContain('No backup data loaded')
  })
})

describe('COMM-PROD-1 B — organization isolation', () => {
  it('scopes every bootstrap read and write to the authenticated tenant id', () => {
    expect(authStoreSrc).toContain('setActiveTenantUser(userId)')
    expect(authStoreSrc).toContain('const initialResult = await loadFromSupabase(userId, false, isCurrent)')
    expect(authStoreSrc).toContain('markTenantDataReady(userId)')
  })

  it('keeps the local cache tenant-keyed and refuses another tenant’s cache', () => {
    expect(backupSrc).toContain('return `poweron_backup_data_${userId}`')
    expect(backupSrc).toContain('if (userId && !tenantOwnerMatches(data, userId))')
    expect(backupSrc).toContain('Ignoring cache owned by another tenant')
  })

  it('refuses a remote row that does not belong to the requested tenant', () => {
    expect(backupSrc).toContain("error: 'Supabase returned wrong tenant row'")
    expect(backupSrc).toContain("error: 'Authenticated user mismatch'")
  })

  it('keeps authenticated sessions off the browser-global legacy fallback', () => {
    expect(backupSrc).toContain('// Only unauthenticated/legacy flows may fall back to poweron_v2. Authenticated')
    expect(backupSrc).toContain('if (!userId) {')
  })
})

describe('COMM-PROD-1 C — owner shell branding', () => {
  it('falls back to the PowerOn Hub product brand, never to Power On Solutions', () => {
    expect(layoutSrc).toContain("settings.company || 'PowerOn Hub'")
    expect(layoutSrc).not.toContain("settings.company || 'PowerOn Solutions'")
  })

  it('keeps the shell footer on product branding only', () => {
    expect(layoutSrc).toContain('&copy; 2026 PowerOn Hub &middot; V3.0')
    expect(layoutSrc).not.toContain('&copy; 2026 Power On Solutions LLC')
  })

  it('lets a configured organization name resolve as the tenant identity', () => {
    // Customer Zero carries settings.company = "Power On Solutions, LLC" in its
    // own backup, so it keeps resolving its own name through the same slot.
    expect(layoutSrc).toContain('settings.company ||')
  })

  it('does not suggest Power On Solutions as a new contractor’s own business', () => {
    expect(betaOnboardingSrc).not.toContain('placeholder="Power On Solutions LLC"')
    expect(betaOnboardingSrc).toContain('placeholder="Your company name"')
  })
})

describe('COMM-PROD-1 D — PIN persistence', () => {
  it('confirms the passcode write with a server readback before reporting success', () => {
    expect(passcodeSrc).toContain(".select('id, passcode_hash')")
    expect(passcodeSrc).toContain('if (!saved || (saved as { passcode_hash?: string }).passcode_hash !== hash)')
  })

  it('keeps profiles.passcode_hash the single stored authority — no plaintext, no new field', () => {
    expect(passcodeSrc).toContain('update({ passcode_hash: hash })')
    expect(passcodeSrc).toContain('return `pbkdf2:${PBKDF2_ITERATIONS}:${toHex(salt.buffer)}:${toHex(derived)}`')
    expect(passcodeSrc).not.toContain('passcode_plain')
  })

  it('reads PIN-configured state from the profile row on reinitialize', () => {
    expect(authStoreSrc).toContain("select('id, org_id, full_name, role, is_active, passcode_hash')")
    expect(authStoreSrc).toContain('if (!profile.passcode_hash) {')
    expect(authStoreSrc).toContain("apply({ status: 'needs_passcode_setup', user, profile })")
  })

  it('writes the local device hash only after the server confirmed the save', () => {
    const confirmIndex = initialSetupSrc.indexOf('if (!result.success)')
    const localWriteIndex = initialSetupSrc.indexOf('savePinLocal(await sha256hex(pin))')
    expect(confirmIndex).toBeGreaterThan(-1)
    expect(localWriteIndex).toBeGreaterThan(confirmIndex)
  })

  it('verifies the password-only setup choice the same way', () => {
    expect(initialSetupSrc).toContain("(data as any).passcode_hash !== 'password_only'")
  })
})

describe('COMM-PROD-1 E — demo safety unchanged', () => {
  it('keeps demo runtime out of the authenticated bootstrap', () => {
    expect(authStoreSrc).toContain('if (isDemoRuntimeActive()) {')
    expect(authStoreSrc).toContain('clearActiveTenantUser()')
    expect(appSrc).toContain('if (isDemoRuntimeActive()) return')
  })

  it('keeps demo reads on the isolated synthetic store, not the new-org empty seed', () => {
    expect(backupSrc).toContain('return getDemoBackupData()')
    expect(backupSrc).toContain('persistDemoBackupData(data)')
    expect(homeSrc).toContain('(hasHydrated && isDemoMode) ? getDemoBackupData() : _rawBackup')
  })

  it('keeps the demo company label separate from the tenant identity slot', () => {
    expect(layoutSrc).toContain('isDemoMode ? DEMO_COMPANY :')
  })
})
