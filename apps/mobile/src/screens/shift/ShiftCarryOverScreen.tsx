import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CARRY_OVER_REASONS, type CarryOverReason, type WorkLogPublic } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { ScreenHeader } from '../../components/ScreenHeader';
import { colors } from '../../components/theme';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { Eyebrow, FuelScreen, PrimaryButton, f } from '../fuel/fuelUi';

type Nav = NativeStackNavigationProp<RootStackParams>;
type Route = RouteProp<RootStackParams, 'ShiftCarryOver'>;

/**
 * "Nega bugun emas?" — the answer to "will you deliver it today?" being no.
 * A pressable reason and a comment (required for "Boshqa"); sending it ends
 * the shift, keeps the orders his for tomorrow, and tells the sellers and
 * admin. It answers whichever button asked: the toggle or the reminder's STOP.
 */
export function ShiftCarryOverScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { orders, via } = useRoute<Route>().params;
  const [reason, setReason] = useState<CarryOverReason | null>(null);
  const [comment, setComment] = useState('');

  const needsComment = reason === 'other';
  const ready = !!reason && (!needsComment || comment.trim().length > 0);

  const endM = useMutation({
    mutationFn: () =>
      api.post<WorkLogPublic>(via === 'stop' ? '/drivers/me/shifts/end-check/stop' : '/drivers/me/shifts/clock-out', {
        carry_over: { reason, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      }),
    onSuccess: (log) => {
      void queryClient.invalidateQueries({ queryKey: ['driver'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      nav.replace('ShiftCarryDone', { log, orders, reason: reason!, comment: comment.trim() || null });
    },
    onError: () => Alert.alert(t('profile.statusChangeFailed'), t('errors.generic')),
  });

  return (
    <KeyboardAvoidingView style={f.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FuelScreen>
        <ScreenHeader title={t('shift.reasonHeader')} />
        <ScrollView contentContainerStyle={f.body} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 4 }}>
            <Text style={s.title}>{t('shift.reasonTitle')}</Text>
            <Text style={s.sub}>{t('shift.reasonOrders', { orders: orders.map((o) => o.client_name).join(' · ') })}</Text>
          </View>

          <View style={s.list}>
            {CARRY_OVER_REASONS.map((code, i) => {
              const on = reason === code;
              return (
                <Pressable
                  key={code}
                  onPress={() => setReason(code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[s.row, i > 0 && s.rowDivider]}
                >
                  <View style={[s.radio, on && s.radioOn]} />
                  <Text style={s.rowText}>{t(`shift.reasons.${code}`)}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ gap: 6 }}>
            <Eyebrow>{needsComment ? t('shift.commentRequired') : t('shift.commentOptional')}</Eyebrow>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder={t('shift.commentPlaceholder')}
              placeholderTextColor={colors.slateLt}
              multiline
              maxLength={500}
              style={s.comment}
            />
          </View>

          <View style={f.spacer} />
          <PrimaryButton label={t('shift.stop')} onPress={() => endM.mutate()} disabled={!ready || endM.isPending} />
          {!ready && <Text style={s.hint}>{!reason ? t('shift.pickReason') : t('shift.needComment')}</Text>}
        </ScrollView>
      </FuelScreen>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', color: colors.ink, letterSpacing: -0.2 },
  sub: { fontSize: 14.5, color: colors.slate, fontWeight: '600' },
  list: { backgroundColor: colors.white, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14, minHeight: 48 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.chip },
  radio: { width: 22, height: 22, borderRadius: 99, borderWidth: 2, borderColor: '#c3c8cf' },
  radioOn: { borderWidth: 7, borderColor: colors.brand },
  rowText: { flex: 1, fontSize: 15.5, fontWeight: '600', color: colors.ink },
  comment: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.mist,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.white,
    textAlignVertical: 'top',
  },
  note: { backgroundColor: colors.brandTint, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12.5, color: colors.warnInk, lineHeight: 18 },
  hint: { fontSize: 12, color: colors.slateLt, textAlign: 'center', marginTop: -4 },
});
