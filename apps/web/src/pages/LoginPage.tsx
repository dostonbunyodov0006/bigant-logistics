import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { loginSchema, type LoginInput } from '@bigant/shared';
import { DriverNotAllowedError, useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/api';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { UzPhoneInput } from '../components/UzPhoneInput';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone_number: '', password: '' },
  });

  if (user) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.phone_number, values.password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof DriverNotAllowedError
          ? t('login.driverNotAllowed')
          : err instanceof ApiError && err.status === 401
            ? t('login.invalidCredentials')
            : t('login.genericError'),
      );
    }
  });

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink p-10 text-white md:flex">
        <div className="font-display text-2xl font-extrabold tracking-tight">
          BIG<span className="text-brand">ANT</span>
        </div>
        <div className="relative z-10">
          <h1 className="font-display text-4xl font-bold leading-tight">
            {t('login.heroLine1')}
            <br />
            {t('login.heroLine2')}
          </h1>
          <p className="mt-4 max-w-sm text-sm text-white/60">{t('login.heroSubtitle')}</p>
        </div>
        <div className="text-xs text-white/40">{t('login.consoleLabel')}</div>
        <svg
          aria-hidden
          className="pointer-events-none absolute -right-10 bottom-0 h-[120%] w-[70%] opacity-[0.14]"
          viewBox="0 0 200 400"
          fill="none"
        >
          <path
            d="M40 0 C 120 80, -20 160, 80 240 S 160 360, 100 400"
            stroke="#e2630b"
            strokeWidth="2"
            strokeDasharray="2 10"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <div className="relative flex items-center justify-center p-6">
        <div className="absolute right-6 top-6">
          <LanguageSwitcher />
        </div>
        <form onSubmit={onSubmit} className="w-full max-w-sm" noValidate>
          <div className="mb-8 font-display text-2xl font-extrabold md:hidden">
            BIG<span className="text-brand">ANT</span>
          </div>
          <h2 className="font-display text-2xl font-bold">{t('login.title')}</h2>
          <p className="mt-1 text-sm text-slate">{t('login.subtitle')}</p>

          {error && (
            <div className="mt-4 rounded-lg bg-[#fdeaea] px-3 py-2 text-sm text-[#dc2626]">
              {error}
            </div>
          )}

          <div className="mt-6">
            <label className="field-label" htmlFor="phone">
              {t('login.phone')}
            </label>
            <Controller
              control={control}
              name="phone_number"
              render={({ field }) => (
                <UzPhoneInput {...field} id="phone" className="input" autoComplete="username" />
              )}
            />
            {errors.phone_number && (
              <p className="mt-1 text-xs text-[#dc2626]">{errors.phone_number.message}</p>
            )}
          </div>

          <div className="mt-4">
            <label className="field-label" htmlFor="password">
              {t('login.password')}
            </label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="••••••••"
              autoComplete="current-password"
              {...register('password')}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-[#dc2626]">{errors.password.message}</p>
            )}
          </div>

          <button type="submit" disabled={isSubmitting} className="btn-primary mt-6 w-full">
            {isSubmitting ? t('login.signingIn') : t('login.signIn')}
          </button>
        </form>
      </div>
    </div>
  );
}
