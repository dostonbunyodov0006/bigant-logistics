import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ServiceVisit } from '@bigant/shared';
import { errorText } from '../lib/errorText';
import { api } from '../lib/api';
import { formatDate, formatTime } from '../lib/format';
import { SERVICE_KEYS, currentVisit, fetchMyDue, fetchMyVisits, fmtKm, invalidateService, remainingLabel, worksLine } from '../lib/service';
import type { RootStackParams } from '../navigation/RootNavigator';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { colors } from './theme';

type Nav = NativeStackNavigationProp<RootStackParams>;

/**
 * What the home screen says about the truck's upkeep, above the order card.
 *
 * Two things at most: a strip for the most urgent work in range (amber
 * inside 1 000 km, red once overdue — the strip is the reminder made
 * visible; nothing is blocked), and a card for the one visit that is open —
 * waiting for admin, approved with the start button, or in progress with
 * the way back into the photos.
 */
export function ServiceHomeCards() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const toast = useToast();

  const dueQ = useQuery({ queryKey: SERVICE_KEYS.due, queryFn: fetchMyDue, refetchInterval: 60_000 });
  const visitsQ = useQuery({ queryKey: SERVICE_KEYS.visits, queryFn: fetchMyVisits, refetchInterval: 30_000 });

  const visit = currentVisit(visitsQ.data ?? []);
  // The strip is quiet about works the open visit already covers.
  const covered = new Set(visit?.items.map((i) => i.reason_id) ?? []);
  const due = (dueQ.data ?? []).filter((d) => d.remaining_km != null && !covered.has(d.reason_id));
  const top = due[0] ?? null;

  const cancelM = useMutation({
    mutationFn: (id: string) => api.del<ServiceVisit>(`/service/visits/${id}`),
    onSuccess: () => {
      invalidateService();
      toast.showSuccess(t('service.cancelled'));
    },
    onError: (err) => Alert.alert(errorText(err)),
  });

  if (!top && !visit) return null;

  return (
    <View style={s.wrap}>
      {top && (
        <Pressable
          onPress={() => nav.navigate('ServiceReasons', { preselect: due.map((d) => d.reason_id) })}
          accessibilityRole="button"
          style={[s.strip, top.remaining_km! < 0 && s.stripOverdue]}
        >
          <Icon name="wrench" size={18} color={top.remaining_km! < 0 ? colors.danger : colors.warn} strokeWidth={2.2} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={[s.stripTitle, top.remaining_km! < 0 && { color: colors.danger }]} numberOfLines={1}>
              {t('service.dueStrip', { name: top.reason_name, left: remainingLabel(t, top.remaining_km) })}
              {due.length > 1 ? `  ${t('service.dueStripMore', { n: due.length - 1 })}` : ''}
            </Text>
            <Text style={[s.stripSub, top.remaining_km! < 0 && { color: colors.danger }]} numberOfLines={1}>
              {t(top.remaining_km! < 0 ? 'service.dueStripSubOverdue' : 'service.dueStripSub', {
                km: top.current_km != null ? fmtKm(top.current_km) : '—',
                due: top.due_km != null ? fmtKm(top.due_km) : '—',
              })}
            </Text>
          </View>
          <Icon name="chevron-right" size={16} color={top.remaining_km! < 0 ? colors.danger : colors.warn} strokeWidth={2.5} />
        </Pressable>
      )}

      {visit && (
        <View style={s.card}>
          <View style={s.cardHead}>
            <Icon name="wrench" size={15} color={colors.brand} strokeWidth={2.2} />
            <Text style={s.eyebrow}>{visit.origin === 'request' ? t('service.cardEyebrowRequest') : t('service.cardEyebrow')}</Text>
            <View style={{ flex: 1 }} />
            <StatusPill status={visit.status} />
          </View>
          <Text style={s.works}>{worksLine(visit)}</Text>
          <Text style={s.when}>
            {visit.origin === 'emergency'
              ? t('service.emergencyLine')
              : visit.scheduled_at
                ? t('service.when', { date: formatDate(visit.scheduled_at), time: formatTime(visit.scheduled_at) })
                : ''}
            {visit.selected_center ? ` · ${visit.selected_center.name}` : ''}
          </Text>

          {visit.status === 'approved' && (
            <Pressable onPress={() => nav.navigate('ServicePicker', { visitId: visit.id })} accessibilityRole="button" style={s.cta}>
              <Text style={s.ctaText}>{t('service.cardStart')}</Text>
            </Pressable>
          )}
          {visit.status === 'in_progress' && (
            <Pressable
              onPress={() =>
                visit.outcome
                  ? nav.navigate('ServicePhotos', { visitId: visit.id })
                  : nav.navigate('ServicePicker', { visitId: visit.id })
              }
              accessibilityRole="button"
              style={s.cta}
            >
              <Text style={s.ctaText}>{t('service.cardContinue')}</Text>
            </Pressable>
          )}
          {visit.status === 'requested' && (
            <View style={s.waitRow}>
              <Text style={s.waitText}>{t('service.cardWaiting')}</Text>
              <Pressable
                onPress={() =>
                  Alert.alert(t('service.cancelConfirmTitle'), t('service.cancelConfirmBody'), [
                    { text: t('common.back'), style: 'cancel' },
                    { text: t('service.cardCancel'), style: 'destructive', onPress: () => cancelM.mutate(visit.id) },
                  ])
                }
                disabled={cancelM.isPending}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={s.cancel}>{t('service.cardCancel')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function StatusPill({ status }: { status: ServiceVisit['status'] }) {
  const { t } = useTranslation();
  const tone =
    status === 'approved'
      ? { bg: colors.successBg, fg: colors.success, label: t('service.statusApproved') }
      : status === 'in_progress'
        ? { bg: colors.brandTint, fg: colors.brandDark, label: t('service.statusInProgress') }
        : { bg: colors.chip, fg: colors.slate, label: t('service.statusRequested') };
  return (
    <View style={[s.pill, { backgroundColor: tone.bg }]}>
      <Text style={[s.pillText, { color: tone.fg }]}>{tone.label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.warnBg,
    borderWidth: 1,
    borderColor: colors.warnBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  stripOverdue: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
  stripTitle: { fontSize: 14, fontWeight: '800', color: colors.warnInk },
  stripSub: { fontSize: 12, color: colors.warnSoft },
  card: { backgroundColor: colors.white, borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: colors.mist },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 0.7, color: colors.brand },
  works: { fontSize: 16, fontWeight: '800', color: colors.ink },
  when: { fontSize: 13, color: colors.slate },
  cta: { marginTop: 4, height: 44, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 15, fontWeight: '800', color: colors.onAccent },
  waitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  waitText: { fontSize: 13, color: colors.slateLt },
  cancel: { fontSize: 13, fontWeight: '700', color: colors.danger },
  pill: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '800' },
});
