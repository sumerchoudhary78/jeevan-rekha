// Device coordinates are a caller-provided rescue hint, never an inferred address.
export function deviceLocation(input) {
  if (!input || typeof input !== 'object') return null;
  const { lat, lon, accuracy } = input;
  if (![lat, lon, accuracy].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || accuracy < 0 || accuracy > 100000) return null;
  return { lat, lon, accuracy };
}

export function distanceKm(a, b) {
  if (a?.lat == null || a?.lon == null || b?.lat == null || b?.lon == null) return Infinity;
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function withDeviceLocation(fields, position, { confirmed = false } = {}) {
  const reported = { ...fields, locationSource: 'reported', locationAccuracy: null };
  if (!position) return reported;
  // A confirmed named rescue locality far from the device wins over its coordinates.
  // Gazetteer points describe localities, not individual roofs; allow that spread.
  if (confirmed && fields.place && (position.accuracy > 100 || distanceKm(fields, position) > 10 + position.accuracy / 1000)) return reported;
  return {
    ...fields, lat: position.lat, lon: position.lon,
    locationSource: 'device', locationAccuracy: position.accuracy,
    approximate: fields.approximate || position.accuracy > 100,
  };
}
