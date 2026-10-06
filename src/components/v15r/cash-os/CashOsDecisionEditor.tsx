import type { CashProjectFactsRow } from '@/finance/cashProjectFacts'
import CashOsProjectFactsEditor, { type LinkedSpend } from './CashOsProjectFactsEditor'

/** Lets the owner answer a job's open questions right where the money is shown. */
export interface DecisionEditor {
  factsFor: (projectId: string) => CashProjectFactsRow | null
  spendFor: (projectId: string) => LinkedSpend[]
  onSaved: () => void | Promise<void>
}

/** "Tell Cash OS about this job" entry point / inline editor for one project. */
export function DetailsToggle({ projectId, name, editor, open, onOpen, onClose, hasFacts }: {
  projectId: string; name: string; editor?: DecisionEditor; open: string | null
  onOpen: (id: string) => void; onClose: () => void; hasFacts: boolean
}) {
  if (!editor) return null
  if (open === projectId) {
    return <CashOsProjectFactsEditor projectId={projectId} projectName={name} facts={editor.factsFor(projectId)}
      linkedSpend={editor.spendFor(projectId)} onCancel={onClose}
      onSaved={async () => { await editor.onSaved(); onClose() }} />
  }
  return <button type="button" onClick={() => onOpen(projectId)}
    className="mt-2 min-h-[44px] text-sm font-semibold text-orange-300 hover:text-orange-200">{hasFacts ? 'Edit job details' : 'Tell Cash OS about this job'}</button>
}
