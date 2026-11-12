/**
 * Approximate centre and a sensible starting zoom for each region, keyed by the
 * official region code. The Region table carries no geometry, and the picker
 * needs somewhere to open: "the selected region" was the decision, so the map
 * starts here and the seller pans or searches from a familiar place instead of
 * from a country-wide view.
 *
 * These are rough administrative centres (the regional capital), not
 * geographic centroids — a seller in Andijon wants to see Andijon city, not a
 * point in the countryside equidistant from every border.
 */
export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}

export const REGION_CENTROIDS: Record<string, MapView> = {
  '1703': { lat: 40.7821, lng: 72.3442, zoom: 12 }, // Andijon
  '1706': { lat: 39.7747, lng: 64.4286, zoom: 12 }, // Buxoro
  '1708': { lat: 40.1158, lng: 67.8422, zoom: 12 }, // Jizzax
  '1710': { lat: 38.8606, lng: 65.7891, zoom: 12 }, // Qarshi (Qashqadaryo)
  '1712': { lat: 40.0844, lng: 65.3792, zoom: 12 }, // Navoiy
  '1714': { lat: 40.9983, lng: 71.6726, zoom: 12 }, // Namangan
  '1718': { lat: 39.6542, lng: 66.9597, zoom: 12 }, // Samarqand
  '1722': { lat: 37.2242, lng: 67.2783, zoom: 12 }, // Termiz (Surxondaryo)
  '1724': { lat: 40.4897, lng: 68.7842, zoom: 12 }, // Guliston (Sirdaryo)
  '1726': { lat: 41.3111, lng: 69.2797, zoom: 12 }, // Toshkent shahri
  '1727': { lat: 41.2213, lng: 69.4175, zoom: 10 }, // Toshkent viloyati — wide: it surrounds the city
  '1730': { lat: 40.3864, lng: 71.7864, zoom: 12 }, // Farg'ona
  '1733': { lat: 41.5500, lng: 60.6333, zoom: 12 }, // Urganch (Xorazm)
  '1735': { lat: 42.4531, lng: 59.6103, zoom: 11 }, // Nukus (Qoraqalpog'iston)
};

/** Country view, for when no region is chosen yet. */
export const UZBEKISTAN_VIEW: MapView = { lat: 41.3775, lng: 64.5853, zoom: 6 };

export function regionView(regionCode: string | null | undefined): MapView {
  return (regionCode && REGION_CENTROIDS[regionCode]) || UZBEKISTAN_VIEW;
}
