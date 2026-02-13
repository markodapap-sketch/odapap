/**
 * Geolocation Helper – Oda Pap
 * Uses the browser Geolocation API to detect the user's position,
 * then reverse-geocodes via the free Nominatim / OpenStreetMap service
 * to fill in county / sub-county / ward fields.
 *
 * Privacy-compliant:
 *  • Only runs on explicit user action (button click).
 *  • Never stores or transmits raw coordinates to our servers
 *    (coords are only sent to the free OSM Nominatim API once).
 *  • No background tracking – single one-shot request.
 *  • Falls back gracefully when permission is denied.
 */

/**
 * Detect the user's precise location.
 * Returns { lat, lng, display_name, county, subcounty, ward, ... }
 * or throws with a user-friendly message.
 */
export async function detectLocation() {
  // 1. Check browser support
  if (!navigator.geolocation) {
    throw new Error('Your browser does not support location detection.');
  }

  // 2. Get coordinates (one-shot, never watches)
  const pos = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, (err) => {
      switch (err.code) {
        case err.PERMISSION_DENIED:
          reject(new Error('Location permission denied. Please allow location access in your browser settings, then try again.'));
          break;
        case err.POSITION_UNAVAILABLE:
          reject(new Error('Location unavailable. Please check your device GPS or network settings.'));
          break;
        case err.TIMEOUT:
          reject(new Error('Location request timed out. Please try again.'));
          break;
        default:
          reject(new Error('Could not detect location. Please try again.'));
      }
    }, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60000   // accept a reading up to 60 s old
    });
  });

  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;

  // 3. Reverse geocode via Nominatim (free, no API key)
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=16`;
  const resp = await fetch(url, {
    headers: { 'Accept-Language': 'en' }
  });

  if (!resp.ok) throw new Error('Could not determine your address. Please select manually.');

  const geo = await resp.json();
  const addr = geo.address || {};

  return {
    lat,
    lng,
    display_name: geo.display_name || '',
    county: addr.county || addr.state_district || addr.city || '',
    subcounty: addr.suburb || addr.town || addr.city_district || '',
    ward: addr.neighbourhood || addr.village || addr.hamlet || '',
    road: addr.road || '',
    country: addr.country || ''
  };
}
