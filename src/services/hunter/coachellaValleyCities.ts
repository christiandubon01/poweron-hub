// HUNTER-5D: Coachella Valley city allowlist for the Zone "Focus: Coachella
// Valley" view. City-based match only — works even for pending-geocode leads
// since it does not depend on lat/lng or distance.
export const COACHELLA_VALLEY_CITIES = [
  'Desert Hot Springs',
  'Palm Springs',
  'Cathedral City',
  'Rancho Mirage',
  'Palm Desert',
  'Indian Wells',
  'La Quinta',
  'Indio',
  'Coachella',
  'Thermal',
  'Mecca',
  'Thousand Palms',
  'Bermuda Dunes',
  'North Palm Springs',
  'Sky Valley',
  'Desert Edge',
]

const COACHELLA_VALLEY_CITY_SET = new Set(
  COACHELLA_VALLEY_CITIES.map((city) => city.toLowerCase().trim()),
)

export function isCoachellaValleyCity(city: string | null | undefined): boolean {
  const normalized = city?.toLowerCase().trim()
  if (!normalized) return false
  return COACHELLA_VALLEY_CITY_SET.has(normalized)
}
