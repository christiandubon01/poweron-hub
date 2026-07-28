const DESKTOP_ELECTRICAL_TOOLS_OPEN_KEY = 'blueprint.desktopElectricalToolsOpen'

export function readDesktopElectricalToolsOpen(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(DESKTOP_ELECTRICAL_TOOLS_OPEN_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeDesktopElectricalToolsOpen(open: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(DESKTOP_ELECTRICAL_TOOLS_OPEN_KEY, open ? 'true' : 'false')
  } catch {
    // Best-effort UI preference only.
  }
}
