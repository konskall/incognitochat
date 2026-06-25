// Reverse-geocode coordinates to a city/area NAME using the keyless OSM Nominatim
// service (same provider as the location-message map tiles). Only the name is ever
// passed on to the AI — never the coordinates. Low volume (only when inco needs a
// location), so Nominatim's usage policy is satisfied by the browser Referer.

export function parseNominatimCity(data: unknown): string | null {
  const a = (data as { address?: Record<string, string> } | null)?.address;
  if (!a || typeof a !== 'object') return null;
  return a.city || a.town || a.village || a.municipality || a.county || a.state || null;
}

export async function reverseGeocodeCity(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10`;
    const resp = await fetch(url, { headers: { 'Accept-Language': navigator.language || 'en' } });
    if (!resp.ok) return null;
    return parseNominatimCity(await resp.json());
  } catch {
    return null;
  }
}
