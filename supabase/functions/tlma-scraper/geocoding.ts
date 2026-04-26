export interface GeocodeResult {
  lat: number;
  lng: number;
  formatted_address: string;
  place_id: string;
  status: 'success' | 'failed' | 'no_results';
  error?: string;
}

/**
 * Geocode an address string via Google Maps Geocoding API.
 * Reads GOOGLE_MAPS_API_KEY from Deno env.
 *
 * If API key is missing or call fails, returns failed status without throwing.
 * Caller should fall back gracefully (e.g., insert lead without geocoding).
 */
export async function geocodeAddress(addressText: string): Promise<GeocodeResult> {
  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!apiKey) {
    return {
      lat: 0, lng: 0, formatted_address: '', place_id: '',
      status: 'failed',
      error: 'GOOGLE_MAPS_API_KEY not set in env'
    };
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', addressText);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('region', 'us');
    url.searchParams.set('components', 'country:US|administrative_area:CA');

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      return {
        lat: 0, lng: 0, formatted_address: '', place_id: '',
        status: 'failed',
        error: `HTTP ${resp.status}`
      };
    }
    const data = await resp.json();

    if (data.status === 'ZERO_RESULTS') {
      return { lat: 0, lng: 0, formatted_address: '', place_id: '', status: 'no_results' };
    }
    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      return {
        lat: 0, lng: 0, formatted_address: '', place_id: '',
        status: 'failed',
        error: `Google API status: ${data.status}`
      };
    }

    const result = data.results[0];
    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formatted_address: result.formatted_address,
      place_id: result.place_id,
      status: 'success'
    };
  } catch (err) {
    return {
      lat: 0, lng: 0, formatted_address: '', place_id: '',
      status: 'failed',
      error: (err as Error).message
    };
  }
}

/**
 * Calculate Haversine distance between two lat/lng points, in miles.
 * Pure function, no I/O. Used for distance_from_base_miles.
 */
export function haversineDistanceMiles(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100; // 2 decimal places
}

/**
 * Build a clean address string for geocoding from a TLMA permit's fields.
 * TLMA gives us street_name and city; we add ", Riverside County, CA" for
 * accuracy in unincorporated areas.
 */
export function buildAddressForGeocoding(
  streetName: string | null,
  city: string | null
): string | null {
  if (!streetName || streetName.trim() === '') return null;
  const cityPart = city && city.trim() ? `, ${city}, ` : ', ';
  return `${streetName.trim()}${cityPart}Riverside County, CA`;
}
