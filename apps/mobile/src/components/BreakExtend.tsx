import { useEffect, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { DriverMe } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { formatTime } from '../lib/format';
import { gpsGuard } from '../lib/gpsGuard';
import { Sheet } from './Sheet';
import { colors } from './theme';

const CHOICES = [15, 30, 60, 120] as const;

/** Minutes added from the later of now and the break's current end. */
function newEnd(driver: DriverMe | undefined, minutes: number): Date {
  const until = driver?.break_until ? Date.parse(driver.break_until) : 0;
  return new Date(Math.max(Date.now(), until) + minutes * 60_000);
}

/**
 * A longer break (owner, 12.11.2026): how much longer, and why — the reason is
 * always asked, there is no limit on how often. The office sees each one.
 */
export function BreakExtendSheet({ visible, onClose, driver }: { visible: boolean; onClose: () => void; driver: DriverMe | undefined }) {
  const { t } = useTranslation();
  const [minutes, setMinutes] = useState<number>(30);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);
  const extendM = useMutation({
    mutationFn: () => api.post<DriverMe>('/drivers/me/break/extend', { to: newEnd(driver, minutes).toISOString(), reason: reason.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['driver', 'me'] });
      onClose();
    },
    onError: () => Alert.alert(t('errors.generic')),
  });
  const ok = reason.trim().length >= 2;
  return (
    <Sheet visible={visible} onClose={onClose} title={t('breakExtend.title')}>
      <View style={{ gap: 12 }}>
        <View style={s.choices}>
          {CHOICES.map((m) => (
            <Pressable key={m} onPress={() => setMinutes(m)} accessibilityRole="button" style={[s.choice, minutes === m && s.choiceOn]}>
              <Text style={[s.choiceText, minutes === m && s.choiceTextOn]}>{m < 60 ? t('breakExtend.min', { n: m }) : t('breakExtend.hours', { n: m / 60 })}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.until}>{t('breakExtend.until', { time: formatTime(newEnd(driver, minutes).toISOString()) })}</Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder={t('breakExtend.reasonPlaceholder')}
          placeholderTextColor={colors.slateLt}
          style={s.input}
          multiline
          maxLength={200}
          autoCapitalize="sentences"
        />
        <Pressable
          onPress={() => extendM.mutate()}
          disabled={!ok || extendM.isPending}
          accessibilityRole="button"
          style={[s.submit, (!ok || extendM.isPending) && { opacity: 0.5 }]}
        >
          <Text style={s.submitText}>{t('breakExtend.submit')}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

/**
 * The longer-break sheet, opened from the phone's red screen ("TANAFFUSNI
 * CHO'ZISH"). Nothing pops up when the break's end passes (owner, 12.11.2026).
 */
export function BreakLapsedPrompt() {
  const driverQ = useQuery({ queryKey: ['driver', 'me'], queryFn: () => api.get<DriverMe>('/drivers/me'), refetchInterval: 15_000 });
  const driver = driverQ.data;
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  const [extendOpen, setExtendOpen] = useState(false);
  // "TANAFFUSNI CHO'ZISH" pressed on the phone's red screen: the sheet opens.
  useEffect(() => {
    const look = () => {
      if (gpsGuard.consumeAction() === 'extend_break') setExtendOpen(true);
    };
    look();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && look());
    return () => sub.remove();
  }, []);
  // Late back from the break: nothing pops up any more (owner, 12.11.2026); he
  // comes back by pressing Ish boshlandi himself, and the seller's card shows
  // the lateness. "TANAFFUSNI CHO'ZISH" on the phone's red screen still opens
  // the sheet here.
  return (
    <>
      <BreakExtendSheet visible={extendOpen} onClose={() => setExtendOpen(false)} driver={driver} />
    </>
  );
}

const s = StyleSheet.create({
  choices: { flexDirection: 'row', gap: 8 },
  choice: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  choiceOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  choiceText: { fontSize: 15, fontWeight: '700', color: colors.ink },
  choiceTextOn: { color: colors.brandDark },
  until: { fontSize: 14, fontWeight: '600', color: colors.slate },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.mist,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.white,
    textAlignVertical: 'top',
  },
  submit: { height: 52, borderRadius: 14, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.paper, borderRadius: 20, padding: 20, gap: 12 },
  title: { fontSize: 20, fontWeight: '800', color: colors.ink },
  body: { fontSize: 15, color: colors.slate, lineHeight: 21 },
  secondary: { height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 16, fontWeight: '800', color: colors.brandDark },
});
