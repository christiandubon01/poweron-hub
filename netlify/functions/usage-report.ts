/**
 * usage-report.ts
 * Serverless function for aggregating usage metrics per account
 * Rate limited to 1 call per minute per user
 * Used by admin dashboard and billing page
 */

import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

interface UsageReportRequest {
  userId: string;
  period?: 'day' | 'week' | 'month';
}

interface UsageReport {
  userId: string;
  totalApiCalls: number;
  totalVoiceCaptures: number;
  totalVoiceSessions: number;
  totalVoiceMinutes: number;
  projectCount: number;
  teamMemberCount: number;
  tier: string;
  period: string;
  generatedAt: string;
  rateLimitRemaining: number;
}

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_KEY_PREFIX = 'usage_report_rate_limit_';

/**
 * In-memory rate limit store (in production, use Redis or similar)
 * Maps userId -> { count, resetTime }
 */
const rateLimitStore: {
  [key: string]: { count: number; resetTime: number };
} = {};

/**
 * Check rate limit for user
 */
const checkRateLimit = (userId: string): { allowed: boolean; remaining: number } => {
  const now = Date.now();
  const key = RATE_LIMIT_KEY_PREFIX + userId;
  const current = rateLimitStore[key];

  if (!current || now > current.resetTime) {
    // Reset or initialize
    rateLimitStore[key] = { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS };
    return { allowed: true, remaining: 0 };
  }

  if (current.count >= 1) {
    // Rate limit exceeded
    return {
      allowed: false,
      remaining: Math.ceil((current.resetTime - now) / 1000),
    };
  }

  // Increment count
  current.count += 1;
  return { allowed: true, remaining: 0 };
};

/**
 * Get user's subscription tier
 */
const getUserTier = async (supabase: any, userId: string): Promise<string> => {
  try {
    const { data } = await supabase
      .from('user_subscriptions')
      .select('tier')
      .eq('user_id', userId)
      .single();

    return data?.tier || 'free';
  } catch (err) {
    console.warn('Failed to get user tier:', err);
    return 'free';
  }
};

/**
 * Aggregate usage metrics for a user
 */
const aggregateUsageMetrics = async (
  supabase: any,
  userId: string,
  period: 'day' | 'week' | 'month' = 'month',
): Promise<Omit<UsageReport, 'userId' | 'generatedAt' | 'rateLimitRemaining'>> => {
  try {
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

    // Get usage tracking metrics
    const { data: usageMetrics } = await supabase
      .from('usage_tracking')
      .select('metric_name, count')
      .eq('user_id', userId)
      .gte('date', startDateStr)
      .catch(() => ({ data: [] }));

    let totalApiCalls = 0;
    let totalVoiceCaptures = 0;
    let totalVoiceMinutes = 0;

    (usageMetrics || []).forEach((metric: any) => {
      if (metric.metric_name.startsWith('api_call_')) {
        totalApiCalls += metric.count;
      } else if (metric.metric_name === 'voice_capture') {
        totalVoiceCaptures += metric.count;
      } else if (metric.metric_name === 'voice_session_minutes') {
        totalVoiceMinutes += metric.count;
      }
    });

    // Get team member count
    const { data: teamMembers } = await supabase
      .from('team_members')
      .select('id')
      .eq('account_owner_id', userId)
      .catch(() => ({ data: [] }));

    const teamMemberCount = (teamMembers || []).length;

    // Get project count
    const { data: projects } = await supabase
      .from('projects')
      .select('id')
      .eq('owner_id', userId)
      .catch(() => ({ data: [] }));

    const projectCount = (projects || []).length;

    // Get tier
    const tier = await getUserTier(supabase, userId);

    return {
      totalApiCalls,
      totalVoiceCaptures,
      totalVoiceSessions: totalVoiceCaptures,
      totalVoiceMinutes,
      projectCount,
      teamMemberCount,
      tier,
      period,
    };
  } catch (err) {
    console.error('Error aggregating usage metrics:', err);
    return {
      totalApiCalls: 0,
      totalVoiceCaptures: 0,
      totalVoiceSessions: 0,
      totalVoiceMinutes: 0,
      projectCount: 0,
      teamMemberCount: 0,
      tier: 'free',
      period,
    };
  }
};

/**
 * Netlify function handler
 */
const handler: Handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}') as UsageReportRequest;
    const { userId, period = 'month' } = body;

    if (!userId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'userId is required' }),
      };
    }

    // Check rate limit
    const { allowed, remaining } = checkRateLimit(userId);
    if (!allowed) {
      return {
        statusCode: 429,
        headers: {
          'Retry-After': String(remaining),
        },
        body: JSON.stringify({
          error: 'Rate limit exceeded',
          retryAfter: remaining,
        }),
      };
    }

    // Initialize Supabase
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Supabase configuration missing' }),
      };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user (check auth token if provided)
    const authHeader = event.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (token) {
      // Verify JWT token here if needed
      // For now, we trust the userId from the request
    }

    // Aggregate metrics
    const metrics = await aggregateUsageMetrics(supabase, userId, period);

    const report: UsageReport = {
      userId,
      ...metrics,
      generatedAt: new Date().toISOString(),
      rateLimitRemaining: 0, // Remaining calls in this window (always 0 after this call)
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(report),
    };
  } catch (err) {
    console.error('Error in usage-report function:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        details: (err as any).message,
      }),
    };
  }
};

export { handler };
