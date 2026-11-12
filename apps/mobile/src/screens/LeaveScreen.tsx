import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useBottomInset } from '../lib/useBottomInset';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { LeaveRequestPublic, LeaveStatus } from '@bigant/shared';
import { api } from '../lib/api';
import { Card, EmptyState, Spinner } from '../components/ui';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors } from '../components/theme';

const STATUS_COLORS: Record<LeaveStatus, { bg: string; fg: string }> = {
  pending: { bg: '#fef6e6', fg: colors.warn },
  approved: { bg: colors.successBg, fg: colors.success },
  rejected: { bg: colors.dangerBg, fg: colors.danger },
};

/**
 * The driver's leave, as the office wrote it down. He asks for it in person;
 * nothing is requested from here — this screen only shows what was recorded.
 */
export function LeaveScreen() {
  const { t } = useTranslation();
  const bottomInset = useBottomInset();
  const listQ = useQuery({
    queryKey: ['leave', 'me'],
    queryFn: () => api.get<LeaveRequestPublic[]>('/leave/me'),
  });
  const requests = listQ.data ?? [];

  return (
    <View style={s.scroll}>
      <ScreenHeader title={t('leave.title')} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: 40 + bottomInset }]}>
        {listQ.isLoading ? (
          <Spinner />
        ) : requests.length === 0 ? (
          <EmptyState title={t('leave.noRequests')} />
        ) : (
          requests.map((r) => {
            const sc = STATUS_COLORS[r.status];
            return (
              <Card key={r.id} style={s.reqCard}>
                <View style={s.reqHeader}>
                  <Text style={s.reqType}>{t(`leaveType.${r.type}`)}</Text>
                  <View style={[s.statusChip, { backgroundColor: sc.bg }]}>
                    <Text style={[s.statusChipText, { color: sc.fg }]}>{t(`leaveStatus.${r.status}`)}</Text>
                  </View>
                </View>
                <Text style={s.reqPeriod}>{r.start_date} → {r.end_date}</Text>
                {r.reason ? <Text style={s.reqReason}>{r.reason}</Text> : null}
                {r.review_note ? (
                  <Text style={s.reqNote}>{t('leave.reviewNote')}: {r.review_note}</Text>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 16, paddingBottom: 40 },
  reqCard: { padding: 14, marginBottom: 10 },
  reqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reqType: { fontSize: 15, fontWeight: '700', color: colors.ink },
  statusChip: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 },
  statusChipText: { fontSize: 11, fontWeight: '700' },
  reqPeriod: { fontSize: 14, fontFamily: 'monospace', color: colors.slate, marginTop: 6 },
  reqReason: { fontSize: 14, color: colors.ink, marginTop: 4 },
  reqNote: { fontSize: 14, color: colors.slate, marginTop: 6, fontStyle: 'italic', fontWeight: '600' },
});
