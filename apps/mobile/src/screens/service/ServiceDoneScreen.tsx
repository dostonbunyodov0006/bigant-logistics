import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { colors } from '../../components/theme';
import { formatNumber } from '../../lib/fuel';
import { SERVICE_KEYS, fetchReasons, fmtKm, worksLine } from '../../lib/service';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { Card, FuelScreen, PrimaryButton, f } from '../fuel/fuelUi';

type Nav = NativeStackNavigationProp<RootStackParams>;
type Route = RouteProp<RootStackParams, 'ServiceDone'>;

/** The receipt: where, what, the km, the money, whose money — and when next. */
export function ServiceDoneScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { visit } = useRoute<Route>().params;
  useEffect(() => nav.setOptions({ gestureEnabled: false }), [nav]);

  // The first scheduled work on the visit tells the driver when they are next due.
  const reasonsQ = useQuery({ queryKey: SERVICE_KEYS.reasons, queryFn: fetchReasons });
  const next = (() => {
    if (visit.odometer_km == null) return null;
    for (const item of visit.items) {
      const r = (reasonsQ.data ?? []).find((x) => x.id === item.reason_id);
      if (r?.interval_km) return { name: r.name, km: visit.odometer_km + r.interval_km, interval: r.interval_km };
    }
    return null;
  })();

  const payer =
    visit.settlement === 'station_invoice'
      ? t('service.payerCenter')
      : visit.settlement === 'driver_reimbursement'
        ? t('service.payerDriver')
        : t('service.payerPending');

  return (
    <FuelScreen>
      <ScreenHeader title={t('service.doneTitle')} back={false} />
      <View style={[f.body, s.body]}>
        <View style={s.badge}>
          <Icon name="check" size={34} color={colors.success} strokeWidth={2.6} />
        </View>
        <Text style={f.title}>{t('service.doneTitle')}</Text>

        <Card style={s.receipt}>
          <Row label={t('service.center')} value={visit.resolved_center?.name ?? visit.selected_center?.name ?? t('service.street')} />
          <Row label={t('service.worksLabel')} value={worksLine(visit)} />
          <Row label={t('service.totalLabel')} value={visit.total_sum != null ? `${formatNumber(visit.total_sum)} ${t('fuel.sum')}` : '—'} strong />
          <Row label={t('service.payer')} value={payer} color={visit.settlement === 'station_invoice' ? colors.success : colors.ink} last />
        </Card>

        {next && (
          <Text style={s.next}>{t('service.nextDue', { name: next.name, km: fmtKm(next.km), interval: fmtKm(next.interval) })}</Text>
        )}

        <View style={f.spacer} />
        <View style={{ width: '100%' }}>
          <PrimaryButton label={t('service.home')} onPress={() => nav.popToTop()} />
        </View>
      </View>
    </FuelScreen>
  );
}

function Row({ label, value, strong, color, last }: { label: string; value: string; strong?: boolean; color?: string; last?: boolean }) {
  return (
    <View style={[s.row, !last && s.rowDivider]}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, strong && { fontWeight: '800' }, color ? { color } : null]} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  body: { paddingTop: 70, alignItems: 'center', gap: 14 },
  badge: { width: 72, height: 72, borderRadius: 99, backgroundColor: colors.successBg, alignItems: 'center', justifyContent: 'center' },
  receipt: { width: '100%', marginTop: 6, paddingVertical: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.mist },
  rowLabel: { fontSize: 16, color: colors.slate, fontWeight: '600' },
  rowValue: { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '700', color: colors.ink, fontVariant: ['tabular-nums'] },
  next: {
    width: '100%',
    backgroundColor: colors.successBg,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.success,
    lineHeight: 18,
  },
});
