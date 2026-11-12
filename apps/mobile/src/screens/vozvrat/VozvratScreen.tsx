import { useCallback, useEffect, useState } from 'react';
import { Alert, BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OrderPublic, ReturnDestination } from '@bigant/shared';
import { api } from '../../lib/api';
import {
  blameOf,
  emptyDraft,
  quantityLabel,
  reasonText,
  toItemInput,
  type VozvratDraft,
} from '../../lib/vozvrat';
import { useOrderJourney } from '../../hooks/useOrderJourney';
import { uploadPhoto } from '../../hooks/usePhotoCapture';
import { Icon } from '../../components/Icon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { ReturnDestinationForm } from '../../components/ReturnDestinationSheet';
import { ErrorBanner, Spinner } from '../../components/ui';
import { errorText } from '../../lib/errorText';
import { useToast } from '../../components/Toast';
import { colors } from '../../components/theme';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { FuelScreen, PrimaryButton } from '../fuel/fuelUi';
import { VozvratItemForm, VozvratReasonList, VozvratSearch } from './VozvratParts';

type Nav = NativeStackNavigationProp<RootStackParams>;
type Route = RouteProp<RootStackParams, 'Vozvrat'>;
type Step = 'list' | 'search' | 'item' | 'reason' | 'where';

/**
 * Starting a vozvrat at the client: first every returned product — how many,
 * usable or not, why, who is to blame, a photo — then where each load goes
 * back. Both go to the server in one request; the product list is forwarded
 * to the accounting system from there.
 *
 * One screen walking its own steps rather than a stack of screens, so the list
 * being written survives every detour into search or the reason list.
 */
export function VozvratScreen() {
  const { t } = useTranslation();
  const { orderId } = useRoute<Route>().params;
  const orderQ = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.get<OrderPublic>(`/orders/${orderId}`),
  });
  // Not loaded (audit, 07.11.2026): said, with a retry — it used to spin for ever.
  if (!orderQ.data && orderQ.isError) {
    return (
      <FuelScreen>
        <ScreenHeader title="" />
        <View style={s.failed}>
          <ErrorBanner message={errorText(orderQ.error)} />
          <PrimaryButton
            label={t('common.retry')}
            onPress={() => void orderQ.refetch()}
            disabled={orderQ.isFetching}
          />
        </View>
      </FuelScreen>
    );
  }
  if (!orderQ.data) {
    return (
      <FuelScreen>
        <ScreenHeader title="" />
        <Spinner />
      </FuelScreen>
    );
  }
  return <VozvratFlow order={orderQ.data} />;
}

function VozvratFlow({ order }: { order: OrderPublic }) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { showSuccess } = useToast();
  const j = useOrderJourney(order);

  const [step, setStep] = useState<Step>('list');
  const [items, setItems] = useState<VozvratDraft[]>([]);
  const [draft, setDraft] = useState<VozvratDraft>(emptyDraft);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // A swipe would skip the "leave and lose the list?" question.
  useEffect(() => nav.setOptions({ gestureEnabled: false }), [nav]);

  const leave = useCallback(() => {
    if (items.length === 0) {
      nav.goBack();
      return;
    }
    Alert.alert(t('vozvrat.leaveTitle'), t('vozvrat.leaveBody'), [
      { text: t('vozvrat.stay'), style: 'cancel' },
      { text: t('vozvrat.leave'), style: 'destructive', onPress: () => nav.goBack() },
    ]);
  }, [items.length, nav, t]);

  const back = useCallback(() => {
    if (step === 'list') leave();
    else if (step === 'search') setStep(draft.product ? 'item' : 'list');
    else if (step === 'reason') setStep('item');
    else setStep('list');
  }, [draft.product, leave, step]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  }, [back]);

  const patch = (p: Partial<VozvratDraft>) => setDraft((d) => ({ ...d, ...p }));

  const startNew = () => {
    setDraft(emptyDraft());
    setEditing(null);
    setStep('search');
  };
  const edit = (i: number) => {
    setDraft(items[i]!);
    setEditing(i);
    setStep('item');
  };

  const save = async () => {
    let photoUrl = draft.photoUrl;
    if (!photoUrl && draft.photoUri) {
      setSaving(true);
      photoUrl = await uploadPhoto(draft.photoUri, t);
      setSaving(false);
      if (!photoUrl) return;
    }
    // The further shots not uploaded yet; one that fails keeps him on the form.
    const extraPhotos: string[] = [];
    for (const uri of draft.extraPhotos ?? []) {
      if (/^https?:/.test(uri)) {
        extraPhotos.push(uri);
        continue;
      }
      setSaving(true);
      const url = await uploadPhoto(uri, t);
      setSaving(false);
      if (!url) return;
      extraPhotos.push(url);
    }
    const saved = { ...draft, photoUrl, extraPhotos };
    setItems((list) => (editing == null ? [...list, saved] : list.map((it, i) => (i === editing ? saved : it))));
    setStep('list');
  };
  const remove = () => {
    if (editing != null) setItems((list) => list.filter((_, i) => i !== editing));
    setStep('list');
  };

  const sources = order.pickup_sources.filter((source) => source.leg_status === 'arrived');
  // A vozvrat order already knows where the goods go: its stops are return
  // stops from the start, so the "where" step is skipped and they are sent as is.
  const vozvratOrder = order.kind === 'vozvrat';
  const presetReturns = order.pickup_sources
    .filter((source) => source.return_destination)
    .map((source) => ({ pickup_source_id: source.id, destination: source.return_destination as ReturnDestination }));
  // Writing it again after the seller sent it back: the places were chosen the
  // first time and have not changed, so he is not asked for them twice.
  const rewriting =
    order.status === 'returning' &&
    order.pickup_sources.filter((source) => source.return_required).every((source) => source.return_destination);
  const knowsWhere = vozvratOrder || rewriting;
  const submit = (returns: { pickup_source_id: string; destination?: ReturnDestination }[], reason: string | null) =>
    j.startReturnM.mutate(
      { returns, reason, items: items.map(toItemInput) },
      {
        onSuccess: () => {
          showSuccess(t('vozvrat.started'));
          nav.goBack();
        },
        onError: (err) => {
          // The server says it is already written up: the first tap landed
          // after all, and the phone only missed the answer. The driver is
          // done, so say so rather than show him a failure.
          const code = err instanceof Error ? err.message : '';
          if (code === 'return_already_written' || code === 'return_already_started') {
            j.startReturnM.reset();
            void j.invalidate();
            showSuccess(t('vozvrat.started'));
            nav.goBack();
          }
        },
      },
    );

  if (step === 'search') {
    return (
      <VozvratSearch
        onBack={back}
        onPick={(product) => {
          patch({ product });
          setStep('item');
        }}
      />
    );
  }
  if (step === 'reason') {
    return (
      <VozvratReasonList
        draft={draft}
        onBack={back}
        onPick={(reason) => {
          // A new reason may no longer blame an omborchi, or no longer be "x".
          patch(reason === 'x' ? { reason } : { reason, otherReason: '', culprit: null });
          setStep('item');
        }}
      />
    );
  }
  if (step === 'item') {
    return (
      <VozvratItemForm
        draft={draft}
        onChange={patch}
        onBack={back}
        onChangeProduct={() => setStep('search')}
        onOpenReasons={() => setStep('reason')}
        onSave={save}
        onRemove={editing != null ? remove : null}
        saving={saving}
      />
    );
  }

  const header = (n: 1 | 2, title: string) => (
    <>
      <ScreenHeader
        title={title}
        onBack={back}
        right={
          <View style={s.stepPill}>
            <Text style={s.stepPillText}>{t('vozvrat.step', { n })}</Text>
          </View>
        }
      />
      <View style={s.progress}>
        <View style={[s.bar, s.barOn]} />
        <View style={[s.bar, n === 2 && s.barOn]} />
      </View>
    </>
  );

  if (step === 'where') {
    const names = items.map((it) => `${it.product!.name} ${quantityLabel(it)}`);
    return (
      <FuelScreen>
        {header(2, t('returns.whereTitle'))}
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {j.startReturnM.error ? <ErrorBanner message={errorText(j.startReturnM.error)} /> : null}
          <Pressable onPress={() => setStep('list')} accessibilityRole="button" style={s.summary}>
            <Icon name="check" size={18} color={colors.success} strokeWidth={2.6} />
            <View style={{ flex: 1 }}>
              <Text style={s.summaryTitle}>{t('vozvrat.written', { n: items.length })}</Text>
              <Text style={s.summarySub} numberOfLines={2}>
                {names.join(' · ')}
              </Text>
            </View>
            <Text style={s.link}>{t('vozvrat.change')}</Text>
          </Pressable>
          <View style={s.note}>
          </View>
          <ReturnDestinationForm
            sources={sources}
            pending={j.pending}
            reasonLabel={t('vozvrat.commentLabel')}
            onSubmit={submit}
          />
        </ScrollView>
      </FuelScreen>
    );
  }

  return (
    <FuelScreen>
      {header(1, t('vozvrat.title'))}
      <Text style={s.order}>{t('home.clientNamed', { name: order.client_name })}</Text>
      {order.return_items_reject_reason ? (
        <View style={s.sentBack}>
          <Text style={s.sentBackTitle}>{t('home.returnRewriteTitle')}</Text>
          <Text style={s.sentBackText}>{order.return_items_reject_reason}</Text>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={s.body}>
        {items.map((it, i) => {
          const blame = blameOf(it);
          return (
            <Pressable key={i} onPress={() => edit(i)} accessibilityRole="button" style={s.card}>
              <Image source={{ uri: it.photoUri ?? it.photoUrl ?? undefined }} style={s.thumb} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.cardTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                  {it.product!.name}
                </Text>
                <View style={s.tags}>
                  <Text style={s.qty}>{quantityLabel(it)}</Text>
                  <Text style={s.cardReason}>
                    {t('vozvrat.cardCondition', { cond: t(`vozvrat.cond_${it.condition}`) })}
                  </Text>
                </View>
                <Text style={s.cardReason}>
                  {t('vozvrat.cardReason', { text: it.reason === 'x' ? it.otherReason : reasonText(it.reason!) })}
                </Text>
                {blame ? (
                  <Text style={s.cardBlame}>
                    {t('vozvrat.cardBlame', { who: t(`vozvrat.culprit_${blame}`) })}
                  </Text>
                ) : null}
              </View>
              <Icon name="chevron-right" size={16} color={colors.slateLt} strokeWidth={2.5} />
            </Pressable>
          );
        })}

        <Pressable onPress={startNew} accessibilityRole="button" style={s.add}>
          <Icon name="plus" size={18} color={colors.brandDark} strokeWidth={2.6} />
          <Text style={s.addText}>{t('vozvrat.add')}</Text>
        </Pressable>
      </ScrollView>

      <View style={s.footer}>
        <View style={s.totalRow}>
          <Text style={s.totalLabel}>{t('vozvrat.total')}</Text>
          <Text style={s.totalValue}>{t('vozvrat.count', { n: items.length })}</Text>
        </View>
        {j.startReturnM.error ? (
          <ErrorBanner message={errorText(j.startReturnM.error)} />
        ) : null}
        <PrimaryButton
          label={t('vozvrat.continue')}
          // Where the goods go is the seller's call: the driver sends what came
          // back and which stop it came from, and the seller picks the place.
          onPress={() =>
            submit(
              knowsWhere ? presetReturns : sources.map((source) => ({ pickup_source_id: source.id })),
              null,
            )
          }
          disabled={items.length === 0 || j.pending}
        />
        {items.length === 0 ? <Text style={s.hint}>{t('vozvrat.addOne')}</Text> : null}
      </View>
    </FuelScreen>
  );
}

const s = StyleSheet.create({
  failed: { padding: 16, gap: 12 },
  body: { padding: 16, gap: 10, flexGrow: 1 },
  order: {
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    paddingBottom: 10,
    fontSize: 12,
    fontWeight: '600',
    color: colors.slate,
  },
  sentBack: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fcd9b6',
    backgroundColor: '#fff7ed',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 2,
  },
  sentBackTitle: { fontSize: 13, fontWeight: '800', color: colors.warn },
  sentBackText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  stepPill: { borderRadius: 99, backgroundColor: colors.warnBg, paddingHorizontal: 10, paddingVertical: 5, marginRight: 8 },
  stepPillText: { fontSize: 11, fontWeight: '800', color: colors.warn },
  progress: { flexDirection: 'row', gap: 6, backgroundColor: colors.white, paddingHorizontal: 16, paddingBottom: 10 },
  bar: { flex: 1, height: 4, borderRadius: 99, backgroundColor: colors.chip },
  barOn: { backgroundColor: colors.brand },
  note: {
    flexDirection: 'row',
    gap: 9,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  noteText: { fontSize: 12, fontWeight: '600', color: colors.slate, lineHeight: 17 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    backgroundColor: colors.white,
    padding: 12,
  },
  thumb: { width: 60, height: 60, borderRadius: 10, backgroundColor: colors.photoBg },
  cardTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  qty: { fontSize: 13, fontWeight: '800', color: colors.ink },
  cardReason: { fontSize: 12, fontWeight: '600', color: colors.slate, lineHeight: 16 },
  cardBlame: { fontSize: 12, fontWeight: '700', color: colors.graphite },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.brand,
    backgroundColor: colors.brandTint,
  },
  addText: { fontSize: 15, fontWeight: '800', color: colors.brandDark },
  footer: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.mist,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 8,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: 13, fontWeight: '700', color: colors.slate },
  totalValue: { fontSize: 13, fontWeight: '800', color: colors.ink },
  hint: { textAlign: 'center', fontSize: 13, fontWeight: '700', color: colors.brandDark },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  summaryTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  summarySub: { marginTop: 2, fontSize: 12, fontWeight: '600', color: colors.slate },
  link: { fontSize: 13, fontWeight: '700', color: colors.brandDark },
});
