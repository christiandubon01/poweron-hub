import React, { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { fetchLatestRunsByCity, type CityLatestRun } from '@/services/hunter/cronRunLogService';

export function CronStatusPanel() {
  const [rows, setRows] = useState<CityLatestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedCity, setExpandedCity] = useState<string | null>(null);

  const load = async () => {
    setRefreshing(true);
    try {
      const r = await fetchLatestRunsByCity();
      setRows(r);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return <div className="text-sm text-gray-500 py-3">Loading cron status…</div>;
  }

  const formatRelative = (iso: string | null) => {
    if (!iso) return 'Never';
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 60) return minutes + ' min ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-gray-500">
          Last run per city. Crons fire daily at 6am Pacific.
        </p>
        <button
          onClick={load}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50"
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="rounded border border-gray-800 overflow-hidden">
        {rows.map((row, idx) => {
          const isExpanded = expandedCity === row.city;
          const status = row.latest?.status;
          const statusIcon =
            status === 'success' ? <CheckCircle2 size={13} className="text-emerald-500" />
            : status === 'partial' ? <AlertTriangle size={13} className="text-amber-500" />
            : status === 'failed' ? <XCircle size={13} className="text-red-500" />
            : status === 'running' ? <Clock size={13} className="text-blue-400 animate-pulse" />
            : <Clock size={13} className="text-gray-600" />;

          return (
            <div key={row.city} className={idx > 0 ? 'border-t border-gray-800' : ''}>
              <button
                onClick={() => setExpandedCity(isExpanded ? null : row.city)}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-900 text-left text-xs"
              >
                {row.latest?.error_message
                  ? (isExpanded ? <ChevronDown size={11} className="text-gray-600" /> : <ChevronRight size={11} className="text-gray-600" />)
                  : <span className="w-[11px]" />}
                {statusIcon}
                <span className="text-gray-200 font-medium min-w-[140px]">{row.city}</span>
                <span className="text-gray-500 min-w-[90px]">{formatRelative(row.latest?.started_at ?? null)}</span>
                {row.latest && (
                  <span className="text-gray-400 ml-auto">
                    +{row.latest.new_leads} new · ~{row.latest.updated_leads} upd
                    {row.latest.errors > 0 && <span className="text-red-400"> · {row.latest.errors} err</span>}
                  </span>
                )}
                {!row.latest && <span className="text-gray-600 ml-auto">no runs in 14d</span>}
                <span className="text-gray-600 text-[10px] ml-3 min-w-[55px] text-right">
                  {row.totalRuns7d > 0 ? Math.round(row.successRate7d * 100) + '% / 7d' : '—'}
                </span>
              </button>
              {isExpanded && row.latest?.error_message && (
                <div className="px-3 pb-3 pl-12 text-[11px] text-red-300 bg-red-950/30 border-t border-red-900/30">
                  <div className="font-mono whitespace-pre-wrap break-all py-2">{row.latest.error_message}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
