import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ServiceReason } from '@bigant/shared';
import { Icon } from '../../components/Icon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { ErrorBanner, Spinner } from '../../components/ui';
import { colors } from '../../components/theme';
import { SERVICE_KEYS, fetchMyDue, fetchReasons, fmtKm, remainingLabel, type Work } from '../../lib/service';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { FuelScreen, PrimaryButton, f } from '../fuel/fuelUi';

type Nav = NativeStackNavigationProp<RootStackParams>;
type Route = RouteProp<RootStackParams, 'ServiceReasons'>;

/**
 * The works that will actually be sent: the ticked ones found in the loaded
 * catalogue (an id ticked from a cached due list but missing from it counts
 * for nothing), then the typed ones (owner, 07.11.2026).
 */
export function resolveWorks(picked: Iterable<string>, catalogue: ServiceReason[] | undefined, custom: string[]): Work[] {
  const byId = new Map((catalogue ?? []).map((r) => [r.id, r]));
  const fromCatalogue: Work[] = [...picked]
    .map((id) => byId.get(id))
    .filter((r): r is ServiceReason => !!r)
    .map((r) => ({ reason_id: r.id, name: r.name }));
  return [...fromCatalogue, ...custom.map((name) => ({ custom_name: name, name }))];
}

/**
 * Step 1: what needs doing.
 *
 * The catalogue as a checklist, the works that are due already ticked and
 * carrying their remaining km. A work that is not in the catalogue is typed
 * in and lives on this screen until the visit is created — the server keeps
 * it as a suggestion for admin. Two ways out: now (an emergency, goes to the
 * centre picker) or a date (a request admin says yes or no to).
 */
export function ServiceReasonsScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const preselect = useRoute<Route>().params?.preselect ?? [];

  const reasonsQ = useQuery({ queryKey: SERVICE_KEYS.reasons, queryFn: fetchReasons });
  const dueQ = useQuery({ queryKey: SERVICE_KEYS.due, queryFn: fetchMyDue });
  const dueByReason = useMemo(
    () => new Map((dueQ.data ?? []).map((d) => [d.reason_id, d.remaining_km])),
    [dueQ.data],
  );

  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselect));
  const [custom, setCustom] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  // The field sits under the list: while typing, the screen shrinks above the
  // keyboard and rolls to the field, so the driver sees what he writes (owner, 11.11.2026).
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (!adding) return;
    const sub = Keyboard.addListener('keyboardDidShow', () => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => sub.remove();
  }, [adding]);

  // Once the due list is in, tick what is due — unless the driver came from a
  // strip that already said which one.
  const [autoTicked, setAutoTicked] = useState(preselect.length > 0);
  const due = dueQ.data;
  useEffect(() => {
    if (autoTicked || !due) return;
    setAutoTicked(true);
    setPicked(new Set(due.map((d) => d.reason_id)));
  }, [autoTicked, due]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Whatever he typed is kept however he leaves the field — the button, the
  // keyboard's "done", or closing the keyboard (owner, 11.11.2026).
  const addCustom = () => {
    // Starts with a capital however it was typed (owner, 11.11.2026).
    const name = draft.trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase());
    if (name) setCustom((c) => (c.includes(name) ? c : [...c, name]));
    setDraft('');
    setAdding(false);
  };

  const [nudge, setNudge] = useState(false);
  // From what will really be sent, not from the ticks (owner, 07.11.2026).
  const resolved = useMemo(() => resolveWorks(picked, reasonsQ.data, custom), [picked, reasonsQ.data, custom]);
  const none = resolved.length === 0;
  useEffect(() => {
    if (!nudge) return;
    const id = setTimeout(() => setNudge(false), 1200);
    return () => clearTimeout(id);
  }, [nudge]);

  const works = (): Work[] | null => {
    if (resolved.length === 0) {
      // A line above the button, not a white box over the screen (owner, 07.11.2026).
      setNudge(true);
      return null;
    }
    return resolved;
  };

  const goNow = () => {
    const w = works();
    if (w) nav.navigate('ServicePicker', { works: w });
  };

  // The catalogue, the due ones first, then the scheduled, then the rest;
  // the driver's own suggestions at the end.
  const reasons = useMemo(() => {
    const all = reasonsQ.data ?? [];
    const key = (r: ServiceReason) => {
      const left = dueByReason.get(r.id);
      if (left != null) return [0, left] as const;
      if (!r.approved) return [3, 0] as const;
      if (r.interval_km != null) return [1, r.interval_km] as const;
      return [2, 0] as const;
    };
    return [...all].sort((a, b) => {
      const [ga, va] = key(a);
      const [gb, vb] = key(b);
      return ga - gb || va - vb || a.name.localeCompare(b.name);
    });
  }, [reasonsQ.data, dueByReason]);

  const customRows = custom.map((name) => (
    <ReasonRow
      key={`c:${name}`}
      name={name}
      sub={t('service.yours')}
      on
      onPress={() => setCustom((c) => c.filter((x) => x !== name))}
      removable
    />
  ));

  return (
    <FuelScreen>
      <ScreenHeader title={t('service.reasonsTitle')} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView ref={scrollRef} contentContainerStyle={f.body} keyboardShouldPersistTaps="handled">
        <Text style={s.h1}>{t('service.whatToDo')}</Text>

        {reasonsQ.isLoading ? (
          <Spinner />
        ) : reasonsQ.isError && !reasonsQ.data ? (
          // Weak internet: said, with a retry — not an empty list (owner, 07.11.2026).
          <View style={{ gap: 8 }}>
            <ErrorBanner message={t('service.listFailed')} />
            <PrimaryButton label={t('common.retry')} onPress={() => void reasonsQ.refetch()} disabled={reasonsQ.isFetching} />
            {customRows}
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {reasons.map((r) => {
              const on = picked.has(r.id);
              const left = dueByReason.get(r.id);
              const sub =
                left != null
                  ? t('service.due', { left: remainingLabel(t, left) })
                  : !r.approved
                    ? t('service.yours')
                    : r.interval_km != null
                      ? t('service.every', { km: fmtKm(r.interval_km) })
                      : null;
              return (
                <ReasonRow key={r.id} name={r.name} sub={sub} on={on} flash={nudge && !on} overdue={left != null && left < 0} onPress={() => toggle(r.id)} />
              );
            })}
            {customRows}
          </View>
        )}

        {adding ? (
          <View style={s.addRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t('service.addReasonPlaceholder')}
              placeholderTextColor={colors.slateLt}
              style={s.addInput}
              autoFocus
              autoCapitalize="sentences"
              returnKeyType="done"
              onSubmitEditing={addCustom}
              onBlur={addCustom}
              blurOnSubmit
              maxLength={80}
            />
            <Pressable onPress={addCustom} accessibilityRole="button" style={s.addBtn}>
              <Text style={s.addBtnText}>{t('service.addReasonAdd')}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setAdding(true)} accessibilityRole="button" style={s.addDashed}>
            <Icon name="plus" size={16} color={colors.brandDark} strokeWidth={2.4} />
            <Text style={s.addDashedText}>{t('service.addReason')}</Text>
          </Pressable>
        )}

        <View style={f.spacer} />
        <View style={f.row}>
          {/* One way in (owner, 06.11.2026): the dispatcher's km schedule decides when; no date for an admin to approve. */}
          <Pressable onPress={goNow} accessibilityRole="button" style={[s.cta, none ? s.ctaIdle : s.ctaLoud]}>
            {/* Literal white: the theme's "white" is near-black on the dark set. */}
            <Text style={[s.ctaTitle, { color: none ? colors.slateLt : '#ffffff' }]}>{t('service.goNow')}</Text>
            <Text style={[s.ctaSub, { color: none ? colors.slateLt : '#ffffff' }]}>
              {none ? t('service.pickFirst') : t('service.goNowSub')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </FuelScreen>
  );
}

function ReasonRow({
  name,
  sub,
  on,
  flash,
  overdue,
  removable,
  onPress,
}: {
  name: string;
  sub: string | null;
  on: boolean;
  flash?: boolean;
  overdue?: boolean;
  removable?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      style={[s.reason, on && s.reasonOn, flash && s.reasonFlash]}
    >
      <View style={[s.box, on && s.boxOn, flash && s.boxFlash]}>{on ? <Icon name="check" size={14} color={colors.onAccent} strokeWidth={3} /> : null}</View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={s.reasonName}>{name}</Text>
        {sub ? <Text style={[s.reasonSub, overdue && { color: colors.danger, fontWeight: '700' }]}>{sub}</Text> : null}
      </View>
      {removable ? <Icon name="x" size={14} color={colors.slateLt} strokeWidth={2.4} /> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  h1: { fontSize: 24, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: colors.mist,
    borderRadius: 14,
    backgroundColor: colors.white,
  },
  reasonOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.mist,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { borderColor: colors.brand, backgroundColor: colors.brand },
  reasonName: { fontSize: 16, fontWeight: '700', color: colors.ink },
  reasonSub: { fontSize: 13, color: colors.slate, fontWeight: '600' },
  addDashed: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.mist,
  },
  addDashedText: { fontSize: 15, fontWeight: '700', color: colors.brandDark },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addInput: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  addBtn: { height: 48, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { fontSize: 15, fontWeight: '800', color: colors.onAccent },
  cta: {
    flex: 1,
    minHeight: 66,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  // Nothing ticked yet: the button is grey and says what to do first (owner, 07.11.2026).
  ctaIdle: { backgroundColor: colors.mist },
  // A tap on the grey button lights the boxes up for a moment: tick here.
  reasonFlash: { borderColor: colors.brand, borderWidth: 2 },
  boxFlash: { borderColor: colors.brand },
  ctaLoud: { backgroundColor: colors.brand },
  ctaTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  ctaSub: { fontSize: 13, color: colors.slate, fontWeight: '600', textAlign: 'center' },
});
