/**
 * guardianStore.ts
 * Zustand state management for the GUARDIAN compliance and protection agent.
 * Power On Solutions LLC (C-10 #1151468)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  GuardianAlert,
  GuardianChecklist,
  GuardianRFI,
  GuardianChangeOrder,
  GuardianViolation,
  GuardianRule,
  GuardianEvent,
  AlertStatus,
  ChecklistStatus,
  RFIStatus,
  RuleStatus,
  ChecklistItem,
  ChecklistType,
  ViolationType,
  TierCrossed,
  Severity,
} from '@/services/guardian/GuardianTypes';

// ─── Store State Interface ────────────────────────────────────

export interface GuardianStoreState {
  // Data collections
  alerts:       GuardianAlert[];
  checklists:   GuardianChecklist[];
  rfis:         GuardianRFI[];
  changeOrders: GuardianChangeOrder[];
  violations:   GuardianViolation[];
  rules:        GuardianRule[];

  // UI state
  isLoading: boolean;
  lastError: string | null;

  // ─── Actions ───────────────────────────────────────────────

  /** Fetch all open + acknowledged alerts from Supabase */
  fetchAlerts: () => Promise<void>;

  /**
   * Resolve an open alert with a resolution note.
   * Updates both Supabase and local state.
   */
  resolveAlert: (alertId: string, resolution: string) => Promise<void>;

  /**
   * Process a new flagged event through the 5-step GUARDIAN loop.
   * Calls GuardianIntelligenceLoop.processAlert, then prepends result.
   */
  processNewEvent: (event: GuardianEvent) => Promise<GuardianAlert>;

  /** Create a new checklist for a project */
  createChecklist: (
    projectId: string | null,
    checklistType: ChecklistType,
    items: ChecklistItem[],
  ) => Promise<GuardianChecklist>;

  /** Toggle a single checklist item complete/incomplete */
  completeChecklistItem: (
    checklistId: string,
    itemIndex: number,
    photoUrl?: string,
    notes?: string,
  ) => Promise<void>;

  /** Create a new RFI record */
  createRFI: (
    rfiData: Omit<GuardianRFI, 'id' | 'sent_at' | 'auto_followup_sent'>,
  ) => Promise<GuardianRFI>;

  /** Flag a worker violation */
  flagViolation: (violationData: {
    worker_id?:             string;
    project_id?:            string;
    violation_type:         ViolationType;
    tier_crossed?:          TierCrossed;
    description:            string;
    impact?:                string;
    corrective_conversation?: string;
    rule_established?:      string;
  }) => Promise<GuardianViolation>;

  /** Create a new prevention rule */
  createRule: (
    ruleText:      string,
    category?:     string,
    sourceAlertId?: string,
  ) => Promise<GuardianRule>;

  /** Archive a rule */
  archiveRule: (ruleId: string) => Promise<void>;

  /** Acknowledge a critical alert */
  acknowledgeAlert: (alertId: string) => Promise<void>;

  /** Clear last error */
  clearError: () => void;
}

// ─── Supabase lazy loader ─────────────────────────────────────

async function getSupabase() {
  const { supabase } = await import('@/lib/supabase');
  return supabase;
}

// ─── Store ────────────────────────────────────────────────────

export const useGuardianStore = create<GuardianStoreState>()(
  devtools(
    (set, get) => ({
      // ─── Initial State ──────────────────────────────────────
      alerts:       [],
      checklists:   [],
      rfis:         [],
      changeOrders: [],
      violations:   [],
      rules:        [],
      isLoading:    false,
      lastError:    null,

      // ─── fetchAlerts ────────────────────────────────────────
      fetchAlerts: async () => {
        set({ isLoading: true, lastError: null });
        try {
          const { getOpenAlerts } = await import(
            '@/services/guardian/GuardianIntelligenceLoop'
          );
          const alerts = await getOpenAlerts();
          set({ alerts, isLoading: false });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'fetchAlerts failed';
          console.error('[guardianStore] fetchAlerts:', message);
          set({ lastError: message, isLoading: false });
        }
      },

      // ─── resolveAlert ───────────────────────────────────────
      resolveAlert: async (alertId, resolution) => {
        set({ isLoading: true, lastError: null });
        try {
          const { resolveAlert: resolveAlertSvc } = await import(
            '@/services/guardian/GuardianIntelligenceLoop'
          );
          await resolveAlertSvc(alertId, resolution);

          // Update local state optimistically
          set((state) => ({
            alerts: state.alerts.map((a) =>
              a.id === alertId
                ? {
                    ...a,
                    status:      AlertStatus.RESOLVED,
                    resolved_at: new Date().toISOString(),
                    corrective_action: resolution,
                  }
                : a,
            ),
            isLoading: false,
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'resolveAlert failed';
          console.error('[guardianStore] resolveAlert:', message);
          set({ lastError: message, isLoading: false });
          throw err;
        }
      },

      // ─── processNewEvent ────────────────────────────────────
      processNewEvent: async (event) => {
        set({ isLoading: true, lastError: null });
        try {
          const { processAlert } = await import(
            '@/services/guardian/GuardianIntelligenceLoop'
          );
          const newAlert = await processAlert(event);

          set((state) => ({
            alerts:    [newAlert, ...state.alerts],
            isLoading: false,
          }));

          return newAlert;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'processNewEvent failed';
          console.error('[guardianStore] processNewEvent:', message);
          set({ lastError: message, isLoading: false });
          throw err;
        }
      },

      // ─── createChecklist ────────────────────────────────────
      createChecklist: async (projectId, checklistType, items) => {
        set({ isLoading: true, lastError: null });
        try {
          const supabase = await getSupabase();
          const { data: { user } } = await supabase.auth.getUser();

          const payload = {
            user_id:        user?.id ?? '',
            project_id:     projectId,
            checklist_type: checklistType,
            items,
            status:         ChecklistStatus.PENDING,
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (supabase as any)
            .from('guardian_checklists')
            .insert(payload)
            .select()
            .single();

          if (error) throw new Error(error.message);

          const checklist = data as GuardianChecklist;
          set((state) => ({
            checklists: [checklist, ...state.checklists],
            isLoading:  false,
          }));

          return checklist;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'createChecklist failed';
          console.error('[guardianStore] createChecklist:', message);
          set({ lastError: message, isLoading: false });
          throw err;
        }
      },

      // ─── completeChecklistItem ──────────────────────────────
      completeChecklistItem: async (checklistId, itemIndex, photoUrl, notes) => {
        const { checklists } = get();
        const checklist = checklists.find((c) => c.id === checklistId);
        if (!checklist) return;

        const updatedItems: ChecklistItem[] = checklist.items.map((item, idx) =>
          idx === itemIndex
            ? {
                ...item,
                completed:    true,
                photo_url:    photoUrl ?? item.photo_url,
                notes:        notes     ?? item.notes,
                completed_at: new Date().toISOString(),
              }
            : item,
        );

        const allDone    = updatedItems.every((i) => i.completed);
        const anyDone    = updatedItems.some((i) => i.completed);
        const newStatus: ChecklistStatus = allDone
          ? ChecklistStatus.COMPLETE
          : anyDone
          ? ChecklistStatus.PENDING
          : ChecklistStatus.INCOMPLETE;

        try {
          const supabase = await getSupabase();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (supabase as any)
            .from('guardian_checklists')
            .update({
              items:        updatedItems,
              status:       newStatus,
              completed_at: allDone ? new Date().toISOString() : null,
            })
            .eq('id', checklistId);

          if (error) throw new Error(error.message);

          set((state) => ({
            checklists: state.checklists.map((c) =>
              c.id === checklistId
                ? {
                    ...c,
                    items:        updatedItems,
                    status:       newStatus,
                    completed_at: allDone ? new Date().toISOString() : null,
                  }
                : c,
            ),
          }));
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'completeChecklistItem failed';
          console.error('[guardianStore] completeChecklistItem:', message);
          set({ lastError: message });
          throw err;
        }
      },

      // ─── createRFI ──────────────────────────────────────────
      createRFI: async (rfiData) => {
        set({ isLoading: true, lastError: null });
        try {
          const supabase = await getSupabase();

          const payload = {
            ...rfiData,
            sent_at:           new Date().toISOString(),
            auto_followup_sent: false,
            status:            RFIStatus.SENT,
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (supabase as any)
            .from('guardian_rfis')
            .insert(payload)
            .select()
            .single();

          if (error) throw new Error(error.message);

          const rfi = data as GuardianRFI;
          set((state) => ({
            rfis:      [rfi, ...state.rfis],
            isLoading: false,
          }));

          return rfi;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'createRFI failed';
          console.error('[guardianStore] createRFI:', message);
          set({ lastError: message, isLoading: false });
          throw err;
        }
      },

      // ─── flagViolation ──────────────────────────────────────
      flagViolation: async (violationData) => {
        set({ isLoading: true, lastError: null });
        try {
          const supabase = await getSupabase();
          const { data: { user } } = await supabase.auth.getUser();

          const payload = {
            user_id:    user?.id ?? '',
            ...violationData,
            created_at: new Date().toISOString(),
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (supabase as any)
            .from('guardian_violations')
            .insert(payload)
            .select()
            .single();

          if (error) throw new Error(error.message);

          const violation = data as GuardianViolation;
          set((state) => ({
            violations: [violation, ...state.violations],
            isLoading:  false,
          }));

          return violation;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'flagViolation failed';
          console.error('[guardianStore] flagViolation:', message);
          set({ lastError: message, isLoading: false });
          throw err;
        }
      },

      // ─── createRule ─────────────────────────────────────────
      createRule: async (ruleText, category, sourceAlertId) => {
        set({ isLoading: true, lastError: null });
        try {
          const supabase = await getSupabase();
          const { data: { user } } = await supabase.auth.getUser();

          const payload = {
            user_id:         user?.id ?? '',
            rule_text:       ruleText,
            category:        category        ?? null,
            source_alert_id: sourceAlertId   ?? null,
            status:          RuleStatus.ACTIVE,
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (supabase as any)
            .from('guardian_rules')
            .insert(payload)
            .select()
            .single();

          if (error) throw new Error(error.message);

          const rule = data as GuardianRule;
          set((state) => ({
            rules:     [rule, ...state.rules],
            isLoading: false,
          }));

          return rule;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'createRule failed';
          console.error('[guardianStore] createRule:', message);
          set({ lastError: message, isLoading: false });
          throw err;
        }
      },

      // ─── archiveRule ─────────────────────────────────────────
      archiveRule: async (ruleId) => {
        try {
          const supabase = await getSupabase();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (supabase as any)
            .from('guardian_rules')
            .update({ status: RuleStatus.ARCHIVED })
            .eq('id', ruleId);

          if (error) throw new Error(error.message);

          set((state) => ({
            rules: state.rules.map((r) =>
              r.id === ruleId ? { ...r, status: RuleStatus.ARCHIVED } : r,
            ),
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'archiveRule failed';
          console.error('[guardianStore] archiveRule:', message);
          set({ lastError: message });
          throw err;
        }
      },

      // ─── acknowledgeAlert ────────────────────────────────────
      acknowledgeAlert: async (alertId) => {
        try {
          const supabase = await getSupabase();
          const { data: { user } } = await supabase.auth.getUser();

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (supabase as any)
            .from('guardian_alerts')
            .update({
              status:          AlertStatus.ACKNOWLEDGED,
              acknowledged_by: user?.id ?? null,
            })
            .eq('id', alertId);

          if (error) throw new Error(error.message);

          set((state) => ({
            alerts: state.alerts.map((a) =>
              a.id === alertId
                ? {
                    ...a,
                    status:          AlertStatus.ACKNOWLEDGED,
                    acknowledged_by: user?.id ?? null,
                  }
                : a,
            ),
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'acknowledgeAlert failed';
          console.error('[guardianStore] acknowledgeAlert:', message);
          set({ lastError: message });
          throw err;
        }
      },

      // ─── clearError ─────────────────────────────────────────
      clearError: () => set({ lastError: null }),
    }),
    { name: 'GuardianStore' },
  ),
);

export default useGuardianStore;
