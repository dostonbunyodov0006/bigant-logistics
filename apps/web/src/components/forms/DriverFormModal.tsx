import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  MAX_PAGE_SIZE,
  UZ_PHONE_PREFIX,
  uzPhoneSchema,
  type DriverPublic,
  type GeoDistrictPublic,
  type VehiclePublic,
} from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote, Field } from '../ui';

import { UzPhoneInput } from '../UzPhoneInput';
import { PasswordInput } from '../PasswordInput';
const formSchema = z.object({
  // Typed apart, stored as one name: the two boxes are what the office asked
  // for, and everything downstream — the board, the reports, Telegram — has
  // always shown a driver as one line of text.
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().min(1),
  phone_number: uzPhoneSchema,
  password: z.string().optional(),
  vehicle_id: z.string().optional(),
  birth_date: z.string().optional(),
  license_category: z.string().optional(),
  license_issued_at: z.string().optional(),
  license_expires_at: z.string().optional(),
  home_district_code: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

/** The two boxes, joined the way the rest of the system reads a name. */
const fullName = (v: FormValues) => `${v.first_name.trim()} ${v.last_name.trim()}`.trim();

export function DriverFormModal({
  open,
  onClose,
  editing,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  editing?: DriverPublic | null;
  onCreated?: (driver: DriverPublic) => void;
}) {
  const { t } = useTranslation();
  const isEdit = !!editing;
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      first_name: '',
      last_name: '',
      phone_number: UZ_PHONE_PREFIX,
      password: '',
      vehicle_id: '',
      birth_date: '',
      license_category: '',
      license_issued_at: '',
      license_expires_at: '',
      home_district_code: '',
    },
  });

  useEffect(() => {
    if (open) {
      const [first = '', ...rest] = (editing?.name ?? '').split(' ').filter(Boolean);
      reset({
        first_name: first,
        last_name: rest.join(' '),
        phone_number: editing?.phone_number ?? UZ_PHONE_PREFIX,
        password: '',
        vehicle_id: editing?.vehicle_id ?? '',
        birth_date: editing?.birth_date ?? '',
        license_category: editing?.license_category ?? '',
        license_issued_at: editing?.license_issued_at ?? '',
        license_expires_at: editing?.license_expires_at ?? '',
        home_district_code: editing?.home_district_code ?? '',
      });
    }
  }, [open, editing, reset]);

  // Only offer unassigned vehicles (plus this driver's current one when editing).
  const { data: vehicles = [], isSuccess: vehiclesReady } = useQuery({
    queryKey: ['vehicles'],
    // Reference dropdown: bounded explicitly. A fleet/roster past this size
    // needs a searchable picker rather than a <select>.
    queryFn: () => api.get<VehiclePublic[]>(`/vehicles?take=${MAX_PAGE_SIZE}`),
    enabled: open,
  });
  const { data: districts = [], isSuccess: districtsReady } = useQuery({
    queryKey: ['geo', 'districts', 'all'],
    queryFn: () => api.get<GeoDistrictPublic[]>('/geo/districts'),
    enabled: open,
  });
  const available = vehicles.filter(
    (v) => v.assigned_driver_id === null || v.id === editing?.vehicle_id,
  );

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      if (isEdit && editing) {
        const payload: Record<string, unknown> = {
          name: fullName(values),
          phone_number: values.phone_number,
          vehicle_id: values.vehicle_id || null,
          birth_date: values.birth_date || null,
          license_issued_at: values.license_issued_at || null,
          license_expires_at: values.license_expires_at || null,
          license_category: values.license_category || null,
          home_district_code: values.home_district_code || null,
        };
        if (values.password) payload.password = values.password;
        return api.patch<DriverPublic>(`/drivers/${editing.id}`, payload);
      }
      return api.post<DriverPublic>('/drivers', {
        name: fullName(values),
        phone_number: values.phone_number,
        password: values.password,
        vehicle_id: values.vehicle_id || undefined,
        birth_date: values.birth_date || undefined,
        license_issued_at: values.license_issued_at || undefined,
        license_expires_at: values.license_expires_at || undefined,
        license_category: values.license_category || undefined,
        home_district_code: values.home_district_code || undefined,
      });
    },
    onSuccess: (driver) => {
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      // Edited from his own page now, so the single-driver query has to be told
      // as well — otherwise the header keeps the old name.
      void queryClient.invalidateQueries({ queryKey: ['driver'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      if (!isEdit) onCreated?.(driver);
      reset();
      onClose();
    },
  });

  const onSubmit = (values: FormValues) => {
    const pw = values.password ?? '';
    if ((!isEdit && pw.length < 6) || (isEdit && pw.length > 0 && pw.length < 6)) {
      setError('password', { message: t('driverForm.passwordPlaceholder') });
      return;
    }
    mutation.mutate(values);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('driverForm.editTitle') : t('driverForm.title')}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {mutation.isError && <ErrorNote error={mutation.error} />}
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('driverForm.firstName')} error={errors.first_name?.message}>
            <input className="input" {...register('first_name')} />
          </Field>
          <Field label={t('driverForm.lastName')} error={errors.last_name?.message}>
            <input className="input" {...register('last_name')} />
          </Field>
        </div>
        <Field label={t('driverForm.phoneNumber')} error={errors.phone_number?.message}>
          <Controller
            control={control}
            name="phone_number"
            render={({ field }) => <UzPhoneInput {...field} className="input" />}
          />
        </Field>
        <Field label={t('driverForm.password')} error={errors.password?.message}>
          <PasswordInput
            className="input"
            autoComplete="new-password"
            placeholder={
              isEdit ? t('driverForm.passwordKeepBlank') : t('driverForm.passwordPlaceholder')
            }
            {...register('password')}
          />
        </Field>
        <Field label={t('driverForm.vehicleOptional')}>
          {/* Mounted once the list is in: a <select> drawn before its options
              shows "Transport yo'q" over the driver's own lorry, and saving
              that took the lorry off him (28.10.2026). */}
          {vehiclesReady ? (
          <select className="input" {...register('vehicle_id')}>
            <option value="">{t('driverDetail.noVehicle')}</option>
            {available.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate_number} · {v.model}
              </option>
            ))}
          </select>
          ) : (
            <select className="input" disabled><option>{t('common.loading')}</option></select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('driverForm.birthDate')}>
            <input type="date" className="input" {...register('birth_date')} />
          </Field>
          <Field label={t('driverForm.licenseCategory')}>
            <input className="input" placeholder="B, C" {...register('license_category')} />
          </Field>
        </div>
        {/* Off the licence: 4a and 4b. Experience (staj) is counted from the first. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('driverForm.licenseIssued')}>
            <input type="date" className="input" {...register('license_issued_at')} />
          </Field>
          <Field label={t('driverForm.licenseExpires')}>
            <input type="date" className="input" {...register('license_expires_at')} />
          </Field>
        </div>
        <Field label={t('driverForm.homeDistrict')}>
          {districtsReady ? (
          <select className="input" {...register('home_district_code')}>
            <option value="">{t('driverForm.noDistrict')}</option>
            {districts.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </select>
          ) : (
            <select className="input" disabled><option>{t('common.loading')}</option></select>
          )}
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={mutation.isPending || !vehiclesReady || !districtsReady}>
            {mutation.isPending
              ? t('common.saving')
              : isEdit
                ? t('driverForm.save')
                : t('driverForm.createDriver')}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
