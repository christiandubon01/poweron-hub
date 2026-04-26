/**
 * Distance formatting helpers.
 * Pure functions — no I/O, no API calls.
 *
 * HUNTER-GEOCODING-DISTANCE-CARDS-APR25-2026-1
 */

export function formatDistance(miles: number | null | undefined): string {
  if (miles == null) return '—';
  if (miles < 1) return '<1 mi';
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

export function estimateDriveTimeMinutes(miles: number): number {
  // Coachella Valley average mix of freeway + surface streets
  return Math.round((miles / 35) * 60); // 35mph average
}

export function formatDriveTime(miles: number | null | undefined): string {
  if (miles == null) return '—';
  const mins = estimateDriveTimeMinutes(miles);
  if (mins < 60) return `~${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainder = mins % 60;
  return `~${hrs}h${remainder > 0 ? ` ${remainder}m` : ''}`;
}
