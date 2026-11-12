import { useEffect, useState } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  createClientSchema,
  updateClientSchema,
  isCityRegionCode,
  UZ_PHONE_PREFIX,
  type ClientPublic,
  type CreateClientInput,
} from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote, Field } from '../ui';
import { ClientGeoFields } from '../ClientGeoFields';
import { LocationPickerLazy } from '../LocationPickerLazy';
import { useGeoAutofill } from '../../lib/useGeoAutofill';
import { UzPhoneInput } from '../UzPhoneInput';
import { useAuth } from '../../auth/AuthContext';
import { useSellers } from '../../lib/useSellers';

/** Form state. The pin is optional *here* because the user has not placed it
 *  yet while typing; the resolver still rejects a create without one. */
type FormValues = Omit<CreateClientInput, 'lat' | 'lng'> & { lat?: number; lng?: number };

const EMPTY: FormValues = {
  name: '',
  phone_number: UZ_PHONE_PREFIX,
  region_code: '',
  district_code: '',
  address: '',
  location: '',
  seller_id: '',
};

export function ClientFormModal({
  open,
  onClose,
  editing,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  editing?: ClientPublic | null;
  onCreated?: (client: ClientPublic) => void;
}) {
  const { t } = useTranslation();
  // Staff decide whose client it is; a seller's own clients are always theirs,
  // so the picker is not shown to them at all.
  const { user } = useAuth();
  const isStaff = user?.role === 'admin' || user?.role === 'manager';
  const sellersQ = useSellers(isStaff && open);
  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    // Create requires a pin; update does not, so a legacy client can still be
    // edited before anyone has pinned it.
    resolver: zodResolver(
      editing ? updateClientSchema : createClientSchema,
    ) as Resolver<FormValues>,
    defaultValues: EMPTY,
  });
  // District is only required when the region is Tashkent city / region.
  const [districtError, setDistrictError] = useState(false);

  const regionCode = watch('region_code');
  const districtCode = watch('district_code') ?? '';
  const lat = watch('lat');
  const lng = watch('lng');
  const pin = lat !== undefined && lng !== undefined ? { lat, lng } : null;
  const autofill = useGeoAutofill({
    regionCode,
    setRegion: (c) => setValue('region_code', c, { shouldValidate: true, shouldDirty: true }),
    setDistrict: (c) => {
      setValue('district_code', c, { shouldValidate: true, shouldDirty: true });
      if (c) setDistrictError(false);
    },
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    setDistrictError(false);
    reset(
      editing
        ? {
            name: editing.name,
            phone_number: editing.phone_number,
            region_code: editing.region_code ?? '',
            district_code: editing.district_code ?? '',
            address: editing.address ?? '',
            location: editing.location ?? '',
            lat: editing.lat ?? undefined,
            lng: editing.lng ?? undefined,
            seller_id: editing.seller_id ?? '',
          }
        : EMPTY,
    );
  }, [open, editing, reset]);

  const mutation = useMutation({
    mutationFn: (form: FormValues) => {
      // Only staff send an owner; empty = unassigned.
      const { seller_id, ...rest } = form;
      const values = isStaff ? { ...rest, seller_id: seller_id || null } : rest;
      return editing
        ? api.patch<ClientPublic>(`/clients/${editing.id}`, values)
        : api.post<ClientPublic>('/clients', values);
    },
    onSuccess: (client) => {
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
      // Edited from its own page now, so the single-item query has to be told
      // as well — otherwise the header keeps the old name.
      void queryClient.invalidateQueries({ queryKey: ['client'] });
      onCreated?.(client);
      onClose();
    },
  });

  const submit = (values: FormValues) => {
    if (isCityRegionCode(values.region_code) && !values.district_code) {
      setDistrictError(true);
      return;
    }
    mutation.mutate(values);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? t('clientForm.editTitle') : t('clientForm.newTitle')}
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        {mutation.isError && <ErrorNote error={mutation.error} />}
        {isStaff && (
          <Field label={t('clientForm.seller')}>
            <select className="input" {...register('seller_id')}>
              <option value="">{t('clientForm.sellerNone')}</option>
              {(sellersQ.data ?? [])
                .filter((u) => u.status === 'active' || u.id === editing?.seller_id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.status !== 'active' ? ` (${t('clientForm.sellerInactive')})` : ''}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field label={t('clientForm.name')} error={errors.name?.message}>
          <input className="input" {...register('name')} />
        </Field>
        <Field label={t('clientForm.phoneNumber')} error={errors.phone_number?.message}>
          <Controller
            control={control}
            name="phone_number"
            render={({ field }) => <UzPhoneInput {...field} className="input" />}
          />
        </Field>
        <Field
          label=""
          error={
            errors.region_code?.message ??
            (districtError ? t('clientForm.districtRequired') : undefined)
          }
        >
          <ClientGeoFields
            regionCode={regionCode}
            districtCode={districtCode}
            onRegion={(c) => setValue('region_code', c, { shouldValidate: true })}
            onDistrict={(c) => {
              setValue('district_code', c, { shouldValidate: true });
              if (c) setDistrictError(false);
            }}
          />
        </Field>
        {/* Delivery point — what ETA and routing use. The region above only seeds
            where the map opens; reverse geocoding fills the address below. */}
        <LocationPickerLazy
          value={pin}
          regionCode={regionCode}
          districtCode={districtCode}
          onResolved={(r) => void autofill(r)}
          onChange={(next) => {
            setValue('lat', next?.lat, { shouldValidate: true, shouldDirty: true });
            setValue('lng', next?.lng, { shouldValidate: true, shouldDirty: true });
          }}
          onAddress={(address) => setValue('address', address, { shouldDirty: true })}
          error={errors.lat || errors.lng ? t('locationPicker.required') : undefined}
        />
        <Field label={t('clientForm.addressOptional')}>
          <input className="input" {...register('address')} />
        </Field>
        <Field label={t('clientForm.locationOptional')}>
          <input className="input" {...register('location')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? t('common.saving')
              : editing
                ? t('common.saveChanges')
                : t('clientForm.createClient')}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
