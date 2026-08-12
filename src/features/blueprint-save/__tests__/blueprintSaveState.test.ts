import { describe, expect, it } from 'vitest'
import {
  classifyBlueprintAnimationPersistenceResult,
  classifyBlueprintPersistenceResult,
  getBlueprintSaveState,
  getBlueprintSaveStateClassName,
} from '../blueprintSaveState'

describe('blueprintSaveState', () => {
  it('classifies cloud-success results as saved to cloud', () => {
    expect(classifyBlueprintPersistenceResult({ localSaved: true, cloudSynced: true })).toEqual(
      getBlueprintSaveState('saved-to-cloud'),
    )
  })

  it('classifies local fallback results as saved on this device', () => {
    expect(classifyBlueprintPersistenceResult({
      localSaved: true,
      cloudSynced: false,
      warning: 'Annotations saved locally. Cloud sync will retry shortly.',
    })).toEqual({
      kind: 'saved-on-this-device',
      label: 'Saved on this device',
      tone: 'warning',
      detail: 'Annotations saved locally. Cloud sync will retry shortly.',
    })
  })

  it('never upgrades a failed persistence result to saved', () => {
    expect(classifyBlueprintPersistenceResult({
      localSaved: false,
      cloudSynced: false,
      error: 'Could not reach cloud save path.',
    })).toEqual({
      kind: 'sync-failed',
      label: 'Sync failed',
      tone: 'error',
      detail: 'Could not reach cloud save path.',
    })
  })

  it('treats verified animation route saves as saved to cloud', () => {
    expect(classifyBlueprintAnimationPersistenceResult({
      status: 'verified',
      localSaved: true,
      cloudSynced: true,
    })).toEqual(getBlueprintSaveState('saved-to-cloud'))
  })

  it('treats local-only animation route saves as saved on this device', () => {
    expect(classifyBlueprintAnimationPersistenceResult({
      status: 'local-saved-cloud-failed',
      localSaved: true,
      cloudSynced: false,
      warning: 'Animation route saved on this device. Cloud sync has not been verified yet.',
    })).toEqual({
      kind: 'saved-on-this-device',
      label: 'Saved on this device',
      tone: 'warning',
      detail: 'Animation route saved on this device. Cloud sync has not been verified yet.',
    })
  })

  it('exposes stable classes for rendered save-state badges', () => {
    expect(getBlueprintSaveStateClassName('success')).toContain('emerald')
    expect(getBlueprintSaveStateClassName('warning')).toContain('amber')
    expect(getBlueprintSaveStateClassName('error')).toContain('rose')
  })
})
