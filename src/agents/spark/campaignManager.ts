import { supabase } from '@/lib/supabase'

export type CampaignType = 'social_media' | 'email_blast' | 'referral_program' | 'trade_show' | 'in_person_event' | 'retargeting' | 'other'

export interface Campaign {
  id: string
  org_id: string
  name: string
  campaign_type: CampaignType
  start_date: string
  end_date?: string
  budget?: number
  status: string
  created_at: string
}

export interface CampaignROI {
  campaign_id: string
  campaign_name: string
  budget: number
  total_leads: number
  won_leads: number
  revenue_from_leads: number
  roi_pct: number
}

export async function getCampaigns(orgId: string): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from('campaigns' as never)
    .select('*')
    .eq('org_id', orgId)
    .order('start_date', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as Campaign[]
}

export async function createCampaign(orgId: string, campaign: Partial<Campaign>): Promise<Campaign> {
  const { data, error } = await supabase
    .from('campaigns' as never)
    .insert({
      org_id: orgId,
      name: campaign.name,
      campaign_type: campaign.campaign_type || 'other',
      start_date: campaign.start_date || new Date().toISOString().split('T')[0],
      end_date: campaign.end_date || null,
      budget: campaign.budget || 0,
      status: 'planning',
    } as never)
    .select()
    .single()

  if (error) throw error
  return data as unknown as Campaign
}

export async function calculateCampaignROI(campaignId: string): Promise<CampaignROI> {
  // Get campaign
  const { data: campaign, error: campError } = await supabase
    .from('campaigns' as never)
    .select('*')
    .eq('id', campaignId)
    .single()

  if (campError) throw campError
  const camp = campaign as unknown as Campaign

  // Get attributed leads
  const { data: campaignLeads, error: clError } = await supabase
    .from('campaign_leads' as never)
    .select('lead_id, revenue_from_lead')
    .eq('campaign_id', campaignId)

  if (clError) throw clError
  const cls = (campaignLeads ?? []) as unknown as Array<{ lead_id: string; revenue_from_lead: number | null }>

  // Get lead statuses
  const leadIds = cls.map(cl => cl.lead_id)
  let wonCount = 0
  if (leadIds.length > 0) {
    const { data: leads, error: leadError } = await supabase
      .from('leads' as never)
      .select('id, status')
      .in('id', leadIds)

    if (leadError) throw leadError
    wonCount = ((leads ?? []) as unknown as Array<{ status: string }>).filter(l => l.status === 'won').length
  }

  const totalRevenue = cls.reduce((sum, cl) => sum + (cl.revenue_from_lead ?? 0), 0)
  const budget = camp.budget ?? 0
  const roi_pct = budget > 0 ? ((totalRevenue - budget) / budget) * 100 : 0

  return {
    campaign_id: campaignId,
    campaign_name: camp.name,
    budget,
    total_leads: cls.length,
    won_leads: wonCount,
    revenue_from_leads: totalRevenue,
    roi_pct: parseFloat(roi_pct.toFixed(1)),
  }
}
