/**
 * COACH-LINK-3C — Practice voice/text UX layout contracts.
 * UI/layout only — does not alter AI, dialer, or Sales Session semantics.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

const REPO_ROOT = resolve(__dirname, '..', '..')

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8')
}

describe('COACH-LINK-3C Practice workspace layout', () => {
  const voice = () =>
    read('src/components/salesIntel/practice/VoicePracticeView.tsx')
  const practice = () =>
    read('src/components/salesIntel/practice/PracticeTab.tsx')
  const host = () => read('src/components/salesIntel/tabs/PracticeTab.tsx')

  it('1. Practice workspace has a bounded/flex-contained layout', () => {
    const src = voice()
    expect(src).toContain('data-testid="practice-workspace"')
    expect(src).toContain('max-h-[calc(100dvh-9rem)]')
    expect(src).toContain('flex flex-col')
    expect(src).toContain('overflow-hidden')
    // No fullscreen takeover of SI shell
    expect(src).not.toMatch(/fixed\s+inset-0/)
    expect(src).not.toMatch(/z-50/)
  })

  it('2. interaction body is the primary vertical scroll region', () => {
    const src = voice()
    expect(src).toContain('data-testid="practice-interaction-body"')
    expect(src).toContain('data-testid="practice-transcript-scroll"')
    expect(src).toMatch(
      /practice-transcript-scroll[\s\S]{0,200}overflow-y-auto/,
    )
    expect(src).toContain('min-h-0 flex-1 overflow-y-auto')
  })

  it('3–4. voice transcript scrolls without covering controls', () => {
    const src = voice()
    const workspace = src.slice(src.indexOf('data-testid="practice-workspace"'))
    const bodyIdx = workspace.indexOf('data-testid="practice-interaction-body"')
    const controlsIdx = workspace.indexOf(
      'data-testid="practice-workspace-controls"',
    )
    const voiceModeIdx = workspace.indexOf('data-testid="practice-voice-mode"')
    expect(bodyIdx).toBeGreaterThan(-1)
    expect(voiceModeIdx).toBeGreaterThan(bodyIdx)
    expect(controlsIdx).toBeGreaterThan(voiceModeIdx)
    expect(src).toContain('data-testid="practice-mic-control"')
    expect(src).toContain('data-testid="practice-transcript-scroll"')
    // Controls are shrink-0 / outside transcript overflow
    const controlsBlock = workspace.slice(controlsIdx, controlsIdx + 220)
    expect(controlsBlock).toContain('shrink-0')
  })

  it('5–6. text history scrolls; composer protected outside overflow', () => {
    const src = voice()
    expect(src).toContain('data-testid="practice-text-mode"')
    expect(src).toContain('data-testid="practice-text-composer"')
    const textMode = src.slice(
      src.indexOf('data-testid="practice-text-mode"'),
      src.indexOf('data-testid="practice-voice-mode"'),
    )
    expect(textMode).toContain('TranscriptPanel')
    expect(textMode).toContain('practice-text-composer')
    expect(textMode).toContain('shrink-0')
    expect(textMode).toMatch(/Send/)
  })

  it('7. voice/text interfaces are conditionally rendered (not stacked)', () => {
    const src = voice()
    expect(src).toMatch(
      /mode === 'text-only'\s*\?[\s\S]*practice-text-mode[\s\S]*:\s*\([\s\S]*practice-voice-mode/,
    )
    // Waveform only for non-text
    expect(src).toContain("mode !== 'text-only'")
    expect(src).toContain('data-testid="practice-waveform"')
  })

  it('8. SalesSessionContextBar still renders above Practice workspace', () => {
    const src = host()
    expect(src).toContain('SalesSessionContextBar')
    expect(src).toContain('data-testid="practice-tab-shell"')
    const shell = src.slice(src.indexOf('data-testid="practice-tab-shell"'))
    const barIdx = shell.indexOf('<SalesSessionContextBar')
    const implIdx = shell.indexOf('<PracticeTabImpl')
    expect(barIdx).toBeGreaterThan(-1)
    expect(implIdx).toBeGreaterThan(barIdx)
  })

  it('9. real-lead context still renders', () => {
    expect(voice()).toContain('data-testid="practice-lead-header"')
    expect(voice()).toContain('practiceLeadHeader')
    expect(practice()).toContain('practiceLeadHeader')
    expect(practice()).toContain('real-lead-practice-banner')
  })

  it('10. Live Call action still exists', () => {
    expect(voice()).toContain('data-testid="practice-go-live-call"')
    expect(voice()).toContain('onGoLiveCall')
    expect(practice()).toContain('handleGoLiveCall')
    expect(practice()).toContain('requestLiveCallLaunch')
  })

  it('11. generic Practice remains available', () => {
    const src = practice()
    expect(src).toContain('BEGIN PRACTICE')
    expect(src).toContain('handleBeginPractice')
    // Setup view is the non-active path
    expect(src).toContain('activePracticeSession')
    expect(src).toMatch(/if\s*\(\s*activePracticeSession\s*\)/)
  })
})

describe('COACH-LINK-3C protected boundaries', () => {
  it('12–14. AI/service files unchanged; layout-only Practice UI', () => {
    for (const file of [
      'src/services/sparkTraining/SparkTrainingVoice.ts',
      'src/services/sparkTraining/SparkRolePlayEngine.ts',
    ]) {
      const status = execSync(`git status --porcelain -- "${file}"`, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim()
      expect(status, file).toBe('')
    }
    const voice = read('src/components/salesIntel/practice/VoicePracticeView.tsx')
    // Still imports same AI entrypoints — no new service wiring
    expect(voice).toContain('transcribeUserSpeech')
    expect(voice).toContain('getCharacterResponse')
    expect(voice).toContain('characterSpeechGenerator')
  })

  it('15–16. dialer / call-log code unchanged', () => {
    for (const file of [
      'src/services/calls/phoneNormalize.ts',
      'src/services/calls/callLogService.ts',
      'src/components/hunter/CallLogModal.tsx',
    ]) {
      const status = execSync(`git status --porcelain -- "${file}"`, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim()
      expect(status, file).toBe('')
    }
    const voice = read('src/components/salesIntel/practice/VoicePracticeView.tsx')
    expect(voice).not.toContain('openTelDialer')
    expect(voice).not.toContain('createCallLog')
  })

  it('17–18. Performance / QuickBooks / KPI untouched', () => {
    for (const file of [
      'src/components/salesIntel/tabs/PerformanceTab.tsx',
      'src/features/sales-intelligence/source-performance/sourcePerformanceCalculations.ts',
    ]) {
      const status = execSync(`git status --porcelain -- "${file}"`, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim()
      expect(status, file).toBe('')
    }
    for (const file of [
      'src/components/salesIntel/practice/VoicePracticeView.tsx',
      'src/components/salesIntel/practice/PracticeTab.tsx',
      'src/components/salesIntel/tabs/PracticeTab.tsx',
    ]) {
      const text = read(file).toLowerCase()
      expect(text).not.toContain('quickbooks')
      expect(text).not.toMatch(/getprojectfinancials|moneypanel|servicequotemath/)
    }
  })

  it('19. no migration', () => {
    const status = execSync(
      'git status --porcelain -- "supabase/migrations"',
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(status).not.toMatch(/practice|coach_link|sales_session/i)
  })

  it('Sales Session store semantics not altered by this UX phase', () => {
    const status = execSync(
      'git status --porcelain -- "src/components/salesIntel/SalesIntelStore.ts"',
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).trim()
    expect(status).toBe('')
  })
})
