import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { colors } from '../../components/theme';
import { fuelLabel, pumpQty, pumpSum } from '../../lib/fuel';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Card, PrimaryButton, f, FuelScreen } from './fuelUi';

type Nav = NativeStackNavigationProp<RootStackParams>;
type Route = RouteProp<RootStackParams, 'FuelDone'>;

/** Step 5: the receipt. Station, fuel, total, and whose money it was. */
export function FuelDoneScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { log } = useRoute<Route>().params;
  // No way back into a confirmed log: the header has no arrow, and the swipe
  // gesture is off so the review screen of a spent draft cannot be reached.
  useEffect(() => nav.setOptions({ gestureEnabled: false }), [nav]);

  const payer =
    log.settlement === 'station_invoice'
      ? t('fuel.payerStation')
      : log.settlement === 'driver_reimbursement'
        ? t('fuel.payerDriver')
        : t('fuel.payerPending');
  const payerColor = log.settlement === 'station_invoice' ? colors.success : colors.ink;
  const reading = log.confirmed;

  return (
    <FuelScreen>
      <ScreenHeader title={t('fuel.doneTitle')} back={false} />
      <View style={[f.body, s.body]}>
        <View style={s.badge}>
          <Icon name="check" size={34} color={colors.success} strokeWidth={2.6} />
        </View>
        <Text style={f.title}>{t('fuel.doneTitle')}</Text>

        <Card style={s.receipt}>
          <Row label={t('fuel.stationLabel')} value={log.resolved_station?.name ?? log.selected_station?.name ?? t('fuel.street')} />
          {/* One fact per line, in the pump's order: the fuel, how much,
              the price of one, the total. */}
          <Row label={t('fuel.fuelLabel')} value={fuelLabel(t, log.fuel_type)} />
          <Row
            label={log.fuel_type === 'gaz' ? 'm³' : t('fuel.lineQty', { word: t('fuel.wordLitr') })}
            value={reading ? pumpQty(reading.quantity) : '—'}
          />
          <Row
            label={t('fuel.linePrice', { word: log.fuel_type === 'gaz' ? 'm³' : t('fuel.wordLitr') })}
            value={reading ? `${pumpSum(reading.unit_price_sum)} ${t('fuel.sum')}` : '—'}
          />
          <Row label={t('fuel.lineTotal')} value={reading ? `${pumpSum(reading.total_sum)} ${t('fuel.sum')}` : '—'} strong />
          <Row label={t('fuel.payer')} value={payer} color={payerColor} last />
        </Card>

        <View style={f.spacer} />
        <View style={{ width: '100%' }}>
          <PrimaryButton label={t('fuel.home')} onPress={() => nav.popToTop()} />
        </View>
      </View>
    </FuelScreen>
  );
}

function Row({ label, value, strong, color, last }: { label: string; value: string; strong?: boolean; color?: string; last?: boolean }) {
  return (
    <View style={[s.row, !last && s.rowDivider]}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, strong && { fontWeight: '800' }, color ? { color } : null]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  body: { paddingTop: 70, alignItems: 'center', gap: 14 },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 99,
    backgroundColor: colors.successBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receipt: { width: '100%', marginTop: 10, paddingVertical: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.mist },
  rowLabel: { fontSize: 16, color: colors.slate, fontWeight: '600' },
  rowValue: { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '700', color: colors.ink, fontVariant: ['tabular-nums'] },
});
