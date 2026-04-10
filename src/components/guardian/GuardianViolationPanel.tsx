/**
 * src/components/guardian/GuardianViolationPanel.tsx
 * GRD4 — GUARDIAN Violation History Panel
 *
 * Features:
 *   - Worker violation history per employee
 *   - Violation cards: date, type, tier crossed, description, corrective action taken
 *   - Trend: violation frequency per worker over time
 *   - Print/export for documentation — court-ready format
 *   - "Add Manual Violation" for incidents not auto-detected
 *   - Worker profile view: all violations + positive performance notes
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  User,
  Users,
  Calendar,
  FileText,
  Download,
  Plus,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Filter,
  RefreshCw,
  X,
  Star,
  MessageSquare,
  Printer,
} from 'lucide-react';
import {
  getAllViolations,
  getViolationsByWorker,
  markViolationReviewed,
  createManualViolation,
  generateCorrectiveConversationTemplate,
  type GuardianViolationRecord,
  type ViolationSource,
  type ImpactLevel,
} from '@/services/guardian/GuardianBoundaryDetector';
import {
  TIER_DEFINITIONS,
  type WorkerTier,
} from '@/services/guardian/GuardianPermissionTiers';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkerProfile {
  worker_id: string;
  worker_name: string;
  worker_tier: WorkerTier;
  violations: GuardianViolationRecord[];
  performance_notes: PerformanceNote[];
}

interface PerformanceNote {
  id: string;
  worker_id: string;
  date: string;
  note: string;
  added_by: string;
}

type TabId = 'all_violations' | 'by_worker' | 'trend' | 'worker_profile';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function impactBadge(level: ImpactLevel): string {
  switch (level) {
    case 'CRITICAL': return 'bg-red-900/40 text-red-300 border border-red-700/50';
    case 'HIGH':     return 'bg-orange-900/40 text-orange-300 border border-orange-700/50';
    case 'MEDIUM':   return 'bg-amber-900/40 text-amber-300 border border-amber-700/50';
    case 'LOW':      return 'bg-blue-900/40 text-blue-300 border border-blue-700/50';
    default:         return 'bg-zinc-800 text-zinc-400 border border-zinc-700';
  }
}

function sourceBadge(source: ViolationSource): string {
  switch (source) {
    case 'field_log':    return 'bg-green-900/30 text-green-300';
    case 'nexus_voice':  return 'bg-purple-900/30 text-purple-300';
    case 'chrono_clock': return 'bg-cyan-900/30 text-cyan-300';
    case 'manual':       return 'bg-zinc-700 text-zinc-300';
    default:             return 'bg-zinc-800 text-zinc-400';
  }
}

function sourceLabel(source: ViolationSource): string {
  switch (source) {
    case 'field_log':    return 'Field Log';
    case 'nexus_voice':  return 'NEXUS Voice';
    case 'chrono_clock': return 'CHRONO Clock';
    case 'manual':       return 'Manual Entry';
    default:             return source;
  }
}

function tierLabel(tier: WorkerTier): string {
  return TIER_DEFINITIONS[tier]?.label ?? `Tier ${tier}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function groupViolationsByWorker(
  violations: GuardianViolationRecord[],
): Map<string, GuardianViolationRecord[]> {
  const map = new Map<string, GuardianViolationRecord[]>();
  for (const v of violations) {
    const existing = map.get(v.worker_id) ?? [];
    existing.push(v);
    map.set(v.worker_id, existing);
  }
  return map;
}

function violationsByWeek(violations: GuardianViolationRecord[]): Array<{ week: string; count: number }> {
  const weekMap = new Map<string, number>();
  for (const v of violations) {
    const d = new Date(v.created_at);
    const monday = new Date(d);
    monday.setDate(d.getDate() - d.getDay() + 1);
    const key = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    weekMap.set(key, (weekMap.get(key) ?? 0) + 1);
  }
  return Array.from(weekMap.entries())
    .map(([week, count]) => ({ week, count }))
    .slice(-8);
}

// ─── Print / Export ───────────────────────────────────────────────────────────

function printViolation(v: GuardianViolationRecord): void {
  const content = `
GUARDIAN BOUNDARY VIOLATION RECORD
Power On Solutions, LLC — Confidential

Violation ID:       ${v.id}
Date:               ${formatDate(v.created_at)}
Worker:             ${v.worker_name}
Worker Tier:        Tier ${v.worker_tier} — ${tierLabel(v.worker_tier)}

Action Performed:   ${v.action_type.replace(/_/g, ' ')}
Tier Required:      Tier ${v.tier_required} — ${tierLabel(v.tier_required)}
Detection Source:   ${sourceLabel(v.source)}
Impact Level:       ${v.impact_level}

DESCRIPTION
${v.description}

IMPACT ASSESSMENT
${v.impact_description}

PREVENTION RULE
${v.prevention_rule}

${v.corrective_template ? `CORRECTIVE CONVERSATION TEMPLATE\n${v.corrective_template}` : ''}

${v.reviewed_by_owner ? `REVIEWED BY OWNER: Yes — ${v.reviewed_at ? formatDate(v.reviewed_at) : ''}` : 'REVIEWED BY OWNER: Pending'}
${v.corrective_action_taken ? `CORRECTIVE ACTION TAKEN:\n${v.corrective_action_taken}` : ''}

---
Generated by GUARDIAN — Power On Hub
${new Date().toLocaleString('en-US')}
`.trim();

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<pre style="font-family:monospace;white-space:pre-wrap;padding:24px;">${content}</pre>`);
  win.document.close();
  win.print();
}

function exportViolationsCSV(violations: GuardianViolationRecord[]): void {
  const headers = [
    'Violation ID', 'Date', 'Worker Name', 'Worker Tier', 'Action Type',
    'Tier Required', 'Source', 'Impact Level', 'Description', 'Reviewed',
  ];

  const rows = violations.map(v => [
    v.id,
    formatDate(v.created_at),
    v.worker_name,
    `Tier ${v.worker_tier} — ${tierLabel(v.worker_tier)}`,
    v.action_type.replace(/_/g, ' '),
    `Tier ${v.tier_required}`,
    sourceLabel(v.source),
    v.impact_level,
    `"${v.description.replace(/"/g, '""')}"`,
    v.reviewed_by_owner ? 'Yes' : 'No',
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `guardian_violations_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Violation Card ───────────────────────────────────────────────────────────

interface ViolationCardProps {
  violation: GuardianViolationRecord;
  onReview: (id: string, action?: string) => void;
  onPrint: (v: GuardianViolationRecord) => void;
  onGenerateTemplate: (v: GuardianViolationRecord) => void;
}

function ViolationCard({ violation: v, onReview, onPrint, onGenerateTemplate }: ViolationCardProps): React.ReactElement {
  const [expanded, setExpanded]       = useState(false);
  const [reviewNote, setReviewNote]   = useState('');
  const [reviewing, setReviewing]     = useState(false);
  const [genLoading, setGenLoading]   = useState(false);

  const handleReview = async (): Promise<void> => {
    setReviewing(true);
    await onReview(v.id, reviewNote || undefined);
    setReviewing(false);
  };

  const handleGenTemplate = async (): Promise<void> => {
    setGenLoading(true);
    await onGenerateTemplate(v);
    setGenLoading(false);
  };

  return (
    <div className={`border rounded-lg overflow-hidden transition-all ${
      v.reviewed_by_owner
        ? 'border-zinc-700/50 bg-zinc-900/30'
        : v.impact_level === 'CRITICAL'
          ? 'border-red-700/60 bg-red-950/20'
          : 'border-amber-700/40 bg-zinc-900/50'
    }`}>
      {/* Card Header */}
      <div
        className="flex items-start justify-between p-4 cursor-pointer hover:bg-zinc-800/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="mt-0.5">
            {v.reviewed_by_owner
              ? <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
              : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            }
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-zinc-100">{v.worker_name}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${impactBadge(v.impact_level)}`}>
                {v.impact_level}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${sourceBadge(v.source)}`}>
                {sourceLabel(v.source)}
              </span>
            </div>
            <div className="text-xs text-zinc-400 mt-0.5">
              {v.action_type.replace(/_/g, ' ')} · Tier {v.worker_tier} → Required Tier {v.tier_required}
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">{formatDate(v.created_at)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-2 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onPrint(v); }}
            className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Print / Export"
          >
            <Printer className="w-3.5 h-3.5" />
          </button>
          {expanded
            ? <ChevronDown className="w-4 h-4 text-zinc-500" />
            : <ChevronRight className="w-4 h-4 text-zinc-500" />
          }
        </div>
      </div>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t border-zinc-700/50 p-4 space-y-4">

          {/* Description */}
          <div>
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">What Happened</div>
            <p className="text-sm text-zinc-300 leading-relaxed">{v.description}</p>
          </div>

          {/* Impact */}
          <div>
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">Impact Assessment</div>
            <p className="text-sm text-zinc-300 leading-relaxed">{v.impact_description}</p>
          </div>

          {/* Prevention Rule */}
          <div>
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">Prevention Rule</div>
            <p className="text-sm text-zinc-400 leading-relaxed">{v.prevention_rule}</p>
          </div>

          {/* Corrective Template */}
          {v.corrective_template ? (
            <div>
              <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">
                Corrective Conversation Template
              </div>
              <pre className="text-xs text-zinc-300 bg-zinc-800/50 border border-zinc-700/50 rounded p-3 whitespace-pre-wrap leading-relaxed font-sans">
                {v.corrective_template}
              </pre>
            </div>
          ) : (
            <div>
              <button
                onClick={handleGenTemplate}
                disabled={genLoading}
                className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 disabled:opacity-50 transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                {genLoading ? 'Generating template…' : 'Generate Corrective Conversation Template'}
              </button>
            </div>
          )}

          {/* Corrective Action Taken */}
          {v.corrective_action_taken && (
            <div>
              <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">
                Corrective Action Taken
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed">{v.corrective_action_taken}</p>
            </div>
          )}

          {/* Review Section */}
          {!v.reviewed_by_owner && (
            <div className="border-t border-zinc-700/50 pt-4">
              <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
                Mark as Reviewed
              </div>
              <textarea
                value={reviewNote}
                onChange={e => setReviewNote(e.target.value)}
                placeholder="Optional: what corrective action was taken?"
                className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 resize-none focus:outline-none focus:border-zinc-500 transition-colors"
                rows={2}
              />
              <button
                onClick={handleReview}
                disabled={reviewing}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-green-700/40 hover:bg-green-700/60 border border-green-700/50 text-green-300 text-xs rounded transition-colors disabled:opacity-50"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {reviewing ? 'Saving…' : 'Mark Reviewed'}
              </button>
            </div>
          )}

          {v.reviewed_by_owner && (
            <div className="flex items-center gap-1.5 text-xs text-green-400">
              <CheckCircle className="w-3.5 h-3.5" />
              Reviewed by owner{v.reviewed_at ? ` on ${formatDateShort(v.reviewed_at)}` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add Manual Violation Modal ───────────────────────────────────────────────

interface AddViolationModalProps {
  onClose: () => void;
  onAdd: (payload: {
    worker_id: string;
    worker_name: string;
    action_type: string;
    description: string;
    generate_template: boolean;
  }) => Promise<void>;
}

const COMMON_ACTIONS = [
  'approve_scope_change',
  'communicate_scope_to_gc',
  'respond_to_rfi',
  'approve_schedule_change',
  'approve_material_substitution',
  'approve_change_order',
  'communicate_scope_to_customer',
  'approve_mto_over_500',
];

function AddViolationModal({ onClose, onAdd }: AddViolationModalProps): React.ReactElement {
  const [workerName,    setWorkerName]    = useState('');
  const [workerId,      setWorkerId]      = useState('');
  const [actionType,    setActionType]    = useState('approve_scope_change');
  const [description,   setDescription]  = useState('');
  const [genTemplate,   setGenTemplate]  = useState(true);
  const [saving,        setSaving]        = useState(false);

  const handleSubmit = async (): Promise<void> => {
    if (!workerName.trim() || !description.trim()) return;
    setSaving(true);
    await onAdd({
      worker_id:        workerId || `manual_${Date.now()}`,
      worker_name:      workerName.trim(),
      action_type:      actionType,
      description:      description.trim(),
      generate_template: genTemplate,
    });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-zinc-700/50">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-zinc-100">Add Manual Violation</h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">Worker Name *</label>
            <input
              value={workerName}
              onChange={e => setWorkerName(e.target.value)}
              placeholder="e.g. Jose Martinez"
              className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">Worker ID (optional)</label>
            <input
              value={workerId}
              onChange={e => setWorkerId(e.target.value)}
              placeholder="crew_members.id — leave blank if unknown"
              className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">Action / Violation Type *</label>
            <select
              value={actionType}
              onChange={e => setActionType(e.target.value)}
              className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 transition-colors"
            >
              {COMMON_ACTIONS.map(a => (
                <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
              ))}
              <option value="other">other</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">Description *</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe what happened, when, and what commitment was made or implied."
              rows={4}
              className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={genTemplate}
              onChange={e => setGenTemplate(e.target.checked)}
              className="rounded"
            />
            <span className="text-xs text-zinc-300">Generate corrective conversation template (Claude)</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-zinc-700/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !workerName.trim() || !description.trim()}
            className="px-4 py-2 bg-amber-600/40 hover:bg-amber-600/60 border border-amber-600/50 text-amber-200 text-xs rounded transition-colors disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add Violation'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Trend Chart (simple bar) ─────────────────────────────────────────────────

interface TrendBarProps {
  data: Array<{ week: string; count: number }>;
  maxVal: number;
}

function TrendBars({ data, maxVal }: TrendBarProps): React.ReactElement {
  return (
    <div className="flex items-end gap-1 h-24">
      {data.map(({ week, count }) => (
        <div key={week} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-amber-500/60 rounded-t transition-all"
            style={{ height: maxVal > 0 ? `${(count / maxVal) * 80}px` : '2px', minHeight: count > 0 ? '4px' : '2px' }}
            title={`${count} violation${count !== 1 ? 's' : ''}`}
          />
          <div className="text-[9px] text-zinc-500 text-center leading-none truncate w-full">{week}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function GuardianViolationPanel(): React.ReactElement {
  const [violations,       setViolations]       = useState<GuardianViolationRecord[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [activeTab,        setActiveTab]        = useState<TabId>('all_violations');
  const [selectedWorker,   setSelectedWorker]   = useState<string | null>(null);
  const [filterImpact,     setFilterImpact]     = useState<ImpactLevel | 'ALL'>('ALL');
  const [filterReviewed,   setFilterReviewed]   = useState<'ALL' | 'PENDING' | 'REVIEWED'>('ALL');
  const [showAddModal,     setShowAddModal]      = useState(false);
  const [performanceNotes, setPerformanceNotes] = useState<Map<string, PerformanceNote[]>>(new Map());
  const [newNote,          setNewNote]          = useState('');
  const [noteWorkerId,     setNoteWorkerId]     = useState('');
  const [noteWorkerName,   setNoteWorkerName]   = useState('');

  // Load violations
  const loadViolations = useCallback(async (): Promise<void> => {
    setLoading(true);
    const data = await getAllViolations();
    setViolations(data);
    setLoading(false);
  }, []);

  useEffect(() => { void loadViolations(); }, [loadViolations]);

  // Derived
  const workerMap = groupViolationsByWorker(violations);
  const workerList = Array.from(workerMap.entries()).map(([id, vs]) => ({
    worker_id:   id,
    worker_name: vs[0]?.worker_name ?? 'Unknown',
    worker_tier: (vs[0]?.worker_tier ?? 1) as WorkerTier,
    violations:  vs,
    performance_notes: performanceNotes.get(id) ?? [],
  })).sort((a, b) => b.violations.length - a.violations.length);

  const selectedProfile: WorkerProfile | null = selectedWorker
    ? workerList.find(w => w.worker_id === selectedWorker) ?? null
    : null;

  const filteredViolations = violations.filter(v => {
    if (filterImpact !== 'ALL' && v.impact_level !== filterImpact) return false;
    if (filterReviewed === 'PENDING' && v.reviewed_by_owner) return false;
    if (filterReviewed === 'REVIEWED' && !v.reviewed_by_owner) return false;
    return true;
  });

  const weeklyTrend     = violationsByWeek(violations);
  const maxWeeklyCount  = Math.max(...weeklyTrend.map(d => d.count), 1);
  const pendingCount    = violations.filter(v => !v.reviewed_by_owner).length;
  const criticalCount   = violations.filter(v => v.impact_level === 'CRITICAL').length;

  // Handlers
  const handleReview = async (id: string, action?: string): Promise<void> => {
    await markViolationReviewed(id, action);
    setViolations(prev => prev.map(v =>
      v.id === id
        ? { ...v, reviewed_by_owner: true, reviewed_at: new Date().toISOString(), corrective_action_taken: action ?? v.corrective_action_taken }
        : v,
    ));
  };

  const handleGenerateTemplate = async (violation: GuardianViolationRecord): Promise<void> => {
    const template = await generateCorrectiveConversationTemplate(violation);
    setViolations(prev => prev.map(v =>
      v.id === violation.id ? { ...v, corrective_template: template } : v,
    ));
  };

  const handleAddViolation = async (payload: {
    worker_id: string;
    worker_name: string;
    action_type: string;
    description: string;
    generate_template: boolean;
  }): Promise<void> => {
    const record = await createManualViolation({
      worker_id:    payload.worker_id,
      worker_name:  payload.worker_name,
      action_type:  payload.action_type,
      source:       'manual',
      description:  payload.description,
      generate_template: payload.generate_template,
    });
    setViolations(prev => [record, ...prev]);
  };

  const handleAddPerformanceNote = (workerId: string, workerName: string): void => {
    if (!newNote.trim()) return;
    const note: PerformanceNote = {
      id:        `pnote_${Date.now()}`,
      worker_id: workerId,
      date:      new Date().toISOString(),
      note:      newNote.trim(),
      added_by:  'Owner',
    };
    setPerformanceNotes(prev => {
      const updated = new Map(prev);
      updated.set(workerId, [note, ...(prev.get(workerId) ?? [])]);
      return updated;
    });
    setNewNote('');
    setNoteWorkerId('');
    setNoteWorkerName('');
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-400" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">GUARDIAN — Violation Records</h2>
            <p className="text-xs text-zinc-500">3-Tier boundary enforcement · Permanent records · Court-ready export</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadViolations}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => exportViolationsCSV(violations)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/60 hover:bg-zinc-700/60 border border-zinc-700/50 text-zinc-300 text-xs rounded transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700/30 hover:bg-amber-700/50 border border-amber-700/40 text-amber-300 text-xs rounded transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Violation
          </button>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-4 gap-px border-b border-zinc-800 bg-zinc-800">
        {[
          { label: 'Total Violations', value: violations.length, icon: ShieldAlert, color: 'text-amber-400' },
          { label: 'Pending Review',   value: pendingCount,      icon: Clock,       color: 'text-orange-400' },
          { label: 'Critical Impact',  value: criticalCount,     icon: AlertTriangle, color: 'text-red-400' },
          { label: 'Workers Flagged',  value: workerMap.size,    icon: Users,       color: 'text-zinc-300' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="flex items-center gap-3 px-5 py-3 bg-zinc-900">
            <Icon className={`w-4 h-4 ${color} shrink-0`} />
            <div>
              <div className={`text-lg font-semibold ${color}`}>{value}</div>
              <div className="text-xs text-zinc-500">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 px-6">
        {([
          { id: 'all_violations' as TabId, label: 'All Violations' },
          { id: 'by_worker'      as TabId, label: 'By Worker' },
          { id: 'trend'          as TabId, label: 'Trend' },
          { id: 'worker_profile' as TabId, label: 'Worker Profile' },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-5 h-5 text-zinc-600 animate-spin mr-2" />
            <span className="text-sm text-zinc-500">Loading violations…</span>
          </div>
        ) : (

          <>
            {/* ── All Violations Tab ─────────────────────────────────────── */}
            {activeTab === 'all_violations' && (
              <div className="space-y-4">
                {/* Filters */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <Filter className="w-3.5 h-3.5" />
                    Filter:
                  </div>
                  <select
                    value={filterImpact}
                    onChange={e => setFilterImpact(e.target.value as ImpactLevel | 'ALL')}
                    className="bg-zinc-800/60 border border-zinc-700/50 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none"
                  >
                    <option value="ALL">All Impact Levels</option>
                    <option value="CRITICAL">Critical</option>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </select>
                  <select
                    value={filterReviewed}
                    onChange={e => setFilterReviewed(e.target.value as 'ALL' | 'PENDING' | 'REVIEWED')}
                    className="bg-zinc-800/60 border border-zinc-700/50 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none"
                  >
                    <option value="ALL">All Status</option>
                    <option value="PENDING">Pending Review</option>
                    <option value="REVIEWED">Reviewed</option>
                  </select>
                  <span className="text-xs text-zinc-600">{filteredViolations.length} record{filteredViolations.length !== 1 ? 's' : ''}</span>
                </div>

                {filteredViolations.length === 0 ? (
                  <div className="text-center py-16 text-zinc-600">
                    <ShieldCheck className="w-8 h-8 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">No violations match the current filter.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredViolations.map(v => (
                      <ViolationCard
                        key={v.id}
                        violation={v}
                        onReview={handleReview}
                        onPrint={printViolation}
                        onGenerateTemplate={handleGenerateTemplate}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── By Worker Tab ──────────────────────────────────────────── */}
            {activeTab === 'by_worker' && (
              <div className="space-y-4">
                {workerList.length === 0 ? (
                  <div className="text-center py-16 text-zinc-600">
                    <Users className="w-8 h-8 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">No worker violations on record.</p>
                  </div>
                ) : (
                  workerList.map(worker => (
                    <div key={worker.worker_id} className="border border-zinc-700/50 rounded-lg overflow-hidden">
                      <div
                        className="flex items-center justify-between px-4 py-3 bg-zinc-900/60 cursor-pointer hover:bg-zinc-800/40 transition-colors"
                        onClick={() => {
                          setSelectedWorker(s => s === worker.worker_id ? null : worker.worker_id);
                          setActiveTab('worker_profile');
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <User className="w-4 h-4 text-zinc-500" />
                          <div>
                            <div className="text-sm font-medium text-zinc-100">{worker.worker_name}</div>
                            <div className="text-xs text-zinc-500">
                              {tierLabel(worker.worker_tier)} · {worker.violations.length} violation{worker.violations.length !== 1 ? 's' : ''}
                              {worker.violations.filter(v => !v.reviewed_by_owner).length > 0 && (
                                <span className="ml-2 text-amber-400">
                                  · {worker.violations.filter(v => !v.reviewed_by_owner).length} pending review
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {worker.violations.some(v => v.impact_level === 'CRITICAL') && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${impactBadge('CRITICAL')}`}>CRITICAL</span>
                          )}
                          <ChevronRight className="w-4 h-4 text-zinc-600" />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── Trend Tab ─────────────────────────────────────────────── */}
            {activeTab === 'trend' && (
              <div className="space-y-6">
                <div className="border border-zinc-700/50 rounded-lg p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="w-4 h-4 text-amber-400" />
                    <h3 className="text-sm font-medium text-zinc-200">Violation Frequency — Last 8 Weeks</h3>
                  </div>
                  {weeklyTrend.length > 0 ? (
                    <TrendBars data={weeklyTrend} maxVal={maxWeeklyCount} />
                  ) : (
                    <div className="text-xs text-zinc-600 py-8 text-center">No trend data available yet.</div>
                  )}
                </div>

                {/* Per-worker frequency */}
                <div className="border border-zinc-700/50 rounded-lg p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Users className="w-4 h-4 text-zinc-400" />
                    <h3 className="text-sm font-medium text-zinc-200">Violations Per Worker</h3>
                  </div>
                  {workerList.length === 0 ? (
                    <div className="text-xs text-zinc-600 text-center py-4">No workers on record.</div>
                  ) : (
                    <div className="space-y-2">
                      {workerList.map(worker => {
                        const pct = violations.length > 0
                          ? Math.round((worker.violations.length / violations.length) * 100)
                          : 0;
                        return (
                          <div key={worker.worker_id}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-zinc-300">{worker.worker_name}</span>
                              <span className="text-xs text-zinc-500">{worker.violations.length} ({pct}%)</span>
                            </div>
                            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-amber-500/70 rounded-full transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Impact breakdown */}
                <div className="border border-zinc-700/50 rounded-lg p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-4 h-4 text-zinc-400" />
                    <h3 className="text-sm font-medium text-zinc-200">Impact Level Breakdown</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as ImpactLevel[]).map(level => {
                      const count = violations.filter(v => v.impact_level === level).length;
                      return (
                        <div key={level} className={`rounded-lg p-3 ${impactBadge(level)}`}>
                          <div className="text-lg font-semibold">{count}</div>
                          <div className="text-xs opacity-80">{level}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── Worker Profile Tab ─────────────────────────────────────── */}
            {activeTab === 'worker_profile' && (
              <div className="space-y-4">
                {/* Worker selector */}
                <div>
                  <label className="text-xs font-medium text-zinc-400 block mb-1.5">Select Worker</label>
                  <select
                    value={selectedWorker ?? ''}
                    onChange={e => setSelectedWorker(e.target.value || null)}
                    className="bg-zinc-800/60 border border-zinc-700/50 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none w-full max-w-sm"
                  >
                    <option value="">— Select a worker —</option>
                    {workerList.map(w => (
                      <option key={w.worker_id} value={w.worker_id}>
                        {w.worker_name} ({w.violations.length} violation{w.violations.length !== 1 ? 's' : ''})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedProfile ? (
                  <div className="space-y-5">
                    {/* Profile header */}
                    <div className="flex items-center gap-4 p-4 border border-zinc-700/50 rounded-lg bg-zinc-900/40">
                      <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-semibold text-zinc-200">
                        {selectedProfile.worker_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-zinc-100">{selectedProfile.worker_name}</div>
                        <div className="text-xs text-zinc-500">
                          {tierLabel(selectedProfile.worker_tier)} · ID: {selectedProfile.worker_id}
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          {selectedProfile.violations.length} total violation{selectedProfile.violations.length !== 1 ? 's' : ''} on record
                        </div>
                      </div>
                      <div className="ml-auto">
                        <button
                          onClick={() => exportViolationsCSV(selectedProfile.violations)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 text-zinc-300 text-xs rounded transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Export Profile
                        </button>
                      </div>
                    </div>

                    {/* Violations */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">
                          Violation History ({selectedProfile.violations.length})
                        </h3>
                      </div>
                      {selectedProfile.violations.length === 0 ? (
                        <div className="text-xs text-zinc-600 py-4 text-center border border-zinc-800 rounded-lg">
                          No violations on record.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {selectedProfile.violations.map(v => (
                            <ViolationCard
                              key={v.id}
                              violation={v}
                              onReview={handleReview}
                              onPrint={printViolation}
                              onGenerateTemplate={handleGenerateTemplate}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Performance Notes */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Star className="w-3.5 h-3.5 text-green-400" />
                        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">
                          Positive Performance Notes ({selectedProfile.performance_notes.length})
                        </h3>
                      </div>

                      {/* Add note form */}
                      <div className="mb-3 flex gap-2">
                        <input
                          value={noteWorkerId === selectedProfile.worker_id ? newNote : ''}
                          onChange={e => {
                            setNewNote(e.target.value);
                            setNoteWorkerId(selectedProfile.worker_id);
                            setNoteWorkerName(selectedProfile.worker_name);
                          }}
                          placeholder="Add a positive performance note…"
                          className="flex-1 bg-zinc-800/60 border border-zinc-700/50 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
                        />
                        <button
                          onClick={() => handleAddPerformanceNote(selectedProfile.worker_id, selectedProfile.worker_name)}
                          className="px-3 py-2 bg-green-700/30 hover:bg-green-700/50 border border-green-700/40 text-green-300 text-xs rounded transition-colors"
                        >
                          Add
                        </button>
                      </div>

                      {selectedProfile.performance_notes.length === 0 ? (
                        <div className="text-xs text-zinc-600 py-4 text-center border border-zinc-800 rounded-lg">
                          No performance notes yet.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {selectedProfile.performance_notes.map(note => (
                            <div key={note.id} className="border border-green-700/30 bg-green-900/10 rounded-lg p-3">
                              <p className="text-sm text-zinc-300">{note.note}</p>
                              <div className="text-xs text-zinc-500 mt-1">
                                Added by {note.added_by} · {formatDateShort(note.date)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-16 text-zinc-600">
                    <User className="w-8 h-8 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">Select a worker to view their full profile.</p>
                  </div>
                )}
              </div>
            )}

          </>
        )}
      </div>

      {/* Add Violation Modal */}
      {showAddModal && (
        <AddViolationModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddViolation}
        />
      )}
    </div>
  );
}

export default GuardianViolationPanel;
