import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  authGetUser,
  profileMaybeSingle,
  storageUpload,
  storageFrom,
  profilesEq,
  profilesSelect,
  from,
} = vi.hoisted(() => {
  const authGetUser = vi.fn()
  const profileMaybeSingle = vi.fn()
  const storageUpload = vi.fn()
  const storageFrom = vi.fn(() => ({ upload: storageUpload }))
  const profilesEq = vi.fn(() => ({ maybeSingle: profileMaybeSingle }))
  const profilesSelect = vi.fn(() => ({ eq: profilesEq }))
  const from = vi.fn(() => ({ select: profilesSelect }))

  return {
    authGetUser,
    profileMaybeSingle,
    storageUpload,
    storageFrom,
    profilesEq,
    profilesSelect,
    from,
  }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: authGetUser },
    from,
    storage: { from: storageFrom },
  },
}))

vi.mock('@/services/demoModeSafety', () => ({
  isDemoRuntimeActive: () => false,
}))

import { uploadBlueprintPdfToStorage } from '@/services/blueprintLibraryService'

function makePdfFile(name: string, size = 8): File {
  const bytes = new Uint8Array(size).fill(0x25)
  return new File([bytes as unknown as Uint8Array<ArrayBuffer>], name, { type: 'application/pdf' })
}

describe('uploadBlueprintPdfToStorage org guard', () => {
  beforeEach(() => {
    authGetUser.mockReset()
    profileMaybeSingle.mockReset()
    storageUpload.mockReset()
    storageFrom.mockClear()
    profilesEq.mockClear()
    profilesSelect.mockClear()
    from.mockClear()
  })

  it('refuses live upload when the authenticated org cannot be resolved', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    profileMaybeSingle.mockResolvedValue({ data: { org_id: null }, error: null })

    await expect(uploadBlueprintPdfToStorage({
      file: makePdfFile('live-blueprint.pdf'),
      projectId: 'project-1',
      orgId: 'local',
    })).rejects.toThrow('Could not resolve organization for blueprint upload.')

    expect(storageUpload).not.toHaveBeenCalled()
  })
})
