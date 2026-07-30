import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SIGNED_URL_TTL_SECONDS = 600
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // Include supabase-js browser platform headers. Without them, browsers complete
  // OPTIONS with 200 then abort the real POST ("Failed to fetch") because
  // functions.invoke sends X-Supabase-Client-Platform* on the preflight.
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type JsonBody = {
  assignment_id?: unknown
  snapshot_id?: unknown
}

type AssignmentRow = {
  id: string
  org_id: string
  assigned_employee_ids: string[]
}

type AttachmentRow = {
  display_order: number
  caption_override: string | null
  attached_at: string
  blueprint_snapshots: {
    id: string
    caption: string | null
    page_number: number | null
    width: number
    height: number
    mime_type: string
    storage_path: string
  } | null
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: corsHeaders,
    })
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  try {
    const authorization = req.headers.get('authorization') ?? ''
    const jwt = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!jwt) {
      return json(401, { error: 'Authentication required' })
    }

    let body: JsonBody
    try {
      body = await req.json()
    } catch {
      return json(400, { error: 'Invalid JSON body' })
    }

    if (!isUuid(body.assignment_id)) {
      return json(400, { error: 'Valid assignment_id is required' })
    }
    if (body.snapshot_id != null && !isUuid(body.snapshot_id)) {
      return json(400, { error: 'Valid snapshot_id is required' })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json(500, { error: 'Server configuration error' })
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })

    const { data: authData, error: authError } = await userClient.auth.getUser(jwt)
    if (authError || !authData.user) {
      return json(401, { error: 'Authentication required' })
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: assignment, error: assignmentError } = await serviceClient
      .from('employee_task_assignments')
      .select('id, org_id, assigned_employee_ids')
      .eq('id', body.assignment_id)
      .maybeSingle<AssignmentRow>()

    if (assignmentError) {
      return json(500, { error: 'Unable to load assignment' })
    }

    if (!assignment) {
      return json(404, { error: 'Assignment not found' })
    }

    const userId = authData.user.id

    const { data: ownerAdmin, error: ownerAdminError } = await serviceClient
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .eq('org_id', assignment.org_id)
      .in('role', ['owner', 'admin'])
      .maybeSingle()

    if (ownerAdminError) {
      return json(500, { error: 'Unable to verify authorization' })
    }

    let authorized = Boolean(ownerAdmin)

    if (!authorized) {
      const { data: employeeProfile, error: employeeError } = await serviceClient
        .from('employee_profiles')
        .select('id')
        .eq('user_id', userId)
        .eq('org_id', assignment.org_id)
        .eq('active', true)
        .in('id', assignment.assigned_employee_ids)
        .maybeSingle()

      if (employeeError) {
        return json(500, { error: 'Unable to verify authorization' })
      }

      authorized = Boolean(employeeProfile)
    }

    if (!authorized) {
      return json(403, { error: 'Not authorized' })
    }

    let attachmentQuery = serviceClient
      .from('assignment_snapshots')
      .select(`
        display_order,
        caption_override,
        attached_at,
        blueprint_snapshots!inner (
          id,
          caption,
          page_number,
          width,
          height,
          mime_type,
          storage_path
        )
      `)
      .eq('assignment_id', assignment.id)
      .eq('org_id', assignment.org_id)
      .order('display_order', { ascending: true })
      .order('attached_at', { ascending: true })
      .returns<AttachmentRow[]>()

    if (isUuid(body.snapshot_id)) {
      attachmentQuery = attachmentQuery.eq('snapshot_id', body.snapshot_id)
    }

    const { data: attachments, error: attachmentError } = await attachmentQuery

    if (attachmentError) {
      return json(500, { error: 'Unable to load snapshots' })
    }

    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString()
    const snapshots = []

    const orderedAttachments = [...(attachments ?? [])].sort((left, right) => {
      const order = left.display_order - right.display_order
      if (order !== 0) return order
      const attachedAt = left.attached_at.localeCompare(right.attached_at)
      if (attachedAt !== 0) return attachedAt
      return (left.blueprint_snapshots?.id ?? '').localeCompare(right.blueprint_snapshots?.id ?? '')
    })

    for (const attachment of orderedAttachments) {
      const snapshot = attachment.blueprint_snapshots
      if (!snapshot?.storage_path) continue

      const { data: signed, error: signError } = await serviceClient.storage
        .from('blueprint-snapshots')
        .createSignedUrl(snapshot.storage_path, SIGNED_URL_TTL_SECONDS)

      if (signError || !signed?.signedUrl) {
        return json(502, { error: 'Unable to sign snapshot URL' })
      }

      snapshots.push({
        id: snapshot.id,
        caption: snapshot.caption,
        caption_override: attachment.caption_override,
        page_number: snapshot.page_number,
        width: snapshot.width,
        height: snapshot.height,
        mime_type: snapshot.mime_type,
        display_order: attachment.display_order,
        signed_url: signed.signedUrl,
        expires_at: expiresAt,
      })
    }

    return json(200, {
      assignment_id: assignment.id,
      expires_in: SIGNED_URL_TTL_SECONDS,
      snapshots,
    })
  } catch {
    return json(500, { error: 'Unexpected error' })
  }
})
