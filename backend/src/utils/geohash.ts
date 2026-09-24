import ngeohash from 'ngeohash';

/**
 * Geohash utilities for driver proximity.
 *
 * A geohash encodes a lat/lng into a short string identifying a
 * rectangular cell. Drivers and passengers within the same cell share
 * the same prefix, making proximity matching a string operation rather
 * than a geospatial database query.
 *
 * Precision 5 cells are approximately 4.9km × 4.9km. Broadcasting to
 * the passenger's cell plus its 8 neighbours covers a 15km × 15km
 * bounding area — comfortably larger than the 5km search radius.
 */

export const GEOHASH_PRECISION = 5;

/**
 * Convert (lat, lng) to a geohash string at the given precision.
 */
export function encode(
  lat: number,
  lng: number,
  precision: number = GEOHASH_PRECISION
): string {
  return ngeohash.encode(lat, lng, precision);
}

/**
 * Decode a geohash to its bounding box.
 * Returns { latitude, longitude } of the cell's center point.
 */
export function decode(geohash: string): { lat: number; lng: number } {
  const decoded = ngeohash.decode(geohash);
  return { lat: decoded.latitude, lng: decoded.longitude };
}

/**
 * Compute the 9 geohashes covering a passenger's broadcast area:
 * the passenger's own cell plus its 8 immediate neighbours.
 *
 * Used by MarketplaceService when broadcasting a ride request: we emit
 * to all 9 `drivers:near:{geohash}` rooms so that any driver within
 * roughly 5km receives it.
 */
export function neighbours(lat: number, lng: number): string[] {
  const center = encode(lat, lng);
  // ngeohash.neighbors returns a plain array of 8 neighbouring
  // geohashes. We add the center itself so callers get 9 cells total.
  const surrounding: string[] = ngeohash.neighbors(center);
  const result = [center, ...surrounding];
  // Deduplicate defensively in case any value repeats.
  return Array.from(new Set(result));
}

/**
 * Build the room name for a driver-near room.
 * Delegates to the Room builder in connection.manager to keep naming
 * consistent — this function is a convenience re-export for services
 * that only need the geohash format.
 */
export function geohashRoomName(geohash: string): string {
  return `drivers:near:${geohash}`;
}