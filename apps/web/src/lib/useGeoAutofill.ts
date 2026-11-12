import { useCallback } from 'react';
import { isCityRegionCode, type GeoDistrictPublic, type GeocodingResult, type RegionPublic } from '@bigant/shared';
import { api } from './api';
import { queryClient } from './queryClient';
import { matchDistrict, matchRegion } from './geoMatch';

/**
 * Fills the Viloyat / Tuman selects from a dropped pin. Returns a handler for
 * LocationPicker's `onResolved`. Shares the query keys ClientGeoFields uses,
 * so the lists are usually already in the cache.
 *
 * Rules: set the region when it matches confidently; when that changes the
 * region, the old district is meaningless and is cleared; set the district only
 * for city regions, where the select is shown and required — elsewhere it is
 * hidden and pay does not depend on it, so a hidden value would just confuse.
 */
export function useGeoAutofill({
  regionCode,
  setRegion,
  setDistrict,
  anyDistrict = false,
}: {
  regionCode: string;
  setRegion: (code: string) => void;
  setDistrict: (code: string) => void;
  /** Fill the tuman in every viloyat, for a form that shows it everywhere. */
  anyDistrict?: boolean;
}) {
  return useCallback(
    async (r: GeocodingResult) => {
      const regions = await queryClient.fetchQuery({
        queryKey: ['geo', 'regions'],
        queryFn: () => api.get<RegionPublic[]>('/geo/regions'),
        staleTime: Infinity,
      });
      const region = matchRegion(regions, r);
      if (!region) return; // no confident match — leave the selects to the user

      const regionChanged = region.code !== regionCode;
      if (regionChanged) setRegion(region.code);
      if (!anyDistrict && !isCityRegionCode(region.code)) {
        if (regionChanged) setDistrict('');
        return;
      }
      const districts = await queryClient.fetchQuery({
        queryKey: ['geo', 'districts', region.code],
        queryFn: () => api.get<GeoDistrictPublic[]>(`/geo/districts?region_code=${region.code}`),
        staleTime: Infinity,
      });
      const district = matchDistrict(districts, r);
      if (district) setDistrict(district.code);
      else if (regionChanged) setDistrict('');
    },
    [regionCode, setRegion, setDistrict, anyDistrict],
  );
}
