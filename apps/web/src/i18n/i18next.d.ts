// Make `t()` keys type-safe and autocompletable against the English resource.
import type { Resources } from './en';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: Resources;
    };
  }
}
