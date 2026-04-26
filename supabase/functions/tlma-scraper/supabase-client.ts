import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import type { HunterLeadRow } from "./types.ts";
import {
  geocodeAddress,
  haversineDistanceMiles,
  buildAddressForGeocoding,
} from "./geocoding.ts";

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment"
    );
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Fields from hunter_leads that we track for revision diffing.
// Must exactly match the CHECK constraint on hunter_lead_revisions.field_name.
const TRACKED_FIELDS = [
  "permit_status",
  "total_sqft",
  "issued_date",
  "finalized_date",
  "expired_date",
  "description",
  "contact_name",
  "contact_company",
  "phone",
  "email",
  "work_class_code",
  "sqft_breakdown",
  "estimated_value",
] as const;

type TrackedField = (typeof TRACKED_FIELDS)[number];

// Map from tracker field name → HunterLeadRow field name (if they differ)
const FIELD_MAP: Partial<Record<TrackedField, keyof HunterLeadRow>> = {
  description: "description",
  contact_name: "contact_name",
  contact_company: "contact_company",
  phone: "phone",
  email: "email",
};

function toText(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

/**
 * Reads tenant_settings for setting_key='home_base_address' and returns
 * { lat, lng } if available, otherwise null.
 */
export async function getHomeBaseLatLng(
  client: SupabaseClient,
  tenantId: string
): Promise<{ lat: number; lng: number } | null> {
  try {
    const { data, error } = await client
      .from("tenant_settings")
      .select("setting_value")
      .eq("tenant_id", tenantId)
      .eq("setting_key", "home_base_address")
      .maybeSingle();

    if (error || !data) return null;

    const val = data.setting_value;
    if (
      val &&
      typeof val.lat === "number" &&
      typeof val.lng === "number"
    ) {
      return { lat: val.lat, lng: val.lng };
    }
    return null;
  } catch {
    return null;
  }
}

export async function upsertLead(
  client: SupabaseClient,
  row: HunterLeadRow
): Promise<{ action: "insert" | "update" | "unchanged"; lead_id: string; revisions_written: number }> {
  // 0. Geocoding — enrich row with lat/lng + distance before upsert
  const addressText = buildAddressForGeocoding(row.address, row.city);

  if (!addressText) {
    row.geocoding_status = 'skipped';
  } else {
    const geocodeResult = await geocodeAddress(addressText);

    if (geocodeResult.status === 'success') {
      row.latitude = geocodeResult.lat;
      row.longitude = geocodeResult.lng;
      row.geocoded_at = new Date().toISOString();
      row.geocoding_status = 'success';

      // Calculate distance from home base if available
      const homeBase = await getHomeBaseLatLng(client, row.tenant_id);
      if (homeBase) {
        row.distance_from_base_miles = haversineDistanceMiles(
          homeBase.lat, homeBase.lng,
          geocodeResult.lat, geocodeResult.lng
        );
      }
    } else if (geocodeResult.status === 'no_results') {
      row.geocoding_status = 'failed';
    } else {
      // failed (API error, key missing, etc.)
      row.geocoding_status = 'failed';
    }
  }

  // 1. Look for existing row
  const { data: existing, error: selectError } = await client
    .from("hunter_leads")
    .select(
      "id, permit_status, total_sqft, issued_date, finalized_date, expired_date, description, contact_name, contact_company, phone, email, work_class_code, sqft_breakdown, estimated_value"
    )
    .eq("tenant_id", row.tenant_id)
    .eq("permit_number", row.permit_number)
    .maybeSingle();

  if (selectError) {
    throw new Error(
      `upsertLead SELECT failed for permit ${row.permit_number}: ${selectError.message}`
    );
  }

  // 2. No existing row → INSERT
  if (!existing) {
    const { data: inserted, error: insertError } = await client
      .from("hunter_leads")
      .insert(row)
      .select("id")
      .single();

    if (insertError || !inserted) {
      throw new Error(
        `upsertLead INSERT failed for permit ${row.permit_number}: ${
          insertError?.message ?? "no data returned"
        }`
      );
    }

    return { action: "insert", lead_id: inserted.id, revisions_written: 0 };
  }

  // 3. Existing row → diff and update
  const leadId: string = existing.id;
  const changedFields: Partial<Record<string, unknown>> = {};
  const revisionRows: Array<{
    tenant_id: string;
    lead_id: string;
    field_name: string;
    old_value: string;
    new_value: string;
    source: string;
  }> = [];

  for (const field of TRACKED_FIELDS) {
    // Map to the corresponding field in the incoming row
    let newVal: unknown;
    switch (field) {
      case "permit_status":
        newVal = row.permit_status;
        break;
      case "total_sqft":
        newVal = row.total_sqft;
        break;
      case "issued_date":
        newVal = row.issued_date;
        break;
      case "finalized_date":
        newVal = row.finalized_date;
        break;
      case "expired_date":
        newVal = row.expired_date;
        break;
      case "description":
        newVal = row.description;
        break;
      case "contact_name":
        newVal = row.contact_name;
        break;
      case "contact_company":
        newVal = row.contact_company;
        break;
      case "phone":
        newVal = row.phone;
        break;
      case "email":
        newVal = row.email;
        break;
      case "work_class_code":
        newVal = row.work_class_code;
        break;
      case "sqft_breakdown":
        newVal = row.sqft_breakdown;
        break;
      case "estimated_value":
        newVal = row.estimated_value;
        break;
      default:
        continue;
    }

    const oldText = toText(existing[field]);
    const newText = toText(newVal);

    if (oldText !== newText) {
      changedFields[field] = newVal;
      revisionRows.push({
        tenant_id: row.tenant_id,
        lead_id: leadId,
        field_name: field,
        old_value: oldText,
        new_value: newText,
        source: "tlma_scraper",
      });
    }
  }

  let revisionsWritten = 0;

  if (revisionRows.length > 0) {
    // Write revisions
    const { error: revError } = await client
      .from("hunter_lead_revisions")
      .insert(revisionRows);

    if (revError) {
      throw new Error(
        `upsertLead revision INSERT failed for permit ${row.permit_number}: ${revError.message}`
      );
    }
    revisionsWritten = revisionRows.length;

    // Update changed fields + bump revision_count + last_seen_at
    const { error: updateError } = await client
      .from("hunter_leads")
      .update({
        ...changedFields,
        last_seen_at: new Date().toISOString(),
        revision_count: (existing.revision_count ?? 0) + revisionRows.length,
      })
      .eq("id", leadId);

    if (updateError) {
      throw new Error(
        `upsertLead UPDATE (with changes) failed for permit ${row.permit_number}: ${updateError.message}`
      );
    }

    return { action: "update", lead_id: leadId, revisions_written: revisionsWritten };
  }

  // No changes — just touch last_seen_at
  const { error: touchError } = await client
    .from("hunter_leads")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", leadId);

  if (touchError) {
    throw new Error(
      `upsertLead UPDATE (last_seen_at) failed for permit ${row.permit_number}: ${touchError.message}`
    );
  }

  return { action: "unchanged", lead_id: leadId, revisions_written: 0 };
}
