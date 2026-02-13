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

  // 3. Reverse geocode via Nominatim (free, no API key) - zoom=18 for maximum precision
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`;
  const resp = await fetch(url, {
    headers: { 'Accept-Language': 'en' }
  });

  if (!resp.ok) throw new Error('Could not determine your address. Please select manually.');

  const geo = await resp.json();
  const addr = geo.address || {};

  // Extract all available precise location details
  const houseNumber = addr.house_number || '';
  const building = addr.building || '';
  const amenity = addr.amenity || '';
  const shop = addr.shop || '';
  const road = addr.road || addr.street || '';
  const neighbourhood = addr.neighbourhood || addr.quarter || '';
  const suburb = addr.suburb || addr.town || addr.city_district || '';
  const village = addr.village || addr.hamlet || '';
  const ward = neighbourhood || village || '';
  const subcounty = suburb || addr.municipality || '';
  const county = addr.county || addr.state_district || addr.city || '';
  const postcode = addr.postcode || '';

  // Build a comprehensive specific location string with all available details
  const specificParts = [
    houseNumber,
    building,
    amenity,
    shop,
    road,
    neighbourhood,
    suburb !== neighbourhood ? suburb : '',
    village !== neighbourhood ? village : ''
  ].filter(Boolean);

  return {
    lat,
    lng,
    display_name: geo.display_name || '',
    county: county,
    subcounty: subcounty,
    ward: ward,
    road: road,
    country: addr.country || '',
    postcode: postcode,
    // Additional precise fields
    houseNumber: houseNumber,
    building: building,
    amenity: amenity,
    shop: shop,
    neighbourhood: neighbourhood,
    suburb: suburb,
    village: village,
    // Comprehensive specific location string
    specificLocation: specificParts.join(', '),
    // Raw address object for debugging
    rawAddress: addr
  };
}

/**
 * Helper function to match detected location to dropdown values
 * @param {Object} detectedLocation - Location object from detectLocation()
 * @param {Object} countiesData - Counties hierarchy data
 * @returns {Object} - { region, county, constituency, ward }
 */
export function matchLocationToDropdowns(detectedLocation, countiesData) {
  const detected = {
    county: (detectedLocation.county || '').toLowerCase().trim(),
    subcounty: (detectedLocation.subcounty || '').toLowerCase().trim(),
    ward: (detectedLocation.ward || '').toLowerCase().trim()
  };

  let bestMatch = { region: '', county: '', constituency: '', ward: '' };
  let matchScore = 0;

  // Search through counties data
  for (const [regionKey, countiesInRegion] of Object.entries(countiesData)) {
    for (const [countyName, constituencies] of Object.entries(countiesInRegion)) {
      const countyLower = countyName.toLowerCase();
      
      // Check if detected county matches this county
      if (detected.county.includes(countyLower) || countyLower.includes(detected.county)) {
        bestMatch.region = regionKey;
        bestMatch.county = countyName;
        matchScore = 1;

        // Try to match constituency
        for (const [constituencyName, wards] of Object.entries(constituencies)) {
          const constLower = constituencyName.toLowerCase();
          
          if (detected.subcounty.includes(constLower) || constLower.includes(detected.subcounty)) {
            bestMatch.constituency = constituencyName;
            matchScore = 2;

            // Try to match ward
            for (const wardName of wards) {
              const wardLower = wardName.toLowerCase();
              
              if (detected.ward.includes(wardLower) || wardLower.includes(detected.ward)) {
                bestMatch.ward = wardName;
                matchScore = 3;
                break;
              }
            }
            
            if (matchScore === 3) break;
          }
        }
        
        if (matchScore >= 1) break;
      }
    }
    
    if (matchScore >= 1) break;
  }

  return {
    ...bestMatch,
    matchScore // 0=no match, 1=county only, 2=county+constituency, 3=full match
  };
}
