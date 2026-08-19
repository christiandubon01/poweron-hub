/**
 * COACH-LINK-3 — Real-lead Practice role-play wiring proofs.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import {
  customCharacterFromHunterLead,
  customerPracticeFirstName,
  mapHunterStoreLeadToRolePlayLead,
} from '@/services/sparkTraining/SparkRolePlayEngine'
import {
  SI_SALES_SESSION_KEY,
  useSalesIntelStore,
} from '@/components/salesIntel/SalesIntelStore'

const REPO_ROOT = resolve(__dirname, '..', '..')

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8')
}

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null
    },
    removeItem(key: string) {
      map.delete(key)
    },
    setItem(key: string, value: string) {
      map.set(key, String(value))
    },
  }
}

function ensureBrowserStorage(): void {
  const g = globalThis as typeof globalThis & {
    sessionStorage?: Storage
    localStorage?: Storage
    window?: typeof globalThis
  }
  if (!g.sessionStorage) {
    Object.defineProperty(g, 'sessionStorage', {
      value: makeMemoryStorage(),
      configurable: true,
    })
  }
  if (!g.localStorage) {
    Object.defineProperty(g, 'localStorage', {
      value: makeMemoryStorage(),
      configurable: true,
    })
  }
  if (!g.window) {
    Object.defineProperty(g, 'window', {
      value: g,
      configurable: true,
    })
  }
}

beforeEach(() => {
  ensureBrowserStorage()
  useSalesIntelStore.getState().clearSalesSession()
  sessionStorage.removeItem(SI_SALES_SESSION_KEY)
})

describe('COACH-LINK-3 lead → role-play mapper', () => {
  it('2–5. maps Hunter store lead facts without inventing value/objections', () => {
    const mapped = mapHunterStoreLeadToRolePlayLead({
      id: 'lead-1',
      contact_name: 'Kathryn Healy',
      city: 'Palm Desert',
      description: 'flickering lights',
      source: 'customer_portal',
      source_tag: 'paid_search',
      notes: 'Called twice',
      permit_number: 'B-123',
    })
    expect(mapped).not.toBeNull()
    expect(mapped!.contact).toBe('Kathryn Healy')
    expect(mapped!.description).toBe('flickering lights')
    expect(mapped!.source).toBe('customer_portal')
    expect(mapped!.sourceDetail).toBe('paid_search')
    expect(mapped!.estimatedValue).toBeUndefined()
    expect(mapped!.likelyObjections).toBeUndefined()
  })

  it('3. customer first name from contact', () => {
    expect(customerPracticeFirstName('Kathryn Healy')).toBe('Kathryn')
    expect(customerPracticeFirstName('')).toBe('')
  })

  it('4–6. prompt separates known facts from simulated behavior', () => {
    const generated = customCharacterFromHunterLead({
      id: 'lead-1',
      contact: 'Kathryn Healy',
      description: 'flickering lights',
      source: 'customer_portal',
      sourceDetail: 'paid_search',
    })
    expect(generated.characterName).toBe('Kathryn Healy')
    expect(generated.systemPrompt).toContain('KNOWN LEAD FACTS')
    expect(generated.systemPrompt).toContain('SIMULATED CUSTOMER BEHAVIOR')
    expect(generated.systemPrompt).toContain('flickering lights')
    expect(generated.systemPrompt).toContain('paid_search')
    expect(generated.systemPrompt).toMatch(/You are the CUSTOMER/i)
    expect(generated.systemPrompt).not.toContain('Est. Value: $5000')
  })

  it('10. unresolved / empty lead maps to null', () => {
    expect(mapHunterStoreLeadToRolePlayLead(null)).toBeNull()
    expect(mapHunterStoreLeadToRolePlayLead({})).toBeNull()
  })

  it('does not invent estimated value when absent', () => {
    const generated = customCharacterFromHunterLead({
      id: 'x',
      contact: 'Sam',
      description: 'EV charger',
    })
    expect(generated.systemPrompt).toContain('EV charger')
    expect(generated.systemPrompt).not.toMatch(/Estimated value on file: \$5000/)
  })
})

describe('COACH-LINK-3 Practice wiring (static)', () => {
  const practiceTab = () => read('src/components/salesIntel/practice/PracticeTab.tsx')
  const voiceView = () => read('src/components/salesIntel/practice/VoicePracticeView.tsx')
  const voiceSvc = () => read('src/services/sparkTraining/SparkTrainingVoice.ts')

  it('1. generic Practice still defaults to Adam Stone when no lead', () => {
    const src = practiceTab()
    expect(src).toContain('ADAM_STONE_VOICE')
    expect(src).toMatch(/practiceCharacter \?\? ADAM_STONE_VOICE/)
  })

  it('7–8. difficulty and archetype still passed to VoicePracticeView', () => {
    const src = practiceTab()
    expect(src).toContain('difficulty={activePracticeSession.difficulty}')
    expect(src).toContain('archetypeId={activePracticeSession.archetypeId')
  })

  it('9. real lead does not silently force only Adam Stone name', () => {
    const src = practiceTab()
    expect(src).toContain('customCharacterFromHunterLead')
    expect(src).toContain('leadRolePlayPrompt')
    expect(src).toContain('real-lead-practice-banner')
  })

  it('11. custom scenario plumbing no longer discards values', () => {
    const src = practiceTab()
    expect(src).toContain('setPendingCustom')
    expect(src).toContain('pendingCustom')
    expect(src).not.toMatch(
      /handleCustomScenario[\s\S]{0,120}setShowCustomModal\(false\)\s*\n\s*\/\/ Scene will be passed/
    )
  })

  it('12. VoicePracticeView receives real scenario/customer context', () => {
    const src = voiceView()
    expect(src).toContain('leadRolePlayPrompt')
    expect(src).toContain('practiceLeadHeader')
    expect(src).toContain('practice-lead-header')
  })

  it('13–17. voice / Claude / Whisper / ElevenLabs / no new AI provider', () => {
    const svc = voiceSvc()
    expect(svc).toContain("fetch('/.netlify/functions/claude'")
    expect(svc).toContain('transcribeWithWhisper')
    expect(svc).toContain('synthesizeWithElevenLabs')
    expect(svc).toContain('leadRolePlayPrompt')
    expect(svc).not.toMatch(/openai\.com|api\.openai|new OpenAI/i)
    expect(practiceTab()).toContain('SparkTrainingVoice')
  })

  it('18. reuses customCharacterFromHunterLead (no second transformer file)', () => {
    expect(practiceTab()).toContain('customCharacterFromHunterLead')
    expect(practiceTab()).toContain('mapHunterStoreLeadToRolePlayLead')
    // Mapper lives beside the existing role-play engine, not a new parallel service
    expect(
      read('src/services/sparkTraining/SparkRolePlayEngine.ts')
    ).toContain('mapHunterStoreLeadToRolePlayLead')
  })

  it('19–20. Practice → Live Call preserves sales session lead', () => {
    const src = practiceTab()
    expect(src).toContain('handleGoLiveCall')
    expect(src).toContain("beginSalesSession(leadId, 'live_call')")
    expect(src).toContain('requestLiveCallLaunch(leadId)')
    expect(src).toContain("setActiveTab('live_call')")
    useSalesIntelStore.getState().beginSalesSession('leadA', 'practice')
    const sid = useSalesIntelStore.getState().salesSession!.sessionId
    useSalesIntelStore.getState().beginSalesSession('leadA', 'live_call')
    useSalesIntelStore.getState().requestLiveCallLaunch('leadA')
    useSalesIntelStore.getState().setActiveTab('live_call')
    const s = useSalesIntelStore.getState().salesSession!
    expect(s.leadId).toBe('leadA')
    expect(s.sessionId).toBe(sid)
    expect(s.mode).toBe('live_call')
    expect(useSalesIntelStore.getState().liveCallLaunchRequest).toEqual({
      hunterLeadId: 'leadA',
    })
  })

  it('21–22. Practice completion does not auto-dial or create call_log', () => {
    const src = practiceTab()
    expect(src).not.toContain('openTelDialer')
    expect(src).not.toContain('createCallLog')
    expect(src).toMatch(/never dial|never create call_log/i)
  })
})

describe('COACH-LINK-3 protected boundaries', () => {
  it('23–25. dialer / call_logs / Performance unchanged vs HEAD (CallLogModal dialer≠save allowed)', () => {
    const files = [
      'src/services/calls/phoneNormalize.ts',
      'src/services/calls/callLogService.ts',
      'src/components/salesIntel/tabs/PerformanceTab.tsx',
      'src/features/sales-intelligence/source-performance/sourcePerformanceCalculations.ts',
    ]
    for (const file of files) {
      const status = execSync(`git status --porcelain -- "${file}"`, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim()
      expect(status, file).toBe('')
    }
    const modal = read('src/components/hunter/CallLogModal.tsx')
    expect(modal).toContain('showOptionalDialer')
    expect(modal).toContain('openTelDialer')
  })

  it('26–27. no KPI / QuickBooks on Practice path files', () => {
    const files = [
      'src/components/salesIntel/practice/PracticeTab.tsx',
      'src/components/salesIntel/practice/VoicePracticeView.tsx',
      'src/services/sparkTraining/SparkRolePlayEngine.ts',
      'src/services/sparkTraining/SparkTrainingVoice.ts',
    ]
    for (const file of files) {
      const text = read(file).toLowerCase()
      expect(text).not.toContain('quickbooks')
      expect(text).not.toMatch(/getprojectfinancials|moneypanel|servicequotemath/)
    }
  })

  it('28. no migration', () => {
    const engine = read('src/services/sparkTraining/SparkRolePlayEngine.ts')
    expect(engine).not.toMatch(/CREATE TABLE|ALTER TABLE/i)
    expect(practiceHasNoSql()).toBe(true)
  })

  it('Coach tab not implementing coaching AI in this phase', () => {
    const coach = read('src/components/salesIntel/tabs/CoachTab.tsx')
    expect(coach).not.toContain('getCharacterResponse')
    expect(coach).not.toContain('customCharacterFromHunterLead')
  })
})

function practiceHasNoSql(): boolean {
  const practice = read('src/components/salesIntel/practice/PracticeTab.tsx')
  return !/CREATE TABLE|ALTER TABLE/i.test(practice)
}
