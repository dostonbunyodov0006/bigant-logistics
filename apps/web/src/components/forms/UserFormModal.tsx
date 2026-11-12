import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  UZ_PHONE_PREFIX,
  uzPhoneSchema,
  type ManageableRole,
  type UserPublic,
} from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote, Field } from '../ui';

import { UzPhoneInput } from '../UzPhoneInput';
import { PasswordInput } from '../PasswordInput';
const formSchema = z.object({
  name: z.string().min(1),
  phone_number: uzPhoneSchema,
  password: z.string().optional(),
  telegram_id: z.string().trim().regex(/^\d{0,15}$/),
});
type FormValues = z.infer<typeof formSchema>;

export function UserFormModal({
  open,
  onClose,
  role,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  role: ManageableRole;
  editing?: UserPublic | null;
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
    defaultValues: { name: '', phone_number: UZ_PHONE_PREFIX, password: '', telegram_id: '' },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: editing?.name ?? '',
        phone_number: editing?.phone_number ?? UZ_PHONE_PREFIX,
        password: '',
        telegram_id: editing?.telegram_id ?? '',
      });
    }
  }, [open, editing, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      if (isEdit && editing) {
        const payload: Record<string, string | null> = {
          name: values.name,
          phone_number: values.phone_number,
        };
        if (role === 'seller') payload.telegram_id = values.telegram_id || null;
        if (values.password) payload.password = values.password;
        return api.patch<UserPublic>(`/users/${editing.id}`, payload);
      }
      return api.post<UserPublic>('/users', {
        name: values.name,
        phone_number: values.phone_number,
        password: values.password,
        role,
        ...(role === 'seller' ? { telegram_id: values.telegram_id || null } : {}),
      });
    },
    onSuccess: () => {
      // ['users'] and not ['users', role]: the list key is ['users', 'page', role, …],
      // which a positional prefix of ['users', role] never matches.
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      // Edited from the seller's own page now, so the single-account query has
      // to be told as well — otherwise the header keeps the old name.
      void queryClient.invalidateQueries({ queryKey: ['user'] });
      reset();
      onClose();
    },
  });

  const onSubmit = (values: FormValues) => {
    const pw = values.password ?? '';
    // Password required on create; on edit it's optional but min 6 if provided.
    if ((!isEdit && pw.length < 6) || (isEdit && pw.length > 0 && pw.length < 6)) {
      setError('password', { message: t('userForm.passwordPlaceholder') });
      return;
    }
    mutation.mutate(values);
  };

  const title = isEdit
    ? t('userForm.editTitle')
    : role === 'admin'
      ? t('userForm.createAdminTitle')
      : role === 'manager'
        ? t('userForm.createManagerTitle')
        : t('userForm.createSellerTitle');

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {mutation.isError && <ErrorNote error={mutation.error} />}
        <Field label={t('userForm.name')} error={errors.name?.message}>
          <input className="input" {...register('name')} />
        </Field>
        <Field label={t('userForm.phoneNumber')} error={errors.phone_number?.message}>
          <Controller
            control={control}
            name="phone_number"
            render={({ field }) => <UzPhoneInput {...field} className="input" />}
          />
        </Field>
        <Field label={t('userForm.password')} error={errors.password?.message}>
          <PasswordInput
            className="input"
            autoComplete="new-password"
            placeholder={
              isEdit ? t('userForm.passwordKeepBlank') : t('userForm.passwordPlaceholder')
            }
            {...register('password')}
          />
        </Field>
        {role === 'seller' && (
          <Field
            label={t('userForm.telegramId')}
            error={errors.telegram_id ? t('userForm.telegramIdInvalid') : undefined}
          >
            <input className="input" inputMode="numeric" {...register('telegram_id')} />
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? t('common.saving')
              : isEdit
                ? t('userForm.save')
                : t('userForm.create')}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
