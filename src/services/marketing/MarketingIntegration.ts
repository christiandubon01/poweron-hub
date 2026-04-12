import { supabase } from '../../lib/supabase';

// Types
export type CampaignType = 'new_service_announcement' | 'seasonal_promotion' | 'follow_up_sequence' | 'newsletter';
export type CallOutcome = 'estimate_scheduled' | 'job_booked' | 'no_answer' | 'voicemail';
export type SocialPlatform = 'google_business' | 'yelp' | 'instagram' | 'facebook' | 'linkedin' | 'nextdoor';

export interface EmailCampaign {
  id: string;
  name: string;
  type: CampaignType;
  template: string;
  recipients: string[];
  subject: string;
  content: string;
  status: 'draft' | 'scheduled' | 'sent';
  sentAt?: string;
  openRate?: number;
  clickRate?: number;
  unsubscribeRate?: number;
  createdAt: string;
  updatedAt: string;
}

export interface InboundCall {
  id: string;
  phone: string;
  source: string;
  duration: number; // seconds
  outcome: CallOutcome;
  timestamp: string;
  hunterId?: string;
  notes?: string;
}

export interface SocialProfile {
  platform: SocialPlatform;
  url: string;
  handle?: string;
  verified: boolean;
  followers?: number;
}

export interface SocialPost {
  id: string;
  projectId: string;
  platform: SocialPlatform;
  content: string;
  mediaUrl?: string;
  scheduledAt?: string;
  postedAt?: string;
  status: 'draft' | 'scheduled' | 'posted';
  engagement: {
    likes: number;
    comments: number;
    shares: number;
  };
  createdAt: string;
}

export interface ChannelPerformance {
  channel: string;
  leadsGenerated: number;
  costPerLead: number;
  roi: number;
  conversionRate: number;
}

export interface LeadSource {
  source: string;
  count: number;
  percentage: number;
}

export interface MarketingReport {
  period: string;
  totalLeads: number;
  totalCost: number;
  averageCostPerLead: number;
  totalRevenue: number;
  roi: number;
  topChannels: ChannelPerformance[];
  leadSources: LeadSource[];
  campaignStats: {
    name: string;
    opens: number;
    clicks: number;
    conversions: number;
  }[];
}

// EMAIL CAMPAIGNS SERVICE
export const emailCampaignsService = {
  async createCampaign(
    name: string,
    type: CampaignType,
    template: string,
    recipients: string[]
  ): Promise<EmailCampaign> {
    const id = `campaign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    // Generate email content via Claude (simulated)
    const content = await generateEmailContent(type, template);

    const campaign: EmailCampaign = {
      id,
      name,
      type,
      template,
      recipients,
      subject: generateEmailSubject(type),
      content,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };

    // Save to Supabase if available (table may not exist yet)
    try {
      const client = supabase;
      if (client && typeof client.from === 'function') {
        const result = await (client as any).from('marketing_campaigns').insert([campaign] as any);
        if (result?.error) {
          console.warn('Failed to save campaign to Supabase:', result.error);
        }
      }
    } catch (error) {
      console.warn('Failed to save campaign to Supabase:', error);
    }

    return campaign;
  },

  async getCampaigns(status?: 'draft' | 'scheduled' | 'sent'): Promise<EmailCampaign[]> {
    try {
      const client = supabase as any;
      if (client && typeof client.from === 'function') {
        let query = client.from('marketing_campaigns').select('*');
        if (status) {
          query = query.eq('status', status);
        }
        const { data } = await query;
        return data || [];
      }
      return [];
    } catch (error) {
      console.warn('Failed to fetch campaigns:', error);
      return [];
    }
  },

  async sendCampaign(campaignId: string): Promise<boolean> {
    try {
      const client = supabase as any;
      if (!client || typeof client.from !== 'function') return false;

      const { data: campaign } = await client
        .from('marketing_campaigns')
        .select('*')
        .eq('id', campaignId)
        .single();

      if (!campaign) return false;

      // Simulate sending via Resend API
      // In production, call Resend API here with campaign.recipients
      console.log(`Sending campaign ${campaignId} to ${campaign.recipients.length} recipients`);

      // Update status
      const { error } = await client
        .from('marketing_campaigns')
        .update({
          status: 'sent',
          sentAt: new Date().toISOString(),
        })
        .eq('id', campaignId);

      return !error;
    } catch (error) {
      console.warn('Failed to send campaign:', error);
      return false;
    }
  },

  async trackMetrics(campaignId: string): Promise<Partial<EmailCampaign>> {
    try {
      const client = supabase as any;
      // Simulate fetching metrics from Resend API
      const metrics = {
        openRate: Math.random() * 0.4, // 0-40%
        clickRate: Math.random() * 0.2, // 0-20%
        unsubscribeRate: Math.random() * 0.02, // 0-2%
      };

      if (client && typeof client.from === 'function') {
        await client
          .from('marketing_campaigns')
          .update(metrics)
          .eq('id', campaignId);
      }

      return metrics;
    } catch (error) {
      console.warn('Failed to track metrics:', error);
      return {};
    }
  },
};

// CALL TRACKING SERVICE
export const callTrackingService = {
  async logInboundCall(
    phone: string,
    source: string,
    duration: number,
    outcome: CallOutcome,
    notes?: string
  ): Promise<InboundCall> {
    const id = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const call: InboundCall = {
      id,
      phone,
      source,
      duration,
      outcome,
      timestamp: new Date().toISOString(),
      notes,
    };

    try {
      const client = supabase as any;
      if (client && typeof client.from === 'function') {
        await client.from('inbound_calls').insert([call] as any);
      }
    } catch (error) {
      console.warn('Failed to log call:', error);
    }

    return call;
  },

  async getCallsBySource(source: string): Promise<InboundCall[]> {
    try {
      const client = supabase as any;
      if (!client || typeof client.from !== 'function') return [];
      
      const { data } = await client
        .from('inbound_calls')
        .select('*')
        .eq('source', source);
      return data || [];
    } catch (error) {
      console.warn('Failed to fetch calls:', error);
      return [];
    }
  },

  async getConversionRates(): Promise<Record<string, number>> {
    try {
      const client = supabase as any;
      if (!client || typeof client.from !== 'function') return {};

      const { data } = await client.from('inbound_calls').select('*');
      if (!data) return {};

      const rates: Record<string, number> = {};
      const bySource: Record<string, { total: number; converted: number }> = {};

      for (const call of data) {
        if (!bySource[call.source]) {
          bySource[call.source] = { total: 0, converted: 0 };
        }
        bySource[call.source].total++;
        if (call.outcome === 'estimate_scheduled' || call.outcome === 'job_booked') {
          bySource[call.source].converted++;
        }
      }

      for (const [source, stats] of Object.entries(bySource)) {
        rates[source] = stats.total > 0 ? stats.converted / stats.total : 0;
      }

      return rates;
    } catch (error) {
      console.warn('Failed to calculate conversion rates:', error);
      return {};
    }
  },
};

// SOCIAL MEDIA SERVICE
export const socialMediaService = {
  socialProfiles: {
    google_business: 'https://business.google.com',
    yelp: 'https://www.yelp.com',
    instagram: 'https://www.instagram.com',
    facebook: 'https://www.facebook.com',
    linkedin: 'https://www.linkedin.com',
    nextdoor: 'https://www.nextdoor.com',
  } as Record<SocialPlatform, string>,

  async generateSocialPost(
    projectId: string,
    platform: SocialPlatform,
    projectData?: any
  ): Promise<SocialPost> {
    const id = `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Generate content for the specific platform
    const content = generateSocialContent(platform, projectData);

    const post: SocialPost = {
      id,
      projectId,
      platform,
      content,
      status: 'draft',
      engagement: {
        likes: 0,
        comments: 0,
        shares: 0,
      },
      createdAt: new Date().toISOString(),
    };

    try {
      const client = supabase as any;
      if (client && typeof client.from === 'function') {
        await client.from('social_posts').insert([post] as any);
      }
    } catch (error) {
      console.warn('Failed to save social post:', error);
    }

    return post;
  },

  async schedulePostAcrossAll(projectId: string, scheduledAt: string): Promise<SocialPost[]> {
    const posts: SocialPost[] = [];
    const platforms: SocialPlatform[] = [
      'google_business',
      'yelp',
      'instagram',
      'facebook',
      'linkedin',
      'nextdoor',
    ];

    for (const platform of platforms) {
      const post = await this.generateSocialPost(projectId, platform);
      post.scheduledAt = scheduledAt;
      post.status = 'scheduled';
      posts.push(post);

      try {
        const client = supabase as any;
        if (client && typeof client.from === 'function') {
          await client.from('social_posts').update({ scheduledAt, status: 'scheduled' }).eq('id', post.id);
        }
      } catch (error) {
        console.warn(`Failed to schedule ${platform} post:`, error);
      }
    }

    return posts;
  },

  async getRecentPosts(limit: number = 10): Promise<SocialPost[]> {
    try {
      const client = supabase as any;
      if (!client || typeof client.from !== 'function') return [];

      const { data } = await client
        .from('social_posts')
        .select('*')
        .eq('status', 'posted')
        .order('postedAt', { ascending: false })
        .limit(limit);
      return data || [];
    } catch (error) {
      console.warn('Failed to fetch recent posts:', error);
      return [];
    }
  },
};

// MARKETING ANALYTICS SERVICE
export const analyticsService = {
  async getChannelPerformance(): Promise<ChannelPerformance[]> {
    try {
      // Aggregate data from multiple sources
      const channels = ['Google', 'Portal', 'Referral', 'Ad', 'Direct', 'Social'];
      const performance: ChannelPerformance[] = [];

      for (const channel of channels) {
        const calls = await callTrackingService.getCallsBySource(channel);
        const converted = calls.filter(
          (c) => c.outcome === 'estimate_scheduled' || c.outcome === 'job_booked'
        ).length;
        const totalCost = Math.random() * 5000; // Simulated

        performance.push({
          channel,
          leadsGenerated: calls.length,
          costPerLead: calls.length > 0 ? totalCost / calls.length : 0,
          roi: converted > 0 ? (converted * 15000 - totalCost) / totalCost : 0, // Assume $15k avg job value
          conversionRate: calls.length > 0 ? converted / calls.length : 0,
        });
      }

      return performance.sort((a, b) => b.roi - a.roi);
    } catch (error) {
      console.warn('Failed to calculate channel performance:', error);
      return [];
    }
  },

  async getLeadSourceAttribution(): Promise<LeadSource[]> {
    try {
      const client = supabase as any;
      if (!client || typeof client.from !== 'function') return [];

      const { data: calls } = await client.from('inbound_calls').select('source');

      if (!calls) return [];

      const sources: Record<string, number> = {};
      for (const call of calls) {
        sources[call.source] = (sources[call.source] || 0) + 1;
      }

      const total = calls.length;
      return Object.entries(sources).map(([source, count]) => ({
        source,
        count,
        percentage: (count / total) * 100,
      }));
    } catch (error) {
      console.warn('Failed to get lead source attribution:', error);
      return [];
    }
  },

  async getCostPerLead(channel: string): Promise<number> {
    try {
      const calls = await callTrackingService.getCallsBySource(channel);
      const marketingSpend = Math.random() * 3000; // Simulated spend
      return calls.length > 0 ? marketingSpend / calls.length : 0;
    } catch (error) {
      console.warn('Failed to calculate cost per lead:', error);
      return 0;
    }
  },

  async getBestPerformingContent(): Promise<
    {
      type: string;
      engagement: number;
      conversionRate: number;
    }[]
  > {
    try {
      const client = supabase as any;
      if (!client || typeof client.from !== 'function') return [];

      const { data: campaigns } = await client.from('marketing_campaigns').select('*');
      const { data: posts } = await client.from('social_posts').select('*');

      const results = [];

      if (campaigns) {
        for (const campaign of campaigns) {
          results.push({
            type: `Email: ${campaign.name}`,
            engagement:
              (campaign.openRate || 0) * 0.6 + (campaign.clickRate || 0) * 0.4,
            conversionRate: campaign.clickRate || 0,
          });
        }
      }

      if (posts) {
        for (const post of posts) {
          const totalEngagement = post.engagement.likes + post.engagement.comments + post.engagement.shares;
          results.push({
            type: `Social: ${post.platform} - ${post.projectId}`,
            engagement: totalEngagement,
            conversionRate: (post.engagement.shares / Math.max(totalEngagement, 1)) * 100,
          });
        }
      }

      return results.sort((a, b) => b.engagement - a.engagement).slice(0, 10);
    } catch (error) {
      console.warn('Failed to get best performing content:', error);
      return [];
    }
  },

  async getMonthlyMarketingReport(): Promise<MarketingReport> {
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [channels, sources] = await Promise.all([
      this.getChannelPerformance(),
      this.getLeadSourceAttribution(),
    ]);

    const totalLeads = sources.reduce((sum, s) => sum + s.count, 0);
    const totalCost = channels.reduce((sum, c) => sum + c.costPerLead * c.leadsGenerated, 0);
    const totalRevenue = totalLeads * 15000; // Assume $15k avg job value

    return {
      period,
      totalLeads,
      totalCost,
      averageCostPerLead: totalLeads > 0 ? totalCost / totalLeads : 0,
      totalRevenue,
      roi: totalCost > 0 ? (totalRevenue - totalCost) / totalCost : 0,
      topChannels: channels.slice(0, 5),
      leadSources: sources,
      campaignStats: [
        {
          name: 'Recent Campaign',
          opens: Math.floor(Math.random() * 500),
          clicks: Math.floor(Math.random() * 100),
          conversions: Math.floor(Math.random() * 10),
        },
      ],
    };
  },
};

// Helper functions
function generateEmailSubject(type: CampaignType): string {
  const subjects: Record<CampaignType, string> = {
    new_service_announcement: 'Introducing Our Latest Electrical Services',
    seasonal_promotion: 'Limited Time: Seasonal Electrical Service Promotion',
    follow_up_sequence: 'Follow Up: Your Electrical Service Inquiry',
    newsletter: 'Monthly Electrical Insights & Tips',
  };
  return subjects[type] || 'From PowerOn Solutions';
}

async function generateEmailContent(type: CampaignType, template: string): Promise<string> {
  const templates: Record<CampaignType, string> = {
    new_service_announcement: `Dear valued customer,

We're excited to announce new electrical services that can help improve your home or business.

${template || 'Learn more about our latest offerings today!'}

Best regards,
PowerOn Solutions`,
    seasonal_promotion: `Special Seasonal Offer!

Take advantage of our limited-time promotion on electrical services.

${template || 'Contact us today for a free estimate!'}

Regards,
PowerOn Solutions`,
    follow_up_sequence: `Thank you for your interest!

We wanted to follow up regarding your recent electrical service inquiry.

${template || 'Let us know if you have any questions.'}

Best regards,
PowerOn Solutions`,
    newsletter: `Monthly Newsletter - Electrical Tips & Insights

${template || 'Stay informed about electrical safety and maintenance.'}

Until next month,
PowerOn Solutions`,
  };

  return templates[type] || template;
}

function generateSocialContent(platform: SocialPlatform, projectData?: any): string {
  const platformContent: Record<SocialPlatform, string> = {
    google_business: `✨ Check out our latest project! Professional electrical work that powers your home. 🏠⚡ #Electrical #PowerOn #ProQuality`,
    yelp: `Another successful project completed! Thank you for choosing PowerOn Solutions for your electrical needs. 🔌✨`,
    instagram: `✨ Lighting up lives one project at a time! 💡 Professional electrical services for homes and businesses. #Electrical #Construction #LocalBusiness`,
    facebook: `We're proud to share another satisfied customer! PowerOn Solutions brings quality electrical work to your community. 🏆⚡`,
    linkedin: `Delivering excellence in commercial electrical services. Our team of expert electricians is committed to quality and safety. 🔧⚡`,
    nextdoor: `Your neighborhood electrician! PowerOn Solutions provides reliable, professional electrical services for your home. ⚡🏠`,
  };

  return platformContent[platform] || 'PowerOn Solutions - Quality Electrical Services';
}

export default {
  emailCampaignsService,
  callTrackingService,
  socialMediaService,
  analyticsService,
};
