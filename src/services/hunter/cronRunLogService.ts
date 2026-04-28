import { supabase } from '@/lib/supabase';

export interface CronRunLogRow {
  id: string;
  city: string;
  run_source: 'cron' | 'manual';
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'success' | 'partial' | 'failed';
  new_leads: number;
  updated_leads: number;
  errors: number;
  error_message: string | null;
  duration_ms: number | null;
  permit_types_processed: number;
}

export interface CityLatestRun {
  city: string;
  latest: CronRunLogRow | null;
  successRate7d: number;
  totalRuns7d: number;
  successfulRuns7d: number;
}

const TLMA_CITIES = [
  'COACHELLA','INDIO','LA QUINTA','PALM DESERT','PALM SPRINGS',
  'RANCHO MIRAGE','DESERT HOT SPRINGS','BERMUDA DUNES','MECCA',
  'THERMAL','THOUSAND PALMS','WHITE WATER','CATHEDRAL CITY',
];

export async function fetchLatestRunsByCity(): Promise<CityLatestRun[]> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await (supabase as any)
    .from('cron_run_log')
    .select('*')
    .gte('started_at', fourteenDaysAgo)
    .order('started_at', { ascending: false });

  if (error) {
    console.error('[cronRunLogService] fetchLatestRunsByCity:', error);
    return TLMA_CITIES.map(c => ({
      city: c, latest: null, successRate7d: 0, totalRuns7d: 0, successfulRuns7d: 0
    }));
  }

  const rows = (data ?? []) as CronRunLogRow[];
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

  return TLMA_CITIES.map(city => {
    const cityRows = rows.filter(r => r.city === city);
    const last7d = cityRows.filter(r => new Date(r.started_at).getTime() >= sevenDaysAgoMs);
    const successful = last7d.filter(r => r.status === 'success').length;
    return {
      city,
      latest: cityRows[0] ?? null,
      successRate7d: last7d.length > 0 ? successful / last7d.length : 0,
      totalRuns7d: last7d.length,
      successfulRuns7d: successful,
    };
  });
}
