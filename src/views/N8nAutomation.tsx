import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { initN8nAutomationAgent } from '../agents/n8nAutomation';

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

// ─── Mock Data ────────────────────────────────────────────────────────────────

const INITIAL_WORKFLOWS: AutomationWorkflow[] = [
  {
    id: 'lead-intake',
    name: 'Lead Intake',
    description: 'Captures inbound email and text leads and pushes them into SPARK for follow-up.',
    status: 'active',
    lastRun: '2026-04-05T07:42:00Z',
    nextRun: 'Continuous',
    icon: <Mail size={18} />,
  },
  {
    id: 'invoice-followup',
    name: 'Invoice Follow-Up',
    description: 'Sends automatic AR reminder messages for outstanding invoices on a 3/7/14-day cadence.',
    status: 'active',
    lastRun: '2026-04-05T06:00:00Z',
    nextRun: '2026-04-06T06:00:00Z',
    icon: <FileText size={18} />,
  },
  {
    id: 'daily-briefing',
    name: 'Daily Briefing',
    description: 'Delivers a morning summary of open jobs, today\'s tasks, and unread leads via text.',
    status: 'active',
    lastRun: '2026-04-05T05:30:00Z',
    nextRun: '2026-04-06T05:30:00Z',
    icon: <Sun size={18} />,
  },
  {
    id: 'receipt-processing',
    name: 'Receipt Processing',
    description: 'Parses emailed receipts and automatically updates the corresponding MTO job cost entry.',
    status: 'paused',
    lastRun: '2026-04-03T14:17:00Z',
    nextRun: null,
    icon: <Receipt size={18} />,
  },
  {
    id: 'review-monitoring',
    name: 'Review Monitoring',
    description: 'Monitors Google Business reviews and triggers alerts for new negative or positive reviews.',
    status: 'error',
    lastRun: '2026-04-04T22:00:00Z',
    nextRun: '2026-04-05T22:00:00Z',
    icon: <Star size={18} />,
  },
];

const MOCK_ACTIVITY: ActivityEvent[] = [
  {
    id: 'evt-20',
    timestamp: '2026-04-05T07:42:11Z',
    automationName: 'Lead Intake',
    result: 'success',
    description: 'New lead captured from email — forwarded to SPARK queue.',
  },
  {
    id: 'evt-19',
    timestamp: '2026-04-05T07:11:03Z',
    automationName: 'Invoice Follow-Up',
    result: 'success',
    description: 'Reminder sent to Riverside Commercial — Invoice #1047 (7-day).',
  },
  {
    id: 'evt-18',
    timestamp: '2026-04-05T06:59:44Z',
    automationName: 'Lead Intake',
    result: 'success',
    description: 'SMS lead captured — pushed to SPARK as "New Contact".',
  },
  {
    id: 'evt-17',
    timestamp: '2026-04-05T06:01:02Z',
    automationName: 'Invoice Follow-Up',
    result: 'success',
    description: 'Daily AR sweep complete — 3 reminders queued.',
  },
  {
    id: 'evt-16',
    timestamp: '2026-04-05T05:30:00Z',
    automationName: 'Daily Briefing',
    result: 'success',
    description: 'Morning briefing delivered — 4 open jobs, 2 unread leads.',
  },
  {
    id: 'evt-15',
    timestamp: '2026-04-04T22:01:09Z',
    automationName: 'Review Monitoring',
    result: 'failure',
    description: 'Google Business API auth token expired — re-authentication required.',
  },
  {
    id: 'evt-14',
    timestamp: '2026-04-04T19:38:22Z',
    automationName: 'Lead Intake',
    result: 'success',
    description: 'New lead captured from email — forwarded to SPARK queue.',
  },
  {
    id: 'evt-13',
    timestamp: '2026-04-04T17:14:55Z',
    automationName: 'Invoice Follow-Up',
    result: 'success',
    description: 'Reminder sent to Oakwood Remodel — Invoice #1039 (14-day).',
  },
  {
    id: 'evt-12',
    timestamp: '2026-04-04T16:07:31Z',
    automationName: 'Lead Intake',
    result: 'success',
    description: 'SMS lead captured — duplicate detected, merged with existing contact.',
  },
  {
    id: 'evt-11',
    timestamp: '2026-04-04T14:17:43Z',
    automationName: 'Receipt Processing',
    result: 'success',
    description: 'Receipt from Home Depot parsed — $342.18 logged to Job #204.',
  },
  {
    id: 'evt-10',
    timestamp: '2026-04-04T12:55:10Z',
    automationName: 'Invoice Follow-Up',
    result: 'success',
    description: 'Reminder sent to Metro Contractors — Invoice #1041 (3-day).',
  },
  {
    id: 'evt-09',
    timestamp: '2026-04-04T09:30:00Z',
    automationName: 'Daily Briefing',
    result: 'success',
    description: 'Morning briefing delivered — 5 open jobs, 1 unread lead.',
  },
  {
    id: 'evt-08',
    timestamp: '2026-04-03T22:01:00Z',
    automationName: 'Review Monitoring',
    result: 'success',
    description: '2 new 5-star reviews detected on Google Business.',
  },
  {
    id: 'evt-07',
    timestamp: '2026-04-03T18:44:12Z',
    automationName: 'Lead Intake',
    result: 'failure',
    description: 'Email parse error — unrecognized sender format. Flagged for manual review.',
  },
  {
    id: 'evt-06',
    timestamp: '2026-04-03T15:22:00Z',
    automationName: 'Receipt Processing',
    result: 'success',
    description: 'Receipt from Graybar parsed — $1,205.40 logged to Job #198.',
  },
  {
    id: 'evt-05',
    timestamp: '2026-04-03T14:17:22Z',
    automationName: 'Receipt Processing',
    result: 'success',
    description: 'Receipt from Rexel parsed — $87.60 logged to Job #201.',
  },
  {
    id: 'evt-04',
    timestamp: '2026-04-03T11:03:44Z',
    automationName: 'Invoice Follow-Up',
    result: 'success',
    description: 'Reminder sent to Sunrise Properties — Invoice #1033 (7-day).',
  },
  {
    id: 'evt-03',
    timestamp: '2026-04-03T09:30:00Z',
    automationName: 'Daily Briefing',
    result: 'success',
    description: 'Morning briefing delivered — 4 open jobs, 0 unread leads.',
  },
  {
    id: 'evt-02',
    timestamp: '2026-04-02T22:01:00Z',
    automationName: 'Review Monitoring',
    result: 'success',
    description: '1 new 4-star review detected — no alert triggered.',
  },
  {
    id: 'evt-01',
    timestamp: '2026-04-02T16:55:19Z',
    automationName: 'Lead Intake',
    result: 'success',
    description: 'New lead captured from email — forwarded to SPARK queue.',
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

// ─── Main N8nAutomation View ──────────────────────────────────────────────────

export default function N8nAutomation() {
  const [workflows, setWorkflows] = useState<AutomationWorkflow[]>(INITIAL_WORKFLOWS);

  // Initialize agent stub on mount
  useEffect(() => {
    initN8nAutomationAgent();
  }, []);

  function handleToggle(id: string) {
    setWorkflows((prev) =>
      prev.map((wf) => {
        if (wf.id !== id) return wf;
        // Toggle between active and paused (error stays until resolved)
        if (wf.status === 'active') return { ...wf, status: 'paused' as AutomationStatus };
        if (wf.status === 'paused') return { ...wf, status: 'active' as AutomationStatus };
        return wf; // error — toggle disabled
      })
    );
  }

  // Derived stats
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
            V3-18 · Management UI
          </span>
        </div>
        <p className="text-sm text-gray-500">
          Monitor and control your n8n automation workflows. Toggles pause/resume — real webhook
          connections are configured in n8n directly.
        </p>
      </div>

      {/* ── Stats Row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total" value={total} accent="text-gray-200" />
        <StatCard label="Active" value={active} accent="text-green-400" />
        <StatCard label="Paused" value={paused} accent="text-yellow-400" />
        <StatCard label="Errors" value={errors} accent="text-red-400" />
      </div>

      {/* ── Workflow Grid ──────────────────────────────────────────────────── */}
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

      {/* ── Activity Log ───────────────────────────────────────────────────── */}
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
            Last 20 events
          </span>
        </div>
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
        >
          {MOCK_ACTIVITY.map((event) => (
            <ActivityRow key={event.id} event={event} />
          ))}
        </div>
      </div>

      {/* ── Footer note ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 pb-2">
        <AlertCircle size={12} className="text-gray-700 flex-shrink-0" />
        <p className="text-xs text-gray-700">
          Activity log uses mock data. Wire to n8n execution history API during integration.
        </p>
      </div>
    </div>
  );
}
