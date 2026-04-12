/**
 * UsageTracker.ts
 * Tracks usage metrics per account for tier enforcement and analytics
 * Storage: Supabase usage_tracking table + localStorage cache
 */

import { createClient } from '@supabase/supabase-js';

export interface UsageMetric {
  id?: string;
  user_id: string;
  date: string;
  metric_name: string;
  count: number;
  details?: Record<string, unknown>;
}

export interface UsageStats {
  apiCalls: number;
  voiceCaptures: number;
  voiceSessions: number;
  voiceMinutesTotal: number;
  projects: number;
  teamMembers: number;
  period: 'day' | 'week' | 'month';
  timestamp: number;
}

export interface UsageLimitCheck {
  metric: string;
  current: number;
  limit: number;
  isExceeded: boolean;
  remaining: number;
  percentUsed: number;
}

const CACHE_KEY_PREFIX = 'poweron_usage_';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

let supabaseClient: ReturnType<typeof createClient> | null = null;

/**
 * Initialize Supabase client for usage tracking
 */
export const initUsageTracking = () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase credentials not available for usage tracking');
    return;
  }

  supabaseClient = createClient(supabaseUrl, supabaseKey);
};

/**
 * Get Supabase client, initializing if needed
 */
const getSupabaseClient = () => {
  if (!supabaseClient) {
    initUsageTracking();
  }
  return supabaseClient;
};

/**
 * Get cache key for a metric
 */
const getCacheKey = (userId: string, metricName: string, date: string): string => {
  return `${CACHE_KEY_PREFIX}${userId}_${metricName}_${date}`;
};

/**
 * Read from localStorage cache
 */
const readCache = (key: string): UsageMetric | null => {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_DURATION_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('Cache read error:', err);
    return null;
  }
};

/**
 * Write to localStorage cache
 */
const writeCache = (key: string, data: UsageMetric): void => {
  try {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (err) {
    console.warn('Cache write error:', err);
  }
};

/**
 * Get today's date in YYYY-MM-DD format
 */
const getToday = (): string => {
  return new Date().toISOString().split('T')[0];
};

/**
 * Increment daily API call counter
 */
export const trackApiCall = async (userId: string, agentName: string): Promise<void> => {
  if (!userId) return;

  const today = getToday();
  const metricName = `api_call_${agentName}`;
  const cacheKey = getCacheKey(userId, metricName, today);

  // Read from cache first
  let metric = readCache(cacheKey);

  if (!metric) {
    // Fetch from Supabase
    const client = getSupabaseClient();
    if (!client) {
      console.warn('Supabase not available for API call tracking');
      return;
    }

    try {
      const { data } = await client
        .from('usage_tracking')
        .select('*')
        .eq('user_id', userId)
        .eq('date', today)
        .eq('metric_name', metricName)
        .single();

      metric = data as UsageMetric | null;
    } catch (err) {
      // Record not found or error, will create new
      metric = null;
    }
  }

  // Increment or create
  const newCount = (metric?.count ?? 0) + 1;
  const updatedMetric: UsageMetric = {
    user_id: userId,
    date: today,
    metric_name: metricName,
    count: newCount,
    details: { agent: agentName },
  };

  // Update cache
  writeCache(cacheKey, updatedMetric);

  // Update Supabase (async, don't block)
  const client = getSupabaseClient();
  if (client) {
    try {
      if (metric?.id) {
        await (client.from('usage_tracking') as any)
          .update(updatedMetric)
          .eq('id', metric.id);
      } else {
        await (client.from('usage_tracking') as any).insert([updatedMetric]);
      }
    } catch (err) {
      console.warn('Failed to update API call metric:', err);
    }
  }
};

/**
 * Increment daily voice capture counter
 */
export const trackVoiceCapture = async (userId: string): Promise<void> => {
  if (!userId) return;

  const today = getToday();
  const metricName = 'voice_capture';
  const cacheKey = getCacheKey(userId, metricName, today);

  let metric = readCache(cacheKey);

  if (!metric) {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      const { data } = await client
        .from('usage_tracking')
        .select('*')
        .eq('user_id', userId)
        .eq('date', today)
        .eq('metric_name', metricName)
        .single();

      metric = data as UsageMetric | null;
    } catch (err) {
      metric = null;
    }
  }

  const newCount = (metric?.count ?? 0) + 1;
  const updatedMetric: UsageMetric = {
    user_id: userId,
    date: today,
    metric_name: metricName,
    count: newCount,
  };

  writeCache(cacheKey, updatedMetric);

  const client = getSupabaseClient();
  if (client) {
    try {
      if (metric?.id) {
        await (client.from('usage_tracking') as any)
          .update(updatedMetric)
          .eq('id', metric.id);
      } else {
        await (client.from('usage_tracking') as any).insert([updatedMetric]);
      }
    } catch (err) {
      console.warn('Failed to update voice capture metric:', err);
    }
  }
};

/**
 * Log voice session with duration in minutes
 */
export const trackVoiceSession = async (userId: string, durationMinutes: number): Promise<void> => {
  if (!userId || durationMinutes <= 0) return;

  const today = getToday();
  const metricName = 'voice_session_minutes';
  const cacheKey = getCacheKey(userId, metricName, today);

  let metric = readCache(cacheKey);

  if (!metric) {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      const { data } = await client
        .from('usage_tracking')
        .select('*')
        .eq('user_id', userId)
        .eq('date', today)
        .eq('metric_name', metricName)
        .single();

      metric = data as UsageMetric | null;
    } catch (err) {
      metric = null;
    }
  }

  const newCount = (metric?.count ?? 0) + durationMinutes;
  const updatedMetric: UsageMetric = {
    user_id: userId,
    date: today,
    metric_name: metricName,
    count: newCount,
    details: { durationMinutes },
  };

  writeCache(cacheKey, updatedMetric);

  const client = getSupabaseClient();
  if (client) {
    try {
      if (metric?.id) {
        await (client.from('usage_tracking') as any)
          .update(updatedMetric)
          .eq('id', metric.id);
      } else {
        await (client.from('usage_tracking') as any).insert([updatedMetric]);
      }
    } catch (err) {
      console.warn('Failed to update voice session metric:', err);
    }
  }
};

/**
 * Get usage statistics for a time period
 */
export const getUsageStats = async (
  userId: string,
  period: 'day' | 'week' | 'month',
): Promise<UsageStats> => {
  if (!userId) {
    return {
      apiCalls: 0,
      voiceCaptures: 0,
      voiceSessions: 0,
      voiceMinutesTotal: 0,
      projects: 0,
      teamMembers: 0,
      period,
      timestamp: Date.now(),
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      apiCalls: 0,
      voiceCaptures: 0,
      voiceSessions: 0,
      voiceMinutesTotal: 0,
      projects: 0,
      teamMembers: 0,
      period,
      timestamp: Date.now(),
    };
  }

  const now = new Date();
  let startDate = new Date();

  if (period === 'day') {
    startDate.setDate(now.getDate());
  } else if (period === 'week') {
    startDate.setDate(now.getDate() - 7);
  } else if (period === 'month') {
    startDate.setMonth(now.getMonth());
    startDate.setDate(1);
  }

  const startDateStr = startDate.toISOString().split('T')[0];

  try {
    const { data } = await client
      .from('usage_tracking')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDateStr);

    const metrics = (data as UsageMetric[]) || [];
    let apiCalls = 0;
    let voiceCaptures = 0;
    let voiceMinutesTotal = 0;

    metrics.forEach((m) => {
      if (m.metric_name.startsWith('api_call_')) {
        apiCalls += m.count;
      } else if (m.metric_name === 'voice_capture') {
        voiceCaptures += m.count;
      } else if (m.metric_name === 'voice_session_minutes') {
        voiceMinutesTotal += m.count;
      }
    });

    return {
      apiCalls,
      voiceCaptures,
      voiceSessions: voiceCaptures,
      voiceMinutesTotal,
      projects: 0,
      teamMembers: 0,
      period,
      timestamp: Date.now(),
    };
  } catch (err) {
    console.warn('Failed to get usage stats:', err);
    return {
      apiCalls: 0,
      voiceCaptures: 0,
      voiceSessions: 0,
      voiceMinutesTotal: 0,
      projects: 0,
      teamMembers: 0,
      period,
      timestamp: Date.now(),
    };
  }
};

/**
 * Tier limits mapping
 */
export interface TierLimits {
  [key: string]: number;
}

const DEFAULT_TIER_LIMITS: TierLimits = {
  api_calls_per_day: 100,
  voice_captures_per_day: 10,
  voice_minutes_per_day: 60,
  team_members: 3,
  projects: 10,
};

/**
 * Check if current usage exceeds tier limit
 */
export const checkUsageLimit = async (
  userId: string,
  metric: string,
  tierLimits: TierLimits = DEFAULT_TIER_LIMITS,
): Promise<UsageLimitCheck> => {
  const today = getToday();
  const client = getSupabaseClient();

  let current = 0;
  let limit = tierLimits[metric] || 0;

  try {
    if (metric === 'api_calls_per_day') {
      if (client) {
        const { data } = await client
          .from('usage_tracking')
          .select('count')
          .eq('user_id', userId)
          .eq('date', today)
          .like('metric_name', 'api_call_%');

        current = ((data as any[]) || []).reduce((sum, m) => sum + m.count, 0);
      }
    } else if (metric === 'voice_captures_per_day') {
      if (client) {
        const { data } = await client
          .from('usage_tracking')
          .select('count')
          .eq('user_id', userId)
          .eq('date', today)
          .eq('metric_name', 'voice_capture');

        current = ((data as any[]) || []).reduce((sum, m) => sum + m.count, 0);
      }
    } else if (metric === 'voice_minutes_per_day') {
      if (client) {
        const { data } = await client
          .from('usage_tracking')
          .select('count')
          .eq('user_id', userId)
          .eq('date', today)
          .eq('metric_name', 'voice_session_minutes');

        current = ((data as any[]) || []).reduce((sum, m) => sum + m.count, 0);
      }
    }
  } catch (err) {
    console.warn('Error checking usage limit:', err);
  }

  const isExceeded = current >= limit;
  const remaining = Math.max(0, limit - current);
  const percentUsed = limit > 0 ? Math.round((current / limit) * 100) : 0;

  return {
    metric,
    current,
    limit,
    isExceeded,
    remaining,
    percentUsed,
  };
};

/**
 * Reset daily counters (called at midnight or via scheduled function)
 */
export const resetDailyCounters = async (userId: string): Promise<void> => {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    // Clear localStorage cache for today's date
    const today = getToday();
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.includes(`${userId}_`) && key.includes(`_${today}`)) {
        localStorage.removeItem(key);
      }
    });

    // Note: Supabase data is not deleted, only cache is cleared
    // This allows historical tracking while resetting daily limits
  } catch (err) {
    console.warn('Failed to reset daily counters:', err);
  }
};

/**
 * Get usage from cache or Supabase
 */
export const getUsageMetric = async (
  userId: string,
  metricName: string,
  date: string = getToday(),
): Promise<UsageMetric | null> => {
  const cacheKey = getCacheKey(userId, metricName, date);
  let metric = readCache(cacheKey);

  if (!metric) {
    const client = getSupabaseClient();
    if (!client) return null;

    try {
      const { data } = await client
        .from('usage_tracking')
        .select('*')
        .eq('user_id', userId)
        .eq('date', date)
        .eq('metric_name', metricName)
        .single();

      metric = data as UsageMetric | null;
      if (metric) {
        writeCache(cacheKey, metric);
      }
    } catch (err) {
      console.warn('Failed to get usage metric:', err);
    }
  }

  return metric;
};
