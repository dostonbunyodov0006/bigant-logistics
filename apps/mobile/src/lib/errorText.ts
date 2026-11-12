import i18n from '../i18n';

/**
 * What to show the driver when a call fails.
 *
 * The server answers with a code (`fuel_log_already_confirmed`, …), not a
 * sentence, and every code has a line in the dictionary. Anything without
 * one — a dropped connection, something unforeseen — falls back to the
 * general message rather than putting a code on the screen.
 */
export function errorText(err: unknown, fallbackKey = 'errors.generic'): string {
  const code = err instanceof Error ? err.message : '';
  if (/^[a-z][a-z0-9_]*$/.test(code) && i18n.exists(`errors.${code}`)) {
    return i18n.t(`errors.${code}`);
  }
  if (code === 'Network request failed') return i18n.t('errors.network');
  return i18n.t(fallbackKey);
}
