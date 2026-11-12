import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { uz } from './uz';

// Uzbek-first app: default to Uzbek for everyone (the Profile screen still lets a
// driver switch to English manually). This keeps all UI and notifications Uzbek.
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    uz: { translation: uz },
  },
  lng: 'uz',
  fallbackLng: 'uz',
  supportedLngs: ['en', 'uz'],
  // {{start}}/{{end}}: the shift times the office set (Kunlik ish soati); see useShiftTimes.
    interpolation: { escapeValue: false, defaultVariables: { start: '9:00', end: '18:00' } },
});

export default i18n;
