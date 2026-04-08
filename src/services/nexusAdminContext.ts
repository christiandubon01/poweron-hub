/**
 * nexusAdminContext — Module-level store for NEXUS admin override mode.
 *
 * Set by VoiceActivationButton when the admin user selects "NEXUS ADMIN - FULL OVERSIGHT".
 * Read by systemPrompt.buildSystemPrompt() to inject the expanded multi-source
 * business context into every Claude call that runs through NEXUS.
 *
 * Lifecycle: lives for the duration of the page session.
 *   - setAdminNexusActive(true, 'combined')  — admin activates full-oversight mode
 *   - setAdminNexusActive(false)              — admin switches back to electrical mode
 *   - setAdminContextMode('software')         — toggle changes; systemPrompt picks it up next call
 */

export type AdminContextMode = 'combined' | 'electrical' | 'software' | 'rmo'

let _adminNexusActive   = false
let _adminContextMode: AdminContextMode = 'combined'

/** Activate or deactivate NEXUS Admin oversight mode. */
export function setAdminNexusActive(active: boolean, mode: AdminContextMode = 'combined'): void {
  _adminNexusActive = active
  if (active) _adminContextMode = mode
}

/** Returns true when the current NEXUS session is in admin oversight mode. */
export function isAdminNexusActive(): boolean {
  return _adminNexusActive
}

/** Returns the current context scope for admin mode. */
export function getAdminContextMode(): AdminContextMode {
  return _adminContextMode
}

/** Update the context scope without toggling the active flag. */
export function setAdminContextMode(mode: AdminContextMode): void {
  _adminContextMode = mode
}
