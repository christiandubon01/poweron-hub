import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const LOGIN_FLOW = readFileSync(join(ROOT, 'src/components/auth/LoginFlow.tsx'), 'utf8')
const APP = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8')
const AUTH_STORE = readFileSync(join(ROOT, 'src/store/authStore.ts'), 'utf8')
const OWNER_BOOTSTRAP_FN = readFileSync(join(ROOT, 'supabase/functions/bootstrap-owner-workspace/index.ts'), 'utf8')

describe('COMM-PROD-2 contractor existing-identity path (SOURCE-CONTRACT)', () => {
  it('contractor signup offers a direct sign-in continuation for an existing PowerOn identity', () => {
    expect(LOGIN_FLOW).toContain('This email already has a PowerOn Hub login. Sign in to continue creating your contractor workspace.')
    expect(LOGIN_FLOW).toContain('Already use PowerOn Hub? Sign In')
    expect(LOGIN_FLOW).toMatch(/onExistingAccount/)
  })

  it('treats the obfuscated Supabase existing-user signup response as a sign-in path, not a phantom verification email', () => {
    expect(LOGIN_FLOW).toContain('data.user.identities.length === 0')
    expect(LOGIN_FLOW).not.toContain('Check your email â€” we sent a verification link')
  })

  it('stores explicit portal context so the shared root can resolve owner vs employee deliberately', () => {
    expect(APP).toContain("setPreferredPortalContext(role === 'employee' ? 'employee' : 'main')")
    expect(AUTH_STORE).toContain("const context = detectPortalContext(typeof window !== 'undefined' ? window.location.pathname : '/')")
    expect(AUTH_STORE).toContain('resolvePortalRoleOnce')
  })

  it('requires an authenticated Supabase identity before owner workspace recovery can run', () => {
    expect(OWNER_BOOTSTRAP_FN).toContain("Missing authorization header")
    expect(OWNER_BOOTSTRAP_FN).toContain("admin.auth.getUser(token)")
    expect(OWNER_BOOTSTRAP_FN).toContain("passcode_hash: 'password_only'")
  })
})
