import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { colors } from '../../components/theme';
import { formatTime } from '../../lib/format';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { FuelScreen, PrimaryButton, f } from '../fuel/fuelUi';

type Nav = NativeStackNavigationProp<RootStackParams>;
type Route = RouteProp<RootStackParams, 'ShiftCarryDone'>;

/** "Smena tugadi": today's hours, the orders he continues tomorrow, and that the sellers were told. */
export function ShiftCarryDoneScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { log, orders, reason, comment } = useRoute<Route>().params;
  // No way back into the finished form.
  useEffect(() => nav.setOptions({ gestureEnabled: false }), [nav]);
  const minutes = log.duration_minutes ?? 0;

  return (
    <FuelScreen>
      <ScreenHeader title={t('shift.doneTitle')} back={false} />
      <View style={[f.body, s.body]}>
        <View style={s.badge}>
          <Icon name="check" size={34} color={colors.success} strokeWidth={2.6} />
        </View>
        <Text style={f.title}>{t('shift.doneTitle')}</Text>
        <Text style={f.hint}>
          {t('shift.doneTimes', { from: formatTime(log.clock_in_at), to: formatTime(log.clock_out_at), h: Math.floor(minutes / 60), m: minutes % 60 })}
        </Text>

        <View style={s.card}>
          <Text style={s.eyebrow}>{t('shift.tomorrowEyebrow')}</Text>
          {orders.map((o) => (
            <View key={o.id} style={s.row}>
              <View style={s.number}>
                <Text style={s.numberText}>{t('home.clientLabel')}</Text>
              </View>
              <Text style={s.client} numberOfLines={1}>
                {o.client_name}
              </Text>
              <Text style={s.status}>{t(`orderStatus.${o.status}`)}</Text>
            </View>
          ))}
          <View style={[s.row, s.reasonRow]}>
            <Text style={s.reasonLabel}>{t('shift.reasonLabel')}</Text>
            <Text style={s.reasonValue}>{[t(`shift.reasons.${reason}`), comment].filter(Boolean).join(' — ')}</Text>
          </View>
        </View>

        <View style={s.told}>
          <Icon name="bell" size={18} color={colors.success} strokeWidth={2.2} />
          <Text style={s.toldText}>{t('shift.notified')}</Text>
        </View>

        <View style={f.spacer} />
        <View style={{ width: '100%' }}>
          <PrimaryButton label={t('shift.home')} onPress={() => nav.popToTop()} />
        </View>
      </View>
    </FuelScreen>
  );
}

const s = StyleSheet.create({
  body: { paddingTop: 56, alignItems: 'center', gap: 14 },
  badge: { width: 72, height: 72, borderRadius: 99, backgroundColor: colors.successBg, alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', marginTop: 6, backgroundColor: colors.white, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 6 },
  eyebrow: { paddingTop: 12, paddingBottom: 8, fontSize: 12, fontWeight: '800', letterSpacing: 0.7, color: colors.brand },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.chip },
  number: { backgroundColor: colors.chip, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  numberText: { fontSize: 14, fontWeight: '800', color: colors.slate },
  client: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.ink },
  status: { fontSize: 12.5, color: colors.slate },
  reasonRow: { justifyContent: 'space-between', alignItems: 'flex-start' },
  reasonLabel: { fontSize: 15, color: colors.slate, fontWeight: '600' },
  reasonValue: { flex: 1, textAlign: 'right', fontSize: 14, fontWeight: '700', color: colors.ink },
  told: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.successBg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  toldText: { flex: 1, fontSize: 13, color: colors.success },
});
