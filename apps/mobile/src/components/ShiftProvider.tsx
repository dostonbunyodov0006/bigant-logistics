import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useBottomInset } from '../lib/useBottomInset';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { KmDue } from '@bigant/shared';
import { api, apiBase } from '../lib/api';
import * as Location from 'expo-location';
import { useShift } from '../hooks/useShift';
import { shiftPrompt } from '../lib/shiftPrompt';
import { ensureShiftLocation, startBackgroundLocation, stopBackgroundLocation } from '../lib/backgroundLocation';
import { gpsGuard } from '../lib/gpsGuard';
import { oneAtATime } from '../lib/oneAtATime';
import { kmDeferredFor } from '../lib/kmDefer';
import { report } from '../lib/crashReport';
import { formatTime } from '../lib/format';
import type { RootStackParams } from '../navigation/RootNavigator';
import { Icon } from './Icon';
import { EndCheckNote, canSendNote } from './EndCheckNote';
import { Sheet } from './Sheet';
import { colors, ORDER_STATUS_TONE } from './theme';

/** Every five minutes with the app closed, in his pocket (owner, 03.11.2026). */
const TRACK_EVERY_MS = 5 * 60_000;

/** One native start at a time; let go after 2 minutes if a dialog never answers (owner, 07.11.2026). */
const nativeStart = oneAtATime();

type Nav = NativeStackNavigationProp<RootStackParams>;
type ShiftValue = ReturnType<typeof useShift> & { openReminder: () => void };

const ShiftContext = createContext<ShiftValue | null>(null);

/**
 * One shift state for the whole home screen: the header toggle, the
 * end-of-day card and the two sheets act on the same thing, so STOP pressed on
 * the card can raise the same "you have orders" question the toggle does.
 */
export function ShiftProvider({ children }: { children: ReactNode }) {
  const shift = useShift();
  const nav = useNavigation<Nav>();
  const { t } = useTranslation();

  // The service follows the shift. Asked again whenever the app comes back:
  // the phone may have been restarted, or the permission given in settings.
  const loaded = !!shift.driver;
  const { onShift } = shift;
  // The phone watches the GPS itself while he is on shift, app open or not.
  const gpsFrom = shift.driver?.gps_required?.from ?? null;
  const gpsUntil = shift.driver?.gps_required?.until ?? null;
  useEffect(() => {
    if (loaded) gpsGuard.setRequired(onShift && gpsFrom && gpsUntil ? { from: gpsFrom, until: gpsUntil } : null);
  }, [loaded, onShift, gpsFrom, gpsUntil]);
  // On a break: GPS alone (owner, 12.11.2026).
  const onlyFrom = shift.driver?.gps_only?.from ?? null;
  const onlyUntil = shift.driver?.gps_only?.until ?? null;
  useEffect(() => {
    if (loaded) gpsGuard.setGpsOnly(onShift && onlyFrom && onlyUntil ? { from: onlyFrom, until: onlyUntil } : null);
  }, [loaded, onShift, onlyFrom, onlyUntil]);
  // The break's end, for the red screen's "extend the break" button (owner, 12.11.2026).
  const breakUntil = shift.driver?.break_until ?? null;
  useEffect(() => {
    if (loaded) gpsGuard.setBreakEnd(onShift && breakUntil ? Date.parse(breakUntil) : 0);
  }, [loaded, onShift, breakUntil]);
  useEffect(() => {
    if (!loaded) return;
    // On an APK with its own location service (1.2.7+) the phone takes and
    // sends the position itself, asleep or not (owner, 05.11.2026); the older
    // JavaScript service is stopped so the two do not both send.
    const native = gpsGuard.tracksNatively();
    if (!onShift) {
      gpsGuard.stopTracking();
      void stopBackgroundLocation();
      return;
    }
    const startNative = () => {
      // One at a time: two at once each fetched a key, and the second cut off the first.
      return nativeStart.run(async () => {
        if (!(await Location.getBackgroundPermissionsAsync()).granted && !(await ensureShiftLocation(t))) return;
        // The phone's own service is proven (owner, 12.11.2026): the older
        // JavaScript one kept running beside it since 05.11 and, with the app
        // closed, sent a position every ~6 s — the battery's cost, for nothing
        // the office needed. It is stopped wherever it is still running.
        void stopBackgroundLocation();
        // The key it already has — a new one each time would cut the service off mid-send.
        if (gpsGuard.resumeTracking()) return;
        try {
          const { key } = await api.post<{ key: string }>('/drivers/me/location-key', {});
          const err = gpsGuard.startTracking(apiBase(), key, TRACK_EVERY_MS);
          if (err) report(new Error(`native location start failed: ${err}`));
        } catch {
          // No key this time (no network): asked again when the app comes back.
        }
      });
    };
    const startOld = async () => {
      if (!(await startBackgroundLocation(t)) && (await ensureShiftLocation(t))) await startBackgroundLocation(t);
    };
    const start = native ? startNative : startOld;
    void start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void (native ? startNative() : startBackgroundLocation(t));
    });
    return () => sub.remove();
  }, [loaded, onShift, t]);
  const [reminderOpen, setReminderOpen] = useState(false);

  // Mondays, once he has started work: the odometer before anything else
  // (owner, 30.10.2026). Asked again on every return home until it is in —
  // unless he tapped "Keyinroq yuboraman" for this shift (audit, 07.11.2026):
  // then not again until the app starts fresh or a new shift begins.
  const shiftStartedAt = shift.driver?.shift_started_at ?? null;
  const kmDue = useQuery({
    queryKey: ['km-due', shift.onShift],
    queryFn: () => api.get<KmDue>('/drivers/me/km/due'),
    enabled: shift.onShift,
  });
  useEffect(() => {
    if (shift.onShift && kmDue.data?.due && !kmDeferredFor(shiftStartedAt))
      nav.navigate('FuelOdometer', { lastKm: kmDue.data.last_km, shiftStartedAt });
  }, [shift.onShift, kmDue.data, nav, shiftStartedAt]);
  const awaiting = shift.onShift && !!shift.endCheck?.awaiting_answer;

  // A tapped reminder push opens the sheet — even one that launched the app.
  useEffect(() => shiftPrompt.subscribe(() => setReminderOpen(true)), []);
  // Answered (here, on another screen, or by the system): nothing left to ask.
  useEffect(() => {
    if (!awaiting) setReminderOpen(false);
  }, [awaiting]);

  return (
    <ShiftContext.Provider value={{ ...shift, openReminder: () => setReminderOpen(true) }}>
      {children}
      <ReminderSheet
        key={shift.endCheck?.asked_at ?? ''}
        visible={reminderOpen && awaiting}
        onClose={() => setReminderOpen(false)}
        shift={shift}
      />
      <OrdersSheet shift={shift} />
    </ShiftContext.Provider>
  );
}

export function useShiftContext(): ShiftValue {
  const v = useContext(ShiftContext);
  if (!v) throw new Error('useShiftContext must be used inside ShiftProvider');
  return v;
}

const addMinutes = (iso: string, m: number) => new Date(new Date(iso).getTime() + m * 60_000).toISOString();

/**
 * "Ish kuningiz tugadimi?" — the push, opened. The last of the three asks
 * says when the shift will close by itself if he still does not answer
 * (owner, 07.11.2026).
 */
function ReminderSheet({ visible, onClose, shift }: { visible: boolean; onClose: () => void; shift: ReturnType<typeof useShift> }) {
  const { t } = useTranslation();
  const bottomInset = useBottomInset();
  const keyboard = useKeyboardHeight();
  // "+30 daqiqa" opens the note first; the sheet closes once it is sent (owner, 07.11.2026).
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const check = shift.endCheck;
  const second = (check?.unanswered ?? 0) > 0;
  // A server from before 07.11 sends no closes_at: there the second ask was the last.
  const closesAt =
    check?.closes_at !== undefined ? check.closes_at : second && check?.asked_at ? addMinutes(check.asked_at, 10) : null;
  const startedAt = shift.driver?.shift_started_at ?? null;
  const worked = startedAt ? Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60_000)) : 0;
  const answer = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={r.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" />
        <View style={[r.sheet, { paddingBottom: keyboard > 0 ? keyboard + 12 : Math.max(bottomInset, 18) + 10 }]}>
          <View style={r.grabber} />
          <View style={r.head}>
            <View style={[r.badge, second && { backgroundColor: colors.dangerBg }]}>
              <Icon name={second ? 'warning' : 'clock'} size={28} color={second ? colors.dangerInk : colors.brand} />
            </View>
            <Text style={r.title}>{second ? t('shift.noAnswerTitle') : t('shift.checkTitle')}</Text>
            <Text style={r.body}>
              {second && check?.asked_at
                ? t('shift.noAnswerBody', { time: formatTime(addMinutes(check.asked_at, -30)) })
                : check?.shift_end
                  ? t('shift.checkBody', { end: check.shift_end })
                  : t('shift.checkBodyNoEnd')}
            </Text>
          </View>

          {noting ? null : closesAt ? (
            <View style={r.warn}>
              <Icon name="clock" size={18} color={colors.dangerInk} strokeWidth={2.2} />
              <Text style={r.warnText}>{t('shift.autoCloseWarn', { time: formatTime(closesAt) })}</Text>
            </View>
          ) : startedAt ? (
            <View style={r.facts}>
              <View style={r.fact}>
                <Text style={r.factLabel}>{t('shift.started')}</Text>
                <Text style={r.factValue}>{formatTime(startedAt)}</Text>
              </View>
              <View style={r.fact}>
                <Text style={r.factLabel}>{t('shift.worked')}</Text>
                <Text style={r.factValue}>{t('shift.workedValue', { h: Math.floor(worked / 60), m: worked % 60 })}</Text>
              </View>
            </View>
          ) : null}

          <Pressable onPress={answer(shift.stop)} disabled={shift.pending} accessibilityRole="button" style={[r.primary, shift.pending && { opacity: 0.5 }]}>
            <Icon name="check" size={18} color={colors.onAccent} strokeWidth={2.4} />
            <Text style={r.primaryText}>{t('shift.stop')}</Text>
          </Pressable>
          {noting ? (
            <EndCheckNote
              note={note}
              onChange={setNote}
              onSend={() => {
                if (canSendNote(note)) shift.extend(note);
              }}
              pending={shift.pending}
              error={shift.extendError}
            />
          ) : (
            <Pressable onPress={() => setNoting(true)} disabled={shift.pending} accessibilityRole="button" style={r.secondary}>
              <Text style={r.secondaryText}>{t('shift.extend')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * "Sizda buyurtma bor — bugun yetkazasizmi?" Yes keeps the shift open;
 * No goes on to the reason, and the shift ends there.
 */
function OrdersSheet({ shift }: { shift: ReturnType<typeof useShift> }) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const prompt = shift.ordersPrompt;
  const orders = prompt?.orders ?? [];

  return (
    <Sheet
      visible={!!prompt}
      onClose={shift.closeOrdersPrompt}
      title={t('shift.ordersTitle')}
      subtitle={orders.length > 1 ? t('shift.ordersQuestionMany') : t('shift.ordersQuestion')}
    >
      <View style={o.list}>
        {orders.map((ord, i) => {
          const tone = ORDER_STATUS_TONE[ord.status] ?? ORDER_STATUS_TONE.created!;
          return (
            <View key={ord.id} style={[o.row, i > 0 && o.rowDivider]}>
              <View style={o.number}>
                <Text style={o.numberText}>{t('home.clientLabel')}</Text>
              </View>
              <Text style={o.client} numberOfLines={1}>
                {ord.client_name}
              </Text>
              <View style={[o.pill, { backgroundColor: tone.bg }]}>
                <Text style={[o.pillText, { color: tone.fg }]}>{t(`orderStatus.${ord.status}`)}</Text>
              </View>
            </View>
          );
        })}
      </View>
      <Pressable onPress={shift.closeOrdersPrompt} accessibilityRole="button" style={o.yes}>
        <Text style={o.yesText}>{t('shift.yesToday')}</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          if (!prompt) return;
          shift.closeOrdersPrompt();
          nav.navigate('ShiftCarryOver', { orders: prompt.orders, via: prompt.via });
        }}
        accessibilityRole="button"
        style={o.no}
      >
        <Text style={o.noText}>{t('shift.noTomorrow')}</Text>
      </Pressable>
    </Sheet>
  );
}

const r = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,24,31,0.55)' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 10, gap: 14 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 99, backgroundColor: colors.mist },
  head: { alignItems: 'center', gap: 8, paddingTop: 6 },
  badge: { width: 56, height: 56, borderRadius: 99, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  body: { fontSize: 14, color: colors.slate, lineHeight: 20, textAlign: 'center', maxWidth: 310 },
  facts: { backgroundColor: colors.paper, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  fact: { flexDirection: 'row', justifyContent: 'space-between' },
  factLabel: { fontSize: 15, color: colors.slate, fontWeight: '600' },
  factValue: { fontSize: 14, fontWeight: '700', color: colors.ink },
  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  warnText: { flex: 1, fontSize: 13.5, color: colors.danger, lineHeight: 19 },
  primary: { height: 56, borderRadius: 16, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { fontSize: 17, fontWeight: '800', color: colors.onAccent },
  secondary: { height: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.mist, alignItems: 'center', justifyContent: 'center', gap: 1 },
  secondaryText: { fontSize: 16, fontWeight: '800', color: colors.ink },
  secondaryHint: { fontSize: 11, color: colors.slate },
});

const o = StyleSheet.create({
  list: { borderWidth: 1, borderColor: colors.mist, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.mist },
  number: { backgroundColor: colors.chip, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  numberText: { fontSize: 14, fontWeight: '800', color: colors.slate },
  client: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.ink },
  pill: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 12, fontWeight: '800' },
  yes: { marginTop: 14, height: 56, borderRadius: 16, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', gap: 1 },
  yesText: { fontSize: 17, fontWeight: '800', color: colors.onAccent },
  yesHint: { fontSize: 11, color: 'rgba(255,255,255,0.9)' },
  no: { marginTop: 10, height: 56, borderRadius: 16, borderWidth: 1.5, borderColor: colors.brand, alignItems: 'center', justifyContent: 'center', gap: 1 },
  noText: { fontSize: 17, fontWeight: '800', color: colors.brandDark },
  noHint: { fontSize: 11, color: colors.slate },
});

