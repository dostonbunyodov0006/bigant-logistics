import { TZ } from './tashkent';
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  return new Date(iso).toLocaleString(undefined, { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
}

