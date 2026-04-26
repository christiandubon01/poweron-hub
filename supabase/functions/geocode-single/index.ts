import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geocodeAddress } from "../tlma-scraper/geocoding.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * geocode-single — Thin wrapper for the browser-side Settings UI.
 *
 * The operator enters a home base address in Settings and clicks Save.
 * The frontend calls this function instead of hitting the Google Maps API
 * directly (that would expose the API key to the browser).
 *
 * Usage:
 *   GET /functions/v1/geocode-single?address=1234+Main+St+Palm+Desert+CA
 *
 * Returns:
 *   { status: 'success', lat, lng, formatted_address, place_id }
 *   { status: 'failed' | 'no_results', error?: string }
 */
serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const address = url.searchParams.get("address");

    if (!address || address.trim() === "") {
      return new Response(
        JSON.stringify({ error: "address query param required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const result = await geocodeAddress(address.trim());

    return new Response(JSON.stringify(result), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "failed", error: (err as Error).message }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
