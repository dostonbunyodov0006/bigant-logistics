import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ServiceVisit } from '@bigant/shared';
import { Icon } from '../../components/Icon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Spinner } from '../../components/ui';
import { colors } from '../../components/theme';
import { api } from '../../lib/api';
import { parseNumber } from '../../lib/fuel';
import { SERVICE_KEYS, fetchVisit, fmtKm, invalidateService, takePhotoBase64 } from '../../lib/service';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { Eyebrow, FuelScreen, PrimaryButton, f } from '../fuel/fuelUi';

type Nav = NativeStackNavigationProp<RootStackParams>;
type Route = RouteProp<RootStackParams, 'ServiceCost'>;

/**
 * The last screen: what was paid, and the receipt — or the honest word that
 * there is none. Per-work costs are optional; the total is what the books
 * need. No odometer here any more (owner, 11.11.2026): the km come from the
 * Monday photo. The receipt is read by the AI the moment it is shot, and its
 * total shown beside the one typed.
 */
export function ServiceCostScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { visitId } = useRoute<Route>().params;
  const q = useQuery({ queryKey: SERVICE_KEYS.visit(visitId), queryFn: () => fetchVisit(visitId) });
  const visit = q.data ?? null;
  const [total, setTotal] = useState('');
  const [receipt, setReceipt] = useState<{ uri: string; base64: string } | null>(null);
  const [noReceipt, setNoReceipt] = useState(false);
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  // While the keyboard is up the pinned button steps aside, so the fields
  // below the one being typed — the comment — keep their room (owner, 11.11.2026).
  const [kb, setKb] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKb(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKb(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // What the AI read off the receipt: undefined — not asked yet, null — could not read it.
  const [readSum, setReadSum] = useState<number | null | undefined>(undefined);
  const [reading, setReading] = useState(false);

  const shootReceipt = async () => {
    const shot = await takePhotoBase64(t);
    if (!shot) return;
    setReceipt(shot);
    setNoReceipt(false);
    setReadSum(undefined);
    setReading(true);
    try {
      const r = await api.post<{ total_sum: number | null }>(`/service/visits/${visitId}/receipt-read`, { photo_base64: shot.base64 });
      setReadSum(r.total_sum);
      // An empty total is filled from the receipt; one already typed is left for the driver to compare.
      if (r.total_sum != null) setTotal((cur) => (cur.trim() === '' ? String(r.total_sum) : cur));
    } catch {
      setReadSum(null);
    } finally {
      setReading(false);
    }
  };

  const completeM = useMutation({
    mutationFn: (body: object) => api.post<ServiceVisit>(`/service/visits/${visitId}/complete`, body),
    onSuccess: (v) => {
      invalidateService();
      nav.replace('ServiceDone', { visit: v });
    },
    onError: () => Alert.alert(t('errors.generic')),
  });

  const totalSum = total.trim() === '' ? null : (parseNumber(total) ?? (total.trim() === '0' ? 0 : null));
  const ready = totalSum != null && (noReceipt || !!receipt) && !reading;
  const mismatch = !noReceipt && readSum != null && totalSum != null && Math.abs(totalSum - readSum) > Math.max(1000, totalSum * 0.01);

  const submit = () => {
    if (!ready || !visit) {
      Alert.alert(t('service.costIncomplete'));
      return;
    }
    const item_costs = visit.items
      .map((i) => ({ item_id: i.id, cost_sum: parseNumber(costs[i.id] ?? '') }))
      .filter((c): c is { item_id: string; cost_sum: number } => c.cost_sum != null);
    completeM.mutate({
      total_sum: totalSum,
      receipt_photo_base64: noReceipt ? null : receipt?.base64,
      no_receipt: noReceipt,
      comment: comment.trim() || null,
      ...(item_costs.length ? { item_costs } : {}),
    });
  };

  if (!visit) {
    return (
      <FuelScreen>
        <ScreenHeader title={t('service.costTitle')} />
        <Spinner />
      </FuelScreen>
    );
  }

  return (
    <FuelScreen>
      <ScreenHeader title={t('service.costTitle')} />
      {/* The screen shrinks above the keyboard on both phones (owner, 11.11.2026): the comment box stayed under it. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView ref={scrollRef} contentContainerStyle={f.body} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 6 }}>
            <Eyebrow>{t('service.totalPaid')}</Eyebrow>
            <View style={s.field}>
              <TextInput value={total} onChangeText={setTotal} keyboardType="number-pad" style={s.input} placeholder="0" placeholderTextColor={colors.slateLt} accessibilityLabel={t('service.totalPaid')} />
              <Text style={s.unit}>{t('fuel.sum')}</Text>
            </View>
          </View>

          <View style={{ gap: 6 }}>
            <Eyebrow>{t('service.receipt')}</Eyebrow>
            <View style={f.row}>
              <Pressable onPress={() => void shootReceipt()} accessibilityRole="button" style={[s.receiptBtn, receipt && s.receiptBtnDone]}>
                {receipt ? (
                  <Image source={{ uri: receipt.uri }} style={s.receiptThumb} accessibilityIgnoresInvertColors />
                ) : (
                  <Icon name="camera" size={16} color={colors.brandDark} strokeWidth={2.2} />
                )}
                <Text style={[s.receiptBtnText, receipt && { color: colors.success }]}>{receipt ? t('service.receiptTaken') : t('service.receiptPhoto')}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setNoReceipt((v) => !v);
                  setReceipt(null);
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: noReceipt }}
                style={[s.noReceipt, noReceipt && s.noReceiptOn]}
              >
                <View style={[s.box, noReceipt && s.boxOn]}>{noReceipt ? <Icon name="check" size={12} color={colors.onAccent} strokeWidth={3} /> : null}</View>
                <Text style={s.noReceiptText}>{t('service.noReceipt')}</Text>
              </Pressable>
            </View>
            {/* The AI's reading of the receipt, beside the typed total (owner, 11.11.2026). */}
            {!noReceipt && receipt ? (
              reading ? (
                <View style={s.readRow}>
                  <ActivityIndicator size="small" color={colors.brand} />
                  <Text style={s.readText}>{t('service.receiptReading')}</Text>
                </View>
              ) : readSum != null ? (
                <View style={[s.readBox, mismatch ? s.readBad : s.readOk]}>
                  <Text style={[s.readSum, { color: mismatch ? colors.danger : colors.success }]}>{t('service.receiptRead', { sum: fmtKm(readSum) })}</Text>
                  {mismatch ? <Text style={[s.readText, { color: colors.danger }]}>{t('service.receiptMismatch')}</Text> : null}
                </View>
              ) : readSum === null ? (
                <Text style={s.readText}>{t('service.receiptUnread')}</Text>
              ) : null
            ) : null}
          </View>

          <View style={s.perWork}>
            <Eyebrow>{t('service.perWork')}</Eyebrow>
            {visit.items.map((i) => (
              <View key={i.id} style={s.perRow}>
                <Text style={s.perName} numberOfLines={1}>
                  {i.name}
                </Text>
                <TextInput
                  value={costs[i.id] ?? ''}
                  onChangeText={(v) => setCosts((c) => ({ ...c, [i.id]: v }))}
                  keyboardType="number-pad"
                  style={s.perInput}
                  placeholder="—"
                  placeholderTextColor={colors.slateLt}
                  accessibilityLabel={i.name}
                  onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250)}
                />
                <Text style={s.perUnit}>{t('fuel.sum')}</Text>
              </View>
            ))}
          </View>

          <View style={{ gap: 6 }}>
            <Eyebrow>{t('service.commentLabel')}</Eyebrow>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder={t('service.commentPlaceholder')}
              placeholderTextColor={colors.slateLt}
              style={s.comment}
              multiline
              maxLength={500}
              accessibilityLabel={t('service.commentLabel')}
              onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250)}
            />
          </View>

        </ScrollView>
        {/* Pinned, always in full view — except while typing. */}
        {kb ? null : (
          <View style={s.footer}>
            <PrimaryButton label={t('service.confirm')} icon="check" onPress={submit} disabled={!ready || completeM.isPending} />
          </View>
        )}
      </KeyboardAvoidingView>
    </FuelScreen>
  );
}

const s = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.mist,
    borderRadius: 14,
    height: 54,
    paddingHorizontal: 14,
  },
  input: { flex: 1, fontSize: 22, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 14, fontWeight: '700', color: colors.slateLt },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14, borderTopWidth: 1, borderTopColor: colors.mist, backgroundColor: colors.paper },
  readRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 },
  readText: { fontSize: 13, color: colors.slate, lineHeight: 18, fontWeight: '600' },
  readBox: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 10, gap: 4, marginTop: 4 },
  readOk: { borderColor: colors.success, backgroundColor: colors.successBg },
  readBad: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  readSum: { fontSize: 16, fontWeight: '800' },
  receiptBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.brand,
    backgroundColor: colors.brandTint,
  },
  receiptBtnDone: { borderColor: colors.success, backgroundColor: colors.successBg },
  receiptBtnText: { fontSize: 14, fontWeight: '800', color: colors.brandDark },
  receiptThumb: { width: 32, height: 32, borderRadius: 6 },
  noReceipt: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.white,
  },
  noReceiptOn: { borderColor: colors.brand },
  noReceiptText: { fontSize: 14, fontWeight: '700', color: colors.ink },
  box: { width: 18, height: 18, borderRadius: 5, borderWidth: 2, borderColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  boxOn: { borderColor: colors.brand, backgroundColor: colors.brand },
  perWork: { backgroundColor: colors.white, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  perRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  perName: { flex: 1, fontSize: 14, color: colors.ink },
  perInput: {
    width: 110,
    height: 38,
    borderWidth: 1,
    borderColor: colors.mist,
    borderRadius: 10,
    paddingHorizontal: 10,
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  perUnit: { fontSize: 12, color: colors.slateLt, width: 30 },
  comment: {
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
});
