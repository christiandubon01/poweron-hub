import { useState, useEffect, useCallback } from 'react';
import {
  Workflow,
  Mail,
  FileText,
  Star,
  Sun,
  Receipt,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  Activity,
  Network,
  Shield,
} from 'lucide-react';
import {
  initN8nAutomationAgent,
  getWorkflowRuns,
  getLastRunForWorkflow,
  getLastResultForWorkflow,
} from '../agents/n8nAutomation';
import { getRecentActivity } from '../services/activityLog';
import type { ActivityEntry } from '../services/activityLog';
import { getQueueFor } from '../services/agentBus';
import type { AgentName } from '../services/agentBus';
import { useAuth } from '@/hooks/useAuth';

// ─── Types ────────────────────────────────────────────────────────────────────

type AutomationStatus = 'active' | 'paused' | 'error';
type EventResult = 'success' | 'failure';

interface AutomationWorkflow {
  id: string;
  name: string;
  description: string;
  status: AutomationStatus;
  lastRun: string | null;
  nextRun: string | null;
  icon: React.ReactNode;
}

interface ActivityEvent {
  id: string;
  timestamp: string;
  automationName: string;
  result: EventResult;
  description: string;
}

// ─── Agent System Map Types ───────────────────────────────────────────────────

type ViewTab = 'workflows' | 'agent-map';

type AgentWireStatus = 'yes' | 'partial' | 'not-built';
type AgentLiveStatus = 'Active' | 'V4' | 'V5';

interface AgentDef {
  name: string;
  tier: string;
  tierLabel: string;
  role: string;
  liveStatus: AgentLiveStatus;
  wired: AgentWireStatus;
  busName: AgentName | null;
}

// ─── Agent Registry (all 15) ──────────────────────────────────────────────────

const AGENT_DEFS: AgentDef[] = [
  // T1 Executive
  { name: 'NEXUS',     tier: 'T1', tierLabel: 'Executive',    role: 'Chief of Staff',   liveStatus: 'Active', wired: 'yes',       busName: 'NEXUS'      },
  // T2 Directors
  { name: 'PULSE',     tier: 'T2', tierLabel: 'Directors',    role: 'CFO',              liveStatus: 'Active', wired: 'partial',   busName: 'PULSE'      },
  { name: 'BLUEPRINT', tier: 'T2', tierLabel: 'Directors',    role: 'COO',              liveStatus: 'Active', wired: 'partial',   busName: 'BLUEPRINT'  },
  { name: 'SPARK',     tier: 'T2', tierLabel: 'Directors',    role: 'CMO',              liveStatus: 'Active', wired: 'yes',       busName: 'SPARK'      },
  // T3 Managers
  { name: 'VAULT',     tier: 'T3', tierLabel: 'Managers',     role: 'Estimating',       liveStatus: 'Active', wired: 'partial',   busName: 'VAULT'      },
  { name: 'LEDGER',    tier: 'T3', tierLabel: 'Managers',     role: 'Invoicing',        liveStatus: 'Active', wired: 'partial',   busName: 'LEDGER'     },
  { name: 'CHRONO',    tier: 'T3', tierLabel: 'Managers',     role: 'Scheduling',       liveStatus: 'Active', wired: 'partial',   busName: 'CHRONO'     },
  { name: 'OHM',       tier: 'T3', tierLabel: 'Managers',     role: 'Code Compliance',  liveStatus: 'Active', wired: 'yes',       busName: 'OHM'        },
  { name: 'GUARDIAN',  tier: 'T3', tierLabel: 'Managers',     role: 'Compliance',       liveStatus: 'Active', wired: 'partial',   busName: null         },
  // T4 Intelligence
  { name: 'SCOUT',     tier: 'T4', tierLabel: 'Intelligence', role: 'System Analyzer',  liveStatus: 'Active', wired: 'partial',   busName: 'SCOUT'      },
  { name: 'HUNTER',    tier: 'T4', tierLabel: 'Intelligence', role: 'Lead Sizing',      liveStatus: 'V4',     wired: 'not-built', busName: null         },
  { name: 'ECHO',      tier: 'T4', tierLabel: 'Intelligence', role: 'Context Memory',   liveStatus: 'Active', wired: 'yes',       busName: null         },
  { name: 'ATLAS',     tier: 'T4', tierLabel: 'Intelligence', role: 'Location/Mode',    liveStatus: 'Active', wired: 'partial',   busName: null         },
  // V5 Future
  { name: 'NEGOTIATE', tier: 'V5', tierLabel: 'Future',       role: 'Negotiation',      liveStatus: 'V5',     wired: 'not-built', busName: null         },
  { name: 'SENTINEL',  tier: 'V5', tierLabel: 'Future',       role: 'Security',         liveStatus: 'V5',     wired: 'not-built', busName: null         },
];

// ─── Workflow Definitions (static metadata) ───────────────────────────────────
// lastRun + status are derived from real agentBus/activityLog data at runtime.

const WORKFLOW_DEFS: Omit<AutomationWorkflow, 'lastRun' | 'status'>[] = [
  {
    id: 'lead-intake',
    name: 'Lead Intake',
    description:
      'Captures inbound email and text leads and pushes them into SPARK for scoring and follow-up.',
    nextRun: 'Continuous',
    icon: <Mail size={18} />,
  },
  {
    id: 'invoice-followup',
    name: 'Invoice Follow-Up',
    description:
      'Sends automatic AR reminder messages for outstanding invoices older than 14 days via LEDGER.',
    nextRun: new Date(
      Date.now() + 24 * 60 * 60 * 1000
    ).toISOString(),
    icon: <FileText size={18} />,
  },
  {
    id: 'daily-briefing',
    name: 'Daily Briefing',
    description:
      'Delivers a morning summary of open jobs and unread leads via PULSE + NEXUS on first session of day.',
    nextRun: (() => {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      t.setHours(5, 30, 0, 0);
      return t.toISOString();
    })(),
    icon: <Sun size={18} />,
  },
  {
    id: 'receipt-processing',
    name: 'Receipt Processing',
    description:
      'Parses uploaded receipts via VAULT and automatically creates expense entries in LEDGER.',
    nextRun: null,
    icon: <Receipt size={18} />,
  },
  {
    id: 'review-monitoring',
    name: 'Review Monitoring',
    description:
      'Monitors Google Business reviews via SPARK and flags negative ones for immediate attention.',
    nextRun: new Date(
      Date.now() + 24 * 60 * 60 * 1000
    ).toISOString(),
    icon: <Star size={18} />,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatNextRun(next: string | null): string {
  if (!next) return '—';
  if (next === 'Continuous') return 'Continuous';
  return formatTimestamp(next);
}

/** Map activityLog agent_name to a workflow id for grouping. */
function actionTypeToWorkflowId(actionType: string): string {
  const map: Record<string, string> = {
    lead_intake: 'lead-intake',
    invoice_followup: 'invoice-followup',
    daily_briefing: 'daily-briefing',
    receipt_processing: 'receipt-processing',
    review_monitoring: 'review-monitoring',
  };
  return map[actionType] ?? actionType;
}

/** Map workflow id to a human-readable display name. */
function workflowIdToName(id: string): string {
  const map: Record<string, string> = {
    'lead-intake': 'Lead Intake',
    'invoice-followup': 'Invoice Follow-Up',
    'daily-briefing': 'Daily Briefing',
    'receipt-processing': 'Receipt Processing',
    'review-monitoring': 'Review Monitoring',
  };
  return map[id] ?? id;
}

/** Convert activityLog entries to ActivityEvent shape for the UI. */
function entriesToEvents(entries: ActivityEntry[]): ActivityEvent[] {
  return entries
    .filter((e) => e.agent_name === 'n8n')
    .map((e) => ({
      id: e.id,
      timestamp: e.created_at,
      automationName: workflowIdToName(actionTypeToWorkflowId(e.action_type)),
      result: 'success' as EventResult, // activityLog only records successful writes
      description: e.summary,
    }));
}

// ─── Status Dot ───────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: AutomationStatus }) {
  const styles: Record<AutomationStatus, string> = {
    active: 'bg-green-400',
    paused: 'bg-yellow-400',
    error: 'bg-red-400',
  };
  const labels: Record<AutomationStatus, string> = {
    active: 'Active',
    paused: 'Paused',
    error: 'Error',
  };
  const textStyles: Record<AutomationStatus, string> = {
    active: 'text-green-400',
    paused: 'text-yellow-400',
    error: 'text-red-400',
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${styles[status]}`} />
      <span className={`text-xs font-medium ${textStyles[status]}`}>{labels[status]}</span>
    </div>
  );
}

// ─── Workflow Card ────────────────────────────────────────────────────────────

function WorkflowCard({
  workflow,
  onToggle,
}: {
  workflow: AutomationWorkflow;
  onToggle: (id: string) => void;
}) {
  const isEnabled = workflow.status !== 'paused';
  const iconBgColors: Record<AutomationStatus, string> = {
    active: '#16a34a22',
    paused: '#78350f22',
    error: '#7f1d1d22',
  };
  const iconBorderColors: Record<AutomationStatus, string> = {
    active: '#16a34a44',
    paused: '#92400e44',
    error: '#991b1b44',
  };
  const iconTextColors: Record<AutomationStatus, string> = {
    active: '#4ade80',
    paused: '#fbbf24',
    error: '#f87171',
  };

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3 transition-colors"
      style={{
        borderColor: workflow.status === 'error' ? '#7f1d1d55' : '#1e2128',
        backgroundColor: '#0d0e14',
      }}
    >
      {/* Card header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: iconBgColors[workflow.status],
              border: `1px solid ${iconBorderColors[workflow.status]}`,
              color: iconTextColors[workflow.status],
            }}
          >
            {workflow.icon}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-100">{workflow.name}</h3>
            <StatusDot status={workflow.status} />
          </div>
        </div>

        {/* Toggle */}
        <button
          onClick={() => onToggle(workflow.id)}
          className="flex-shrink-0 text-gray-500 hover:text-gray-300 transition-colors mt-0.5"
          title={isEnabled ? 'Pause automation' : 'Enable automation'}
        >
          {isEnabled ? (
            <ToggleRight size={22} className="text-green-500" />
          ) : (
            <ToggleLeft size={22} className="text-gray-600" />
          )}
        </button>
      </div>

      {/* Description */}
      <p className="text-xs text-gray-500 leading-relaxed">{workflow.description}</p>

      {/* Meta info */}
      <div
        className="flex flex-col gap-1 pt-2 border-t"
        style={{ borderColor: '#1a1c23' }}
      >
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-600">Last run</span>
          <span className="text-gray-400">
            {workflow.lastRun ? formatTimestamp(workflow.lastRun) : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-600">Next run</span>
          <span className={workflow.status === 'paused' ? 'text-gray-600' : 'text-gray-400'}>
            {workflow.status === 'paused' ? 'Paused' : formatNextRun(workflow.nextRun)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Activity Row ─────────────────────────────────────────────────────────────

function ActivityRow({ event }: { event: ActivityEvent }) {
  const isSuccess = event.result === 'success';
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 border-b last:border-0"
      style={{ borderColor: '#1a1c23' }}
    >
      {/* Result icon */}
      <div className="flex-shrink-0 mt-0.5">
        {isSuccess ? (
          <CheckCircle size={14} className="text-green-500" />
        ) : (
          <XCircle size={14} className="text-red-400" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-300">{event.automationName}</span>
          <span
            className={`text-xs font-medium px-1.5 py-0.5 rounded border ${
              isSuccess
                ? 'bg-green-900/30 text-green-400 border-green-800/40'
                : 'bg-red-900/30 text-red-400 border-red-800/40'
            }`}
          >
            {isSuccess ? 'Success' : 'Failure'}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5 leading-snug">{event.description}</p>
      </div>

      {/* Timestamp */}
      <div className="flex items-center gap-1 flex-shrink-0 text-xs text-gray-600">
        <Clock size={11} />
        {formatTimestamp(event.timestamp)}
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div
      className="rounded-xl border px-4 py-3 flex flex-col gap-0.5"
      style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
    >
      <span className="text-xs text-gray-600 uppercase tracking-wider">{label}</span>
      <span className={`text-2xl font-bold ${accent}`}>{value}</span>
    </div>
  );
}

// ─── Build workflows from real agent state ────────────────────────────────────

function buildWorkflows(
  pausedIds: Set<string>
): AutomationWorkflow[] {
  return WORKFLOW_DEFS.map((def) => {
    const lastRun = getLastRunForWorkflow(def.id);
    const lastResult = getLastResultForWorkflow(def.id);

    let status: AutomationStatus = 'active';
    if (pausedIds.has(def.id)) {
      status = 'paused';
    } else if (lastResult === 'failure') {
      status = 'error';
    }

    return {
      ...def,
      lastRun,
      status,
    };
  });
}

// ─── Build activity events from workflowRuns + activityLog ───────────────────

function buildActivityFromRuns(): ActivityEvent[] {
  const runs = getWorkflowRuns();
  return runs.slice(0, 20).map((run, i) => ({
    id: `run-${i}-${run.workflowId}`,
    timestamp: run.timestamp,
    automationName: workflowIdToName(run.workflowId),
    result: run.result,
    description: run.description,
  }));
}

// ─── Agent Card (System Map) ──────────────────────────────────────────────────

/** Get the most-recent bus message timestamp for an agent, or null. */
function getAgentLastActivity(busName: AgentName | null): string | null {
  if (!busName) return null;
  const queue = getQueueFor(busName);
  if (queue.length === 0) return null;
  const latest = queue.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
  return new Date(latest.timestamp).toISOString();
}

function AgentCard({ agent }: { agent: AgentDef }) {
  const lastActivity = getAgentLastActivity(agent.busName);

  // ── Tier badge colors ──────────────────────────────────────────────────────
  const tierColors: Record<string, { bg: string; text: string; border: string }> = {
    T1: { bg: '#1a0a2e', text: '#c084fc', border: '#7c3aed44' },
    T2: { bg: '#0a1f2e', text: '#38bdf8', border: '#0369a144' },
    T3: { bg: '#0a1f14', text: '#4ade80', border: '#16a34a44' },
    T4: { bg: '#1f1a0a', text: '#fbbf24', border: '#d9770644' },
    V5: { bg: '#1a1a1a', text: '#6b7280', border: '#37415144' },
  };
  const tierStyle = tierColors[agent.tier] ?? tierColors.V5;

  // ── Status chip ────────────────────────────────────────────────────────────
  const statusChip: Record<AgentLiveStatus, { bg: string; text: string; border: string; label: string }> = {
    Active: { bg: '#052e16aa', text: '#4ade80', border: '#16a34a55', label: 'Active' },
    V4:     { bg: '#1c1917aa', text: '#a8a29e', border: '#57534e55', label: 'V4' },
    V5:     { bg: '#111111aa', text: '#6b7280', border: '#37415155', label: 'V5' },
  };
  const chip = statusChip[agent.liveStatus];

  // ── Wired indicator ────────────────────────────────────────────────────────
  const wiredDot: Record<AgentWireStatus, { dot: string; label: string; text: string }> = {
    'yes':       { dot: 'bg-green-400',  label: 'Wired',     text: 'text-green-400'  },
    'partial':   { dot: 'bg-yellow-400', label: 'Partial',   text: 'text-yellow-400' },
    'not-built': { dot: 'bg-gray-600',   label: 'Not wired', text: 'text-gray-500'   },
  };
  const wd = wiredDot[agent.wired];

  // ── Card border accent by wired status ────────────────────────────────────
  const cardBorderColor =
    agent.wired === 'yes'       ? '#16a34a33' :
    agent.wired === 'partial'   ? '#d9770633' :
                                  '#1e2128';

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3"
      style={{ borderColor: cardBorderColor, backgroundColor: '#0d0e14' }}
    >
      {/* Top row: name + status chip */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-bold text-gray-100 tracking-wide">{agent.name}</span>
          <span className="text-xs text-gray-500">{agent.role}</span>
        </div>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 mt-0.5"
          style={{ backgroundColor: chip.bg, color: chip.text, borderColor: chip.border }}
        >
          {chip.label}
        </span>
      </div>

      {/* Tier badge */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded border"
          style={{ backgroundColor: tierStyle.bg, color: tierStyle.text, borderColor: tierStyle.border }}
        >
          {agent.tier}
        </span>
        <span className="text-xs text-gray-600">{agent.tierLabel}</span>
      </div>

      {/* Wired status */}
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${wd.dot}`} />
        <span className={`text-xs font-medium ${wd.text}`}>{wd.label}</span>
      </div>

      {/* Last activity */}
      {lastActivity && (
        <div className="flex items-center gap-1 text-xs text-gray-600">
          <Clock size={10} />
          <span>{formatTimestamp(lastActivity)}</span>
        </div>
      )}
    </div>
  );
}

// ─── Agent System Map Panel ───────────────────────────────────────────────────

function AgentSystemMap() {
  // Group agents by tier for section headers
  const tiers: Array<{ key: string; label: string }> = [
    { key: 'T1', label: 'T1 · Executive' },
    { key: 'T2', label: 'T2 · Directors' },
    { key: 'T3', label: 'T3 · Managers' },
    { key: 'T4', label: 'T4 · Intelligence' },
    { key: 'V5', label: 'V5 · Future' },
  ];

  const fullyWired  = AGENT_DEFS.filter((a) => a.wired === 'yes').length;
  const partial     = AGENT_DEFS.filter((a) => a.wired === 'partial').length;
  const notBuilt    = AGENT_DEFS.filter((a) => a.wired === 'not-built').length;

  return (
    <div className="flex flex-col gap-6">
      {/* Legend + summary */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block" />
          Fully wired ({fullyWired})
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" />
          Partial ({partial})
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-600 inline-block" />
          Not built ({notBuilt})
        </div>
        <span className="text-xs text-gray-600 ml-auto italic">Read-only · {AGENT_DEFS.length} agents</span>
      </div>

      {/* Agent grid grouped by tier */}
      {tiers.map(({ key, label }) => {
        const agents = AGENT_DEFS.filter((a) => a.tier === key);
        if (agents.length === 0) return null;
        return (
          <div key={key}>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-600 mb-3">
              {label}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {agents.map((agent) => (
                <AgentCard key={agent.name} agent={agent} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main N8nAutomation View ──────────────────────────────────────────────────

export default function N8nAutomation() {
  const { user } = useAuth();
  const isAdmin = !!user?.email && user.email === import.meta.env.VITE_ADMIN_EMAIL;
  const [activeTab, setActiveTab] = useState<ViewTab>('workflows');

  // Track which workflows the user has manually paused
  const [pausedIds, setPausedIds] = useState<Set<string>>(new Set());
  // Derived workflow list — refreshed when agentBus events arrive
  const [workflows, setWorkflows] = useState<AutomationWorkflow[]>(() =>
    buildWorkflows(new Set())
  );
  // Real activity log — populated from activityLog + workflowRun registry
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);

  // ── Refresh helpers ──────────────────────────────────────────────────────

  const refreshWorkflows = useCallback((paused: Set<string>) => {
    setWorkflows(buildWorkflows(paused));
  }, []);

  const refreshActivity = useCallback(async () => {
    try {
      // Prefer activityLog (persisted to Supabase); fall back to in-memory runs
      const entries = await getRecentActivity(20);
      const fromLog = entriesToEvents(entries);
      if (fromLog.length > 0) {
        setActivityEvents(fromLog);
      } else {
        // No Supabase entries yet — use in-memory workflow run history
        setActivityEvents(buildActivityFromRuns());
      }
    } catch {
      setActivityEvents(buildActivityFromRuns());
    }
  }, []);

  // ── Mount: init agent + load real data ──────────────────────────────────

  useEffect(() => {
    // Initialize the agent (wires Supabase realtime + polling)
    // orgId/userId are not available in the view scope — the agent defers
    // polling until they are provided (e.g. from NEXUS auth context).
    // Workflow triggers can also be called externally with full auth context.
    const cleanup = initN8nAutomationAgent();

    // Initial data load from real event log
    refreshWorkflows(pausedIds);
    void refreshActivity();

    // Poll every 30 s to pick up runs triggered by polling or realtime
    const pollTimer = setInterval(() => {
      refreshWorkflows(pausedIds);
      void refreshActivity();
    }, 30_000);

    return () => {
      clearInterval(pollTimer);
      if (typeof cleanup === 'function') cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-derive workflows when pause state changes ─────────────────────────

  useEffect(() => {
    refreshWorkflows(pausedIds);
  }, [pausedIds, refreshWorkflows]);

  // ── Toggle handler ───────────────────────────────────────────────────────

  function handleToggle(id: string) {
    setPausedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        // Cannot toggle error workflows — they need resolution
        const wf = workflows.find((w) => w.id === id);
        if (wf?.status === 'error') return prev;
        next.add(id);
      }
      return next;
    });
  }

  // ── Derived stats ────────────────────────────────────────────────────────

  const total = workflows.length;
  const active = workflows.filter((w) => w.status === 'active').length;
  const paused = workflows.filter((w) => w.status === 'paused').length;
  const errors = workflows.filter((w) => w.status === 'error').length;

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-5xl mx-auto w-full">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Workflow size={18} className="text-green-400" />
          <h1 className="text-lg font-semibold text-gray-100">n8n Automation</h1>
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full border"
            style={{ color: '#4ade80', borderColor: '#16a34a33', backgroundColor: '#052e1688' }}
          >
            B27 · Agent Wired
          </span>
          {isAdmin && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full border flex items-center gap-1"
              style={{ color: '#c084fc', borderColor: '#7c3aed44', backgroundColor: '#1a0a2e88' }}
            >
              <Shield size={10} />
              Admin
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500">
          Monitor and control your n8n automation workflows. Status and last-run times reflect real
          agent activity from SPARK, LEDGER, VAULT, PULSE, and NEXUS.
        </p>
      </div>

      {/* ── Admin Tab Bar ───────────────────────────────────────────────────── */}
      {isAdmin && (
        <div
          className="flex items-center gap-1 border-b"
          style={{ borderColor: '#1e2128' }}
        >
          <button
            onClick={() => setActiveTab('workflows')}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px"
            style={{
              borderColor:  activeTab === 'workflows' ? '#4ade80' : 'transparent',
              color:        activeTab === 'workflows' ? '#4ade80' : '#6b7280',
            }}
          >
            <Workflow size={13} />
            Workflows
          </button>
          <button
            onClick={() => setActiveTab('agent-map')}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px"
            style={{
              borderColor:  activeTab === 'agent-map' ? '#c084fc' : 'transparent',
              color:        activeTab === 'agent-map' ? '#c084fc' : '#6b7280',
            }}
          >
            <Network size={13} />
            Agent System Map
          </button>
        </div>
      )}

      {/* ── Workflows Tab ───────────────────────────────────────────────────── */}
      {(!isAdmin || activeTab === 'workflows') && (
        <>
          {/* Stats Row */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Total" value={total} accent="text-gray-200" />
            <StatCard label="Active" value={active} accent="text-green-400" />
            <StatCard label="Paused" value={paused} accent="text-yellow-400" />
            <StatCard label="Errors" value={errors} accent="text-red-400" />
          </div>

          {/* Workflow Grid */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-600 mb-3">
              Automation Workflows
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {workflows.map((wf) => (
                <WorkflowCard key={wf.id} workflow={wf} onToggle={handleToggle} />
              ))}
            </div>
          </div>

          {/* Activity Log */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Activity size={14} className="text-green-400" />
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-600">
                Activity Log
              </p>
              <span
                className="text-xs font-medium px-1.5 py-0.5 rounded-full border"
                style={{ color: '#4ade80', borderColor: '#16a34a33', backgroundColor: '#052e1688' }}
              >
                {activityEvents.length > 0
                  ? `Last ${activityEvents.length} events — live`
                  : 'Waiting for events'}
              </span>
            </div>
            <div
              className="rounded-xl border overflow-hidden"
              style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
            >
              {activityEvents.length > 0 ? (
                activityEvents.map((event) => (
                  <ActivityRow key={event.id} event={event} />
                ))
              ) : (
                <div className="px-4 py-8 text-center text-xs text-gray-600">
                  No automation events yet — workflows will log here as they run.
                </div>
              )}
            </div>
          </div>

          {/* Footer note */}
          <div className="flex items-center gap-2 pb-2">
            <AlertCircle size={12} className="text-gray-700 flex-shrink-0" />
            <p className="text-xs text-gray-700">
              Activity sourced from activityLog (Supabase) with in-memory fallback. Workflow statuses
              reflect real agent runs via SPARK, LEDGER, VAULT, PULSE, and NEXUS.
            </p>
          </div>
        </>
      )}

      {/* ── Agent System Map Tab (admin only) ──────────────────────────────── */}
      {isAdmin && activeTab === 'agent-map' && <AgentSystemMap />}
    </div>
  );
}
