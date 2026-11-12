import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { WheelClock } from './WheelClock';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorText } from '../lib/errorText';
import { tashkentAt, tashkentClock, tashkentDayKey } from '../lib/format';
import { queryClient } from '../lib/queryClient';
import { Sheet } from './Sheet';
import { colors } from './theme';

/**
 * What happens when the driver turns the shift switch off.
 *
 * Turning it off used to end his working day on the spot, which a sleeve
 * against the screen could do. It asks first — "did you ask for time off?" —
 * because nine times out of ten he is stepping away for an hour, not going
 * home.
 *
 * Yes: he sets from and to on the clock, says why, and the day carries on with
 * him marked as away. No: the sheet closes and nothing has happened. Ending
 * the day is still here, at the bottom, where it has to be chosen rather than
 * brushed.
 */
export function BreakSheet({
  visible,
  onClose,
  onDayOff,
  dayOffPending = false,
}: {
  visible: boolean;
  onClose: () => void;
  /** "Polniy": the rest of the day off; the shift ends (owner, 12.11.2026). */
  onDayOff?: (reason: string, then: () => void) => void;
  dayOffPending?: boolean;
}) {
  const { t } = useTranslation();
  const [asked, setAsked] = useState(false);
  // After "yes" (owner, 12.11.2026): the whole day ("Polniy") or a few hours.
  const [kind, setKind] = useState<'day' | 'hours' | null>(null);
  // Spun, not typed: the clock wheel under the two boxes rolls whichever
  // of them was tapped last, hours and minutes under the thumb, no keyboard.
  const [from, setFrom] = useState(() => clockOf(new Date()));
  const [picking, setPicking] = useState<'from' | 'to'>('from');
  // While the reason is being typed the clock wheel folds away: the box and
  // the Save under it then sit above the keyboard whatever the phone does.
  const [typing, setTyping] = useState(false);
  const [to, setTo] = useState(() => clockOf(new Date(Date.now() + 60 * 60_000)));
  const [reason, setReason] = useState('');

  // The clock starts at the moment the sheet opens, not at the moment the app
  // did. This component is mounted all day behind a visibility flag, and an
  // app opened at seven was offering seven o'clock at three in the afternoon.
  useEffect(() => {
    if (!visible) return;
    setFrom(clockOf(new Date()));
    setTo(clockOf(new Date(Date.now() + 60 * 60_000)));
  }, [visible]);

  const close = () => {
    setAsked(false);
    setKind(null);
    setReason('');
    onClose();
  };

  const fromAt = parseClock(from);
  const toAt = parseClock(to);
  // An end before the start is a break running past midnight — the night
  // shift's lunch, not a mistake to refuse.
  const ends =
    fromAt && toAt ? (toAt <= fromAt ? new Date(toAt.getTime() + 86_400_000) : toAt) : null;
  const minutes = fromAt && ends ? Math.round((ends.getTime() - fromAt.getTime()) / 60_000) : 0;
  const valid = fromAt != null && ends != null && minutes > 0 && minutes <= 8 * 60;

  const breakM = useMutation({
    mutationFn: () =>
      api.post('/drivers/me/break', {
        from: fromAt!.toISOString(),
        to: ends!.toISOString(),
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['driver', 'me'] });
      close();
    },
    onError: (err: Error) => Alert.alert(errorText(err)),
  });

  return (
    <Sheet visible={visible} onClose={close} title={asked ? t('shift.askedTitle') : t('home.break')} fullScreen>
      {asked && !kind ? (
        // The second question: the whole day, or a few hours.
        <View style={s.ask}>
          <Text style={s.askTitle}>{t('shift.kindTitle')}</Text>
          <View style={s.row}>
            <Pressable onPress={() => setKind('day')} style={[s.kind, s.kindDay]} accessibilityRole="button">
              <Text style={s.kindTitle}>{t('shift.kindDay')}</Text>
              <Text style={s.kindHint}>{t('shift.kindDayHint')}</Text>
            </Pressable>
            <Pressable onPress={() => setKind('hours')} style={[s.kind, s.kindHours]} accessibilityRole="button">
              <Text style={[s.kindTitle, { color: colors.onAccent }]}>{t('shift.kindHours')}</Text>
              <Text style={[s.kindHint, { color: colors.onAccent }]}>{t('shift.kindHoursHint')}</Text>
            </Pressable>
          </View>
          <Pressable onPress={close} style={s.cancel} accessibilityRole="button">
            <Text style={s.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      ) : asked && kind === 'day' ? (
        <View style={s.ask}>
          <Text style={s.askTitle}>{t('shift.dayOffTitle')}</Text>
          <Text style={s.dayBody}>{t('shift.dayOffBody')}</Text>
          <TextInput
            style={s.input}
            value={reason}
            onChangeText={setReason}
            placeholder={t('shift.dayOffReasonPlaceholder')}
            placeholderTextColor={colors.slateLt}
            multiline
          />
          <Pressable
            onPress={() => onDayOff?.(reason, close)}
            disabled={dayOffPending}
            style={[s.save, s.dayOffBtn, dayOffPending && { opacity: 0.6 }]}
            accessibilityRole="button"
          >
            <Text style={s.saveText}>{t('shift.dayOffConfirm')}</Text>
          </Pressable>
          <Pressable onPress={() => setKind(null)} style={s.cancel} accessibilityRole="button">
            <Text style={s.cancelText}>{t('common.back')}</Text>
          </Pressable>
        </View>
      ) : !asked ? (
        // The one question, in the middle of the screen where the eye lands,
        // with the two answers under it.
        <View style={s.ask}>
          <Text style={s.askTitle}>{t('shift.askedTitle')}</Text>
          <View style={s.row}>
            <Pressable onPress={() => setAsked(true)} style={[s.btn, s.yes]} accessibilityRole="button">
              <Text style={s.yesText}>{t('common.yes')}</Text>
            </Pressable>
            <Pressable onPress={close} style={[s.btn, s.no]} accessibilityRole="button">
              <Text style={s.noText}>{t('common.no')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <Text style={s.label}>{t('shift.howLong')}</Text>
          <View style={s.row}>
            <Pressable style={[s.time, picking === 'from' && s.timeOn]} onPress={() => setPicking('from')} accessibilityRole="button">
              <Text style={s.timeLabel}>{t('shift.from')}</Text>
              <Text style={s.timeInput}>{from}</Text>
            </Pressable>
            <Pressable style={[s.time, picking === 'to' && s.timeOn]} onPress={() => setPicking('to')} accessibilityRole="button">
              <Text style={s.timeLabel}>{t('shift.to')}</Text>
              <Text style={s.timeInput}>{to}</Text>
            </Pressable>
          </View>
          {!typing && (
            <WheelClock
              value={picking === 'from' ? from : to}
              onChange={picking === 'from' ? setFrom : setTo}
            />
          )}
          {!valid && from.length === 5 && to.length === 5 ? (
            <Text style={s.bad}>{t('shift.badTime')}</Text>
          ) : null}


          <Text style={s.label}>{t('shift.breakReason')}</Text>
          <TextInput
            style={s.input}
            value={reason}
            onChangeText={setReason}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            placeholder={t('shift.breakReasonPlaceholder')}
            placeholderTextColor={colors.slateLt}
            multiline
          />

          <Pressable
            onPress={() => breakM.mutate()}
            disabled={breakM.isPending || !valid}
            style={[s.save, (breakM.isPending || !valid) && { opacity: 0.6 }]}
            accessibilityRole="button"
          >
            <Text style={s.saveText}>{t('common.save')}</Text>
          </Pressable>
          <Pressable onPress={close} style={s.cancel} accessibilityRole="button">
            <Text style={s.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  timeOn: { borderColor: colors.brand, borderWidth: 2 },
  ask: { flex: 1, justifyContent: 'center', gap: 22, paddingBottom: 80 },
  askTitle: { fontSize: 24, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  kind: { flex: 1, alignItems: 'center', gap: 6, borderRadius: 16, paddingVertical: 22, paddingHorizontal: 10 },
  kindDay: { borderWidth: 1.5, borderColor: colors.danger, backgroundColor: colors.white },
  kindHours: { backgroundColor: colors.brand },
  kindTitle: { fontSize: 20, fontWeight: '800', color: colors.danger },
  kindHint: { fontSize: 13, fontWeight: '600', color: colors.slate, textAlign: 'center' },
  dayBody: { fontSize: 15, color: colors.slate, textAlign: 'center', lineHeight: 21 },
  dayOffBtn: { backgroundColor: colors.danger },
  btn: { flex: 1, alignItems: 'center', borderRadius: 14, paddingVertical: 16 },
  yes: { backgroundColor: colors.brand },
  yesText: { fontSize: 16, fontWeight: '800', color: colors.onAccent },
  no: { borderWidth: 1, borderColor: colors.mist, backgroundColor: colors.white },
  noText: { fontSize: 16, fontWeight: '700', color: colors.graphite },
  label: { marginTop: 12, marginBottom: 8, fontSize: 13, fontWeight: '700', color: colors.slate },
  time: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.white,
    paddingVertical: 12,
  },
  timeLabel: { fontSize: 12, fontWeight: '600', color: colors.slate },
  timeInput: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
    textAlign: 'center',
    paddingVertical: 2,
    minWidth: 100,
  },
  quick: { flexDirection: 'row', gap: 8, marginTop: 10 },
  quickBtn: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.mist,
    paddingVertical: 10,
  },
  quickText: { fontSize: 13, fontWeight: '700', color: colors.brandDark },
  bad: { marginTop: 8, fontSize: 13, fontWeight: '600', color: colors.danger },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  save: {
    marginTop: 16,
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: colors.brand,
    paddingVertical: 16,
  },
  saveText: { fontSize: 16, fontWeight: '800', color: colors.onAccent },
  cancel: { marginTop: 8, alignItems: 'center', paddingVertical: 12 },
  cancelText: { fontSize: 14, fontWeight: '700', color: colors.slate },
});

/** "14:05" from a moment — Tashkent's clock, not the phone's (owner, 06.11.2026). */
function clockOf(d: Date): string {
  return tashkentClock(d);
}


/** Today at that hour, or null while it is not yet a time of day. Both the
 *  day and the hour are Tashkent's: on a phone set to another zone setHours
 *  sent the office a break hours off (owner, 06.11.2026). */
function parseClock(value: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return tashkentAt(tashkentDayKey(), h, min);
}
