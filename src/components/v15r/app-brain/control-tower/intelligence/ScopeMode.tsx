import ScopePackReview from '../ScopePackReview'
import { PREVIEW_SCOPE_PACK, PREVIEW_SCOPE_PACK_LABEL } from '@/features/control-tower/scopePack/preview'
import { SCOPE_STORAGE_PENDING_MESSAGE, type ScopeStorageState } from '@/features/control-tower/scopeStorage'
import type { ScopePackContract } from '@/features/control-tower/scopePack/types'

export default function ScopeMode({ pack, selectedPhaseId, storage, preview }: {
  pack: ScopePackContract | null
  selectedPhaseId?: string | null
  storage: ScopeStorageState
  preview: boolean
}) {
  if (preview) {
    return <div className="ct-scope-mode" aria-label="Scope">
      <p className="ct-preview-scope-label">{PREVIEW_SCOPE_PACK_LABEL}</p>
      <ScopePackReview pack={PREVIEW_SCOPE_PACK} selectedPhaseId={selectedPhaseId ?? PREVIEW_SCOPE_PACK.currentPhaseId} />
    </div>
  }
  if (storage === 'pending') {
    return <div className="ct-scope-mode" aria-label="Scope">
      <p className="ct-scope-pending" role="status">{SCOPE_STORAGE_PENDING_MESSAGE}</p>
    </div>
  }
  if (!pack) {
    return <div className="ct-scope-mode" aria-label="Scope">
      <p className="ct-muted">{storage === 'unknown' ? 'Scope Packs could not be read. No fixture is shown on Live.' : 'No Scope Pack is bound to this session.'}</p>
    </div>
  }
  return <div className="ct-scope-mode" aria-label="Scope">
    <ScopePackReview pack={pack} selectedPhaseId={selectedPhaseId ?? pack.currentPhaseId} />
  </div>
}
