import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  geocodeAddress,
  haversineDistanceMiles,
  buildAddressForGeocoding,
} from "../tlma-scraper/geocoding.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenant_id");

    if (!tenantId) {
      return new Response(
        JSON.stringify({ error: "tenant_id query param required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Create service-role client for DB access
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Read home base lat/lng from tenant_settings
    let homeBase: { lat: number; lng: number } | null = null;
    try {
      const { data: settingData } = await client
        .from("tenant_settings")
        .select("setting_value")
        .eq("tenant_id", tenantId)
        .eq("setting_key", "home_base_address")
        .maybeSingle();

      if (settingData?.setting_value) {
        const val = settingData.setting_value;
        if (typeof val.lat === "number" && typeof val.lng === "number") {
          homeBase = { lat: val.lat, lng: val.lng };
        }
      }
    } catch {
      // Home base missing — distances will be null; proceed
    }

    // 2. Query pending/failed leads (batch of 100)
    const { data: leads, error: leadsError } = await client
      .from("hunter_leads")
      .select("id, address, city, geocoding_status")
      .eq("tenant_id", tenantId)
      .in("geocoding_status", ["pending", "failed"])
      .limit(100);

    if (leadsError) {
      return new Response(
        JSON.stringify({ error: leadsError.message }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const toProcess = leads ?? [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    // 3. Process each lead
    for (const lead of toProcess) {
      const addressText = buildAddressForGeocoding(
        lead.address ?? null,
        lead.city ?? null
      );

      if (!addressText) {
        // No address — mark skipped
        await client
          .from("hunter_leads")
          .update({ geocoding_status: "skipped" })
          .eq("id", lead.id);
        skipped++;
        continue;
      }

      const geocodeResult = await geocodeAddress(addressText);

      if (geocodeResult.status === "success") {
        const updatePayload: Record<string, unknown> = {
          latitude: geocodeResult.lat,
          longitude: geocodeResult.lng,
          geocoded_at: new Date().toISOString(),
          geocoding_status: "success",
        };

        if (homeBase) {
          updatePayload.distance_from_base_miles = haversineDistanceMiles(
            homeBase.lat, homeBase.lng,
            geocodeResult.lat, geocodeResult.lng
          );
        }

        await client
          .from("hunter_leads")
          .update(updatePayload)
          .eq("id", lead.id);

        succeeded++;
      } else {
        await client
          .from("hunter_leads")
          .update({ geocoding_status: "failed" })
          .eq("id", lead.id);
        failed++;
      }

      // Polite 100ms delay between geocoding calls
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // 4. Count remaining
    const { count: remaining } = await client
      .from("hunter_leads")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("geocoding_status", ["pending", "failed"]);

    const result = {
      processed: toProcess.length,
      succeeded,
      failed,
      skipped,
      remaining: remaining ?? 0,
      hint: (remaining ?? 0) > 0
        ? "Re-invoke this function to process the next batch."
        : "All leads processed.",
    };

    return new Response(JSON.stringify(result), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
