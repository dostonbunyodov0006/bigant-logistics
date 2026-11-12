import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { UZ_PHONE_PREFIX, uzPhoneSchema, type DriverPublic } from '@bigant/shared';
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

/**
 * A driver's sign-in, from Foydalanuvchilar: the same short form a seller's
 * account has — name, phone, password, Telegram ID — for handing a driver his login. The
 * lorry, licence and the rest stay on the full form under Haydovchilar.
 */
export function DriverAccountModal({ driver, onClose }: { driver: DriverPublic | null; onClose: () => void }) {
  const { t } = useTranslation();
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
    if (driver) reset({ name: driver.name, phone_number: driver.phone_number, password: '', telegram_id: driver.telegram_id ?? '' });
  }, [driver, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      api.patch<DriverPublic>(`/drivers/${driver!.id}`, {
        name: values.name,
        phone_number: values.phone_number,
        telegram_id: values.telegram_id || null,
        ...(values.password ? { password: values.password } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      onClose();
    },
  });

  const onSubmit = (values: FormValues) => {
    if (values.password && values.password.length < 6) {
      setError('password', { message: t('userForm.passwordPlaceholder') });
      return;
    }
    mutation.mutate(values);
  };

  return (
    <Modal open={!!driver} onClose={onClose} title={t('userForm.editTitle')}>
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
            placeholder={t('userForm.passwordKeepBlank')}
            {...register('password')}
          />
        </Field>
        <Field
          label={t('userForm.telegramId')}
          error={errors.telegram_id ? t('userForm.telegramIdInvalid') : undefined}
        >
          <input className="input" inputMode="numeric" {...register('telegram_id')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? t('common.saving') : t('userForm.save')}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
