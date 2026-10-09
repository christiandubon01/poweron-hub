/** Display formatting shared by the spending surfaces (no arithmetic beyond formatting the server's own values). */
export const usd0 = (minor: number) => `$${Math.round(Math.abs(minor) / 100).toLocaleString('en-US')}`
export const usd2 = (minor: number) => `$${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
export const CONF: Record<string, string> = { high: 'High', possible: 'Possible', low: 'Low' }
/** An account name with its last four digits, unless the name already shows them (e.g. "Wells Fargo Business Checking 6960"). */
export const withMask = (name: string, mask: string | null | undefined) => (mask && !name.includes(mask) ? `${name} ••••${mask}` : name)
