import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { SUPPORTED_LANGUAGES } from '../i18n';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const active = i18n.resolvedLanguage;

  return (
    <div className="flex items-center rounded-lg border border-mist p-0.5">
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          type="button"
          onClick={() => void i18n.changeLanguage(lang.code)}
          className={clsx(
            'rounded-md px-2 py-1 font-mono text-xs font-semibold transition',
            active === lang.code ? 'bg-brand-tint text-brand-dark' : 'text-slate hover:text-ink',
          )}
        >
          {lang.short}
        </button>
      ))}
    </div>
  );
}
