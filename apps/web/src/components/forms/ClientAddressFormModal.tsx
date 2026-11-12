import { useEffect, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  createClientAddressSchema,
  isCityRegionCode,
  updateClientAddressSchema,
  type ClientAddressPublic,
  type CreateClientAddressInput,
} from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote, Field } from '../ui';
import { ClientGeoFields } from '../ClientGeoFields';
import { LocationPickerLazy } from '../LocationPickerLazy';
import { useGeoAutofill } from '../../lib/useGeoAutofill';

/** The pin is optional while the form is being filled; the resolver still
 *  rejects a new address without one. */
type FormValues = Omit<CreateClientAddressInput, 'lat' | 'lng'> & { lat?: number; lng?: number };

const EMPTY: FormValues = { label: '', region_code: '', district_code: '', address: '' };

/**
 * One of a client's places: the shop, the second shop, the yard.
 *
 * The label is what the seller will pick from on an order, so it is the first
 * field and the only one that must be typed; everything else follows from the
 * pin on the map.
 */
export function ClientAddressFormModal({
  open,
  onClose,
  clientId,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  editing?: ClientAddressPublic | null;
}) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(
      editing ? updateClientAddressSchema : createClientAddressSchema,
    ) as Resolver<FormValues>,
    defaultValues: EMPTY,
  });
  const [districtError, setDistrictError] = useState(false);

  const regionCode = watch('region_code') ?? '';
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
    if (!open) return;
    setDistrictError(false);
    reset(
      editing
        ? {
            label: editing.label,
            region_code: editing.region_code ?? '',
            district_code: editing.district_code ?? '',
            address: editing.address ?? '',
            lat: editing.lat ?? undefined,
            lng: editing.lng ?? undefined,
            is_default: editing.is_default,
          }
        : EMPTY,
    );
  }, [open, editing, reset]);

  const mutation = useMutation({
    mutationFn: (form: FormValues) =>
      editing
        ? api.patch<ClientAddressPublic>(`/clients/addresses/${editing.id}`, form)
        : api.post<ClientAddressPublic>(`/clients/${clientId}/addresses`, form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      void queryClient.invalidateQueries({ queryKey: ['client-addresses', clientId] });
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
      onClose();
    },
  });

  const submit = (values: FormValues) => {
    if (isCityRegionCode(values.region_code ?? '') && !values.district_code) {
      setDistrictError(true);
      return;
    }
    mutation.mutate(values);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? t('clientAddresses.editTitle') : t('clientAddresses.newTitle')}
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        {mutation.isError && <ErrorNote error={mutation.error} />}
        <Field label={t('clientAddresses.label')} error={errors.label?.message}>
          <input className="input" placeholder={t('clientAddresses.labelPlaceholder')} {...register('label')} />
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
        <Field label={t('clientAddresses.addressOptional')}>
          <input className="input" {...register('address')} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" {...register('is_default')} />
          {t('clientAddresses.makeDefault')}
        </label>
        <div className="flex justify-end gap-2">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? t('common.saving') : t('common.saveChanges')}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
