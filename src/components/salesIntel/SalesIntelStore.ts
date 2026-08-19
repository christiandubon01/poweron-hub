import { create } from 'zustand';

export type SalesIntelTab =
  | 'practice'
  | 'live_call'
  | 'leads'
  | 'pipeline'
  | 'coach'
  | 'referrals'
  | 'performance';

/** Known SI tabs — used only to accept persisted `si_activeTab` values safely. */
export const SALES_INTEL_TABS: readonly SalesIntelTab[] = [
  'practice',
  'live_call',
  'leads',
  'pipeline',
  'coach',
  'referrals',
  'performance',
] as const;

function resolvePersistedTab(raw: string | null): SalesIntelTab {
  if (raw && (SALES_INTEL_TABS as readonly string[]).includes(raw)) {
    return raw as SalesIntelTab;
  }
  return 'practice';
}

/** Transient Sales Intelligence working context (COACH-LINK-2). Not CRM truth. */
export type SalesSessionMode = 'practice' | 'live_call' | 'coach';

export interface SalesSessionContext {
  sessionId: string;
  leadId: string;
  mode: SalesSessionMode;
  callLogId: string | null;
  startedAt: string;
}

/**
 * COACH-LINK-3A — one-shot Live Call modal launch intent.
 * Memory-only (not sessionStorage). Survives tab remount; cleared on consume.
 */
export interface LiveCallLaunchRequest {
  hunterLeadId: string;
}

export const SI_SALES_SESSION_KEY = 'si_sales_session';

const SESSION_MODES: readonly SalesSessionMode[] = [
  'practice',
  'live_call',
  'coach',
] as const;

function tabToSessionMode(tab: SalesIntelTab): SalesSessionMode | null {
  if (tab === 'practice' || tab === 'live_call' || tab === 'coach') return tab;
  return null;
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `si-${crypto.randomUUID()}`;
  }
  return `si-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function persistSalesSession(session: SalesSessionContext | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!session) {
      sessionStorage.removeItem(SI_SALES_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(SI_SALES_SESSION_KEY, JSON.stringify(session));
  } catch {
    // sessionStorage may be unavailable — memory store still works for the tab.
  }
}

function readPersistedSalesSession(): SalesSessionContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SI_SALES_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SalesSessionContext>;
    if (
      typeof parsed?.sessionId !== 'string' ||
      typeof parsed?.leadId !== 'string' ||
      typeof parsed?.startedAt !== 'string' ||
      !parsed.sessionId ||
      !parsed.leadId ||
      !(SESSION_MODES as readonly string[]).includes(String(parsed.mode))
    ) {
      return null;
    }
    return {
      sessionId: parsed.sessionId,
      leadId: parsed.leadId,
      mode: parsed.mode as SalesSessionMode,
      callLogId:
        parsed.callLogId == null || parsed.callLogId === ''
          ? null
          : String(parsed.callLogId),
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

export interface SalesIntelState {
  activeTab: SalesIntelTab;
  practiceMode: boolean;
  liveCallActive: boolean;
  pipelineFilters: {
    stage?: string;
    daysOverdue?: number;
  };
  // Tab-specific data
  practiceDifficultyLevel?: string;
  newLeadCount: number;
  dueFollowUps: number;
  unreviewedSessions: number;
  /** Transient shared lead/call context across Practice / Live Call / Coach. */
  salesSession: SalesSessionContext | null;
  /**
   * One-shot request for LiveCallTab to open CallLogModal for a Hunter lead.
   * Not persisted — page refresh must not reopen the modal.
   */
  liveCallLaunchRequest: LiveCallLaunchRequest | null;
  // Actions
  setActiveTab: (tab: SalesIntelTab) => void;
  setPracticeMode: (active: boolean) => void;
  setLiveCallActive: (active: boolean) => void;
  setPipelineFilters: (filters: SalesIntelState['pipelineFilters']) => void;
  setPracticeDifficultyLevel: (level: string) => void;
  setNewLeadCount: (count: number) => void;
  setDueFollowUps: (count: number) => void;
  setUnreviewedSessions: (count: number) => void;
  navigateToLeadPractice: (leadId: string) => void;
  beginSalesSession: (leadId: string, mode: SalesSessionMode) => void;
  setSalesSessionMode: (mode: SalesSessionMode) => void;
  attachCallLog: (callLogId: string) => void;
  clearSalesSession: () => void;
  /** Queue a lead-specific CallLogModal open on the Live Call tab (once). */
  requestLiveCallLaunch: (hunterLeadId: string) => void;
  /** Read + clear launch intent. Returns null if none pending. */
  consumeLiveCallLaunchRequest: () => LiveCallLaunchRequest | null;
}

export const useSalesIntelStore = create<SalesIntelState>((set, get) => {
  // Load active tab from localStorage (same key; accept known values including performance)
  const savedTab =
    typeof window !== 'undefined'
      ? resolvePersistedTab(localStorage.getItem('si_activeTab'))
      : 'practice';

  const restoredSession = readPersistedSalesSession();

  return {
    activeTab: savedTab,
    practiceMode: false,
    liveCallActive: false,
    pipelineFilters: {},
    practiceDifficultyLevel: 'intermediate',
    newLeadCount: 0,
    dueFollowUps: 0,
    unreviewedSessions: 0,
    salesSession: restoredSession,
    liveCallLaunchRequest: null,

    setActiveTab: (tab: SalesIntelTab) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('si_activeTab', tab);
      }
      const mode = tabToSessionMode(tab);
      const current = get().salesSession;
      if (mode && current) {
        const next: SalesSessionContext = { ...current, mode };
        persistSalesSession(next);
        set({ activeTab: tab, salesSession: next });
        return;
      }
      set({ activeTab: tab });
    },

    setPracticeMode: (active: boolean) => set({ practiceMode: active }),
    setLiveCallActive: (active: boolean) => set({ liveCallActive: active }),

    setPipelineFilters: (filters: SalesIntelState['pipelineFilters']) =>
      set({ pipelineFilters: filters }),

    setPracticeDifficultyLevel: (level: string) =>
      set({ practiceDifficultyLevel: level }),

    setNewLeadCount: (count: number) => set({ newLeadCount: count }),
    setDueFollowUps: (count: number) => set({ dueFollowUps: count }),
    setUnreviewedSessions: (count: number) =>
      set({ unreviewedSessions: count }),

    beginSalesSession: (leadId: string, mode: SalesSessionMode) => {
      const id = String(leadId || '').trim();
      if (!id) return;
      const current = get().salesSession;
      const next: SalesSessionContext =
        current && current.leadId === id
          ? {
              sessionId: current.sessionId,
              leadId: id,
              mode,
              callLogId: current.callLogId,
              startedAt: current.startedAt,
            }
          : {
              sessionId: newSessionId(),
              leadId: id,
              mode,
              callLogId: null,
              startedAt: new Date().toISOString(),
            };
      persistSalesSession(next);
      set({ salesSession: next });
    },

    setSalesSessionMode: (mode: SalesSessionMode) => {
      const current = get().salesSession;
      if (!current) return;
      const next: SalesSessionContext = { ...current, mode };
      persistSalesSession(next);
      set({ salesSession: next });
    },

    attachCallLog: (callLogId: string) => {
      const current = get().salesSession;
      if (!current) return;
      const id = String(callLogId || '').trim();
      if (!id) return;
      const next: SalesSessionContext = { ...current, callLogId: id };
      persistSalesSession(next);
      set({ salesSession: next });
    },

    clearSalesSession: () => {
      persistSalesSession(null);
      set({ salesSession: null, liveCallLaunchRequest: null });
    },

    requestLiveCallLaunch: (hunterLeadId: string) => {
      const id = String(hunterLeadId || '').trim();
      if (!id) return;
      set({ liveCallLaunchRequest: { hunterLeadId: id } });
    },

    consumeLiveCallLaunchRequest: () => {
      const current = get().liveCallLaunchRequest;
      if (!current) return null;
      set({ liveCallLaunchRequest: null });
      return current;
    },

    navigateToLeadPractice: (leadId: string) => {
      const id = String(leadId || '').trim();
      if (!id) return;
      // Canonical shared context (COACH-LINK-2)
      get().beginSalesSession(id, 'practice');
      // Legacy one-shot handoff — keep until COACH-LINK-3 retires it
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('si_practiceLead', id);
        localStorage.setItem('si_activeTab', 'practice');
      }
      set({
        activeTab: 'practice',
        practiceMode: true,
      });
    },
  };
});
