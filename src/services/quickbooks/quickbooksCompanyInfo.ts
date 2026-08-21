/**
 * src/services/quickbooks/quickbooksCompanyInfo.ts
 *
 * SERVER-ONLY QuickBooks CompanyInfo read — display metadata only.
 *
 * After a successful token exchange, the connected company's display name is
 * retrieved so the QuickBooks menu can show a friendly name instead of a realmId.
 * This is DISPLAY METADATA ONLY: no accounting data is imported, no customers,
 * no invoices, no payments, no ledger. The QBO-1A2 financial-authority firewall
 * stays fully intact.
 *
 * Failure-tolerant by design: if the CompanyInfo lookup fails for any reason
 * (provider error, network, parse, sandbox quirk), this returns null. The caller
 * MUST NOT lose valid tokens or fail the connection because optional display
 * metadata could not be fetched — the connection is still saved with
 * company_name = null and the UI shows a sanitized fallback.
 *
 * Network is injected (QboFetchLike) so logic is testable without a network and
 * without referencing global fetch in browser-bundled code.
 */
import {
  QBO_API_BASE_PRODUCTION,
  QBO_API_BASE_SANDBOX,
  QBO_API_MINOR_VERSION,
} from './quickbooksConstants'
import type { QboApiEnvironment } from './quickbooksTypes'
import type { QboFetchLike } from './quickbooksOAuth'

/** Resolve the QBO accounting API base URL for an environment. */
export function qboApiBaseUrl(environment: QboApiEnvironment): string {
  return environment === 'sandbox' ? QBO_API_BASE_SANDBOX : QBO_API_BASE_PRODUCTION
}

function companyInfoUrl(environment: QboApiEnvironment, realmId: string): string {
  const base = qboApiBaseUrl(environment)
  const query = 'select * from CompanyInfo'
  const params = new URLSearchParams({
    query,
    minorversion: String(QBO_API_MINOR_VERSION),
  })
  return `${base}/v3/company/${encodeURIComponent(realmId)}/query?${params.toString()}`
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }
}

/**
 * Fetch the connected company's display name. Returns the name on success, or
 * null on ANY failure. Never throws — the caller must not lose tokens because
 * optional metadata could not be fetched. Never logs or returns token material.
 */
export async function fetchCompanyName(
  accessToken: string,
  realmId: string,
  environment: QboApiEnvironment,
  fetchImpl: QboFetchLike,
): Promise<string | null> {
  try {
    const res = await fetchImpl(companyInfoUrl(environment, realmId), {
      method: 'GET',
      headers: authHeaders(accessToken),
      body: '',
    })
    if (!res.ok) return null
    const json = (await res.json()) as Record<string, unknown>
    const queryResponse = json?.QueryResponse as Record<string, unknown> | undefined
    const companyInfo = queryResponse?.CompanyInfo as Record<string, unknown> | undefined
    const name = companyInfo?.CompanyName
    return typeof name === 'string' && name.trim() ? name.trim() : null
  } catch {
    return null
  }
}