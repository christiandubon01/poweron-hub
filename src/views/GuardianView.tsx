// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  Plus,
  Download,
  X,
  Brain,
  Filter,
  FileText,
  Mail,
  RefreshCw,
  Send,
  Ban,
} from 'lucide-react';
import {
  sendInvite,
  getInvites,
  revokeInvite,
  type BetaInvite,
} from '../services/inviteService';
import type { GuardianRule, GuardianViolation, GuardianAuditEntry } from '../types';
import type { SignedAgreementRecord } from '../services/ndaService';
import { getUserSignedNDAs, getAllSignedNDAs, revokeSignedNDA, getNDAPdfSignedUrl } from '../services/ndaService';
import {
  mockGuardianRules,
  mockViolations,
  mockAuditLog,
} from '../mock';
import type { AIDecisionLog, DecisionLogFilters } from '../services/auditTrailService';
import { getDecisionLog, exportToCSV } from '../services/auditTrailService';

// ─── Severity Badge ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: 'low' | 'medium' | 'high' }) {
  const styles: Record<'low' | 'medium' | 'high', string> = {
    high: 'bg-red-900/40 text-red-400 border border-red-800/60',
    medium: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800/60',
    low: 'bg-blue-900/40 text-blue-400 border border-blue-800/60',
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${styles[severity]}`}>
      {severity}
    </span>
  );
}

// ─── Panel Wrapper ────────────────────────────────────────────────────────────

function Panel({ title, icon, children, headerRight }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col rounded-xl border overflow-hidden"
      style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: '#1e2128', backgroundColor: '#11121a' }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <span className="text-green-500">{icon}</span>
          {title}
        </div>
        {headerRight}
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

// ─── Panel 1: Active Rules ────────────────────────────────────────────────────

function RulesPanel() {
  // Replace with real Supabase query during integration
  const [rules, setRules] = useState<GuardianRule[]>(mockGuardianRules);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSeverity, setNewSeverity] = useState<'low' | 'medium' | 'high'>('medium');

  function toggleRule(id: string) {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, active: !r.active } : r))
    );
  }

  function handleAddRule() {
    if (!newName.trim()) return;
    const newRule: GuardianRule = {
      id: `rule-${Date.now()}`,
      name: newName.trim(),
      description: newDescription.trim() || 'No description provided.',
      severity: newSeverity,
      active: true,
    };
    setRules((prev) => [...prev, newRule]);
    setNewName('');
    setNewDescription('');
    setNewSeverity('medium');
    setShowForm(false);
  }

  return (
    <Panel
      title="Active Rules"
      icon={<Shield size={14} />}
      headerRight={
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          style={{ backgroundColor: '#16a34a22', color: '#4ade80', border: '1px solid #16a34a44' }}
        >
          <Plus size={12} />
          Add Rule
        </button>
      }
    >
      {/* Inline add-rule form */}
      {showForm && (
        <div
          className="mx-3 mt-3 mb-1 p-3 rounded-lg border"
          style={{ borderColor: '#2a3040', backgroundColor: '#0a0b14' }}
        >
          <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">New Rule</p>
          <div className="flex flex-col gap-2">
            <input
              type="text"
              placeholder="Rule name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-gray-200 placeholder-gray-600 outline-none"
              style={{ backgroundColor: '#1a1d27', border: '1px solid #2a3040' }}
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-gray-200 placeholder-gray-600 outline-none"
              style={{ backgroundColor: '#1a1d27', border: '1px solid #2a3040' }}
            />
            <select
              value={newSeverity}
              onChange={(e) => setNewSeverity(e.target.value as 'low' | 'medium' | 'high')}
              className="w-full px-3 py-2 rounded-lg text-sm text-gray-200 outline-none"
              style={{ backgroundColor: '#1a1d27', border: '1px solid #2a3040' }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <div className="flex gap-2 mt-1">
              <button
                onClick={handleAddRule}
                className="flex-1 py-2 rounded-lg text-xs font-semibold text-white transition-colors"
                style={{ backgroundColor: '#16a34a' }}
              >
                Add Rule
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="px-3 py-2 rounded-lg text-xs font-medium text-gray-400 transition-colors"
                style={{ backgroundColor: '#1a1d27' }}
              >
                <X size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rule list */}
      <ul className="p-3 flex flex-col gap-2">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className="flex flex-col gap-1.5 p-3 rounded-lg border transition-opacity"
            style={{
              borderColor: '#1e2128',
              backgroundColor: '#0f1018',
              opacity: rule.active ? 1 : 0.5,
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <SeverityBadge severity={rule.severity} />
                <span className="text-sm font-medium text-gray-200 truncate">{rule.name}</span>
              </div>
              <button
                onClick={() => toggleRule(rule.id)}
                className="flex-shrink-0 text-gray-500 hover:text-gray-300 transition-colors"
                title={rule.active ? 'Disable rule' : 'Enable rule'}
              >
                {rule.active ? (
                  <ToggleRight size={20} className="text-green-500" />
                ) : (
                  <ToggleLeft size={20} />
                )}
              </button>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">{rule.description}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ─── Panel 2: Active Violations ───────────────────────────────────────────────

function ViolationsPanel() {
  // Replace with real Supabase query during integration
  const [violations, setViolations] = useState<GuardianViolation[]>(mockViolations);
  const [resolvedExpanded, setResolvedExpanded] = useState(false);

  function resolveViolation(id: string) {
    setViolations((prev) =>
      prev.map((v) => (v.id === id ? { ...v, status: 'resolved' } : v))
    );
  }

  const open = violations.filter((v) => v.status === 'open');
  const resolved = violations.filter((v) => v.status === 'resolved');

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString('en', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <Panel
      title="Active Violations"
      icon={<AlertTriangle size={14} />}
      headerRight={
        open.length > 0 ? (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-900/50 text-red-400 border border-red-800/50">
            {open.length} open
          </span>
        ) : (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-800/40">
            All clear
          </span>
        )
      }
    >
      <ul className="p-3 flex flex-col gap-2">
        {open.length === 0 && (
          <li className="flex flex-col items-center justify-center py-8 text-gray-600 text-sm gap-2">
            <CheckCircle size={22} className="text-green-700" />
            No open violations
          </li>
        )}
        {open.map((v) => (
          <li
            key={v.id}
            className="flex flex-col gap-2 p-3 rounded-lg border"
            style={{ borderColor: '#3a1e1e', backgroundColor: '#120a0a' }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <SeverityBadge severity={
                    mockGuardianRules.find((r) => r.id === v.ruleId)?.severity ?? 'low'
                  } />
                  <span className="text-xs text-gray-400 font-medium">{v.ruleName}</span>
                </div>
                <p className="text-xs text-gray-300 leading-relaxed mt-0.5">{v.description}</p>
              </div>
            </div>
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <Clock size={11} />
                {formatDate(v.detectedAt)}
              </div>
              <button
                onClick={() => resolveViolation(v.id)}
                className="text-xs font-semibold px-3 py-1 rounded-lg transition-colors"
                style={{ backgroundColor: '#16a34a22', color: '#4ade80', border: '1px solid #16a34a44' }}
              >
                Resolve
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* Resolved section (collapsible) */}
      {resolved.length > 0 && (
        <div className="px-3 pb-3">
          <button
            onClick={() => setResolvedExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-gray-300 transition-colors"
            style={{ backgroundColor: '#0f1018', border: '1px solid #1e2128' }}
          >
            <div className="flex items-center gap-2">
              <CheckCircle size={12} className="text-green-700" />
              <span>Resolved</span>
              <span className="px-1.5 py-0.5 rounded-full text-xs font-bold bg-gray-800 text-gray-500">
                {resolved.length}
              </span>
            </div>
            <ChevronDown
              size={12}
              className={`transition-transform ${resolvedExpanded ? 'rotate-180' : ''}`}
            />
          </button>

          {resolvedExpanded && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {resolved.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-col gap-1 p-3 rounded-lg border opacity-50"
                  style={{ borderColor: '#1e2128', backgroundColor: '#0f1018' }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <SeverityBadge severity={
                      mockGuardianRules.find((r) => r.id === v.ruleId)?.severity ?? 'low'
                    } />
                    <span className="text-xs text-gray-500 font-medium">{v.ruleName}</span>
                    <span className="ml-auto text-xs text-green-700 font-medium flex items-center gap-1">
                      <CheckCircle size={10} /> Resolved
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">{v.description}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

// ─── Panel 3: Audit Trail ─────────────────────────────────────────────────────

function AuditTrailPanel() {
  // Replace with real Supabase query during integration
  const entries: GuardianAuditEntry[] = mockAuditLog;

  function formatTimestamp(iso: string) {
    return new Date(iso).toLocaleString('en', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function resultColor(result: string): string {
    if (result.startsWith('VIOLATION')) return 'text-red-400';
    if (result.startsWith('ALERT')) return 'text-yellow-400';
    if (result.startsWith('PASS')) return 'text-green-400';
    return 'text-gray-400';
  }

  return (
    <Panel
      title="Audit Trail"
      icon={<Clock size={14} />}
      headerRight={
        <button
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-not-allowed opacity-60"
          style={{ backgroundColor: '#1a1d27', color: '#9ca3af', border: '1px solid #2a3040' }}
          title="Export Log — not yet implemented"
          disabled
        >
          <Download size={12} />
          Export Log
        </button>
      }
    >
      <ul className="p-3 flex flex-col gap-0">
        {entries.map((entry, idx) => (
          <li
            key={entry.id}
            className="flex gap-3 py-2.5 border-b last:border-b-0"
            style={{ borderColor: '#1a1c23' }}
          >
            {/* Timeline dot */}
            <div className="flex flex-col items-center flex-shrink-0 mt-1" style={{ width: 14 }}>
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: entry.result.startsWith('VIOLATION')
                    ? '#f87171'
                    : entry.result.startsWith('ALERT')
                    ? '#facc15'
                    : '#4ade80',
                }}
              />
              {idx < entries.length - 1 && (
                <div className="w-px flex-1 mt-1" style={{ backgroundColor: '#1e2128', minHeight: 12 }} />
              )}
            </div>

            {/* Content */}
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-gray-400">{entry.agentId}</span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-mono"
                  style={{ backgroundColor: '#1a1d27', color: '#6b7280' }}
                >
                  {entry.action}
                </span>
              </div>
              <p className={`text-xs leading-relaxed ${resultColor(entry.result)}`}>
                {entry.result}
              </p>
              <span className="text-xs text-gray-700 mt-0.5">{formatTimestamp(entry.timestamp)}</span>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ─── Signed NDAs Panel (V3-23) ────────────────────────────────────────────────

const STUB_USER_ID = 'local-demo-user';

function SignedNDAsPanel() {
  const [records, setRecords] = useState<SignedAgreementRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUserSignedNDAs(STUB_USER_ID)
      .then((r) => setRecords(r))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Panel title="Signed NDAs" icon={<FileText size={14} />}>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-600">
          Loading…
        </div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center px-4">
          <FileText size={20} className="text-gray-700" />
          <p className="text-xs text-gray-600">No signed agreements on record.</p>
          <p className="text-xs text-gray-700">
            NDA records will appear here after users sign the beta agreement.
          </p>
        </div>
      ) : (
        <ul className="divide-y" style={{ borderColor: '#1a1c23' }}>
          {records.map((record, i) => (
            <li key={record.id ?? i} className="px-4 py-3 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-300 truncate">
                  {record.typed_name}
                </span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-mono flex-shrink-0 ml-2"
                  style={{ backgroundColor: '#052e16', color: '#4ade80' }}
                >
                  signed
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-600">
                <span>{new Date(record.signed_at).toLocaleString()}</span>
                {record.ip_address && <span>IP: {record.ip_address}</span>}
              </div>
              {record.pdf_url && !record.pdf_url.startsWith('stub-') && (
                <a
                  href={record.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-400 hover:text-indigo-300 mt-0.5 inline-flex items-center gap-1"
                >
                  <Download size={11} />
                  View PDF
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ─── Panel 5: AI Decisions (V3-24) ───────────────────────────────────────────

const AI_AGENTS = ['VAULT', 'OHM', 'LEDGER', 'BLUEPRINT', 'CHRONO', 'SPARK', 'ATLAS', 'NEXUS', 'MULTI'];

const CONFIDENCE_COLORS: Record<string, string> = {
  high: '#4ade80',
  medium: '#facc15',
  low: '#f87171',
};

function confidenceLabel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.8) return 'high';
  if (score >= 0.55) return 'medium';
  return 'low';
}

// Owner flag — replace with real auth store check during V2 integration
const STUB_IS_OWNER = true;

function AIDecisionsPanel() {
  const [entries, setEntries] = useState<AIDecisionLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const [filterAgent, setFilterAgent] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterMinConf, setFilterMinConf] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const PAGE_SIZE = 25;

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const filters: DecisionLogFilters = {
        page,
        page_size: PAGE_SIZE,
        ...(filterAgent ? { agent_name: filterAgent } : {}),
        ...(filterDateFrom ? { date_from: new Date(filterDateFrom).toISOString() } : {}),
        ...(filterDateTo ? { date_to: new Date(filterDateTo + 'T23:59:59').toISOString() } : {}),
        ...(filterMinConf ? { min_confidence: parseFloat(filterMinConf) / 100 } : {}),
        ...(filterAction ? { user_action: filterAction as DecisionLogFilters['user_action'] } : {}),
      };
      const result = await getDecisionLog(STUB_USER_ID, filters, STUB_IS_OWNER);
      setEntries(result.entries);
      setTotal(result.total);
      setTotalPages(result.total_pages);
    } catch (err) {
      console.error('[GuardianView] AI Decisions load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [page, filterAgent, filterDateFrom, filterDateTo, filterMinConf, filterAction]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  function handleExportCSV() {
    const csv = exportToCSV(entries);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ai-decisions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function resetFilters() {
    setFilterAgent('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterMinConf('');
    setFilterAction('');
    setPage(1);
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const inputCss: React.CSSProperties = {
    backgroundColor: '#1a1d27', border: '1px solid #2a3040', color: '#e2e8f0',
    borderRadius: 8, padding: '5px 10px', fontSize: 12, outline: 'none', width: '100%',
  };

  const activeFilters = [filterAgent, filterDateFrom, filterDateTo, filterMinConf, filterAction].filter(Boolean).length;

  return (
    <Panel
      title="AI Decisions"
      icon={<Brain size={14} />}
      headerRight={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: showFilters ? '#0f1a0f' : '#11121a', color: showFilters ? '#4ade80' : '#9ca3af', border: `1px solid ${showFilters ? '#16a34a44' : '#2a3040'}` }}
          >
            <Filter size={11} />
            Filter
            {activeFilters > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-green-900/40 text-green-400">{activeFilters}</span>}
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: '#1a1d27', color: '#9ca3af', border: '1px solid #2a3040' }}
          >
            <Download size={11} />
            Export CSV
          </button>
        </div>
      }
    >
      {/* Filters */}
      {showFilters && (
        <div className="mx-3 mt-3 mb-1 p-3 rounded-lg border grid grid-cols-2 gap-2" style={{ borderColor: '#2a3040', backgroundColor: '#0a0b14' }}>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">Agent</label>
            <select value={filterAgent} onChange={(e) => { setFilterAgent(e.target.value); setPage(1); }} style={inputCss}>
              <option value="">All</option>
              {AI_AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">Action</label>
            <select value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(1); }} style={inputCss}>
              <option value="">Any</option>
              <option value="none">No action</option>
              <option value="accepted">Accepted</option>
              <option value="dismissed">Dismissed</option>
              <option value="followed_up">Followed up</option>
              <option value="flagged">Flagged</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">From</label>
            <input type="date" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }} style={inputCss} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">To</label>
            <input type="date" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }} style={inputCss} />
          </div>
          <div className="flex flex-col gap-1 col-span-2">
            <label className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">
              Min Confidence: {filterMinConf ? `${filterMinConf}%` : 'any'}
            </label>
            <input type="range" min="0" max="100" step="5" value={filterMinConf || '0'}
              onChange={(e) => { setFilterMinConf(e.target.value === '0' ? '' : e.target.value); setPage(1); }}
              className="w-full accent-green-500" />
          </div>
          {activeFilters > 0 && (
            <div className="col-span-2">
              <button onClick={resetFilters} className="text-xs text-gray-500 hover:text-gray-300 transition-colors underline">Reset filters</button>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-b" style={{ borderColor: '#1a1c23' }}>
        <span className="text-xs text-gray-600">{loading ? 'Loading…' : `${total} decision${total !== 1 ? 's' : ''}`}</span>
        {STUB_IS_OWNER
          ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-800/40">All team</span>
          : <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400 border border-blue-800/40">My decisions</span>
        }
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {entries.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-600 text-sm">
            <Brain size={24} className="opacity-40" />
            <p>No AI decisions logged yet.</p>
            <p className="text-xs text-gray-700">Decisions appear after NEXUS processes queries.</p>
          </div>
        ) : (
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e2128', backgroundColor: '#0f1018' }}>
                {['Timestamp', 'Agent', 'Query', 'Recommendation', 'Confidence', 'Action'].map((col) => (
                  <th key={col} className="text-left px-3 py-2.5 font-semibold uppercase tracking-wide text-gray-600" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const clvl = confidenceLabel(entry.confidence_score);
                const cc = CONFIDENCE_COLORS[clvl];
                return (
                  <tr key={entry.id} className="border-b hover:bg-white/[0.02] transition-colors" style={{ borderColor: '#1a1c23' }}>
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmtDate(entry.timestamp)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider" style={{ backgroundColor: '#1a1d27', color: '#9ca3af', border: '1px solid #2a3040' }}>
                        {entry.agent_name}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-400 max-w-[180px] truncate" title={entry.query}>{entry.query}</td>
                    <td className="px-3 py-2.5 text-gray-300 max-w-[220px] truncate" title={entry.recommendation}>{entry.recommendation}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#1e2128' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.round(entry.confidence_score * 100)}%`, backgroundColor: cc }} />
                        </div>
                        <span style={{ color: cc }} className="font-mono">{Math.round(entry.confidence_score * 100)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {entry.user_action ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide"
                          style={{
                            backgroundColor: entry.user_action === 'accepted' ? '#14532d55' : entry.user_action === 'flagged' ? '#7f1d1d55' : '#1e2128',
                            color: entry.user_action === 'accepted' ? '#4ade80' : entry.user_action === 'flagged' ? '#f87171' : entry.user_action === 'followed_up' ? '#60a5fa' : '#9ca3af',
                            border: '1px solid currentColor',
                          }}>
                          {entry.user_action.replace('_', ' ')}
                        </span>
                      ) : <span className="text-gray-700">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t" style={{ borderColor: '#1a1c23' }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-40" style={{ backgroundColor: '#1a1d27', color: '#9ca3af', border: '1px solid #2a3040' }}>← Prev</button>
          <span className="text-xs text-gray-600">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-40" style={{ backgroundColor: '#1a1d27', color: '#9ca3af', border: '1px solid #2a3040' }}>Next →</button>
        </div>
      )}
    </Panel>
  );
}

// ─── Signed NDAs Admin Tab (B3) ───────────────────────────────────────────────

function SignedNDAsAdminTab() {
  const [records, setRecords] = useState<SignedAgreementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokeTarget, setRevokeTarget] = useState<SignedAgreementRecord | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    getAllSignedNDAs()
      .then((r) => setRecords(r))
      .catch(() => setError('Failed to load signed NDAs.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDownloadPdf(record: SignedAgreementRecord) {
    if (!record.pdf_url || record.pdf_url.startsWith('stub-')) {
      alert('No PDF on record for this agreement.');
      return;
    }
    setDownloadingId(record.id ?? null);
    try {
      const signedUrl = await getNDAPdfSignedUrl(record.pdf_url, 300);
      if (!signedUrl) {
        alert('Could not generate download link. Please try again.');
        return;
      }
      const a = document.createElement('a');
      a.href = signedUrl;
      a.download = `NDA_${record.typed_name?.replace(/\s+/g, '_') ?? 'signed'}.pdf`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      alert('Download failed. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget?.id) return;
    setRevoking(true);
    try {
      await revokeSignedNDA(revokeTarget.id);
      setRecords((prev) =>
        prev.map((r) => (r.id === revokeTarget.id ? { ...r, revoked: true } : r))
      );
    } catch {
      alert('Revoke failed. Please try again.');
    } finally {
      setRevoking(false);
      setRevokeTarget(null);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString('en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Revoke Confirmation Dialog */}
      {revokeTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
        >
          <div
            className="flex flex-col gap-4 p-6 rounded-xl border max-w-sm w-full mx-4"
            style={{ backgroundColor: '#0d0e14', borderColor: '#2a3040' }}
          >
            <div className="flex items-center gap-3">
              <AlertTriangle size={20} className="text-yellow-400 flex-shrink-0" />
              <h3 className="text-sm font-semibold text-gray-100">Revoke NDA Access</h3>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">
              Are you sure you want to revoke the signed NDA for{' '}
              <span className="font-semibold text-gray-200">{revokeTarget.typed_name}</span>?
              This will flag the record as revoked. This action cannot be undone.
            </p>
            <div className="flex gap-2 mt-1">
              <button
                onClick={confirmRevoke}
                disabled={revoking}
                className="flex-1 py-2 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#7f1d1d' }}
              >
                {revoking ? 'Revoking…' : 'Revoke Access'}
              </button>
              <button
                onClick={() => setRevokeTarget(null)}
                disabled={revoking}
                className="flex-1 py-2 rounded-lg text-xs font-semibold text-gray-300 transition-colors"
                style={{ backgroundColor: '#1a1d27', border: '1px solid #2a3040' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Panel Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: '#1e2128', backgroundColor: '#11121a' }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <FileText size={14} className="text-green-500" />
          Signed NDAs
          {records.length > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-800/40 ml-1">
              {records.length}
            </span>
          )}
        </div>
        <button
          onClick={load}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{ backgroundColor: '#1a1d27', color: '#9ca3af', border: '1px solid #2a3040' }}
        >
          Refresh
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center flex-1 text-xs text-gray-600 gap-2">
          <div className="w-3 h-3 rounded-full border border-green-800 border-t-green-500 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="flex items-center justify-center flex-1 text-xs text-red-400 gap-2">
          <AlertTriangle size={14} />
          {error}
        </div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 py-12 text-center px-4">
          <FileText size={24} className="text-gray-700" />
          <p className="text-sm text-gray-500">No signed NDA records.</p>
          <p className="text-xs text-gray-700">Records appear here after users complete the beta NDA.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e2128', backgroundColor: '#0f1018' }}>
                {['Name', 'Email', 'Signed Date', 'Status', 'Actions'].map((col) => (
                  <th
                    key={col}
                    className="text-left px-4 py-3 font-semibold uppercase tracking-wide text-gray-600"
                    style={{ fontSize: 10, whiteSpace: 'nowrap' }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((record, i) => (
                <tr
                  key={record.id ?? i}
                  className="border-b hover:bg-white/[0.02] transition-colors"
                  style={{
                    borderColor: '#1a1c23',
                    opacity: record.revoked ? 0.5 : 1,
                  }}
                >
                  {/* Name */}
                  <td className="px-4 py-3 text-gray-200 font-medium whitespace-nowrap max-w-[180px] truncate">
                    {record.typed_name || '—'}
                  </td>

                  {/* Email */}
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap max-w-[200px] truncate">
                    {record.email || '—'}
                  </td>

                  {/* Signed Date */}
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {record.signed_at ? formatDate(record.signed_at) : '—'}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    {record.revoked ? (
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
                        style={{ backgroundColor: '#3b0a0a', color: '#f87171', border: '1px solid #7f1d1d44' }}
                      >
                        Revoked
                      </span>
                    ) : (
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
                        style={{ backgroundColor: '#052e16', color: '#4ade80', border: '1px solid #16a34a44' }}
                      >
                        Active
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {/* Download PDF */}
                      <button
                        onClick={() => handleDownloadPdf(record)}
                        disabled={downloadingId === record.id || !record.pdf_url || record.pdf_url.startsWith('stub-')}
                        className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ backgroundColor: '#0f2a4a', color: '#60a5fa', border: '1px solid #1e3a5f' }}
                        title={!record.pdf_url || record.pdf_url.startsWith('stub-') ? 'No PDF available' : 'Download PDF'}
                      >
                        <Download size={10} />
                        {downloadingId === record.id ? 'Getting…' : 'Download PDF'}
                      </button>

                      {/* Revoke */}
                      {!record.revoked && (
                        <button
                          onClick={() => setRevokeTarget(record)}
                          className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors"
                          style={{ backgroundColor: '#2a0a0a', color: '#f87171', border: '1px solid #7f1d1d44' }}
                          title="Revoke NDA access"
                        >
                          <X size={10} />
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Beta Invites Tab (B7) ────────────────────────────────────────────────────

const INDUSTRY_OPTIONS = [
  'Electrical Contractor',
  'General Contractor',
  'HVAC / Mechanical',
  'Plumbing',
  'Solar / Renewable Energy',
  'Property Management',
  'Commercial Real Estate',
  'Residential Construction',
  'Industrial / Manufacturing',
  'Other',
];

function statusBadge(status: BetaInvite['status']) {
  if (status === 'pending') {
    return (
      <span
        className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
        style={{ backgroundColor: '#1e3a5f', color: '#60a5fa', border: '1px solid #1e3a5f' }}
      >
        pending
      </span>
    );
  }
  if (status === 'accepted') {
    return (
      <span
        className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
        style={{ backgroundColor: '#052e16', color: '#4ade80', border: '1px solid #16a34a44' }}
      >
        accepted
      </span>
    );
  }
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
      style={{ backgroundColor: '#3b0a0a', color: '#f87171', border: '1px solid #7f1d1d44' }}
    >
      expired
    </span>
  );
}

function BetaInvitesTab() {
  const [invites, setInvites] = useState<BetaInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Send form
  const [emailInput, setEmailInput] = useState('');
  const [industryInput, setIndustryInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);

  // Revoke in-progress
  const [revokingId, setRevokingId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    getInvites()
      .then((rows) => setInvites(rows))
      .catch((e) => setError(e?.message || 'Failed to load invites'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const pendingCount = invites.filter((i) => i.status === 'pending').length;

  async function handleSend() {
    setSendError(null);
    setSendSuccess(null);
    const trimmed = emailInput.trim();
    if (!trimmed || !trimmed.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      setSendError('Please enter a valid email address.');
      return;
    }
    setSending(true);
    const result = await sendInvite(trimmed, industryInput || undefined);
    setSending(false);
    if (result.success) {
      setSendSuccess(`Invite sent to ${trimmed}`);
      setEmailInput('');
      setIndustryInput('');
      load();
    } else {
      setSendError(result.error || 'Failed to send invite.');
    }
  }

  async function handleRevoke(invite: BetaInvite) {
    setRevokingId(invite.id);
    const result = await revokeInvite(invite.id);
    setRevokingId(null);
    if (result.success) {
      setInvites((prev) =>
        prev.map((i) => i.id === invite.id ? { ...i, status: 'expired' } : i)
      );
    } else {
      setError(result.error || 'Failed to revoke invite.');
    }
  }

  async function handleResend(invite: BetaInvite) {
    setSendError(null);
    setSendSuccess(null);
    setSending(true);
    const result = await sendInvite(invite.email, invite.industry || undefined);
    setSending(false);
    if (result.success) {
      setSendSuccess(`Re-invite sent to ${invite.email}`);
      load();
    } else {
      setSendError(result.error || 'Failed to resend invite.');
    }
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString('en', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  const inputCss: React.CSSProperties = {
    backgroundColor: '#1a1d27',
    border: '1px solid #2a3040',
    color: '#e5e7eb',
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 13,
    outline: 'none',
  };

  return (
    <div
      className="flex flex-col rounded-xl border overflow-hidden"
      style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14', height: '100%', minHeight: 0 }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: '#1e2128', backgroundColor: '#11121a' }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <Mail size={14} className="text-green-500" />
          Beta Invites
          {pendingCount > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-400 border border-blue-800/50 ml-1">
              {pendingCount} pending
            </span>
          )}
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{ backgroundColor: '#1a1d27', color: '#9ca3af', border: '1px solid #2a3040' }}
        >
          <RefreshCw size={11} />
          Refresh
        </button>
      </div>

      {/* Send Invite Form */}
      <div className="px-4 py-4 border-b flex-shrink-0" style={{ borderColor: '#1a1c23' }}>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 mb-3">Send Invite</p>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <label className="text-[10px] text-gray-600 uppercase tracking-wide">Email</label>
            <input
              type="email"
              placeholder="invitee@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
              style={inputCss}
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <label className="text-[10px] text-gray-600 uppercase tracking-wide">Industry (optional)</label>
            <select
              value={industryInput}
              onChange={(e) => setIndustryInput(e.target.value)}
              style={inputCss}
            >
              <option value="">— Select industry —</option>
              {INDUSTRY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleSend}
            disabled={sending}
            className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#16a34a', color: '#fff', border: 'none', cursor: sending ? 'not-allowed' : 'pointer', height: 34 }}
          >
            <Send size={12} />
            {sending ? 'Sending…' : 'Send Invite'}
          </button>
        </div>

        {sendSuccess && (
          <p className="mt-2 text-xs text-green-400 flex items-center gap-1.5">
            <CheckCircle size={12} />
            {sendSuccess}
          </p>
        )}
        {sendError && (
          <p className="mt-2 text-xs text-red-400 flex items-center gap-1.5">
            <AlertTriangle size={12} />
            {sendError}
          </p>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-xs text-gray-600 gap-2">
            <div className="w-3 h-3 rounded-full border border-green-800 border-t-green-500 animate-spin" />
            Loading invites…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-12 text-xs text-red-400 gap-2">
            <AlertTriangle size={14} />
            {error}
          </div>
        ) : invites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-center px-4">
            <Mail size={24} className="text-gray-700" />
            <p className="text-sm text-gray-500">No invites sent yet.</p>
            <p className="text-xs text-gray-700">Use the form above to invite beta users.</p>
          </div>
        ) : (
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e2128', backgroundColor: '#0f1018' }}>
                {['Email', 'Industry', 'Status', 'Invited', 'Expires', 'Actions'].map((col) => (
                  <th
                    key={col}
                    className="text-left px-4 py-3 font-semibold uppercase tracking-wide text-gray-600"
                    style={{ fontSize: 10, whiteSpace: 'nowrap' }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr
                  key={invite.id}
                  className="border-b hover:bg-white/[0.02] transition-colors"
                  style={{ borderColor: '#1a1c23', opacity: invite.status === 'expired' ? 0.5 : 1 }}
                >
                  <td className="px-4 py-3 text-gray-200 font-medium whitespace-nowrap max-w-[200px] truncate">
                    {invite.email}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {invite.industry || <span className="text-gray-700">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {statusBadge(invite.status)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {fmtDate(invite.invited_at)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {fmtDate(invite.expires_at)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {/* Resend */}
                      <button
                        onClick={() => handleResend(invite)}
                        disabled={sending}
                        className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                        style={{ backgroundColor: '#0f2a4a', color: '#60a5fa', border: '1px solid #1e3a5f' }}
                        title="Resend invite"
                      >
                        <Send size={10} />
                        Resend
                      </button>

                      {/* Revoke — only for pending */}
                      {invite.status === 'pending' && (
                        <button
                          onClick={() => handleRevoke(invite)}
                          disabled={revokingId === invite.id}
                          className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                          style={{ backgroundColor: '#2a0a0a', color: '#f87171', border: '1px solid #7f1d1d44' }}
                          title="Revoke invite"
                        >
                          <Ban size={10} />
                          {revokingId === invite.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Guardian View Root ───────────────────────────────────────────────────────

type GuardianTab = 'monitor' | 'ai-decisions' | 'signed-ndas' | 'beta-invites';

export default function GuardianView() {
  const [activeTab, setActiveTab] = useState<GuardianTab>('monitor');

  // Pending invite badge count — loaded lazily to show on tab
  const [pendingInviteCount, setPendingInviteCount] = useState<number | null>(null);

  useEffect(() => {
    import('../services/inviteService').then(({ getInvites }) => {
      getInvites().then((rows) => {
        setPendingInviteCount(rows.filter((r) => r.status === 'pending').length);
      }).catch(() => { /* non-fatal */ });
    });
  }, []);

  const tabs: { id: GuardianTab; label: string; icon: React.ReactNode; badge?: number | null }[] = [
    { id: 'monitor',      label: 'Monitor',       icon: <Shield size={12} /> },
    { id: 'ai-decisions', label: 'AI Decisions',  icon: <Brain size={12} /> },
    { id: 'signed-ndas',  label: 'Signed NDAs',   icon: <FileText size={12} /> },
    { id: 'beta-invites', label: 'Beta Invites',  icon: <Mail size={12} />, badge: pendingInviteCount },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#0a0b0f' }}>
      {/* Page Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: '#1a1c23' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: '#16a34a22', border: '1px solid #16a34a44' }}
          >
            <Shield size={16} className="text-green-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-100">GUARDIAN</h1>
            <p className="text-xs text-gray-600">Proactive project health monitor · Rule engine shell</p>
          </div>
        </div>
        <div
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
          style={{ backgroundColor: '#0f1a0f', color: '#4ade80', border: '1px solid #16a34a33' }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          Shell · E4
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b flex-shrink-0" style={{ borderColor: '#1a1c23' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg transition-all"
            style={{
              backgroundColor: activeTab === tab.id ? '#0d0e14' : 'transparent',
              color: activeTab === tab.id ? '#4ade80' : '#6b7280',
              borderTop: activeTab === tab.id ? '1px solid #1e2128' : '1px solid transparent',
              borderLeft: activeTab === tab.id ? '1px solid #1e2128' : '1px solid transparent',
              borderRight: activeTab === tab.id ? '1px solid #1e2128' : '1px solid transparent',
              borderBottom: activeTab === tab.id ? '1px solid #0d0e14' : 'none',
              marginBottom: activeTab === tab.id ? -1 : 0,
            }}
          >
            {tab.icon}
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none ml-0.5"
                style={{ backgroundColor: '#1e3a5f', color: '#60a5fa', border: '1px solid #1e3a5f' }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'monitor' && (
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 h-full min-h-0">
            <RulesPanel />
            <ViolationsPanel />
            <AuditTrailPanel />
            <SignedNDAsPanel />
          </div>
        )}
        {activeTab === 'ai-decisions' && (
          <div className="h-full min-h-0">
            <AIDecisionsPanel />
          </div>
        )}
        {activeTab === 'signed-ndas' && (
          <div
            className="flex flex-col rounded-xl border overflow-hidden"
            style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14', height: '100%', minHeight: 0 }}
          >
            <SignedNDAsAdminTab />
          </div>
        )}
        {activeTab === 'beta-invites' && (
          <div className="h-full min-h-0">
            <BetaInvitesTab />
          </div>
        )}
      </div>
    </div>
  );
}
