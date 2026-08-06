import React, { useCallback, useEffect, useState } from 'react';
import { useHunterStore } from '@/store/hunterStore';
import type { HunterLead } from '@/services/hunter/HunterTypes';
import { LeadStatus } from '@/services/hunter/HunterTypes';
import { ClipboardList, ArrowLeft, FileText, AlertTriangle } from 'lucide-react';
import { PortalStatusControls } from '@/components/portal/PortalStatusControls';
import { getBackupData } from '@/services/backupDataService';
// SALES-CONVERSION-1
import {
  ConversionReceiptsPanel,
  SERVICE_CALL_CREATED_EVENT,
  reconcilePipelineConversions,
} from '@/features/sales-intelligence/conversion-receipts';
import { completeLeadExit } from '@/features/sales-intelligence/conversion-receipts/conversionCompletion';

/**
 * PipelineTab - Won-leads view.
 *
 * Shows leads the operator has promoted out of HUNTER (status='won').
 * Each lead has two actions:
 *  - Open Estimate: dispatches 'poweron:open-estimate' custom event with
 *    the HunterLead as detail. Downstream wiring (Session C) will listen
 *    for this event and open the existing New Project modal pre-filled
 *    with HUNTER/SPARK-sourced data.
 *  - Return to Leads: sets status='new' to undo a mis-clicked Won.
 *
 * This file deliberately does NOT import anything from src/components/hunter
 * because HunterLeadCard is styled for the discovery flow with different
 * actions. Pipeline uses its own simpler card rendering.
 */
export const PipelineTab: React.FC = () => {
  const leads = useHunterStore((s) => s.leads);
  const fetchLeads = useHunterStore((s) => s.fetchLeads);
  const updateLeadStatus = useHunterStore((s) => s.updateLeadStatus);
  const isLoading = useHunterStore((s) => s.isLoading);

  const [receiptRefreshToken, setReceiptRefreshToken] = useState(0);
  const [conversionErrors, setConversionErrors] = useState<string[]>([]);

  useEffect(() => {
    fetchLeads();
    // Re-fetch when component mounts / re-mounts in case Leads tab
    // promoted something. In Phase 2, we can add a store subscription
    // for real-time updates if needed.
  }, [fetchLeads]);

  const wonLeads = leads.filter((l) => (l as any).status === 'won');

  /**
   * SALES-CONVERSION-1 — conversion completion.
   *
   * Leads sitting in the active Pipeline that provably created a destination
   * record get their receipt written here, and only then leave the Pipeline.
   *
   * This is the Service Call path's integration point: the Service Log save
   * routine already stamps `serviceEstimate.hunterLeadId`, which is the proof
   * this reads. It also picks up any Project whose inline receipt write failed,
   * so a partially completed conversion always finishes without creating a
   * second destination record.
   */
  const reconcileConversions = useCallback(async () => {
    const currentLeads = useHunterStore.getState().leads as any[];
    const backup = getBackupData();
    if (!backup) return;

    const result = await reconcilePipelineConversions({ leads: currentLeads, backup });
    setConversionErrors(result.errors);

    if (result.leadsReadyToExit.length === 0) {
      if (result.outcomes.some((o) => o.created)) setReceiptRefreshToken((n) => n + 1);
      return;
    }

    const updateStatus = useHunterStore.getState().updateLeadStatus;
    for (const leadId of result.leadsReadyToExit) {
      const lead = currentLeads.find((l) => String(l.id) === leadId);
      if (!lead) continue;
      const outcome = result.outcomes.find((o) => o.leadId === leadId);
      if (!outcome) continue;
      try {
        await completeLeadExit({
          lead,
          destinationType: outcome.destinationType,
          destinationLabel: outcome.destinationId,
          updateLeadStatus: updateStatus,
        });
      } catch (err: any) {
        console.error('[Pipeline] lead exit failed:', err);
        setConversionErrors((prev) => [...prev, err?.message ?? 'Lead status update failed.']);
      }
    }
    setReceiptRefreshToken((n) => n + 1);
  }, []);

  // Run on mount (the operator returning from Field Log / Projects) and
  // whenever the Service Log path announces a new service call.
  useEffect(() => {
    void reconcileConversions();
    const handler = () => {
      void reconcileConversions();
    };
    window.addEventListener(SERVICE_CALL_CREATED_EVENT, handler);
    return () => window.removeEventListener(SERVICE_CALL_CREATED_EVENT, handler);
  }, [reconcileConversions]);

const handleOpenEstimate = (lead: HunterLead, type: 'project' | 'service_call' = 'project') => {
    console.log('[Pipeline] Open Estimate clicked for lead:', lead.id);
    // Dispatch to AppShell listener which routes to V15rProjectsPanel prefill.
    // Note: lead status transitions to 'estimated' only when Project is actually
    // created via saveNewProject in V15rProjectsPanel — NOT when modal opens.
    // This way Cancel leaves the lead in Pipeline as 'won' (no rollback needed).
    window.dispatchEvent(
      new CustomEvent('poweron:open-estimate', {
        detail: { lead, source: 'hunter', entryType: type },
      })
    );
  };

  const handleReturnToLeads = async (lead: HunterLead) => {
    if (!window.confirm('Return this lead to the Leads tab? It will be marked as new.')) {
      return;
    }
    try {
      await updateLeadStatus(lead.id, LeadStatus.NEW);
    } catch (err) {
      console.error('Failed to return lead to Leads:', err);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-lg p-5">
        <div className="flex items-center gap-3 mb-1">
          <ClipboardList size={22} className="text-emerald-400" />
          <h2 className="text-lg font-bold text-white">Pipeline</h2>
        </div>
        <p className="text-xs text-gray-500 mb-5">
          Leads you've promoted out of HUNTER. Open Estimate to push into Projects.
        </p>

        {/* SALES-CONVERSION-1 — receipt failures are surfaced, never silent.
            The lead stays in the active list below until its receipt lands. */}
        {conversionErrors.length > 0 && (
          <div className="mb-4 text-xs text-amber-200 bg-amber-900/25 border border-amber-800 rounded px-3 py-2">
            <div className="flex items-center gap-2 font-semibold mb-1">
              <AlertTriangle size={13} />
              Conversion receipt not saved — lead kept in Pipeline
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-amber-300/80">
              {conversionErrors.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => void reconcileConversions()}
              className="mt-2 text-[11px] font-semibold bg-amber-700/40 hover:bg-amber-700/60 text-amber-100 px-2 py-1 rounded transition"
            >
              Retry
            </button>
          </div>
        )}

        {isLoading && wonLeads.length === 0 && (
          <div className="text-sm text-gray-500">Loading pipeline...</div>
        )}

        {!isLoading && wonLeads.length === 0 && (
          <div className="text-sm text-gray-500 bg-gray-900/50 border border-gray-800 rounded px-4 py-6 text-center">
            No leads promoted yet.
            <br />
            <span className="text-gray-600 text-xs">
              Mark leads as Won in the Leads tab to see them here.
            </span>
          </div>
        )}

        {wonLeads.length > 0 && (
          <div className="space-y-3">
            {wonLeads.map((lead) => {
              const anyLead = lead as any;
              const contact = anyLead.contact_name || anyLead.contactName || 'Unknown';
              const company = anyLead.company_name || anyLead.companyName;
              const value = anyLead.estimated_value || anyLead.estimatedValue || 0;
              const score = anyLead.score ?? 0;
              const source = anyLead.source_tag || anyLead.source || 'unknown';

              return (
                <div
                  key={lead.id}
                  className="bg-gray-900 border border-gray-800 rounded-lg p-4"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-white font-semibold truncate">{contact}</h3>
                        {source && (
                          <span className="text-[10px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded">
                            {source}
                          </span>
                        )}
                      </div>
                      {company && (
                        <div className="text-sm text-gray-400">{company}</div>
                      )}
                    </div>

                    <div className="text-right flex-shrink-0">
                      {value > 0 && (
                        <div className="text-emerald-400 font-semibold">
                          ${value.toLocaleString()}
                        </div>
                      )}
                      {score > 0 && (
                        <div className="text-xs text-gray-500">Score: {score}</div>
                      )}
                    </div>
                  </div>

                  <LeadTypeToggle lead={lead} onOpenEstimate={handleOpenEstimate} onReturnToLeads={handleReturnToLeads} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SALES-CONVERSION-1 — the closed ledger, deliberately styled apart from
          the active lead list above (dashed border, amber accent, no actions). */}
      <ConversionReceiptsPanel refreshToken={receiptRefreshToken} />
    </div>
  );
};

function LeadTypeToggle({ lead, onOpenEstimate, onReturnToLeads }: {
  lead: HunterLead
  onOpenEstimate: (lead: HunterLead, type: 'project' | 'service_call') => void
  onReturnToLeads: (lead: HunterLead) => void
}) {
  const [type, setType] = useState<'project' | 'service_call'>('project')
  const anyLead = lead as any
  const isPortalLead =
    anyLead.source === 'customer_portal' || anyLead.source_tag === 'customer_portal'

  return (
    <div className="space-y-2">
      <div className="flex rounded-lg overflow-hidden border border-gray-700">
        <button
          type="button"
          onClick={() => setType('project')}
          className={`flex-1 text-xs font-bold py-1.5 transition-colors ${
            type === 'project'
              ? 'bg-emerald-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}
        >
          📋 Project
        </button>
        <button
          type="button"
          onClick={() => setType('service_call')}
          className={`flex-1 text-xs font-bold py-1.5 transition-colors ${
            type === 'service_call'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}
        >
          🔧 Service Call
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onOpenEstimate(lead, type)}
          className={`flex-1 flex items-center justify-center gap-2 text-white text-sm font-medium px-3 py-2 rounded transition ${
            type === 'project'
              ? 'bg-emerald-600 hover:bg-emerald-500'
              : 'bg-blue-600 hover:bg-blue-500'
          }`}
        >
          <FileText size={14} />
          {type === 'project' ? 'Open as Project' : 'Open as Service Call'}
        </button>
        <button
          onClick={() => onReturnToLeads(lead)}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-3 py-2 rounded transition"
          title="Send back to Leads tab"
        >
          <ArrowLeft size={14} />
        </button>
      </div>

      {/* Customer Tracker — only for portal leads and only when routing as a service call */}
      {isPortalLead && type === 'service_call' && (
        <div className="mt-2">
          <PortalStatusControls lead={lead} />
        </div>
      )}
    </div>
  )
}

export default PipelineTab;
