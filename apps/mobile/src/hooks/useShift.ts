import { ensureShiftLocation } from '../lib/backgroundLocation';
import { useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { DriverMe, OrderInHand } from '@bigant/shared';
import { api, ApiError } from '../lib/api';
import { errorText } from '../lib/errorText';
import { formatTime } from '../lib/format';
import { gpsGuard } from '../lib/gpsGuard';
import { oneAtATime } from '../lib/oneAtATime';
import { deliver } from '../lib/locationQueue';
import { queryClient } from '../lib/queryClient';

/**
 * Drives the header's ON/OFF duty toggle.
 *
 * Lateness is decided by the server, never here: we simply try to clock in, and
 * if the server answers `late_reason_required` we open the accountability prompt
 * and retry with the reason. That keeps the check honest even when the phone's
 * clock is wrong, the settings request is still in flight, or the network is
 * flaky — the old client-side comparison silently let all of those through.
 */
/**
 * Whether he has pressed Ish boshlandi — readable on any screen, not only
 * inside ShiftProvider (an order opened from the list sits outside it). Same
 * cache as useShift; while it is still loading, the server is the guard.
 */
export function useOnShift(): boolean {
  const driverQ = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => api.get<DriverMe>('/drivers/me'),
    refetchInterval: 15_000,
  });
  return driverQ.data ? !!driverQ.data.shift_started_at : true;
}

/**
 * Before the shift ends, the positions kept on the phone go first — from the
 * phone's own service and from the app's queue — so the evening extra is
 * worked out with the road home on it (owner, 05.11.2026).
 */
async function sendKeptPositions(): Promise<void> {
  await Promise.all([gpsGuard.flushTracking(), deliver([]).catch(() => undefined)]);
}

export function useShift() {
  const { t } = useTranslation();

  const driverQ = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => api.get<DriverMe>('/drivers/me'),
    // Poll so the status self-heals for changes the app didn't initiate.
    refetchInterval: 15_000,
  });
  const driver = driverQ.data;

  const [reasonMode, setReasonMode] = useState<'late' | 'early' | null>(null);
  const [reasonText, setReasonText] = useState('');
  // Ending the shift with orders in hand: the server lists them and the app
  // asks "will you deliver today?". `via` is which button asked — the toggle
  // or STOP on the end-of-day reminder — so "not today" answers the same one.
  const [ordersPrompt, setOrdersPrompt] = useState<{ orders: OrderInHand[]; via: 'toggle' | 'stop' } | null>(null);
  const ordersFrom = (err: Error): OrderInHand[] | null =>
    err.message === 'driver_has_orders' && err instanceof ApiError
      ? ((err.body as { orders?: OrderInHand[] }).orders ?? [])
      : null;

  const closeReason = () => {
    setReasonMode(null);
    setReasonText('');
  };
  const done = () => {
    closeReason();
    void queryClient.invalidateQueries({ queryKey: ['driver', 'me'] });
  };

  const clockInM = useMutation({
    mutationFn: (arg?: string | { onLeaveOk: true }) =>
      api.post(
        '/drivers/me/shifts/clock-in',
        typeof arg === 'string' ? { late_reason: arg } : arg ? { on_leave_ok: true } : {},
      ),
    onSuccess: done,
    onError: (err: Error) => {
      // Today is his leave: say so, and let him start all the same.
      if (err.message === 'on_leave_today') {
        Alert.alert(t('shift.onLeaveTitle'), t('shift.onLeaveBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('shift.onLeaveStart'), onPress: () => clockInM.mutate({ onLeaveOk: true }) },
        ]);
        return;
      }
      // The server says this is a late arrival — collect the reason and retry.
      if (err.message === 'late_reason_required') {
        setReasonMode('late');
        return;
      }
      Alert.alert(t('profile.statusChangeFailed'), errorText(err));
    },
  });

  const clockOutM = useMutation({
    mutationFn: async (arg?: string | { dayOff: true; reason: string }) => {
      await sendKeptPositions();
      // "Polniy" (owner, 12.11.2026): the rest of the day off, asked for.
      if (typeof arg === 'object') {
        return api.post('/drivers/me/shifts/clock-out', {
          day_off: true,
          ...(arg.reason.trim() ? { early_leave_reason: arg.reason.trim() } : {}),
        });
      }
      return api.post(
        '/drivers/me/shifts/clock-out',
        arg ? { early_leave_reason: arg } : {},
      );
    },
    onSuccess: done,
    onError: (err: Error) => {
      const orders = ordersFrom(err);
      if (orders) {
        setOrdersPrompt({ orders, via: 'toggle' });
        return;
      }
      if (err.message === 'early_leave_reason_required') {
        setReasonMode('early');
        return;
      }
      const msg =
        err.message === 'driver_has_pending_return'
          ? t('errors.driverHasPendingReturn')
          : err.message === 'driver_busy_finish_delivery'
            ? t('errors.driverBusyFinishDelivery')
            : errorText(err);
      Alert.alert(t('profile.statusChangeFailed'), msg);
    },
  });

  // The end-of-day reminder's two answers.
  const stopM = useMutation({
    mutationFn: async () => {
      await sendKeptPositions();
      return api.post('/drivers/me/shifts/end-check/stop', {});
    },
    onSuccess: done,
    onError: (err: Error) => {
      const orders = ordersFrom(err);
      if (orders) setOrdersPrompt({ orders, via: 'stop' });
      else Alert.alert(t('profile.statusChangeFailed'), errorText(err));
    },
  });
  // "+30" carries what work he is still on (owner, 07.11.2026); a failure is
  // shown under the note on the card, not in an alert box.
  const extendM = useMutation({
    mutationFn: (note: string) => api.post('/drivers/me/shifts/end-check/extend', { note: note.trim() }),
    onSuccess: done,
  });

  const onShift = !!driver?.shift_started_at;
  const pending = clockInM.isPending || clockOutM.isPending || stopM.isPending || extendM.isPending;
  // Tashkent's clock, whatever zone the phone is set to (owner, 06.11.2026).
  const shiftStartedTime = driver?.shift_started_at ? formatTime(driver.shift_started_at) : '';

  // One toggle at a time (audit, 07.11.2026): `pending` only turns on once the
  // request starts, so a double tap ran two permission-dialog chains and two
  // clock-ins while the first still waited on the dialogs. Released after
  // 2 minutes if a dialog never answers (owner, 07.11.2026).
  const [toggling] = useState(() => oneAtATime());
  const handleToggle = async () => {
    if (!driver || pending) return;
    await toggling.run(async () => {
      // Always attempt without a reason first; the server decides if one is needed.
      if (onShift) clockOutM.mutate(undefined);
      else if (await ensureShiftLocation(t)) clockInM.mutate(undefined);
    });
  };

  const submitReason = () => {
    const reason = reasonText.trim();
    if (!reason) return;
    if (reasonMode === 'late') clockInM.mutate(reason);
    else if (reasonMode === 'early') clockOutM.mutate(reason);
  };

  return {
    driver,
    onShift,
    pending,
    shiftStartedTime,
    handleToggle,
    reasonMode,
    reasonText,
    setReasonText,
    submitReason,
    closeReason,
    endCheck: driver?.shift_end_check ?? null,
    stop: () => stopM.mutate(),
    dayOff: (reason: string, then?: () => void) => clockOutM.mutate({ dayOff: true, reason }, { onSuccess: () => then?.() }),
    extend: (note: string) => extendM.mutate(note),
    extendError: extendM.error ? errorText(extendM.error) : null,
    ordersPrompt,
    closeOrdersPrompt: () => setOrdersPrompt(null),
  };
}
