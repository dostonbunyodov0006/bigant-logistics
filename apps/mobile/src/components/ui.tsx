import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { OrderStatus } from '@bigant/shared';
import { colors, ORDER_STATUS_TONE } from './theme';

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <View style={s.spinnerRow}>
      <ActivityIndicator size="small" color={colors.brand} />
      <Text style={s.spinnerLabel}>{label ?? t('common.loading')}</Text>
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={s.emptyWrap}>
      <Text style={s.emptyTitle}>{title}</Text>
      {hint ? <Text style={s.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  const tone = ORDER_STATUS_TONE[status] ?? ORDER_STATUS_TONE.created;
  return (
    <View style={[s.pill, { backgroundColor: tone.bg }]}>
      <Text style={[s.pillText, { color: tone.fg }]}>{t(`orderStatus.${status}`)}</Text>
    </View>
  );
}

export function SectionHeader({ title }: { title: string }) {
  return <Text style={s.sectionHeader}>{title}</Text>;
}

/**
 * One fact of an order: label left, value right. A value too long for the
 * remainder of the line — an address, a comment — goes under its label on
 * its own lines instead, left-aligned, so it reads as a sentence rather than
 * spilling past the card edge or stacking ragged on the right.
 */
const STACK_FROM = 28;

export function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (value.length > STACK_FROM) {
    return (
      <View style={s.detailStack}>
        <Text style={s.detailLabel}>{label}</Text>
        <Text style={[s.detailValue, s.detailValueStacked, mono && s.mono]}>{value}</Text>
      </View>
    );
  }
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={[s.detailValue, s.detailValueRight, mono && s.mono]}>{value}</Text>
    </View>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={s.errorBanner}>
      <Text style={s.errorText}>{message}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.white,
  },
  spinnerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 24 },
  spinnerLabel: { fontSize: 15, color: colors.slate, fontWeight: '600' },
  emptyWrap: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 16 },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: colors.graphite },
  emptyHint: { marginTop: 4, textAlign: 'center', fontSize: 14, color: colors.slate },
  pill: { alignSelf: 'flex-start', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: '600' },
  sectionHeader: {
    marginBottom: 8,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.slateLt,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingVertical: 6 },
  detailStack: { paddingVertical: 6, gap: 2 },
  detailLabel: { fontSize: 15, color: colors.slate, flexShrink: 0, fontWeight: '600' },
  detailValue: { fontSize: 14, color: colors.ink },
  detailValueRight: { flex: 1, textAlign: 'right' },
  detailValueStacked: { lineHeight: 20 },
  mono: { fontFamily: 'monospace' },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: colors.dangerBg,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorText: { fontSize: 14, color: colors.danger },
});
