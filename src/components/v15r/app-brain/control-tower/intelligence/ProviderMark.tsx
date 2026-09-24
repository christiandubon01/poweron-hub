/**
 * ATB-6 provider marks.
 *
 * Official brand SVGs were not safely available in this checkout. These are
 * designed monochrome letter marks — not official logos and not substitutes
 * pretending to be official. Live never fetches remote brand assets.
 */
import type { ProviderLogoKey } from '../controlTowerTypes'

const LETTER: Record<ProviderLogoKey, string> = {
  claude: 'C',
  codex: 'X',
  ollama: 'O',
  cursor: '◆',
  generic: '·',
}

export default function ProviderMark({ logoKey, label }: { logoKey: string; label: string }) {
  const key = (['claude', 'codex', 'ollama', 'cursor'].includes(logoKey) ? logoKey : 'generic') as ProviderLogoKey
  return <span className={`ct-provider-mark ct-provider-mark--${key}`} aria-hidden="true" title={`${label} mark`}>
    {LETTER[key]}
  </span>
}

export const PROVIDER_LOGO_STATUS = {
  claude: 'fallback-mark',
  codex: 'fallback-mark',
  ollama: 'fallback-mark',
  cursor: 'fallback-mark',
} as const
