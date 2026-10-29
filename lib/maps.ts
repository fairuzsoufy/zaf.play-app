// Google Maps links, the same rules as the website's lib/maps.ts.
// Accepts links copied from Google Maps ("Share" → "Copy link"), e.g. https://maps.app.goo.gl/AbCdEf123
export function isValidGoogleMapsUrl(url: string): boolean {
  return /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)(\/|\?|$)/i.test(url.trim());
}

export const MAPS_URL_HELP = 'Open Google Maps, find your court, tap "Share" → "Copy link", and paste it here.';

// Reads the pin from a long Google Maps link. Short links (maps.app.goo.gl/…) hide the position, so they return null.
export function coordsFromMapsUrl(url: string): { lat: number; lng: number } | null {
  const v = url.trim();
  const m = v.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
    || v.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
    || v.match(/[?&](?:q|ll|query|center|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// inside Egypt, like the website's isValidCoords
export const isValidCoords = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= 21.5 && lat <= 31.9 && lng >= 24.5 && lng <= 37;
