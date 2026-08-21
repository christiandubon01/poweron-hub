// @ts-nocheck
/**
 * netlify/functions/quickbooks/qboRepos.ts
 *
 * Supabase-backed adapters implementing the pure QboStateRepo and
 * QboConnectionRepo interfaces against public.quickbooks_oauth_states and
 * public.quickbooks_connections. SERVER-ONLY: the client passed in MUST be a
 * service-role client (SUPABASE_SERVICE_ROLE_KEY) so RLS is bypassed — these
 * token-bearing tables deliberately have NO authenticated RLS policies and the
 * browser has no direct CRUD path to them.
 *
 * All camelCase interface fields are mapped to/from the snake_case DB columns here,
 * keeping the pure service modules database-agnostic and unit-testable.
 */
import type { QboStateRepo, QboStateRow } from '../../../src/services/quickbooks/quickbooksOauthStateStore'
import type {
  QboConnectionRepo,
  QboConnectionRow,
  QboRefreshUpdateFields,
  QboUpsertConnectionInput,
} from '../../../src/services/quickbooks/quickbooksConnectionStore'

function mapStateRow(r: any): QboStateRow {
  return {
    id: r.id,
    organizationId: r.organization_id,
    userId: r.user_id,
    returnPath: r.return_path ?? null,
    expiresAt: r.expires_at,
    consumedAt: r.consumed_at ?? null,
  }
}

function mapConnectionRow(r: any): QboConnectionRow {
  return {
    id: r.id,
    organizationId: r.organization_id,
    status: r.status,
    connectedAt: r.connected_at ?? null,
    disconnectedAt: r.disconnected_at ?? null,
    connectedBy: r.connected_by ?? null,
    environment: r.environment,
    companyName: r.company_name ?? null,
    encryptedAccessToken: r.encrypted_access_token ?? null,
    encryptedRefreshToken: r.encrypted_refresh_token ?? null,
    encryptedRealmId: r.encrypted_realm_id ?? null,
    accessTokenExpiresAt: r.access_token_expires_at ?? null,
    refreshTokenExpiresAt: r.refresh_token_expires_at ?? null,
    lastRefreshedAt: r.last_refreshed_at ?? null,
    tokenVersion: r.token_version ?? 0,
  }
}

/** Build a Supabase-backed state repo from a service-role client. */
export function createStateRepo(client: any): QboStateRepo {
  return {
    async insertState(row) {
      const { error } = await client.from('quickbooks_oauth_states').insert({
        nonce_hash: row.nonceHash,
        organization_id: row.organizationId,
        user_id: row.userId,
        return_path: row.returnPath,
        expires_at: row.expiresAt,
      })
      if (error) throw new Error('Failed to persist QuickBooks OAuth state.')
    },

    async consumeState(nonceHash, now) {
      // Atomic compare-and-set: only an unconsumed, not-yet-expired row matches.
      const { data, error } = await client
        .from('quickbooks_oauth_states')
        .update({ consumed_at: now })
        .eq('nonce_hash', nonceHash)
        .is('consumed_at', null)
        .gt('expires_at', now)
        .select('id, organization_id, user_id, return_path, expires_at, consumed_at')
        .maybeSingle()
      if (error) throw new Error('Failed to consume QuickBooks OAuth state.')
      if (!data) return null
      return mapStateRow(data)
    },

    async pruneStates(now) {
      await client.from('quickbooks_oauth_states').delete().lt('expires_at', now)
    },
  }
}

/** Build a Supabase-backed connection repo from a service-role client. */
export function createConnectionRepo(client: any): QboConnectionRepo {
  return {
    async upsertConnection(input: QboUpsertConnectionInput, now: string): Promise<QboConnectionRow> {
      // created_at is intentionally omitted so the default applies on insert and
      // the original value is preserved on conflict (merge-duplicates).
      const payload = {
        organization_id: input.organizationId,
        created_by: input.userId,
        connected_by: input.userId,
        status: 'connected',
        connected_at: now,
        disconnected_at: null,
        environment: input.environment,
        company_name: input.companyName,
        encrypted_access_token: input.encryptedAccessToken,
        encrypted_refresh_token: input.encryptedRefreshToken,
        encrypted_realm_id: input.encryptedRealmId,
        access_token_expires_at: input.accessTokenExpiresAt,
        refresh_token_expires_at: input.refreshTokenExpiresAt,
        last_refreshed_at: null,
        token_version: 0,
      }
      const { data, error } = await client
        .from('quickbooks_connections')
        .upsert(payload, { onConflict: 'organization_id' })
        .select('*')
        .maybeSingle()
      if (error || !data) throw new Error('Failed to persist QuickBooks connection.')
      return mapConnectionRow(data)
    },

    async loadConnection(organizationId: string): Promise<QboConnectionRow | null> {
      const { data, error } = await client
        .from('quickbooks_connections')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle()
      if (error) throw new Error('Failed to load QuickBooks connection.')
      if (!data) return null
      return mapConnectionRow(data)
    },

    async applyRefreshResult(
      organizationId: string,
      expectedTokenVersion: number,
      fields: QboRefreshUpdateFields,
      now: string,
    ): Promise<number | null> {
      // Compare-and-set: only the row whose token_version still equals the
      // expected value is updated. Zero rows => another refresh won the race.
      const { data, error } = await client
        .from('quickbooks_connections')
        .update({
          encrypted_access_token: fields.encryptedAccessToken,
          encrypted_refresh_token: fields.encryptedRefreshToken,
          access_token_expires_at: fields.accessTokenExpiresAt,
          refresh_token_expires_at: fields.refreshTokenExpiresAt,
          last_refreshed_at: fields.lastRefreshedAt,
          token_version: expectedTokenVersion + 1,
        })
        .eq('organization_id', organizationId)
        .eq('token_version', expectedTokenVersion)
        .select('token_version')
        .maybeSingle()
      if (error) throw new Error('Failed to persist QuickBooks token refresh.')
      if (!data) return null
      return data.token_version
    },

    async markDisconnected(organizationId: string, now: string): Promise<void> {
      // Clear all provider credentials + expiry; preserve company_name,
      // connected_at, and environment as safe audit/display metadata.
      const { error } = await client
        .from('quickbooks_connections')
        .update({
          status: 'disconnected',
          disconnected_at: now,
          connected_by: null,
          encrypted_access_token: null,
          encrypted_refresh_token: null,
          encrypted_realm_id: null,
          access_token_expires_at: null,
          refresh_token_expires_at: null,
          last_refreshed_at: null,
        })
        .eq('organization_id', organizationId)
      if (error) throw new Error('Failed to mark QuickBooks connection disconnected.')
    },
  }
}