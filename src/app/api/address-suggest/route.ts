import { NextRequest, NextResponse } from 'next/server';
import {
  fetchAddressSuggestions,
  type AddressSuggestion,
} from '@/lib/address-suggest';

// Rough centroid lat/lng for each Australian state (for distance scoring)
const STATE_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  VIC: { lat: -37.81, lng: 144.96 },
  NSW: { lat: -33.87, lng: 151.21 },
  QLD: { lat: -27.47, lng: 153.03 },
  SA: { lat: -34.93, lng: 138.6 },
  WA: { lat: -31.95, lng: 115.86 },
  TAS: { lat: -42.88, lng: 147.33 },
  NT: { lat: -12.46, lng: 130.84 },
  ACT: { lat: -35.28, lng: 149.13 },
};

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim();
  const userState = request.nextUrl.searchParams.get('state')?.toUpperCase();
  const userLat = parseFloat(
    request.nextUrl.searchParams.get('lat') ?? ''
  );
  const userLng = parseFloat(
    request.nextUrl.searchParams.get('lng') ?? ''
  );

  if (!query || query.length < 3) {
    return NextResponse.json(
      { suggestions: [], error: 'Query must be at least 3 characters.' },
      { status: 400 }
    );
  }

  try {
    // Fetch all suggestions (no server-side state filter — we sort instead)
    const all = await fetchAddressSuggestions(query);

    // Sort: user's state first, then by distance to user
    const hasLocation = !isNaN(userLat) && !isNaN(userLng);

    const scored = all.map((s) => {
      let score = 0;

      // Bonus for matching user's state
      if (userState && s.state.toUpperCase() === userState) {
        score += 1000;
      }

      // Distance-based scoring (closer = higher score)
      if (hasLocation) {
        const centroid = STATE_CENTROIDS[s.state.toUpperCase()];
        if (centroid) {
          const dist = haversineKm(userLat, userLng, centroid.lat, centroid.lng);
          // Invert distance: closer → higher score (max ~4000km in AU)
          score += Math.max(0, 4000 - dist);
        }
      }

      return { suggestion: s, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const suggestions = scored.map((s) => s.suggestion).slice(0, 8);

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('[/api/address-suggest] Error:', error);
    return NextResponse.json({ suggestions: [] });
  }
}

/**
 * Haversine distance between two points in kilometres.
 */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
