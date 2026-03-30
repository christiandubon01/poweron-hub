/**
 * Biometric authentication — platform-agnostic abstraction layer.
 *
 * WHY NO DYNAMIC IMPORTS:
 *   Vite's dev-server pre-bundler attempts to resolve every dynamic import()
 *   it finds in source files, even ones guarded by @vite-ignore. Because
 *   @aparajita/capacitor-biometric-auth and @tauri-apps/api are not installed
 *   in the web project's node_modules, those import() calls crash the dev server.
 *
 *   The fix: Capacitor and Tauri both inject globals into window at runtime
 *   (window.Capacitor and window.__TAURI__). We access them directly instead
 *   of importing packages. Zero imports, zero resolution failures.
 *
 * Platform support:
 *   iOS / Android  → window.Capacitor.Plugins.BiometricAuth (injected by native layer)
 *   Windows desktop → window.__TAURI__.tauri.invoke() (injected by Tauri shell)
 *   Web (browser)  → biometric returns available:false in Phase 01
 *                    (WebAuthn credential registration wired in Phase 03)
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type Platform = 'ios' | 'android' | 'web' | 'desktop' | 'unknown'

export interface BiometricCapabilities {
  available:     boolean
  enrolled:      boolean
  biometryType:  'faceId' | 'touchId' | 'fingerprint' | 'windowsHello' | 'webauthn' | 'none'
  platformLabel: string
}

export type BiometricResult =
  | { success: true }
  | { success: false; reason: 'cancelled' | 'failed' | 'unavailable' | 'not_enrolled' }

// ── Globals injected by native runtimes ──────────────────────────────────────
// These exist only inside Capacitor / Tauri shells, never in a plain browser.
// All access is optional-chained so referencing them in a browser is a no-op.

interface CapacitorWindow {
  Capacitor?: {
    getPlatform: () => string
    Plugins?: {
      BiometricAuth?: {
        checkBiometry: () => Promise<{ isAvailable: boolean; biometryType: number }>
        authenticate:  (opts: {
          reason:               string
          cancelTitle?:         string
          allowDeviceCredential?: boolean
        }) => Promise<void>
      }
    }
  }
  __TAURI__?: {
    tauri?: {
      invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
    }
    // Tauri v2 moved invoke to core
    core?: {
      invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
    }
  }
}

function win(): CapacitorWindow {
  return (typeof window !== 'undefined' ? window : {}) as CapacitorWindow
}

// Resolve the Tauri invoke function across v1 and v2 API shapes
function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> | null {
  const w = win()
  const fn =
    w.__TAURI__?.core?.invoke ??   // Tauri v2
    w.__TAURI__?.tauri?.invoke     // Tauri v1
  return fn ? fn<T>(cmd, args) : null
}

// ── Platform detection ───────────────────────────────────────────────────────

export function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'unknown'

  const cap = win().Capacitor
  if (cap) {
    const p = cap.getPlatform()
    if (p === 'ios')     return 'ios'
    if (p === 'android') return 'android'
  }

  if (win().__TAURI__) return 'desktop'

  return 'web'
}

// ── Biometric capability check ───────────────────────────────────────────────

export async function getBiometricCapabilities(): Promise<BiometricCapabilities> {
  const platform = detectPlatform()

  switch (platform) {
    case 'ios':
    case 'android': return getCapacitorCapabilities()
    case 'desktop': return getWindowsHelloCapabilities()
    case 'web':     return getWebCapabilities()
    default:        return unavailable()
  }
}

// ── Biometric authenticate ───────────────────────────────────────────────────

export async function authenticateWithBiometric(
  reason = 'Confirm your identity to sign in to PowerOn Hub'
): Promise<BiometricResult> {
  const platform = detectPlatform()

  switch (platform) {
    case 'ios':
    case 'android': return capacitorAuth(reason)
    case 'desktop': return windowsHelloAuth(reason)
    case 'web':     return { success: false, reason: 'unavailable' }
    default:        return { success: false, reason: 'unavailable' }
  }
}

// ── Capacitor — uses window.Capacitor.Plugins.BiometricAuth global ───────────
// The native Capacitor bridge registers this plugin before JS executes.
// In a plain browser window.Capacitor is undefined, so all access is a no-op.

async function getCapacitorCapabilities(): Promise<BiometricCapabilities> {
  try {
    const plugin = win().Capacitor?.Plugins?.BiometricAuth
    if (!plugin) return unavailable()

    const result = await plugin.checkBiometry()
    if (!result.isAvailable) return unavailable()

    const isIos   = detectPlatform() === 'ios'
    const isFace  = isIos && result.biometryType === 2   // 2 = Face ID on iOS

    return {
      available:     true,
      enrolled:      true,
      biometryType:  isFace ? 'faceId' : (isIos ? 'touchId' : 'fingerprint'),
      platformLabel: isFace ? 'Face ID' : (isIos ? 'Touch ID' : 'Fingerprint'),
    }
  } catch {
    return unavailable()
  }
}

async function capacitorAuth(reason: string): Promise<BiometricResult> {
  try {
    const plugin = win().Capacitor?.Plugins?.BiometricAuth
    if (!plugin) return { success: false, reason: 'unavailable' }

    await plugin.authenticate({
      reason,
      cancelTitle:           'Use passcode instead',
      allowDeviceCredential: false,
    })
    return { success: true }
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string }
    if (e?.code === 'userCancel' || e?.message?.toLowerCase().includes('cancel')) {
      return { success: false, reason: 'cancelled' }
    }
    return { success: false, reason: 'failed' }
  }
}

// ── Tauri — uses window.__TAURI__ global injected by the desktop shell ────────

async function getWindowsHelloCapabilities(): Promise<BiometricCapabilities> {
  try {
    const result = tauriInvoke<boolean>('is_biometric_available')
    if (result === null) return unavailable()

    const available = await result
    return {
      available,
      enrolled:      available,
      biometryType:  'windowsHello',
      platformLabel: 'Windows Hello',
    }
  } catch {
    return unavailable()
  }
}

async function windowsHelloAuth(reason: string): Promise<BiometricResult> {
  try {
    const result = tauriInvoke<boolean>('biometric_authenticate', { reason })
    if (result === null) return { success: false, reason: 'unavailable' }

    const ok = await result
    return ok ? { success: true } : { success: false, reason: 'failed' }
  } catch (err: unknown) {
    const e = err as { message?: string }
    if (e?.message?.toLowerCase().includes('cancel')) {
      return { success: false, reason: 'cancelled' }
    }
    return { success: false, reason: 'failed' }
  }
}

// ── Web / browser ─────────────────────────────────────────────────────────────
// Phase 01: biometric is not available in the browser.
// Phase 03 will add WebAuthn credential registration and assertion here.

async function getWebCapabilities(): Promise<BiometricCapabilities> {
  // Kept as a stub so Phase 03 has a clear place to fill in.
  // Until WebAuthn credentials are registered, report unavailable
  // so the UI skips the biometric prompt entirely.
  return unavailable()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function unavailable(): BiometricCapabilities {
  return {
    available:     false,
    enrolled:      false,
    biometryType:  'none',
    platformLabel: 'Not available',
  }
}

// Exported for the onboarding BiometricPrompt enrollment check
export async function getMockCapabilities(): Promise<BiometricCapabilities> {
  return {
    available:     true,
    enrolled:      true,
    biometryType:  'faceId',
    platformLabel: 'Face ID (Mock)',
  }
}
