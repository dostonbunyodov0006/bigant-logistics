import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { en } from './en';
import { uz } from './uz';

export const SUPPORTED_LANGUAGES = [
  { code: 'uz', label: "O'zbekcha", short: 'UZ' },
  { code: 'en', label: 'English', short: 'EN' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      uz: { translation: uz },
    },
    fallbackLng: 'uz',
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    // {{start}}/{{end}}: the shift times the office set (Kunlik ish soati); see useShiftTimes.
    interpolation: { escapeValue: false, defaultVariables: { start: '9:00', end: '18:00' } },
    detection: {
      // Persist the user's choice; key matches the rest of the app's `bigant.*` prefix.
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'bigant.lang',
      caches: ['localStorage'],
    },
  });

export default i18n;
