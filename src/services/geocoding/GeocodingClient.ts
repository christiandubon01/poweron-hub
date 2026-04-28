/**
 * GeocodingClient — Browser-side wrapper for geocoding Edge Functions.
 *
 * All Google Maps API calls are server-side only (Supabase Edge Functions).
 * This file never exposes or contains any API key.
 *
 * HUNTER-GEOCODING-DISTANCE-CARDS-APR25-2026-1
 */

import { supabase } from '@/lib/supabase';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? '';
const EDGE_FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

/**
 * Get current user's auth token for calling Edge Functions.
 */
async function getAuthToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

/**
 * Geocode a plain text address via the geocode-single Edge Function.
 * Returns { lat, lng, formatted_address } on success, or null on failure.
 *
 * Used by HomeBaseSettings when the operator saves their shop address.
 */
export async function geocodeAddressViaEdge(
  address: string
): Promise<{ lat: number; lng: number; formatted_address: string } | null> {
  try {
    const token = await getAuthToken();
    const params = new URLSearchParams({ address });
    const resp = await fetch(
      `${EDGE_FUNCTIONS_BASE}/geocode-single?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!resp.ok) return null;

    const data = await resp.json();
    if (data.status === 'success' && typeof data.lat === 'number' && typeof data.lng === 'number') {
      return {
        lat: data.lat,
        lng: data.lng,
        formatted_address: data.formatted_address ?? address,
      };
    }
    return null;
  } catch (err) {
    console.error('[GeocodingClient] geocodeAddressViaEdge error:', err);
    return null;
  }
}

/**
 * Trigger geocoding backfill for all pending/failed leads for a tenant.
 * Returns { processed, succeeded, failed, skipped, remaining } counts.
 *
 * Used by HomeBaseSettings after the operator saves their home base address.
 */
export async function triggerGeocodingBackfill(
  tenantId: string
): Promise<{ processed: number; succeeded: number; failed: number; skipped: number; remaining: number }> {
  try {
    const token = await getAuthToken();
    const params = new URLSearchParams({ tenant_id: tenantId });
    const resp = await fetch(
      `${EDGE_FUNCTIONS_BASE}/geocode-backfill?${params.toString()}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!resp.ok) {
      return { processed: 0, succeeded: 0, failed: 0, skipped: 0, remaining: 0 };
    }

    const data = await resp.json();
    return {
      processed: data.processed ?? 0,
      succeeded: data.succeeded ?? 0,
      failed: data.failed ?? 0,
      skipped: data.skipped ?? 0,
      remaining: data.remaining ?? 0,
    };
  } catch (err) {
    console.error('[GeocodingClient] triggerGeocodingBackfill error:', err);
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0, remaining: 0 };
  }
}
