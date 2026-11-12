import { useEffect, useMemo, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  type FuelLog,
} from '@bigant/shared';
import { FUEL_READ_CONFIDENCE_RETAKE } from '@bigant/shared';
import { api } from '../../lib/api';
import { formatNumber, pumpQty, pumpSum, parseNumber, unitLabel } from '../../lib/fuel';
import { Icon } from '../../components/Icon';
import { colors } from '../../components/theme';
import { useFuelPhoto } from '../../hooks/useFuelPhoto';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { ScreenHeader } from '../../components/ScreenHeader';
import { ErrorBanner } from '../../components/ui';
import { errorText } from '../../lib/errorText';
import { useKeyboardHeight } from '../../lib/useKeyboardHeight';
import { Eyebrow, FuelScreen, PrimaryButton, SecondaryButton, f } from './fuelUi';

type Nav = NativeStackNavigationProp<RootStackParams>;
type Route = RouteProp<RootStackParams, 'FuelReview'>;

/**
 * Step 4: the numbers.
 *
 * The photo goes to the server the moment this screen opens, with the fix
 * from the shutter, and comes back as a draft that already knows where the
 * truck was. When the photo was read, the three numbers are prefilled and a summary
 * says it plainly: this station, this day and hour, this much fuel, this
 * much money. The driver confirms, or taps Tahrirlash and types their own
 * numbers — which the server keeps, marked for an admin to compare with
 * the photo. Without a reading the driver types the numbers as before.
 *
 * The product check runs as they type. It never blocks — the driver is the
 * one standing at the pump — but a total that is not quantity × price gets
 * said out loud before they commit to it.
 */
/**
 * How many photographs at this pump have come back under the retake line.
 * The retake walks back to the camera and returns as a new screen, so the
 * count lives outside it. The first poor photograph earns only "take it
 * again"; the second earns the reader's guess, poor as it is, to be fixed by
 * hand — a driver cannot be sent back to the camera forever.
 */
const lowReads = new Map<string, number>();
const countedDrafts = new Set<string>();

export function FuelReviewScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { fuelType, station, shot } = useRoute<Route>().params;
  // "Qayta olish": the camera opens here, on the one tap, and the new photo
  // takes this screen's place — not a walk back to the station screen first.
  const camera = useFuelPhoto();
  const retake = async () => {
    const next = await camera.take();
    if (next) nav.replace('FuelReview', { fuelType, station, shot: next });
  };

  const unit = unitLabel(t, fuelType);
  const scrollRef = useRef<ScrollView>(null);
  const keyboard = useKeyboardHeight();
  useEffect(() => {
    if (keyboard > 0) requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [keyboard]);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [editing, setEditing] = useState(false);
  const windowH = useWindowDimensions().height;
  const lineWord = t(fuelType === 'gaz' ? 'fuel.wordKub' : 'fuel.wordLitr');
  const qtyWord = fuelType === 'gaz' ? 'm³' : lineWord;

  const draftM = useMutation({
    mutationFn: async (): Promise<FuelLog> => {
      const { File } = await import('expo-file-system');
      const base64 = await new File(shot.uri).base64();
      // A stalled upload on a weak signal used to spin for ever. After 30 s
      // it gives up and the screen offers "Qayta urinish" instead.
      return Promise.race([
        api.post<FuelLog>('/fuel/logs', {
          fuel_type: fuelType,
          station_id: station?.id ?? null,
          photo_base64: base64,
          captured_at: shot.capturedAt,
          position: shot.position,
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('upload_timeout')), 30_000)),
      ]);
    },
  });
  // Once, when the screen opens: the photo is the same for the life of the
  // screen, and a retry is an explicit tap, not a re-render.
  const startDraft = draftM.mutate;
  useEffect(() => {
    startDraft();
  }, [startDraft]);
  const draft = draftM.data ?? null;

  // When the photo was read, the numbers are the photo's: they fill the
  // fields, which stay locked until the driver asks to edit. Until the draft
  // is back nothing is typed either — we do not yet know which case this is.
  const extracted = draft?.extracted ?? null;
  // What the photo was read as, confident or not. A doubtful reading used to
  // be thrown away and the driver handed three empty boxes — with the pump in
  // front of him and its photo on his screen, correcting a digit is quicker
  // and likelier right than typing all three again.
  const attempt = draft?.read_attempt ?? null;
  // 'retake' on the first poor photograph; on the second the pump itself is
  // likely too faint to read: the reader's guess goes in the boxes and the
  // driver corrects it from the pump (owner, 29.10.2026 — it was the third).
  const [lowPhase, setLowPhase] = useState<'retake' | 'guess' | null>(null);
  useEffect(() => {
    if (!attempt) return;
    // A reading under the retake line is not offered at all — not in the
    // boxes, not in the summary. The photograph is to be taken again.
    const conf = draft?.extracted_confidence;
    if ((conf == null || conf < FUEL_READ_CONFIDENCE_RETAKE) && lowPhase !== 'guess') return;
    if (attempt.quantity != null) setQty(pumpQty(attempt.quantity));
    if (attempt.unit_price_sum != null) setPrice(pumpSum(attempt.unit_price_sum));
  }, [attempt, draft?.extracted_confidence, lowPhase]);
  // Three answers, by how sure the reader was. Under the retake line the
  // photograph does not count and a new one is the only way on. Between the
  // lines the reading is put to the driver as a question. Above the trust
  // line it is saved without asking.
  const confidence = draft?.extracted_confidence ?? null;
  const got = extracted ?? attempt;
  const low = !!draft && (!got || confidence == null || confidence < FUEL_READ_CONFIDENCE_RETAKE);
  const pumpKey = `${fuelType}:${station?.id ?? 'street'}`;
  useEffect(() => {
    if (!draft) return;
    if (!low) {
      lowReads.delete(pumpKey);
      setLowPhase(null);
      return;
    }
    // Counted once per photograph, however often this effect runs for it.
    if (!countedDrafts.has(draft.id)) {
      countedDrafts.add(draft.id);
      lowReads.set(pumpKey, (lowReads.get(pumpKey) ?? 0) + 1);
    }
    const poor = lowReads.get(pumpKey) ?? 1;
    if (poor >= 2) {
      // Second poor photograph: the retake message still shows, and with it
      // the boxes open on the reader's guess for him to correct.
      setLowPhase('guess');
      setEditing(true);
    } else {
      setLowPhase('retake');
    }
  }, [draft, low, got, pumpKey]);
  // A digit the reader was not sure of, on a named line: no new photo — the
  // driver is told which line and corrects it.
  const unclearLine = !!draft?.flags.some((x) => x.startsWith('unclear_'));
  useEffect(() => {
    if (unclearLine && !low) setEditing(true);
  }, [unclearLine, low]);
  const bad = low && lowPhase !== 'guess';
  const guessAgain = low && lowPhase === 'guess';
  const locked = !draft || (!!got && !editing && !guessAgain);

  const confirmM = useMutation({
    mutationFn: (body: { total_sum: number; quantity: number; unit_price_sum: number }) =>
      api.post<FuelLog>(`/fuel/logs/${draft!.id}/confirm`, body),
    onSuccess: (log) => {
      lowReads.delete(pumpKey);
      // The odometer is asked on Mondays at the start of work now, not here.
      nav.replace('FuelDone', { log });
    },
  });

  // The total is not read and not typed: it is the quantity times the price
  // per unit, worked out here, so it can never disagree with them.
  const reading = useMemo(() => {
    const q = parseNumber(qty);
    const p = parseNumber(price);
    if (q == null || p == null) return null;
    const product = q * p;
    return { tSum: Math.round(product * 100) / 100, q, p, product, holds: true };
  }, [qty, price]);

  const submit = () => {
    if (!draft || !reading) return;
    confirmM.mutate({ total_sum: reading.tSum, quantity: reading.q, unit_price_sum: reading.p });
  };
  // Never saved on its own: however sure the reading, the driver confirms
  // it — the money is booked to him.

  return (
    <KeyboardAvoidingView style={f.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FuelScreen>
      <ScreenHeader title={t('fuel.reviewTitle')} />
      {/* Drawn edge to edge, Android lays the keyboard over the screen
          instead of shrinking it: the fields the driver is correcting went
          under it. The content grows by the keyboard's height and scrolls to
          the fields as soon as it opens. */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[f.body, keyboard > 0 && { paddingBottom: keyboard + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* The pump's photo, big: he reads the display off it while he checks
            or types the numbers below. */}
        <Image
          source={{ uri: shot.uri }}
          style={[s.photo, { height: Math.round(windowH * 0.45) }]}
          // Fills the frame edge to edge: an upright photo in a wide frame
          // left black bands down both sides. The pump's display is in the
          // middle of the shot, and the middle is what stays.
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
        <View style={s.top}>
          <View style={{ flex: 1, gap: 6, justifyContent: 'center' }}>
            {/* "SHOXOBCHA - Metan Yujniy" on one line. */}
            <Text style={s.stationName} numberOfLines={2}>
              <Text style={s.stationLabel}>{t('fuel.station')} - </Text>
              {draft?.resolved_station?.name ?? station?.name ?? t('fuel.street')}
            </Text>
            <OutcomeLine draft={draft} pending={draftM.isPending} failed={draftM.isError} />
          </View>
        </View>

        {draftM.isError && (
          <View style={f.row}>
            <SecondaryButton label={t('fuel.tryAgain')} onPress={() => draftM.mutate()} />
          </View>
        )}

        {guessAgain && (
          <View style={s.retakeBoxBad}>
            <Icon name="warning" size={18} color={colors.danger} strokeWidth={2.4} />
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={s.retakeTextBad}>{t('fuel.unreadableBad')}</Text>
              <MissingRows attempt={attempt} word={lineWord} flags={draft?.flags ?? []} />
              <Text style={s.retakeText}>{t('fuel.typeItIn')}</Text>
            </View>
          </View>
        )}
        {bad ? (
          <View style={s.retakeBoxBad}>
            <Icon name="warning" size={18} color={colors.danger} strokeWidth={2.4} />
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={s.retakeTextBad}>{t('fuel.unreadableBad')}</Text>
              <MissingRows attempt={attempt} word={lineWord} flags={draft?.flags ?? []} />
              <Pressable onPress={() => void retake()} disabled={camera.busy} accessibilityRole="button" style={s.retakeBtnBad}>
                <Icon name="camera" size={15} color={colors.onAccent} />
                <Text style={s.retakeBtnText}>{t('fuel.retake')}</Text>
              </Pressable>
            </View>
          </View>
        ) : got && !editing ? (
          <View style={s.aiBox}>
            {/* The numbers alone: no "AI read this" heading, no percentage. */}
            {/* As the pump lays them out: the total, the quantity, the price per unit. */}
            <View style={s.aiRows}>
              <View style={s.aiRow}>
                <Text style={s.aiRowLabel}>{t('fuel.lineTotal')}</Text>
                <Text style={s.aiRowValue}>{pumpSum(got.total_sum ?? 0)} {t('fuel.sum')}</Text>
              </View>
              <View style={s.aiRow}>
                <Text style={s.aiRowLabel}>{t('fuel.lineQty', { word: qtyWord })}</Text>
                <Text style={s.aiRowValue}>{pumpQty(got.quantity ?? 0)}</Text>
              </View>
              <View style={[s.aiRow, s.aiRowLast]}>
                <Text style={s.aiRowLabel}>{t('fuel.linePrice', { word: qtyWord })}</Text>
                <Text style={s.aiRowValue}>{pumpSum(got.unit_price_sum ?? 0)} {t('fuel.sum')}</Text>
              </View>
            </View>
            {guessAgain && <Text style={s.retakeTextBad}>{t('fuel.lowAgainNote', { n: confidence ?? 0 })}</Text>}
            {(
              <>
                <Text style={s.aiAsk}>{t('fuel.aiAsk')}</Text>
                <View style={s.aiBtns}>
                  <Pressable onPress={submit} accessibilityRole="button" style={[s.aiYes, (!reading || confirmM.isPending) && { opacity: 0.6 }]} disabled={!reading || confirmM.isPending}>
                    <Icon name="check" size={15} color={colors.onAccent} strokeWidth={2.6} />
                    <Text style={s.retakeBtnText}>{t('fuel.aiRight')}</Text>
                  </Pressable>
                  <Pressable onPress={() => setEditing(true)} accessibilityRole="button" style={s.aiNo}>
                    <Text style={s.aiNoText}>✏️ {t('fuel.aiFix')}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        ) : got && editing ? (
          <>
            <MissingRows attempt={attempt} word={lineWord} flags={draft?.flags ?? []} />
          </>
        ) : null}

        {/* While the photo goes up only the photo, the station and "Surat
            yuklanmoqda…" show; the boxes come once it is read. */}
        {!bad && !draftM.isPending && !draftM.isError && (
        <>
        {/* Price per unit first, then the quantity: the two that are read off
            the pump. The total under them is their product. */}
        <NumberField
          id="price"
          label={t('fuel.unitPrice')}
          unit={t('fuel.sumPer', { unit })}
          value={price}
          onChange={setPrice}
          locked={locked}
        />
        <NumberField id="qty" label={t('fuel.quantity')} unit={unit} value={qty} onChange={setQty} locked={locked} />
        <NumberField
          id="total"
          label={t('fuel.total')}
          unit={t('fuel.sum')}
          value={reading ? pumpSum(reading.tSum) : ''}
          onChange={() => undefined}
          locked
        />

        {reading && !reading.holds && (
            // Only when the numbers do not multiply out; no green line when they do.
            <View style={s.warnBox}>
              <Icon name="warning" size={16} color={colors.warn} strokeWidth={2.2} />
              <Text style={s.warnText}>
                {t('fuel.arithmeticOff', {
                  q: pumpQty(reading.q),
                  p: pumpSum(reading.p),
                  t: pumpSum(reading.product),
                  entered: formatNumber(reading.tSum),
                })}
              </Text>
            </View>
        )}

        <View style={f.spacer} />
        {/* A refused confirm used to do nothing at all: the driver tapped,
            the sheet stayed, and he had no idea why. */}
        {confirmM.error ? <ErrorBanner message={errorText(confirmM.error)} /> : null}
        {(editing || !got) && (
          <PrimaryButton
            label={editing ? t('fuel.save') : t('fuel.confirm')}
            icon="check"
            onPress={submit}
            disabled={!draft || !reading || confirmM.isPending}
          />
        )}
        </>
        )}

      </ScrollView>
      </FuelScreen>
    </KeyboardAvoidingView>
  );
}


/**
 * Which of the pump's three lines the reader could not make out, by name:
 * "Nm³ qatorini o'qiy olmadim". The total is ours when the other two were
 * read, so it is named only when one of them is missing too.
 */
function MissingRows({
  attempt,
  word,
  flags = [],
}: {
  attempt: { total_sum: number | null; quantity: number | null; unit_price_sum: number | null } | null;
  /** "kub" for gas, "litr" for the rest: the word the office uses for the lines. */
  word: string;
  /** The log's flags: unclear_* name a line with a doubtful digit. */
  flags?: readonly string[];
}) {
  const { t } = useTranslation();
  const qtyWord = word === t('fuel.wordKub') ? 'm³' : word;
  const rows: string[] = [];
  const q = attempt?.quantity ?? null;
  const p = attempt?.unit_price_sum ?? null;
  const unclear = (k: string) => flags.includes(`unclear_${k}`);
  if (((q == null || p == null) && (attempt?.total_sum ?? null) == null) || unclear('total')) rows.push(t('fuel.lineTotal'));
  if (q == null || unclear('quantity')) rows.push(t('fuel.lineQty', { word: qtyWord }));
  if (p == null || unclear('unit_price')) rows.push(t('fuel.linePrice', { word: qtyWord }));
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: 4 }}>
      {rows.map((row) => (
        <Text key={row} style={s.missingRow}>
          ✕ {t('fuel.rowUnread', { row })}
        </Text>
      ))}
    </View>
  );
}

/** What the fence said, in the driver's terms. */
function OutcomeLine({ draft, pending, failed }: { draft: FuelLog | null; pending: boolean; failed: boolean }) {
  const { t } = useTranslation();
  if (pending) {
    return (
      <View style={s.outcome}>
        <ActivityIndicator size="small" color={colors.brand} />
        <Text style={[s.outcomeText, { color: colors.slate }]}>{t('fuel.uploading')}</Text>
      </View>
    );
  }
  if (failed || !draft) {
    return (
      <View style={s.outcome}>
        <Icon name="warning" size={14} color={colors.danger} strokeWidth={2.4} />
        <Text style={[s.outcomeText, { color: colors.danger }]}>{t('fuel.uploadFailed')}</Text>
      </View>
    );
  }
  const map = {
    matched: { icon: 'check' as const, color: colors.success, text: t('fuel.outcomeMatched', { d: Math.round(draft.distance_m ?? 0) }) },
    other_station: { icon: 'pin' as const, color: colors.warn, text: t('fuel.outcomeOther') },
    unlisted: { icon: 'pin' as const, color: colors.warn, text: t('fuel.outcomeUnlisted') },
    mismatch: { icon: 'warning' as const, color: colors.warn, text: t('fuel.outcomeMismatch') },
    unverified: { icon: 'info' as const, color: colors.slate, text: t('fuel.outcomeUnverified') },
  }[draft.outcome];
  // At the station: nothing to say. Only a mismatch or a doubt is shown.
  if (draft.outcome === 'matched') return null;
  return (
    <View style={s.outcome}>
      <Icon name={map.icon} size={14} color={map.color} strokeWidth={2.4} />
      <Text style={[s.outcomeText, { color: map.color }]}>{map.text}</Text>
    </View>
  );
}

function NumberField({
  id,
  label,
  unit,
  value,
  onChange,
  locked,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  /** Read-only: the value came off the photo, or the photo is still being read. */
  locked: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Eyebrow>{label}</Eyebrow>
      <View style={[s.field, locked && s.fieldLocked]}>
        <TextInput
          nativeID={id}
          value={value}
          onChangeText={onChange}
          editable={!locked}
          keyboardType="decimal-pad"
          style={[s.fieldInput, locked && s.fieldInputLocked]}
          placeholder={locked ? '' : '0'}
          placeholderTextColor={colors.slateLt}
          accessibilityLabel={label}
          accessibilityState={{ disabled: locked }}
        />
        <Text style={s.fieldUnit}>{unit}</Text>
        {locked ? <Icon name="lock" size={14} color={colors.slateLt} strokeWidth={2.2} /> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', gap: 12 },
  photo: { width: '100%', borderRadius: 14, backgroundColor: '#000000' },
  stationLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 0.8, color: colors.slateLt },
  stationName: { fontSize: 16, fontWeight: '800', color: colors.ink, lineHeight: 20 },
  retake: { fontSize: 13, fontWeight: '700', color: colors.brand },
  outcome: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  outcomeText: { flex: 1, fontSize: 13, fontWeight: '700' },
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
  // Framed like the others (owner, 29.10.2026): the lock says it is not typed into.
  fieldLocked: {},
  fieldInput: { flex: 1, fontSize: 22, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },
  fieldInputLocked: { color: colors.graphite },
  fieldUnit: { fontSize: 14, fontWeight: '700', color: colors.slateLt },
  okRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  okText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.success },
  warnBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: colors.warnBg,
    borderWidth: 1,
    borderColor: colors.warnBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  warnText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.warnInk },
  aiNote: { backgroundColor: colors.successBg, color: colors.success },
  editNote: { backgroundColor: colors.warnBg, color: colors.warnInk },
  summary: {
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.brand,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  summaryText: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '700', color: colors.ink },
  aiBox: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.brand,
    backgroundColor: colors.brandTint,
    padding: 14,
    gap: 8,
    marginBottom: 12,
  },
  aiHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiTitle: { flex: 1, fontSize: 13, fontWeight: '800', color: colors.brandDark, textTransform: 'uppercase', letterSpacing: 0.4 },
  aiConf: { fontSize: 12, fontWeight: '700', color: colors.slate },
  aiLine: { fontSize: 17, fontWeight: '800', color: colors.ink, lineHeight: 24 },
  aiRows: { borderRadius: 12, borderWidth: 1, borderColor: colors.mist, paddingHorizontal: 14 },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.mist,
  },
  aiRowLast: { borderBottomWidth: 0 },
  missingRow: { fontSize: 15, fontWeight: '800', color: colors.danger },
  aiRowLabel: { fontSize: 15, fontWeight: '700', color: colors.slate },
  aiRowValue: { fontSize: 19, fontWeight: '900', color: colors.ink },
  aiAsk: { fontSize: 15, fontWeight: '700', color: colors.graphite },
  aiBtns: { flexDirection: 'row', gap: 10, marginTop: 2 },
  aiYes: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, backgroundColor: '#16a34a', paddingVertical: 12 },
  aiNo: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1.5, borderColor: colors.brand, paddingVertical: 12, backgroundColor: colors.white },
  aiNoText: { fontSize: 14, fontWeight: '800', color: colors.brandDark },
  retakeBox: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: colors.warnBg,
    borderWidth: 1,
    borderColor: colors.warnBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  retakeText: { fontSize: 14, lineHeight: 20, color: colors.warnInk, fontWeight: '600' },
  retakeBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  retakeBtnText: { fontSize: 14, fontWeight: '800', color: colors.onAccent },
  // The photograph itself is the problem: said in red, bright enough to stop
  // a driver who is halfway to tapping Confirm.
  retakeBoxBad: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: colors.dangerBg,
    borderWidth: 1.5,
    borderColor: colors.danger,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  retakeTextBad: { fontSize: 15, lineHeight: 21, color: colors.danger, fontWeight: '800' },
  retakeBtnBad: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.danger,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
});
