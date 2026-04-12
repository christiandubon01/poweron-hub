/**
 * SeatEnforcement.ts
 * Manages seat/team member limits per tier and upgrade enforcement
 * Integrates with Stripe for tier information
 */

import { createClient } from '@supabase/supabase-js';

export interface SeatUsageInfo {
  used: number;
  max: number;
  available: number;
  percentUsed: number;
  isAtLimit: boolean;
  tier: string;
  nextTierName?: string;
  nextTierSeats?: number;
}

export interface UpgradePrompt {
  show: boolean;
  currentTier: string;
  currentSeats: number;
  nextTierName: string;
  nextTierSeats: number;
  message: string;
}

interface TierConfig {
  name: string;
  maxSeats: number;
  nextTier?: string;
}

const TIER_CONFIGS: { [key: string]: TierConfig } = {
  free: {
    name: 'Free',
    maxSeats: 1,
    nextTier: 'starter',
  },
  starter: {
    name: 'Starter',
    maxSeats: 3,
    nextTier: 'professional',
  },
  professional: {
    name: 'Professional',
    maxSeats: 10,
    nextTier: 'enterprise',
  },
  enterprise: {
    name: 'Enterprise',
    maxSeats: 999,
  },
};

let supabaseClient: ReturnType<typeof createClient> | null = null;

/**
 * Initialize Supabase client for seat enforcement
 */
export const initSeatEnforcement = () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase credentials not available for seat enforcement');
    return;
  }

  supabaseClient = createClient(supabaseUrl, supabaseKey);
};

/**
 * Get Supabase client, initializing if needed
 */
const getSupabaseClient = () => {
  if (!supabaseClient) {
    initSeatEnforcement();
  }
  return supabaseClient;
};

/**
 * Get current user's subscription tier
 */
const getUserTier = async (userId: string): Promise<string> => {
  const client = getSupabaseClient();
  if (!client) return 'free';

  try {
    const { data } = await client
      .from('user_subscriptions')
      .select('tier')
      .eq('user_id', userId)
      .single();

    return (data as any)?.tier || 'free';
  } catch (err) {
    console.warn('Failed to get user tier:', err);
    return 'free';
  }
};

/**
 * Get all team members for a user account
 */
export const getTeamMembers = async (userId: string): Promise<any[]> => {
  const client = getSupabaseClient();
  if (!client) return [];

  try {
    const { data } = await client
      .from('team_members')
      .select('*')
      .eq('account_owner_id', userId);

    return (data as any[]) || [];
  } catch (err) {
    console.warn('Failed to get team members:', err);
    return [];
  }
};

/**
 * Check seat limit against tier max
 */
export const checkSeatLimit = async (userId: string): Promise<SeatUsageInfo> => {
  const tier = await getUserTier(userId);
  const tierConfig = TIER_CONFIGS[tier] || TIER_CONFIGS.free;
  const teamMembers = await getTeamMembers(userId);
  const used = teamMembers.length;
  const max = tierConfig.maxSeats;
  const available = Math.max(0, max - used);
  const percentUsed = max > 0 ? Math.round((used / max) * 100) : 0;
  const isAtLimit = used >= max;

  const nextTier = tierConfig.nextTier ? TIER_CONFIGS[tierConfig.nextTier] : undefined;

  return {
    used,
    max,
    available,
    percentUsed,
    isAtLimit,
    tier,
    nextTierName: nextTier?.name,
    nextTierSeats: nextTier?.maxSeats,
  };
};

/**
 * Get seat usage summary
 */
export const getSeatUsage = async (userId: string): Promise<SeatUsageInfo> => {
  return checkSeatLimit(userId);
};

/**
 * Verify seat is available before inviting team member
 */
export const onInviteTeamMember = async (userId: string): Promise<UpgradePrompt | null> => {
  const seatUsage = await checkSeatLimit(userId);

  if (seatUsage.isAtLimit && seatUsage.nextTierName) {
    return {
      show: true,
      currentTier: seatUsage.tier,
      currentSeats: seatUsage.used,
      nextTierName: seatUsage.nextTierName,
      nextTierSeats: seatUsage.nextTierSeats || seatUsage.max,
      message: `You've reached the ${seatUsage.max} team member limit on your ${seatUsage.tier} plan. Upgrade to ${seatUsage.nextTierName} to add more team members.`,
    };
  }

  return null;
};

/**
 * Check if invitation can proceed
 */
export const canInviteTeamMember = async (userId: string): Promise<boolean> => {
  const seatUsage = await checkSeatLimit(userId);
  return !seatUsage.isAtLimit;
};

/**
 * Get upgrade prompt if at seat limit
 */
export const getUpgradePrompt = async (userId: string): Promise<UpgradePrompt | null> => {
  return onInviteTeamMember(userId);
};

/**
 * Add a team member to the account
 * Returns error if at seat limit
 */
export const addTeamMember = async (
  userId: string,
  email: string,
  role: string = 'member',
): Promise<{ success: boolean; error?: string; memberId?: string }> => {
  const canInvite = await canInviteTeamMember(userId);
  if (!canInvite) {
    const prompt = await getUpgradePrompt(userId);
    return {
      success: false,
      error: prompt?.message || 'Team member limit reached. Please upgrade your plan.',
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      error: 'Supabase not available',
    };
  }

  try {
    const newMember: Record<string, unknown> = {
      account_owner_id: userId,
      email,
      role,
      invited_at: new Date().toISOString(),
      status: 'invited',
    };

    const { data, error } = await (client.from('team_members') as any).insert([newMember]);

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      memberId: (data as any)?.[0]?.id,
    };
  } catch (err) {
    return {
      success: false,
      error: (err as any)?.message || 'Failed to add team member',
    };
  }
};

/**
 * Remove a team member from the account
 */
export const removeTeamMember = async (
  userId: string,
  memberId: string,
): Promise<{ success: boolean; error?: string }> => {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      error: 'Supabase not available',
    };
  }

  try {
    const { error } = await client
      .from('team_members')
      .delete()
      .eq('id', memberId)
      .eq('account_owner_id', userId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: (err as any)?.message || 'Failed to remove team member',
    };
  }
};

/**
 * Update team member role
 */
export const updateTeamMemberRole = async (
  userId: string,
  memberId: string,
  role: string,
): Promise<{ success: boolean; error?: string }> => {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      error: 'Supabase not available',
    };
  }

  try {
    const updateData: Record<string, unknown> = { role };
    const { error } = await (client.from('team_members') as any)
      .update(updateData)
      .eq('id', memberId)
      .eq('account_owner_id', userId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: (err as any)?.message || 'Failed to update team member role',
    };
  }
};

/**
 * Get tier configuration
 */
export const getTierConfig = (tier: string): TierConfig => {
  return TIER_CONFIGS[tier] || TIER_CONFIGS.free;
};

/**
 * Get all available tier configurations
 */
export const getAllTierConfigs = (): { [key: string]: TierConfig } => {
  return TIER_CONFIGS;
};

/**
 * Check if tier can be downgraded (no active team members above new tier limit)
 */
export const canDowngradeTier = async (userId: string, newTier: string): Promise<boolean> => {
  const newTierConfig = TIER_CONFIGS[newTier];
  if (!newTierConfig) return false;

  const teamMembers = await getTeamMembers(userId);
  return teamMembers.length <= newTierConfig.maxSeats;
};

/**
 * Get enforcement message for UI
 */
export const getEnforcementMessage = (seatUsage: SeatUsageInfo): string => {
  if (seatUsage.percentUsed >= 100) {
    return `You've reached your team member limit (${seatUsage.used}/${seatUsage.max}). ${seatUsage.nextTierName ? `Upgrade to ${seatUsage.nextTierName}` : 'Contact support'} to add more members.`;
  } else if (seatUsage.percentUsed >= 80) {
    return `You're using ${seatUsage.percentUsed}% of your team member limit (${seatUsage.used}/${seatUsage.max}). You have ${seatUsage.available} slot${seatUsage.available === 1 ? '' : 's'} remaining.`;
  } else if (seatUsage.percentUsed >= 50) {
    return `${seatUsage.available} team member slot${seatUsage.available === 1 ? '' : 's'} available (${seatUsage.used}/${seatUsage.max}).`;
  }

  return '';
};
