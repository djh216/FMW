/** Approximate center points for territory fallback geocoding */
const TERRITORY_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "northeast-pa": { lat: 41.409, lng: -75.6624 },
  "lehigh-valley": { lat: 40.6084, lng: -75.4902 },
  philadelphia: { lat: 39.9526, lng: -75.1652 },
  "northern-philly": { lat: 40.152, lng: -75.221 },
  "western-philly": { lat: 39.96, lng: -75.4 },
  "southern-susquehanna": { lat: 40.2732, lng: -76.8867 },
  "northern-susquehanna": { lat: 41.2412, lng: -77.0011 },
  pittsburgh: { lat: 40.4406, lng: -79.9959 },
};

function hashOffset(seed: string): { lat: number; lng: number } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const lat = ((h % 200) - 100) / 8000;
  const lng = (((h / 200) | 0) % 200 - 100) / 8000;
  return { lat, lng };
}

export async function resolveCoordinates(
  street: string,
  city: string,
  territoryId: string,
  customerName: string
): Promise<{ lat: number; lng: number; geocoded: boolean }> {
  const query = `${street}, ${city}, PA`;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "PA-Wine-Routing/1.0 (Scranton warehouse)" },
    });
    if (res.ok) {
      const data = (await res.json()) as { lat: string; lon: string }[];
      if (data[0]) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
          geocoded: true,
        };
      }
    }
  } catch {
    // fall through to territory centroid
  }

  const centroid = TERRITORY_CENTROIDS[territoryId] ?? TERRITORY_CENTROIDS["northeast-pa"];
  const offset = hashOffset(customerName + street);
  return {
    lat: centroid.lat + offset.lat,
    lng: centroid.lng + offset.lng,
    geocoded: false,
  };
}
