import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A password field with an eye: tapped, it shows what was typed, so the admin
 * giving a driver his password can check it before saving. The saved password
 * itself is never shown — the server keeps only its hash.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  function PasswordInput({ className = '', ...props }, ref) {
    const { t } = useTranslation();
    const [shown, setShown] = useState(false);
    return (
      <div className="relative">
        <input {...props} ref={ref} type={shown ? 'text' : 'password'} className={`${className} pr-11`} />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? t('common.hidePassword') : t('common.showPassword')}
          title={shown ? t('common.hidePassword') : t('common.showPassword')}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[#6b7480] hover:text-[#14181f]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
            {shown ? null : <line x1="3" y1="3" x2="21" y2="21" />}
          </svg>
        </button>
      </div>
    );
  },
);
