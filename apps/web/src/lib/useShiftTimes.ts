import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import i18n from '../i18n';
import type { WorkSettings } from '@bigant/shared';
import { api } from './api';

/**
 * The shift start and end the office set under Kunlik ish soati, for the
 * labels that name them ("9:00 dan oldin", "18:00 dan keyin") — they used to
 * be written into the text (owner, 30.10.2026).
 */
export function useShiftTimes(enabled = true): { start: string; end: string } {
  const q = useQuery({
    queryKey: ['settings', 'work'],
    queryFn: () => api.get<WorkSettings>('/settings/work'),
    staleTime: 5 * 60_000,
    enabled,
  });
  const trim = (hhmm: string) => hhmm.replace(/^0(\d):/, '$1:');
  return { start: trim(q.data?.shift_start ?? '09:00'), end: trim(q.data?.shift_end ?? '18:00') };
}

/** Puts the office's shift times into every label that names them. Mounted once. */
export function useShiftTimeLabels(signedIn: boolean): void {
  const { start, end } = useShiftTimes(signedIn);
  useEffect(() => {
    const opts = i18n.options.interpolation ?? (i18n.options.interpolation = {});
    opts.defaultVariables = { ...(opts.defaultVariables ?? {}), start, end };
    void i18n.changeLanguage(i18n.language);
  }, [start, end]);
}
