import { bonusRows } from '../../lib/earnings';
import { useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useBottomInset } from '../../lib/useBottomInset';
import { breakState } from '../../lib/breakState';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { DriverEarnings, DriverMe, EarningsPeriod, WorkLogPublic } from '@bigant/shared';
import { api } from '../../lib/api';
import { formatTime, tashkentDmy } from '../../lib/format';
import { queryClient } from '../../lib/queryClient';
import { Card } from '../../components/ui';
import { BreakExtendSheet } from '../../components/BreakExtend';
import { colors } from '../../components/theme';
import type { RootStackParams } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParams>;

// Thousands separator without Intl (Hermes-safe): 160000 -> "160 000".
const som = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');


/** Ma'lumotlarim tab — the driver's profile, pay rates, and the collapsible
 *  Qo'shimcha ma'lumotlarim / Tabel hisobotim / Maosh va bonuslar reports. */
/** 2026-11-30 → 30.11.2026, the way every paper prints its own date. */
function dmy(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function MyInfoTab() {
  const bottomInset = useBottomInset();
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  // One report open at a time (owner, 11.11.2026): opening the bonuses folds the timesheet away, and back.
  const [report, setReport] = useState<'timesheet' | 'salary' | null>(null);
  const toggleReport = (which: 'timesheet' | 'salary') => setReport((cur) => (cur === which ? null : which));

  const driverQ = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => api.get<DriverMe>('/drivers/me'),
  });
  const driver = driverQ.data;
  const tariff = driver?.tariff ?? null;

  // Each row sits on its own line (owner, 03.11.2026). `open` leaves the line
  // off when something belongs under the row — the doverennost holders.
  const infoRow = (label: string, value: string | null | undefined, accent = false, open = false) => (
    <View style={[s.infoRow, open && s.infoRowOpen]}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, accent && { color: colors.success }]}>{value || '—'}</Text>
    </View>
  );

  /**
   * A rate that is two rates: in town and out of it.
   *
   * On one line the wrap fell inside a number — "Tashqari: 20" with the "000"
   * dropping to the line below, which reads as a different amount. Each one
   * gets its own line, whole.
   */
  const bonusRow = (label: string, city: number, outside: number) => (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <View style={s.bonusValues}>
        <Text style={s.infoValue}>{`${t('salary.city')}: ${som(city)}`}</Text>
        <Text style={s.infoValue}>{`${t('salary.outside')}: ${som(outside)}`}</Text>
      </View>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: 28 + bottomInset }]} showsVerticalScrollIndicator={false}>
      <Card style={s.card}>
        <Text style={s.sectionLabel}>{t('profile.myInfo')}</Text>
        {infoRow(t('home.fullName'), driver?.name)}
        {driver?.vehicle_id
          ? infoRow(
              t('home.vehicleLabel'),
              `${driver.vehicle_model ?? ''}${driver.vehicle_plate ? ` · ${driver.vehicle_plate}` : ''}`,
              true,
            )
          : null}
        {/* What he is asked at the loading bay: what the lorry may carry and
            how big the bay is. His licence and the papers live under Hujjatlar. */}
        {driver?.vehicle_id ? (
          <>
            {infoRow(
              t('profile.capacity'),
              driver.vehicle_capacity_kg != null
                ? `${som(driver.vehicle_capacity_kg)} kg`
                : null,
            )}
            {infoRow(
              t('profile.dimensions'),
              driver.vehicle_length_cm && driver.vehicle_width_cm && driver.vehicle_height_cm
                ? `${driver.vehicle_length_cm} × ${driver.vehicle_width_cm} × ${driver.vehicle_height_cm} sm`
                : null,
            )}
            {infoRow(
              t('profile.modelYear'),
              driver.vehicle_model_year != null ? String(driver.vehicle_model_year) : null,
            )}
            {/* Each paper of the lorry, and the day it runs out — what he is
                asked for at a checkpoint, answered without a phone call. */}
            {(driver.vehicle_documents ?? []).length > 0 ? (
              <Text style={s.groupLabel}>{t('profile.groupPapers')}</Text>
            ) : null}
            {(driver.vehicle_documents ?? []).map((d) => (
              <View key={d.type}>
                {infoRow(t(`vehicleDocType.${d.type}`), t('profile.until', { date: dmy(d.expires_at) }), false, d.type === 'power_of_attorney' && !!d.holder_name)}
                {d.type === 'power_of_attorney' && d.holder_name ? (
                  // One name per line (owner, 03.11.2026): the holders are kept as one comma-separated line.
                  <Text style={s.subNote}>{d.holder_name.split(/\s*,\s*/).filter(Boolean).join(String.fromCharCode(10))}</Text>
                ) : null}
              </View>
            ))}
          </>
        ) : null}
        {tariff && (
          <>
            <Text style={s.groupLabel}>{t('profile.groupPay')}</Text>
            <View style={s.infoDivider} />
            {bonusRow(t('profile.pickupBonus'), tariff.pickup_city_som, tariff.pickup_outside_som)}
            {bonusRow(t('profile.deliveryBonus'), tariff.delivery_city_som, tariff.delivery_outside_som)}
          </>
        )}
      </Card>

      {/* The break moved to the shift switch, where he reaches for it; the
          odometer and the leave request each keep a card of their own, named
          after what they do rather than filed under "additional". */}
      {/* Only while a break is running or planned: the break he is on, and
          the way out of it before its time. A break is started from the
          header switch, so otherwise this card has nothing to say. */}
      {breakState(driver) !== 'none' ? (
        <Section icon="⏸" title={t('home.break')}>
          <ExtraInfo driver={driver} only="break" />
        </Section>
      ) : null}

      <Card style={s.card}>
        <Pressable style={s.sectionHead} onPress={() => nav.navigate('Documents')}>
          <Text style={s.sectionTitle}>📄 {t('profile.documents')}</Text>
          <Text style={s.chevron}>›</Text>
        </Pressable>
      </Card>

      <Card style={s.card}>
        <Pressable style={s.sectionHead} onPress={() => nav.navigate('Leave')}>
          <Text style={s.sectionTitle}>📝 {t('leave.title')}</Text>
          <Text style={s.chevron}>›</Text>
        </Pressable>
      </Card>

      <Section icon="📅" title={t('home.timesheet')} open={report === 'timesheet'} onToggle={() => toggleReport('timesheet')}>
        <Timesheet />
      </Section>

      <Section icon="💰" title={t('home.salaryReport')} open={report === 'salary'} onToggle={() => toggleReport('salary')}>
        <Salary />
      </Section>

    </ScrollView>
  );
}

/** Expandable card section (collapsed by default, like the prototype). */
function Section({
  icon,
  title,
  children,
  open: openProp,
  onToggle,
}: {
  icon: string;
  title: string;
  children: ReactNode;
  /** Given by the parent when only one of several sections may be open. */
  open?: boolean;
  onToggle?: () => void;
}) {
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  return (
    <Card style={s.card}>
      <Pressable style={s.sectionHead} onPress={onToggle ?? (() => setOwn((v) => !v))}>
        <Text style={s.sectionTitle}>
          {icon} {title}
        </Text>
        <Text style={s.chevron}>{open ? '⌄' : '›'}</Text>
      </Pressable>
      {open && <View style={s.sectionBody}>{children}</View>}
    </Card>
  );
}

/**
 * The break, on its own card. The odometer card that was here is gone (owner,
 * 05.11.2026): the kilometres come in on Mondays, with a photo the AI reads —
 * this one took any number without a photo.
 */
function ExtraInfo({ driver, only }: { driver?: DriverMe; only: 'break' }) {
  const { t } = useTranslation();
  const invalidateDriver = () => void queryClient.invalidateQueries({ queryKey: ['driver', 'me'] });
  const endBreakM = useMutation({
    mutationFn: () => api.del('/drivers/me/break'),
    onSuccess: invalidateDriver,
    onError: () => Alert.alert(t('errors.generic')),
  });
  const state = breakState(driver);
  const onBreak = state === 'running';
  const lapsed = state === 'lapsed';
  const [extendOpen, setExtendOpen] = useState(false);
  const planned = state === 'planned';
  // Break hours in Tashkent's clock, not the phone's zone (owner, 06.11.2026).
  const clock = formatTime;
  const breakPending = endBreakM.isPending;
  const breakTime = driver?.break_until ? formatTime(driver.break_until) : '';

  if (only === 'break') {
    return (
      <View>
        <View style={s.breakBlock}>
        {onBreak ? (
          <>
            <Text style={s.breakActive}>{t('home.onBreakUntil', { time: breakTime })}</Text>
            <Pressable
              onPress={() => endBreakM.mutate()}
              disabled={breakPending}
              style={[s.breakEndBtn, breakPending && { opacity: 0.6 }]}
            >
              <Text style={s.breakEndText}>{t('home.endBreak')}</Text>
            </Pressable>
            <Pressable onPress={() => setExtendOpen(true)} style={[s.breakEndBtn, { marginTop: 8 }]}>
              <Text style={[s.breakEndText, { color: colors.brandDark }]}>{t('breakExtend.extend')}</Text>
            </Pressable>
          </>
        ) : lapsed ? (
          <>
            <Text style={s.breakActive}>{t('breakExtend.lapsedBody', { time: breakTime })}</Text>
            <Pressable
              onPress={() => endBreakM.mutate()}
              disabled={breakPending}
              style={[s.breakEndBtn, breakPending && { opacity: 0.6 }]}
            >
              <Text style={s.breakEndText}>{t('breakExtend.backToWork')}</Text>
            </Pressable>
            <Pressable onPress={() => setExtendOpen(true)} style={[s.breakEndBtn, { marginTop: 8 }]}>
              <Text style={[s.breakEndText, { color: colors.brandDark }]}>{t('breakExtend.extend')}</Text>
            </Pressable>
          </>
        ) : planned ? (
          <>
            <Text style={s.breakActive}>
              {t('home.breakPlanned', { from: clock(driver!.break_started_at!), to: clock(driver!.break_until!) })}
            </Text>
            <Pressable
              onPress={() => endBreakM.mutate()}
              disabled={breakPending}
              style={[s.breakEndBtn, breakPending && { opacity: 0.6 }]}
            >
              <Text style={s.breakEndText}>{t('home.cancelBreak')}</Text>
            </Pressable>
          </>
        ) : null}
        </View>
        <BreakExtendSheet visible={extendOpen} onClose={() => setExtendOpen(false)} driver={driver} />
      </View>
    );
  }

  return null;
}

/** Tabel hisobotim body: the driver's recent work shifts. */
/**
 * The day, in the order it happened.
 *
 * It used to read "08:15 – 18:00 · 70 daqiqa kech" on one line, with the
 * driver's own words underneath and no clue what they answered. A timesheet is
 * read when something is disputed, so each fact is now on its own line with
 * its name beside it: when the shift was due to start, when he actually
 * started, how late that made him, what he said about it, and what the day
 * came to.
 */
function Timesheet() {
  const { t } = useTranslation();
  const shiftsQ = useQuery({
    queryKey: ['driver', 'me', 'shifts'],
    queryFn: () => api.get<WorkLogPublic[]>('/drivers/me/shifts'),
  });
  // The timesheet is Tashkent's hours and days whatever the phone's zone (owner, 06.11.2026).
  const time = formatTime;
  // "1 soat 10 daqiqa" rather than "70 daqiqa": nobody counts in minutes past
  // the hour, and 322 of them says nothing at all.
  const dur = (m: number) =>
    m >= 60
      ? t('home.durHM', { h: Math.floor(m / 60), m: m % 60 })
      : t('home.durM', { m });
  const dayLabel = tashkentDmy;

  const rows = shiftsQ.data ?? [];
  if (rows.length === 0) {
    return <Text style={s.emptyText}>{t('home.noShifts')}</Text>;
  }
  return (
    <View style={{ gap: 10 }}>
      {rows.map((w) => (
        <View key={w.id} style={s.tsCard}>
          <Text style={s.tsDate}>{dayLabel(w.clock_in_at)}</Text>
          <TsRow label={t('home.tsExpected')} value={w.expected_start ?? '—'} />
          <TsRow label={t('home.tsStarted')} value={time(w.clock_in_at)} bad={w.is_late} />
          {w.is_late && <TsRow label={t('home.tsLate')} value={dur(w.late_minutes)} bad />}
          {w.late_reason ? <TsNote label={t('home.tsReason')} text={w.late_reason} /> : null}
          <TsRow
            label={t('home.tsEnded')}
            value={w.clock_out_at ? time(w.clock_out_at) : t('home.tsOpen')}
            bad={w.is_early_leave}
          />
          {w.is_early_leave && <TsRow label={t('home.tsEarly')} value={dur(w.early_minutes)} bad />}
          {w.early_leave_reason ? (
            <TsNote label={t('home.tsReason')} text={w.early_leave_reason} />
          ) : null}
          <View style={s.tsDivider} />
          <TsRow
            label={t('home.tsTotal')}
            value={w.duration_minutes != null ? dur(w.duration_minutes) : '—'}
            strong
          />
        </View>
      ))}
    </View>
  );
}

function TsRow({
  label,
  value,
  bad,
  strong,
}: {
  label: string;
  value: string;
  bad?: boolean;
  strong?: boolean;
}) {
  return (
    <View style={s.tsRow}>
      <Text style={s.tsLabel}>{label}</Text>
      <Text style={[s.tsValue, bad && s.tsBad, strong && s.tsStrong]}>{value}</Text>
    </View>
  );
}

/** His own words, which do not belong squeezed into a value column. */
function TsNote({ label, text }: { label: string; text: string }) {
  return (
    <View style={s.tsNote}>
      <Text style={s.tsLabel}>{label}</Text>
      <Text style={s.tsNoteText}>{text}</Text>
    </View>
  );
}

/** Maosh va bonuslar body: the salary breakdown with a period toggle. */
function Salary() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<EarningsPeriod>('month');
  const earningsQ = useQuery({
    queryKey: ['driver', 'me', 'earnings', period],
    queryFn: () => api.get<DriverEarnings>(`/drivers/me/earnings?period=${period}`),
  });
  const rows = bonusRows(earningsQ.data?.lines ?? []);
  const rowLabel = { pickup: t('profile.pickupBonus'), delivery: t('profile.deliveryBonus'), overtime: t('salary.overtimeBonus') };

  return (
    <View>
      <View style={s.langRow}>
        {(['month', 'today'] as const).map((p) => (
          <Pressable key={p} onPress={() => setPeriod(p)} style={[s.langBtn, period === p && s.langActive]}>
            <Text style={[s.langLabel, period === p && s.langLabelActive]}>
              {p === 'month' ? t('salary.monthly') : t('salary.today')}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={s.salTable}>
        {rows.map((r) => (
          <View key={r.key} style={s.salRow}>
            <View style={s.salLeft}>
              <Text style={s.salLabel}>{rowLabel[r.key]}</Text>
              <Text style={s.salMeta}>
                {r.key === 'overtime' ? t('salary.overtimeMeta', { min: r.count }) : `${r.count} ${t('salary.units')}`}
              </Text>
            </View>
            <Text style={s.salAmount}>{som(r.amount)}</Text>
          </View>
        ))}
        <View style={[s.salRow, s.salTotalRow]}>
          <Text style={s.salTotalLabel}>{t('salary.total')}</Text>
          <Text style={s.salTotalAmount}>
            {som(earningsQ.data?.total_som ?? 0)} {t('common.som')}
          </Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { paddingTop: 12, paddingBottom: 28 },
  card: { marginHorizontal: 16, marginTop: 12, padding: 16 },
  sectionLabel: {
    marginBottom: 8,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.slateLt,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  chevron: { fontSize: 20, fontWeight: '400', color: colors.slateLt },
  sectionBody: { marginTop: 14 },
  bonusValues: { alignItems: 'flex-end', gap: 2 },
  groupLabel: { marginTop: 16, marginBottom: 2, fontSize: 12, fontWeight: '700', color: colors.brand, textTransform: 'uppercase', letterSpacing: 0.6 },
  subNote: { fontSize: 14, lineHeight: 18, color: colors.slate, textAlign: 'right', marginTop: 0, paddingBottom: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.mist, marginBottom: 0, paddingLeft: 90, fontWeight: '600' },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.mist,
  },
  infoRowOpen: { borderBottomWidth: 0, paddingBottom: 2 },
  infoLabel: { fontSize: 14, color: colors.slate, fontWeight: '600' },
  infoValue: { flexShrink: 1, textAlign: 'right', fontSize: 14, fontWeight: '600', color: colors.ink },
  infoDivider: { height: 1, backgroundColor: colors.mist, marginVertical: 8 },
  leaveRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.mist,
    paddingTop: 14,
  },
  leaveLabel: { fontSize: 15, fontWeight: '600', color: colors.ink },
  breakBlock: { marginBottom: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.mist },
  breakLabel: { fontSize: 13, fontWeight: '600', color: colors.slate, marginBottom: 8 },
  breakRow: { flexDirection: 'row', gap: 8 },
  breakOff: { fontSize: 13, color: colors.slateLt },
  breakBtn: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.mist,
    paddingVertical: 10,
  },
  breakBtnText: { fontSize: 14, fontWeight: '600', color: colors.brandDark },
  breakActive: { fontSize: 14, fontWeight: '600', color: colors.ink, marginBottom: 8 },
  breakEndBtn: {
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: colors.dangerBg,
    paddingVertical: 10,
  },
  breakEndText: { fontSize: 14, fontWeight: '700', color: colors.danger },
  emptyText: { fontSize: 14, color: colors.slateLt },
  tsCard: {
    borderWidth: 1,
    borderColor: colors.mist,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.paper,
  },
  tsDate: { fontSize: 15, fontWeight: '800', color: colors.ink, marginBottom: 6 },
  tsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 3,
  },
  tsLabel: { fontSize: 14, color: colors.slate, fontWeight: '600' },
  tsValue: { fontSize: 14, fontWeight: '700', color: colors.ink, textAlign: 'right', flexShrink: 1 },
  tsBad: { color: colors.danger },
  tsStrong: { fontSize: 15, fontWeight: '800' },
  tsDivider: { height: 1, backgroundColor: colors.mist, marginVertical: 6 },
  tsNote: { paddingVertical: 4 },
  tsNoteText: { marginTop: 2, fontSize: 14, color: colors.ink, lineHeight: 19 },
  langRow: { flexDirection: 'row', borderRadius: 12, backgroundColor: colors.chip, padding: 3 },
  langBtn: { flex: 1, alignItems: 'center', borderRadius: 10, paddingVertical: 8 },
  langActive: { backgroundColor: colors.white },
  langLabel: { fontSize: 14, fontWeight: '600', color: colors.slate },
  langLabelActive: { color: colors.brand },
  salTable: { marginTop: 12 },
  salRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.mist,
  },
  salLeft: { flexShrink: 1 },
  salLabel: { fontSize: 14, fontWeight: '600', color: colors.ink },
  salMeta: { marginTop: 2, fontSize: 13, color: colors.slateLt, fontWeight: '600' },
  salAmount: { fontSize: 15, fontWeight: '700', color: colors.ink },
  salOvertime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginHorizontal: -8,
    paddingHorizontal: 8,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: colors.warnBg,
  },
  salOvertimeMeta: { marginTop: 2, fontSize: 12, color: colors.warnSoft },
  salChevron: { fontSize: 20, fontWeight: '700', color: colors.brandDark, marginLeft: 2 },
  overtimeRow: { marginTop: 6, marginHorizontal: -8, padding: 10, borderRadius: 12, backgroundColor: colors.warnBg, gap: 4 },
  overtimeTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  overtimeLabel: { fontSize: 14, fontWeight: '600', color: colors.warnInk },
  overtimeValue: { fontSize: 14, fontWeight: '800', color: colors.warnInk },
  overtimeHint: { fontSize: 12, color: colors.warnSoft, lineHeight: 17 },
  salTotalRow: { borderTopWidth: 2, borderTopColor: colors.ink, marginTop: 2 },
  salTotalLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
  salTotalAmount: { fontSize: 16, fontWeight: '800', color: colors.brand },
  version: { marginTop: 20, marginBottom: 8, textAlign: 'center', fontSize: 12, color: colors.slateLt },
});
