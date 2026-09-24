/**
 * ATB-5: SHA-256 of the selected local file bytes.
 * Persist the hex digest only — never the file bytes or path.
 */

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array
    ? data
    : new Uint8Array(data)
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const digest = await subtle.digest('SHA-256', copy)
    return toHex(new Uint8Array(digest))
  }
  throw new Error('SHA-256 is not available in this environment.')
}

export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value)
}
