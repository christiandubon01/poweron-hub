import React, { useEffect } from 'react';
import { useHunterStore } from '@/store/hunterStore';
import type { HunterLead } from '@/services/hunter/HunterTypes';
import { LeadStatus } from '@/services/hunter/HunterTypes';
import { ClipboardList, ArrowLeft, FileText } from 'lucide-react';

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

  useEffect(() => {
    fetchLeads();
    // Re-fetch when component mounts / re-mounts in case Leads tab
    // promoted something. In Phase 2, we can add a store subscription
    // for real-time updates if needed.
  }, [fetchLeads]);

  const wonLeads = leads.filter((l) => (l as any).status === 'won');

  const handleOpenEstimate = (lead: HunterLead) => {
    console.log('[Pipeline] Open Estimate clicked for lead:', lead.id);
    // Dispatch a custom event that V15rProjectsPanel (or any listener) can
    // pick up to open the New Project modal pre-filled with this lead's data.
    window.dispatchEvent(
      new CustomEvent('poweron:open-estimate', {
        detail: { lead, source: 'hunter' },
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

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenEstimate(lead)}
                      className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-3 py-2 rounded transition"
                    >
                      <FileText size={14} />
                      Open Estimate
                    </button>
                    <button
                      onClick={() => handleReturnToLeads(lead)}
                      className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-3 py-2 rounded transition"
                      title="Send back to Leads tab"
                    >
                      <ArrowLeft size={14} />
                      Return to Leads
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PipelineTab;
