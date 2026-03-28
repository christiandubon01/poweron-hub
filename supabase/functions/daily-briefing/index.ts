/**
 * daily-briefing — Supabase Edge Function for NEXUS Morning Briefing
 *
 * Triggered by pg_cron at 6:30 AM Pacific daily.
 * Gathers overnight data, builds a briefing, and inserts it as
 * an agent_message in NEXUS chat for each active user.
 *
 * pg_cron setup (run once in SQL Editor):
 *   SELECT cron.schedule(
 *     'daily-nexus-briefing',
 *     '30 13 * * *',  -- 6:30 AM Pacific = 13:30 UTC
 *     $$SELECT net.http_post(
 *       url := 'https://edxxbtyugohtowvslbfo.supabase.co/functions/v1/daily-briefing',
 *       headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
 *       body := '{}'::jsonb
 *     )$$
 *   );
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    // Get all active organizations
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, name')

    if (!orgs || orgs.length === 0) {
      return new Response(JSON.stringify({ message: 'No organizations found' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    let briefingsCreated = 0

    for (const org of orgs) {
      // Gather data for the briefing
      const today = new Date().toISOString().split('T')[0]
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

      // 1. Yesterday's field logs
      const { data: logs } = await supabase
        .from('field_logs')
        .select('hours, material_cost, collected, phase, notes, project_id')
        .eq('org_id', org.id)
        .eq('log_date', yesterday)

      const totalHours = (logs || []).reduce((s: number, l: any) => s + (Number(l.hours) || 0), 0)
      const totalMaterials = (logs || []).reduce((s: number, l: any) => s + (Number(l.material_cost) || 0), 0)
      const totalCollected = (logs || []).reduce((s: number, l: any) => s + (Number(l.collected) || 0), 0)

      // 2. Active projects count
      const { count: activeProjects } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', org.id)
        .in('status', ['active', 'in_progress', 'planning'])

      // 3. Upcoming schedule items (today)
      const { data: scheduleItems } = await supabase
        .from('schedule_entries')
        .select('title, start_time')
        .eq('org_id', org.id)
        .gte('start_time', `${today}T00:00:00`)
        .lte('start_time', `${today}T23:59:59`)
        .order('start_time', { ascending: true })
        .limit(5)

      // 4. Overdue invoices
      const { count: overdueCount } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', org.id)
        .eq('status', 'overdue')

      // 5. Material variance alerts
      const { data: variances } = await supabase
        .from('material_receipts')
        .select('variance_pct, phase')
        .eq('org_id', org.id)
        .gt('variance_pct', 15)
        .limit(3)

      // Build briefing text
      const briefingParts: string[] = [
        `**Good morning! Here's your daily briefing for ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.**`,
        '',
      ]

      // Yesterday summary
      if (logs && logs.length > 0) {
        briefingParts.push(`**Yesterday's Activity:** ${logs.length} field logs — ${totalHours.toFixed(1)} hours, $${totalMaterials.toFixed(0)} in materials${totalCollected > 0 ? `, $${totalCollected.toFixed(0)} collected` : ''}.`)
      } else {
        briefingParts.push('**Yesterday:** No field logs recorded.')
      }

      // Active projects
      briefingParts.push(`**Active Projects:** ${activeProjects || 0} projects in progress.`)

      // Today's schedule
      if (scheduleItems && scheduleItems.length > 0) {
        briefingParts.push('')
        briefingParts.push(`**Today's Schedule:**`)
        for (const item of scheduleItems) {
          const time = new Date(item.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          briefingParts.push(`• ${time} — ${item.title}`)
        }
      }

      // Alerts
      const alerts: string[] = []
      if (overdueCount && overdueCount > 0) {
        alerts.push(`${overdueCount} overdue invoice${overdueCount > 1 ? 's' : ''} need attention`)
      }
      if (variances && variances.length > 0) {
        alerts.push(`${variances.length} phase${variances.length > 1 ? 's' : ''} over material budget`)
      }

      if (alerts.length > 0) {
        briefingParts.push('')
        briefingParts.push(`**Alerts:** ${alerts.join('; ')}.`)
      }

      briefingParts.push('')
      briefingParts.push('Ask me anything to dive deeper into any of these areas.')

      const briefingText = briefingParts.join('\n')

      // Get active users for this org
      const { data: users } = await supabase
        .from('profiles')
        .select('id')
        .eq('org_id', org.id)

      // Insert briefing as NEXUS agent message for each user
      for (const user of (users || [])) {
        await supabase
          .from('agent_messages')
          .insert({
            org_id: org.id,
            user_id: user.id,
            agent_name: 'nexus',
            role: 'assistant',
            content: briefingText,
            metadata: {
              type: 'daily_briefing',
              date: today,
              stats: {
                field_logs: logs?.length || 0,
                total_hours: totalHours,
                total_materials: totalMaterials,
                active_projects: activeProjects || 0,
                overdue_invoices: overdueCount || 0,
              },
            },
          })
        briefingsCreated++
      }
    }

    return new Response(
      JSON.stringify({ success: true, briefingsCreated }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[daily-briefing] Error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }
})
