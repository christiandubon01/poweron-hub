import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function deriveFullName(user: any): string {
  const metadataName = String(user?.user_metadata?.full_name ?? '').trim()
  if (metadataName) return metadataName
  const email = String(user?.email ?? '').trim()
  const local = email.includes('@') ? email.split('@')[0] : email
  return local || 'Owner'
}

function buildWorkspaceName(user: any): string {
  return `${deriveFullName(user)}'s Organization`
}

function buildSlugBase(user: any): string {
  const email = String(user?.email ?? '').trim().toLowerCase()
  const local = email.includes('@') ? email.split('@')[0] : email
  const sanitized = local.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized || 'org'
}

async function buildUniqueSlug(admin: any, user: any): Promise<string> {
  const base = buildSlugBase(user)
  let suffix = 0

  while (suffix < 50) {
    const candidate = suffix === 0 ? `${base}-org` : `${base}-org-${suffix}`
    const { data, error } = await admin
      .from('organizations')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle()

    if (error) throw error
    if (!data?.id) return candidate
    suffix += 1
  }

  return `${base}-org-${String(user?.id ?? '').slice(0, 8) || Date.now()}`
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json(401, { error: 'Missing authorization header' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: 'Supabase Edge Function secrets are not configured.' })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()

  try {
    const { data: authData, error: authError } = await admin.auth.getUser(token)
    const user = authData?.user
    if (authError || !user) {
      return json(401, { error: 'Invalid or expired token' })
    }

    const { data: existingProfile, error: existingProfileError } = await admin
      .from('profiles')
      .select('id, org_id, full_name, role, is_active, passcode_hash, biometric_enabled')
      .eq('id', user.id)
      .maybeSingle()

    if (existingProfileError) {
      return json(500, { error: existingProfileError.message })
    }

    if (existingProfile?.id && existingProfile?.org_id) {
      return json(200, {
        createdOrganization: false,
        createdProfile: false,
        reusedOrganization: true,
        profile: existingProfile,
      })
    }

    const { data: existingOrganizations, error: existingOrganizationsError } = await admin
      .from('organizations')
      .select('id, owner_id, created_at')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true })
      .limit(2)

    if (existingOrganizationsError) {
      return json(500, { error: existingOrganizationsError.message })
    }

    let organizationId = existingOrganizations?.[0]?.id ?? null
    let createdOrganization = false

    if (!organizationId) {
      const slug = await buildUniqueSlug(admin, user)
      const { data: createdOrganizationRow, error: createOrganizationError } = await admin
        .from('organizations')
        .insert({
          name: buildWorkspaceName(user),
          slug,
          owner_id: user.id,
        })
        .select('id')
        .single()

      if (createOrganizationError || !createdOrganizationRow?.id) {
        return json(500, {
          error: createOrganizationError?.message ?? 'Could not create contractor workspace.',
        })
      }

      organizationId = createdOrganizationRow.id
      createdOrganization = true
    }

    const profilePayload = {
      id: user.id,
      org_id: organizationId,
      full_name: deriveFullName(user),
      role: 'owner',
      passcode_hash: 'password_only',
      is_active: true,
      biometric_enabled: false,
    }

    const { data: createdProfile, error: createProfileError } = await admin
      .from('profiles')
      .insert(profilePayload)
      .select('id, org_id, full_name, role, is_active, passcode_hash, biometric_enabled')
      .single()

    if (createProfileError) {
      const { data: recoveredProfile, error: recoveredProfileError } = await admin
        .from('profiles')
        .select('id, org_id, full_name, role, is_active, passcode_hash, biometric_enabled')
        .eq('id', user.id)
        .maybeSingle()

      if (recoveredProfileError || !recoveredProfile?.id || !recoveredProfile?.org_id) {
        return json(500, { error: createProfileError.message })
      }

      return json(200, {
        createdOrganization,
        createdProfile: false,
        reusedOrganization: !createdOrganization,
        profile: recoveredProfile,
      })
    }

    return json(200, {
      createdOrganization,
      createdProfile: true,
      reusedOrganization: !createdOrganization,
      profile: createdProfile,
    })
  } catch (err) {
    console.error('[bootstrap-owner-workspace] Error:', err)
    return json(500, {
      error: err instanceof Error ? err.message : 'Internal server error',
    })
  }
})
