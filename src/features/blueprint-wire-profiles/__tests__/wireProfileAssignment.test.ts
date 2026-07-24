import { describe, expect, it } from 'vitest'
import {
  assignAnnotationWireProfileDefault,
  assignSegmentWireProfileOverride,
  clearAllWireProfileAssignments,
  clearSegmentWireProfileOverride,
  handleSegmentTopologyChange,
  normalizeCircuitWireProfileMetadata,
  readAnnotationWireProfileId,
  readSegmentWireProfileIds,
  remapSegmentWireProfileIds,
  resolveWireProfileIdForSegmentId,
  resolveWireProfileIdForSegmentIndex,
} from '../wireProfileAssignment'

describe('circuit wire profile assignment', () => {
  it('stores defaults and segment overrides in meta without inferring from authored appearance', () => {
    const meta = { segmentIds: ['s1', 's2'], borderColor: '#facc15', color: '#facc15' } as any
    const assigned = assignAnnotationWireProfileDefault(meta, 'wire_profile_default')
    const withOverride = assignSegmentWireProfileOverride(assigned, 1, 'wire_profile_override')

    expect(readAnnotationWireProfileId(withOverride)).toBe('wire_profile_default')
    expect(readSegmentWireProfileIds(withOverride)).toEqual([null, 'wire_profile_override'])
    expect(resolveWireProfileIdForSegmentIndex(withOverride, 0)).toBe('wire_profile_default')
    expect(resolveWireProfileIdForSegmentIndex(withOverride, 1)).toBe('wire_profile_override')
    expect(resolveWireProfileIdForSegmentId(withOverride, 's2')).toBe('wire_profile_override')
    expect(resolveWireProfileIdForSegmentIndex(meta, 0)).toBeNull()
  })

  it('treats null overrides as inherited defaults and clears assignments explicitly', () => {
    const meta = { wireProfileId: 'wire_profile_default', segmentIds: ['s1', 's2'], segmentWireProfileIds: ['wire_profile_a', 'wire_profile_b'] }
    const clearedSegment = clearSegmentWireProfileOverride(meta, 0)
    expect(resolveWireProfileIdForSegmentIndex(clearedSegment, 0)).toBe('wire_profile_default')
    expect(resolveWireProfileIdForSegmentIndex(clearedSegment, 1)).toBe('wire_profile_b')
    expect(clearAllWireProfileAssignments(clearedSegment)).toEqual({ wireProfileId: null, segmentIds: ['s1', 's2'] })
  })

  it('normalizes override arrays parallel to segmentIds', () => {
    expect(normalizeCircuitWireProfileMetadata({
      wireProfileId: ' wire_profile_default ',
      segmentIds: ['s1', 's2'],
      segmentWireProfileIds: [' wire_profile_1 ', '', 'wire_profile_extra'],
    })).toEqual({
      wireProfileId: 'wire_profile_default',
      segmentIds: ['s1', 's2'],
      segmentWireProfileIds: ['wire_profile_1', null],
    })
    expect(resolveWireProfileIdForSegmentIndex({
      wireProfileId: 'wire_profile_default',
      segmentIds: ['s1', 's2', 's3'],
      segmentWireProfileIds: ['wire_profile_1'],
    }, 2)).toBe('wire_profile_default')
  })

  it('preserves overrides for same stable segment ids and reordered ids', () => {
    expect(remapSegmentWireProfileIds({
      previousSegmentIds: ['s1', 's2'],
      nextSegmentIds: ['s1', 's2'],
      previousSegmentWireProfileIds: ['wire_profile_1', 'wire_profile_2'],
    })).toEqual(['wire_profile_1', 'wire_profile_2'])

    expect(remapSegmentWireProfileIds({
      previousSegmentIds: ['s1', 's2', 's3'],
      nextSegmentIds: ['s3', 's1', 's2'],
      previousSegmentWireProfileIds: ['wire_profile_1', 'wire_profile_2', 'wire_profile_3'],
    })).toEqual(['wire_profile_3', 'wire_profile_1', 'wire_profile_2'])
  })

  it('sets new inserted or replaced segment ids to null when stable overlap exists', () => {
    expect(remapSegmentWireProfileIds({
      previousSegmentIds: ['s1', 's2'],
      nextSegmentIds: ['s1', 'sNEW', 's2'],
      previousSegmentWireProfileIds: ['wire_profile_1', 'wire_profile_2'],
    })).toEqual(['wire_profile_1', null, 'wire_profile_2'])

    expect(remapSegmentWireProfileIds({
      previousSegmentIds: ['s1', 's2', 's3'],
      nextSegmentIds: ['s2', 's4', 's1'],
      previousSegmentWireProfileIds: ['wire_profile_1', 'wire_profile_2', 'wire_profile_3'],
    })).toEqual(['wire_profile_2', null, 'wire_profile_1'])

    expect(remapSegmentWireProfileIds({
      previousSegmentIds: ['s1', 's2', 's3'],
      nextSegmentIds: ['s1', 'sNEW', 's3'],
      previousSegmentWireProfileIds: ['wire_profile_1', 'wire_profile_2', 'wire_profile_3'],
    })).toEqual(['wire_profile_1', null, 'wire_profile_3'])
  })

  it('removes deleted segment overrides and adds null for inserted inherited segments', () => {
    expect(handleSegmentTopologyChange({
      wireProfileId: 'wire_profile_default',
      segmentIds: ['s1', 's2', 's3'],
      segmentWireProfileIds: ['wire_profile_1', 'wire_profile_2', 'wire_profile_3'],
    }, ['s1', 's2', 's3'], ['s1', 's3'])).toMatchObject({
      segmentIds: ['s1', 's3'],
      segmentWireProfileIds: ['wire_profile_1', 'wire_profile_3'],
    })

    expect(handleSegmentTopologyChange({
      wireProfileId: 'wire_profile_default',
      segmentIds: ['s1'],
      segmentWireProfileIds: ['wire_profile_1'],
    }, ['s1'], ['s1', 's2'])).toMatchObject({
      segmentIds: ['s1', 's2'],
      segmentWireProfileIds: ['wire_profile_1', null],
    })
  })

  it('preserves logical override order only when all stable ids are regenerated', () => {
    expect(remapSegmentWireProfileIds({
      previousSegmentIds: ['s1', 's2'],
      nextSegmentIds: ['copyA', 'copyB'],
      previousSegmentWireProfileIds: ['wire_profile_1', 'wire_profile_2'],
    })).toEqual(['wire_profile_1', 'wire_profile_2'])
  })

  it('normalizes short and long previous override arrays without leaking extra entries', () => {
    expect(remapSegmentWireProfileIds({
      previousSegmentIds: ['s1', 's2', 's3'],
      nextSegmentIds: ['s3', 's1'],
      previousSegmentWireProfileIds: ['wire_profile_1'],
    })).toEqual([null, 'wire_profile_1'])

    expect(remapSegmentWireProfileIds({
      previousSegmentIds: ['s1', 's2'],
      nextSegmentIds: ['copyA', 'copyB', 'copyC'],
      previousSegmentWireProfileIds: ['wire_profile_1', 'wire_profile_2', 'wire_profile_extra'],
    })).toEqual(['wire_profile_1', 'wire_profile_2', null])
  })

  it('handles empty malformed and duplicate ids deterministically', () => {
    expect(remapSegmentWireProfileIds({
      previousSegmentIds: ['', 's2', 's2'],
      nextSegmentIds: ['s2', '', 'sNEW'],
      previousSegmentWireProfileIds: ['wire_profile_blank', 'wire_profile_2', 'wire_profile_duplicate'],
    })).toEqual(['wire_profile_2', null, null])

    expect(remapSegmentWireProfileIds({
      previousSegmentIds: ['', ''],
      nextSegmentIds: ['copyA', 'copyB'],
      previousSegmentWireProfileIds: ['wire_profile_1', 'wire_profile_2'],
    })).toEqual(['wire_profile_1', 'wire_profile_2'])
  })
})
