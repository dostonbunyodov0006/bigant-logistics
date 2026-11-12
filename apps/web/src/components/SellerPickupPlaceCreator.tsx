import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  isCityRegionCode,
  type Coordinates,
  type PickupPlacePublic,
  type PickupPlaceType,
} from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { ClientGeoFields } from './ClientGeoFields';
import { UzPhoneInput } from './UzPhoneInput';
import { LocationPickerLazy } from './LocationPickerLazy';
import { useGeoAutofill } from '../lib/useGeoAutofill';

const inputClassName =
  'w-full rounded-lg border border-hairline bg-panel2 px-3 py-2.5 text-sm text-paper placeholder:text-slate outline-none focus:border-brand';

export function PickupPlaceCreator({
  onCreated,
  onCancel,
}: {
  onCreated: (place: PickupPlacePublic) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  // Who to ring at the place (owner, 11.11.2026); optional.
  const [phone, setPhone] = useState('');
  const type: PickupPlaceType = 'custom';
  const [address, setAddress] = useState('');
  const [regionCode, setRegionCode] = useState('');
  const [districtCode, setDistrictCode] = useState('');
  const [pin, setPin] = useState<Coordinates | null>(null);
  const [attempted, setAttempted] = useState(false);
  // Added here, it stays in the pickup list for the next order too.
  const keepInList = true;
  const autofill = useGeoAutofill({
    regionCode,
    setRegion: setRegionCode,
    setDistrict: setDistrictCode,
    anyDistrict: true,
  });

  const createM = useMutation({
    mutationFn: () =>
      api.post<PickupPlacePublic>('/pickup-places', {
        name: name.trim(),
        type,
        address: address.trim() || undefined,
        phone_number: phone.trim() || undefined,
        is_temporary: false,
        region_code: regionCode,
        district_code: districtCode || null,
        lat: pin?.lat,
        lng: pin?.lng,
        one_off: !keepInList,
      }),
    onSuccess: (place) => {
      // The new place is offered straight away, whether or not it is kept:
      // the seller is about to pick it for this order.
      queryClient.setQueryData<PickupPlacePublic[]>(['pickup-places'], (current = []) => [
        place,
        ...current.filter((item) => item.id !== place.id),
      ]);
      // Refetching would drop a one-off again (the list leaves them out), so
      // only a kept place is worth asking the server about.
      if (keepInList) void queryClient.invalidateQueries({ queryKey: ['pickup-places'] });
      onCreated(place);
    },
  });

  // Left empty is fine; typed, it must be a whole number.
  const phoneDigits = phone.replace(/\D/g, '');
  const phoneOk = phoneDigits.length === 0 || phoneDigits.length === 9;
  const valid = name.trim() && phoneOk && regionCode && (!isCityRegionCode(regionCode) || districtCode) && pin;
  const phoneError = attempted && !phoneOk ? t('sellerBoard.placePhoneInvalid') : undefined;
  const nameError = attempted && !name.trim() ? t('common.requiredField') : undefined;
  const regionError = attempted && !regionCode ? t('common.requiredField') : undefined;
  const districtError =
    attempted && isCityRegionCode(regionCode) && !districtCode
      ? t('common.requiredField')
      : undefined;
  const pinError = attempted && !pin ? t('locationPicker.required') : undefined;

  return (
    <div className="mt-1 rounded-xl border-2 border-brand bg-[#101a2a] p-4 shadow-xl">
      <div className="mb-3 flex items-center gap-2 border-b border-[#26344a] pb-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
          +
        </span>
        <span className="text-sm font-bold uppercase tracking-wide text-brand">
          {t('sellerBoard.addNewPlace')}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <input
          id="seller-place-name"
          className={`${inputClassName} ${nameError ? 'border-[#dc2626]' : ''}`}
          aria-invalid={!!nameError}
          placeholder={t('sellerBoard.placeName')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
        {nameError && (
          <p role="alert" className="text-xs font-medium text-[#dc2626]">
            {nameError}
          </p>
        )}
        <UzPhoneInput
          id="seller-place-phone"
          className={`${inputClassName} ${phoneError ? 'border-[#dc2626]' : ''}`}
          aria-invalid={!!phoneError}
          aria-label={t('sellerBoard.placePhone')}
          placeholder={t('sellerBoard.placePhone')}
          value={phone}
          onChange={setPhone}
        />
        {phoneError && (
          <p role="alert" className="text-xs font-medium text-[#dc2626]">
            {phoneError}
          </p>
        )}
        {/* Name, then the Location URL; the link fills viloyat and tuman below
            and the address the place is saved with. */}
        <LocationPickerLazy
          showMap={false}
          value={pin}
          regionCode={regionCode}
          districtCode={districtCode}
          theme="dark"
          onChange={(next) => {
            setPin(next);
            // No link, no place: what the old link filled in goes with it.
            if (!next) {
              setRegionCode('');
              setDistrictCode('');
              setAddress('');
            }
          }}
          onAddress={setAddress}
          onResolved={(r) => void autofill(r)}
          error={pinError}
          inputId="seller-place-location"
        />
        {/* Always shown; the Location URL fills both at once. */}
        <ClientGeoFields
          anyDistrict
          emptyLabel={t('sellerBoard.geoFromLink')}
          regionCode={regionCode}
          districtCode={districtCode}
          onRegion={setRegionCode}
          onDistrict={setDistrictCode}
          wrapperClassName="space-y-2"
          labelClassName="mb-1 block text-[11px] uppercase tracking-wide text-slate-light"
          selectClassName={inputClassName}
          regionId="seller-place-region"
          districtId="seller-place-district"
          regionError={regionError}
          districtError={districtError}
        />
        {createM.isError && (
          <div className="rounded-lg border border-full/40 bg-full-bg px-3.5 py-2.5 text-sm font-semibold text-full">
            {t('sellerBoard.errCreatePlace')}
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            disabled={createM.isPending}
            onClick={() => {
              setAttempted(true);
              if (!valid) {
                const id = !name.trim()
                  ? 'seller-place-name'
                  : !phoneOk
                    ? 'seller-place-phone'
                    : !pin
                    ? 'seller-place-location'
                    : !regionCode
                      ? 'seller-place-region'
                      : isCityRegionCode(regionCode) && !districtCode
                        ? 'seller-place-district'
                        : 'seller-place-location';
                requestAnimationFrame(() => document.getElementById(id)?.focus());
                return;
              }
              createM.mutate();
            }}
            className="rounded-xl bg-brand px-4 py-3 text-[15px] font-bold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('sellerBoard.addPlace')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-hairline bg-panel2 px-4 py-3 text-[15px] font-bold text-paper transition hover:bg-[#28303d]"
          >
            {t('sellerBoard.bekor')}
          </button>
        </div>
      </div>
    </div>
  );
}
