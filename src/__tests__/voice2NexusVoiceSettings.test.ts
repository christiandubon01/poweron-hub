/**
 * VOICE-2 / VOICE-2B / VOICE-2C — Nexus Voice Settings restore + audition catalog
 * + placement back inside AI Development.
 *
 * Proves:
 * 1. NEXUS Voice renders inside AI Development (gated by showAIDevelopment)
 * 2. No duplicate standalone NEXUS Voice SettingCard exists
 * 3. Preview sends voice_id (not voiceId)
 * 4. Preview uses /.netlify/functions/speak
 * 5. Preview does not require VITE_ELEVENLABS_API_KEY
 * 6. Successful preview clears prior error / requires real audio
 * 7. Failed preview does not masquerade via WebSpeech
 * 8. Selecting a voice updates existing Nexus voice authority keys
 * 9. Existing preference/localStorage compatibility preserved
 * 10. Sarah label matches EXAVITQu4vr4xnSDxMaL; stale six not usable catalog
 * 11. Browse candidates preview without changing selection
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const settings = readFileSync(resolve(root, 'src/components/v15r/V15rSettingsPanel.tsx'), 'utf8')

function sliceNexusVoiceBlock(): string {
  const start = settings.indexOf('// ── NEXUS Voice selector (VOICE-2B audition)')
  const end = settings.indexOf('// ── Admin Template Switcher', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return settings.slice(start, end)
}

function sliceAiDevelopmentBlock(): string {
  const aiBlock = settings.indexOf('{/* AI DEVELOPMENT */}')
  const end = settings.indexOf('{/* 3. PHASE WEIGHTS EDITOR */}', aiBlock)
  expect(aiBlock).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(aiBlock)
  return settings.slice(aiBlock, end)
}

const STALE_IDS = [
  '21m00Tcm4TlvDq8ikWAM',
  'AZnzlk1XvdvUeBnXmlld',
  'ThT5KcBeYPX3keUQqHPh',
  'yoZ06aMxZnX8TkCVKLEy',
  'CYw35i4Wn5qWUFPfRwi7',
  'ErXwobaYiN019PkySvjV',
]

describe('VOICE-2C — Settings placement inside AI Development', () => {
  it('1. NEXUS Voice renders inside AI Development (showAIDevelopment gated)', () => {
    const aiSlice = sliceAiDevelopmentBlock()
    expect(aiSlice).toContain('{showAIDevelopment && (')
    expect(aiSlice).toContain('data-testid="nexus-voice-in-ai-development"')
    expect(aiSlice).toContain('<h4 className="text-sm font-bold text-gray-100">NEXUS Voice</h4>')
    expect(aiSlice).toContain('<NexusVoiceSelector />')
    expect(aiSlice).toContain('Proposals, NEXUS profile, voice, and skill intelligence.')
  })

  it('2. no duplicate standalone NEXUS Voice SettingCard exists', () => {
    expect(settings).not.toContain('{/* NEXUS Voice — always visible (VOICE-2). Not gated by AI Development. */}')
    // Active standalone SettingCard must not exist; dead `{false &&` stubs are fine if any remain.
    expect(settings).not.toMatch(/^\s*<SettingCard title="NEXUS Voice">/m)
    const selectorOccurrences = settings.split('<NexusVoiceSelector />').length - 1
    expect(selectorOccurrences).toBe(1)
  })
})

describe('VOICE-2B — Catalog + Sarah label + stale removal', () => {
  const block = sliceNexusVoiceBlock()

  it('1. Sarah label matches EXAVITQu4vr4xnSDxMaL (not Bella)', () => {
    expect(block).toMatch(/id:\s*'EXAVITQu4vr4xnSDxMaL',\s*name:\s*'Sarah'/)
    expect(block).not.toMatch(/id:\s*'EXAVITQu4vr4xnSDxMaL',\s*name:\s*'Bella'/)
    // Catalog Bella must not appear; account candidate Bella uses a different ID.
    expect(block).toContain("id: 'hpp4J3VqNfWAUOO0d1Us', name: 'Bella'")
  })

  it('2. six stale IDs are not presented as usable catalog voices', () => {
    expect(block).toContain('NEXUS_STALE_REMOVED_IDS')
    for (const id of STALE_IDS) {
      expect(block).toContain(`'${id}'`)
    }
    // Catalog is exactly the four retained voices (stale IDs live only in NEXUS_STALE_REMOVED_IDS)
    const catalogSlice = block.slice(
      block.indexOf('const NEXUS_CATALOG_VOICES'),
      block.indexOf('const NEXUS_CATALOG_IDS'),
    )
    const catalogIds = [...catalogSlice.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1])
    expect(catalogIds).toEqual([
      'gOkFV1JMCt0G0n9xmBwV',
      'NFG5qt843uXKj4pFvR7C',
      '6WjhCXzqp2hnSqFtrG8P',
      'EXAVITQu4vr4xnSDxMaL',
    ])
    for (const id of STALE_IDS) {
      expect(catalogIds).not.toContain(id)
    }
    expect(block).toContain('{NEXUS_CATALOG_VOICES.length}/10 retained')
    expect(block).toContain('data-testid="nexus-catalog-voices"')
  })
})

describe('VOICE-2B — Browse audition + preview contract', () => {
  const block = sliceNexusVoiceBlock()

  it('3+4+5. available-current voices can be previewed via speak + voice_id', () => {
    expect(block).toContain('Browse available voices')
    expect(block).toContain('NEXUS_BROWSE_CANDIDATES')
    expect(block).toContain('data-testid="nexus-browse-voices"')
    expect(block).toContain("fetch('/.netlify/functions/speak'")
    expect(block).toContain('voice_id: voice.id')
    expect(block).not.toContain('voiceId: voice.id')
    expect(block).toContain('authedJsonHeaders()')
  })

  it('6. successful preview clears prior error', () => {
    expect(block).toContain('// Successful playback clears any prior stale error.')
    expect(block).toContain('setPreviewError(null)')
    expect(block).toMatch(/await audioEl\.play\(\)[\s\S]*setPreviewError\(null\)/)
  })

  it('7. preview does not modify selected Nexus voice', () => {
    expect(block).toContain('Preview only — never changes selected Nexus voice')
    expect(block).toContain("data-voice-role={opts.selectable ? 'catalog' : 'candidate'}")
    // handlePreview must not write localStorage selection keys
    const previewFn = block.slice(block.indexOf('const handlePreview'), block.indexOf('// Sync to Supabase'))
    expect(previewFn).not.toContain('localStorage.setItem')
    expect(previewFn).not.toContain('setSelectedId')
  })

  it('8. selected existing Nexus voice continues surviving refresh', () => {
    expect(block).toContain("localStorage.setItem(NEXUS_VOICE_KEY, voiceId)")
    expect(block).toContain("localStorage.setItem('nexus_voice_id', voiceId)")
    expect(block).toContain("localStorage.getItem(NEXUS_VOICE_KEY)")
    expect(block).toContain("localStorage.getItem('nexus_voice_id')")
    expect(block).toContain("supabase.from('user_preferences').upsert")
    expect(block).toMatch(/Not organization-wide yet/)
  })

  it('9. no browser ElevenLabs secret required', () => {
    expect(block).not.toContain('VITE_ELEVENLABS_API_KEY')
    expect(block).not.toContain('VITE_ELEVEN_LABS_API_KEY')
    expect(block).not.toContain('api.elevenlabs.io')
    expect(block).not.toContain('SpeechSynthesisUtterance')
    expect(block).not.toMatch(/window\.speechSynthesis/)
  })
})

describe('VOICE-2 — Selection runtime + QBO preserve', () => {
  it('runtime Nexus TTS still prefers the same localStorage keys', () => {
    const eleven = readFileSync(resolve(root, 'src/api/voice/elevenLabs.ts'), 'utf8')
    const voice = readFileSync(resolve(root, 'src/services/voice.ts'), 'utf8')
    expect(eleven).toContain("localStorage.getItem('poweron_nexus_voice')")
    expect(eleven).toContain("localStorage.getItem('nexus_voice_id')")
    expect(voice).toContain("localStorage.getItem('poweron_nexus_voice')")
    expect(voice).toContain("localStorage.getItem('nexus_voice_id')")
  })

  it('does not remove QBO-3A1 Settings connection wiring', () => {
    expect(settings).toContain('useQuickBooksConnection')
    expect(settings).toContain('QuickBooksAccountModal')
    expect(settings).toContain('qboConnected')
  })
})
