import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isCityRegionCode, type GeoDistrictPublic, type RegionPublic } from '@bigant/shared';
import { api } from '../lib/api';

/**
 * Region (viloyat) select + a District (tuman) select that appears only for
 * Tashkent city / region. Shared by the admin client modal and the seller
 * inline create form; theme is fully controllable via the *ClassName props.
 */
export function ClientGeoFields({
  regionCode,
  districtCode,
  onRegion,
  onDistrict,
  wrapperClassName = 'space-y-3',
  labelClassName = 'field-label',
  selectClassName = 'input',
  regionId,
  districtId,
  regionError,
  districtError,
  between,
  before,
  anyDistrict = false,
  emptyLabel,
}: {
  regionCode: string;
  districtCode: string;
  onRegion: (code: string) => void;
  onDistrict: (code: string) => void;
  wrapperClassName?: string;
  labelClassName?: string;
  selectClassName?: string;
  regionId?: string;
  districtId?: string;
  regionError?: string;
  districtError?: string;
  /**
   * Rendered between the region and the district. The seller's form puts the
   * location link here: the link is what fills the tuman, so the tuman sits
   * under it and is seen filling in, rather than above it and already done.
   */
  between?: ReactNode;
  /** Rendered above the region: the seller pastes the link first, and watches
   *  viloyat and tuman fill in under it. */
  before?: ReactNode;
  /** Offer the tuman in every viloyat, not only in the city. */
  anyDistrict?: boolean;
  /** What an empty select says, when the form fills it rather than the person. */
  emptyLabel?: string;
}) {
  const { t } = useTranslation();
  const regionsQ = useQuery({
    queryKey: ['geo', 'regions'],
    queryFn: () => api.get<RegionPublic[]>('/geo/regions'),
    staleTime: Infinity,
  });
  const showDistrict = anyDistrict || isCityRegionCode(regionCode);
  const districtsQ = useQuery({
    queryKey: ['geo', 'districts', regionCode],
    queryFn: () => api.get<GeoDistrictPublic[]>(`/geo/districts?region_code=${regionCode}`),
    enabled: showDistrict && !!regionCode,
    staleTime: Infinity,
  });

  return (
    <div className={wrapperClassName}>
      {before}
      <div>
        <label className={labelClassName}>{t('clientForm.region')}</label>
        <select
          id={regionId}
          className={`${selectClassName} ${regionError ? 'border-[#dc2626]' : ''}`}
          aria-invalid={!!regionError}
          value={regionCode}
          onChange={(e) => {
            onRegion(e.target.value);
            onDistrict(''); // region changed → clear any stale district
          }}
        >
          <option value="">{emptyLabel ?? t('clientForm.selectRegion')}</option>
          {(regionsQ.data ?? []).map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
        {regionError && (
          <p role="alert" className="mt-1 text-xs font-medium text-[#dc2626]">{regionError}</p>
        )}
      </div>
      {between}
      {showDistrict && (
        <div>
          <label className={labelClassName}>{t('clientForm.district')}</label>
          <select
            id={districtId}
            className={`${selectClassName} ${districtError ? 'border-[#dc2626]' : ''}`}
            aria-invalid={!!districtError}
            value={districtCode}
            onChange={(e) => onDistrict(e.target.value)}
          >
            <option value="">{emptyLabel ?? t('clientForm.selectDistrict')}</option>
            {(districtsQ.data ?? []).map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </select>
          {districtError && (
            <p role="alert" className="mt-1 text-xs font-medium text-[#dc2626]">{districtError}</p>
          )}
        </div>
      )}
    </div>
  );
}
