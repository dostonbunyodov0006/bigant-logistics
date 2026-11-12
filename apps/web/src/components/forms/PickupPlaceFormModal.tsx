import { useEffect } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  createPickupPlaceSchema,
  updatePickupPlaceSchema,
  PICKUP_PLACE_TYPES,
  type CreatePickupPlaceInput,
  type PickupPlacePublic,
  type SupplierPublic,
} from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ClientGeoFields } from '../ClientGeoFields';
import { LocationPickerLazy } from '../LocationPickerLazy';
import { useGeoAutofill } from '../../lib/useGeoAutofill';
import { ErrorNote, Field } from '../ui';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';

/** Form state. The pin is optional *here* because the user has not placed it
 *  yet while typing; the resolver still rejects a create without one. */
type FormValues = Omit<CreatePickupPlaceInput, 'lat' | 'lng'> & { lat?: number; lng?: number };

const EMPTY: FormValues = {
  name: '',
  address: '',
  phone_number: null,
  type: 'warehouse',
  is_temporary: false,
  region_code: '',
  district_code: '',
  supplier_id: '',
};

export function PickupPlaceFormModal({
  open,
  onClose,
  editing,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  editing?: PickupPlacePublic | null;
  onCreated?: (place: PickupPlacePublic) => void;
}) {
  const { t } = useTranslation();
  // Our shop and warehouse are added by the admin or the dispatcher only (owner, 06.11.2026); a seller adds a supplier's yard.
  const { user } = useAuth();
  const isStaff = user?.role === 'admin' || user?.role === 'manager';
  const types = isStaff ? PICKUP_PLACE_TYPES : PICKUP_PLACE_TYPES.filter((x) => x === 'custom' || x === editing?.type);
  // One supplier may own several yards; the list lets this one say whose it is.
  const suppliersQ = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<SupplierPublic[]>('/pickup-places/suppliers'),
    enabled: open,
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    // Create requires a pin; update does not, so a legacy place can still be
    // renamed before anyone has pinned it. RHF re-reads options each render,
    // so the swap takes effect when `editing` changes.
    resolver: zodResolver(
      editing ? updatePickupPlaceSchema : createPickupPlaceSchema,
    ) as Resolver<FormValues>,
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    reset(
      editing
        ? {
            name: editing.name,
            address: editing.address ?? '',
            phone_number: editing.phone_number ?? null,
            type: editing.type,
            is_temporary: editing.is_temporary,
            region_code: editing.region_code,
            district_code: editing.district_code ?? '',
            lat: editing.lat ?? undefined,
            lng: editing.lng ?? undefined,
            supplier_id: editing.supplier_id ?? '',
          }
        : isStaff
          ? EMPTY
          : { ...EMPTY, type: 'custom' },
    );
  }, [open, editing, reset]);

  const regionCode = watch('region_code') ?? '';
  const districtCode = watch('district_code') ?? '';
  const lat = watch('lat');
  const lng = watch('lng');
  const pin = lat !== undefined && lng !== undefined ? { lat, lng } : null;
  // A dropped pin fills Viloyat/Tuman from the geocoder when it can.
  const autofill = useGeoAutofill({
    regionCode,
    setRegion: (c) => setValue('region_code', c, { shouldValidate: true, shouldDirty: true }),
    setDistrict: (c) => setValue('district_code', c, { shouldValidate: true, shouldDirty: true }),
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      // The place's geo travels onto every order's pickup stop, so an empty
      // district must be sent as null rather than ''.
      // Empty supplier = ours, which the server stores as no supplier at all.
      const body = {
        ...values,
        district_code: values.district_code || null,
        supplier_id: values.supplier_id || null,
      };
      return editing
        ? api.patch<PickupPlacePublic>(`/pickup-places/${editing.id}`, body)
        : api.post<PickupPlacePublic>('/pickup-places', body);
    },
    onSuccess: (place) => {
      void queryClient.invalidateQueries({ queryKey: ['pickup-places'] });
      onCreated?.(place);
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={editing ? t('placeForm.editTitle') : t('placeForm.newTitle')}>
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" noValidate>
        {mutation.isError && <ErrorNote error={mutation.error} />}
        <Field label={t('placeForm.name')} error={errors.name?.message}>
          <input className="input" placeholder={t('placeForm.namePlaceholder')} {...register('name')} />
        </Field>
        {/* Who to ring at the place; the driver calls from his app (owner, 11.11.2026). */}
        <Field label={t('placeForm.phoneOptional')} error={errors.phone_number?.message}>
          <input
            className="input"
            type="tel"
            inputMode="numeric"
            placeholder="90 123 45 67"
            {...register('phone_number', { setValueAs: (v: unknown) => (typeof v === 'string' && v.trim() ? v : null) })}
          />
        </Field>
        <Field label={t('suppliers.pickOptional')}>
          <select className="input" {...register('supplier_id')}>
            <option value="">{t('suppliers.ours')}</option>
            {(suppliersQ.data ?? []).map((sup) => (
              <option key={sup.id} value={sup.id}>
                {sup.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('placeForm.type')} error={errors.type?.message}>
          <select className="input" {...register('type')}>
            {types.map((type) => (
              <option key={type} value={type}>
                {t(`pickupPlaceType.${type}`)}
              </option>
            ))}
          </select>
        </Field>
        {/* The place's official geo — copied onto every order's pickup stop, so it
            drives the city/outside pickup bonus and is never re-entered per order. */}
        <ClientGeoFields
          regionCode={regionCode}
          districtCode={districtCode ?? ''}
          onRegion={(code) => setValue('region_code', code, { shouldValidate: true })}
          onDistrict={(code) => setValue('district_code', code, { shouldValidate: true })}
        />
        {(errors.region_code || errors.district_code) && (
          <p className="text-sm text-danger">{t('placeForm.geoRequired')}</p>
        )}
        {/* The pin is what routing and ETA use; the region above only seeds
            where the map opens. Reverse geocoding fills the address below. */}
        <LocationPickerLazy
          value={pin}
          regionCode={regionCode}
          districtCode={districtCode ?? ''}
          onResolved={(r) => void autofill(r)}
          onChange={(next) => {
            setValue('lat', next?.lat, { shouldValidate: true, shouldDirty: true });
            setValue('lng', next?.lng, { shouldValidate: true, shouldDirty: true });
          }}
          onAddress={(address) => setValue('address', address, { shouldDirty: true })}
          error={errors.lat || errors.lng ? t('locationPicker.required') : undefined}
        />
        <Field label={t('placeForm.addressOptional')}>
          <input className="input" {...register('address')} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-graphite">
          <input type="checkbox" {...register('is_temporary')} />
          {t('placeForm.temporary')}
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? t('common.saving')
              : editing
                ? t('common.saveChanges')
                : t('placeForm.createPlace')}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
