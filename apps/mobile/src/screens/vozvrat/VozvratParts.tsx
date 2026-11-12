import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  VOZVRAT_CONDITIONS,
  VOZVRAT_CULPRITS,
  type VozvratProduct,
  type VozvratReasonCode,
} from '@bigant/shared';
import {
  REASON_GROUPS,
  VOZVRAT_KEYS,
  blameOf,
  cleanQuantityText,
  customProduct,
  isCustomProduct,
  missingOf,
  reasonText,
  searchProducts,
  stepQuantity,
  type VozvratDraft,
  VOZVRAT_PHOTOS_MAX,
} from '../../lib/vozvrat';
import { takePhoto } from '../../hooks/usePhotoCapture';
import { Icon } from '../../components/Icon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { colors } from '../../components/theme';
import { FuelScreen, PrimaryButton } from '../fuel/fuelUi';

const TAG_TONES = {
  green: { bg: colors.successBg, fg: colors.success },
  red: { bg: colors.dangerBg, fg: colors.dangerInk },
  blue: { bg: '#e8f1fd', fg: '#1d4ed8' },
  grey: { bg: colors.chip, fg: colors.slate },
  amber: { bg: '#fef3c7', fg: colors.warn },
} as const;

export function Tag({ tone, label }: { tone: keyof typeof TAG_TONES; label: string }) {
  const c = TAG_TONES[tone];
  return <Text style={[p.tag, { backgroundColor: c.bg, color: c.fg }]}>{label}</Text>;
}

function XodovoyTag({ product }: { product: VozvratProduct }) {
  const { t } = useTranslation();
  if (product.xodovoy == null) return null;
  return (
    <Tag
      tone={product.xodovoy ? 'blue' : 'grey'}
      label={t(product.xodovoy ? 'vozvrat.xodovoy' : 'vozvrat.notXodovoy')}
    />
  );
}

/** Finding the product: by name, from the company's catalogue. */
export function VozvratSearch({
  onBack,
  onPick,
}: {
  onBack: () => void;
  onPick: (product: VozvratProduct) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [needle, setNeedle] = useState('');
  // Ask once the typing pauses, not on every letter.
  useEffect(() => {
    const id = setTimeout(() => setNeedle(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  const enough = needle.length >= 2;
  const resultsQ = useQuery({
    queryKey: VOZVRAT_KEYS.products(needle),
    queryFn: () => searchProducts(needle),
    enabled: enough,
  });
  const results = enough ? (resultsQ.data ?? []) : [];
  // Nothing in the list quite matches what he typed: let him keep his own words.
  const typed = q.trim();
  const canUseTyped =
    enough && !resultsQ.isLoading && typed.length >= 2 && !results.some((r) => r.name.toLowerCase() === typed.toLowerCase());

  return (
    <FuelScreen>
      <ScreenHeader title={t('vozvrat.searchTitle')} onBack={onBack} />
      <View style={p.searchWrap}>
        <Icon name="search" size={18} color={colors.slate} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t('vozvrat.searchPlaceholder')}
          placeholderTextColor={colors.slateLt}
          style={p.searchInput}
          autoFocus
          returnKeyType="search"
          accessibilityLabel={t('vozvrat.searchPlaceholder')}
        />
        {q ? (
          <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel={t('vozvrat.clear')}>
            <Icon name="x" size={16} color={colors.slateLt} strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={p.body} keyboardShouldPersistTaps="handled">
        {!enough ? null : resultsQ.isLoading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 16 }} />
        ) : (
          <>
            {results.length === 0 ? (
              <Text style={p.muted}>{t('vozvrat.notFound')}</Text>
            ) : (
              <Text style={p.eyebrow}>{t('vozvrat.found', { n: results.length })}</Text>
            )}
            {results.map((product) => (
              <Pressable key={product.id} onPress={() => onPick(product)} accessibilityRole="button" style={p.result}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={p.resultName}>{product.name}</Text>
                  <View style={p.row}>
                    {product.unit ? <Text style={p.unit}>{product.unit}</Text> : null}
                    <XodovoyTag product={product} />
                  </View>
                </View>
                <Icon name="chevron-right" size={16} color={colors.slateLt} strokeWidth={2.5} />
              </Pressable>
            ))}
            {canUseTyped ? (
              <Pressable
                onPress={() => onPick(customProduct(typed))}
                accessibilityRole="button"
                style={[p.result, p.resultTyped]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={p.resultName}>{t('vozvrat.useTyped', { name: typed })}</Text>
                </View>
                <Icon name="plus" size={18} color={colors.brandDark} strokeWidth={2.5} />
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </FuelScreen>
  );
}

/** One product: how many, usable or not, why, who is to blame, a photo. */
export function VozvratItemForm({
  draft,
  onChange,
  onBack,
  onChangeProduct,
  onOpenReasons,
  onSave,
  onRemove,
  saving,
}: {
  draft: VozvratDraft;
  onChange: (patch: Partial<VozvratDraft>) => void;
  onBack: () => void;
  onChangeProduct: () => void;
  onOpenReasons: () => void;
  onSave: () => void;
  onRemove: (() => void) | null;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const product = draft.product!;
  const missing = missingOf(draft);
  const blame = blameOf(draft);

  const step = (by: number) => onChange({ quantity: stepQuantity(draft, by) });
  const shoot = async () => {
    const uri = await takePhoto(t);
    if (uri) onChange({ photoUri: uri, photoUrl: null });
  };
  const extras = draft.extraPhotos ?? [];
  const shootMore = async () => {
    const uri = await takePhoto(t);
    if (uri) onChange({ extraPhotos: [...extras, uri] });
  };
  const dropExtra = (i: number) => onChange({ extraPhotos: extras.filter((_, k) => k !== i) });

  return (
    <FuelScreen>
      <ScreenHeader title={t('vozvrat.itemTitle')} onBack={onBack} />
      <ScrollView contentContainerStyle={p.body} keyboardShouldPersistTaps="handled">
        <View style={[p.card, p.rowCenter]}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={p.productName}>{product.name}</Text>
            <View style={p.row}>
              {isCustomProduct(product) ? <Tag tone="amber" label={t('vozvrat.typedTag')} /> : <XodovoyTag product={product} />}
            </View>
          </View>
          <Pressable onPress={onChangeProduct} accessibilityRole="button" hitSlop={8}>
            <Text style={p.link}>{t('vozvrat.change')}</Text>
          </Pressable>
        </View>

        <View style={p.card}>
          <Text style={p.eyebrow}>{t('vozvrat.quantity')}</Text>
          <View style={p.rowCenter}>
            <Pressable onPress={() => step(-1)} accessibilityRole="button" accessibilityLabel="−" style={p.stepBtn}>
              <Text style={p.stepText}>−</Text>
            </Pressable>
            <TextInput
              value={draft.quantity}
              onChangeText={(v) => onChange({ quantity: cleanQuantityText(v) })}
              keyboardType="decimal-pad"
              style={p.qtyInput}
              accessibilityLabel={t('vozvrat.quantity')}
            />
            <Pressable onPress={() => step(1)} accessibilityRole="button" accessibilityLabel="+" style={p.stepBtn}>
              <Text style={p.stepText}>+</Text>
            </Pressable>
            {product.unit ? <Text style={p.qtyUnit}>{product.unit}</Text> : null}
          </View>
        </View>

        <View style={p.card}>
          <Text style={p.eyebrow}>{t('vozvrat.condition')}</Text>
          <View style={p.row}>
            {VOZVRAT_CONDITIONS.map((c) => {
              const on = draft.condition === c;
              const bad = c === 'yaroqsiz';
              return (
                <Pressable
                  key={c}
                  onPress={() => onChange({ condition: c })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[p.choice, on && (bad ? p.choiceBad : p.choiceGood)]}
                >
                  <Text style={[p.choiceText, on && { color: bad ? colors.dangerInk : colors.success, fontWeight: '800' }]}>
                    {t(`vozvrat.cond_${c}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={p.card}>
          <Text style={p.eyebrow}>{t('vozvrat.reason')}</Text>
          <Pressable
            onPress={onOpenReasons}
            accessibilityRole="button"
            style={[p.reasonBtn, !draft.reason && p.reasonBtnEmpty]}
          >
            {draft.reason ? (
              <>
                <Text style={p.codeChip}>{draft.reason}</Text>
                <Text style={p.reasonText}>{reasonText(draft.reason)}</Text>
              </>
            ) : (
              <Text style={[p.reasonText, { color: colors.brandDark }]}>{t('vozvrat.chooseReason')}</Text>
            )}
            <Icon name="chevron-right" size={16} color={colors.brandDark} strokeWidth={2.5} />
          </Pressable>

          {draft.reason === 'x' ? (
            <>
              <Text style={[p.eyebrow, p.brand]}>{t('vozvrat.otherReason')}</Text>
              <TextInput
                value={draft.otherReason}
                onChangeText={(v) => onChange({ otherReason: v })}
                placeholder={t('vozvrat.otherPlaceholder')}
                placeholderTextColor={colors.slateLt}
                style={p.textarea}
                multiline
                maxLength={500}
              />
              <Text style={[p.eyebrow, p.brand]}>{t('vozvrat.whoBlame')}</Text>
              <View style={p.grid}>
                {VOZVRAT_CULPRITS.map((c) => {
                  const on = draft.culprit === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => onChange({ culprit: c })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      style={[p.choice, p.gridCell, on && p.choiceOn]}
                    >
                      <Text style={[p.choiceText, on && p.choiceTextOn]}>{t(`vozvrat.culprit_${c}`)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : blame ? (
            <View style={p.blameRow}>
              <Text style={p.blameText}>{t('vozvrat.blame', { who: t(`vozvrat.culprit_${blame}`) })}</Text>
            </View>
          ) : null}
        </View>

        <View style={p.card}>
          <View style={p.rowCenter}>
            <Text style={[p.eyebrow, { flex: 1 }]}>{t('vozvrat.photo')}</Text>
            <Text style={p.required}>{t('vozvrat.required')}</Text>
          </View>
          {draft.photoUri || draft.photoUrl ? (
            <View style={p.rowCenter}>
              <Image source={{ uri: draft.photoUri ?? draft.photoUrl ?? undefined }} style={p.photo} />
              <Pressable onPress={shoot} accessibilityRole="button" style={[p.choice, p.rowCenter, { gap: 8 }]}>
                <Icon name="camera" size={17} color={colors.graphite} />
                <Text style={p.choiceText}>{t('vozvrat.retake')}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={shoot} accessibilityRole="button" style={p.shoot}>
              <Icon name="camera" size={26} color={colors.graphite} />
              <Text style={p.shootText}>{t('vozvrat.takePhoto')}</Text>
            </Pressable>
          )}
          {draft.photoUri || draft.photoUrl ? (
            <View style={p.extraRow}>
              {extras.map((uri, i) => (
                <View key={uri}>
                  <Image source={{ uri }} style={p.extraPhoto} />
                  <Pressable
                    onPress={() => dropExtra(i)}
                    accessibilityRole="button"
                    accessibilityLabel={t('vozvrat.removePhoto')}
                    hitSlop={8}
                    style={p.extraDrop}
                  >
                    <Icon name="x" size={12} color={colors.white} />
                  </Pressable>
                </View>
              ))}
              {extras.length + 1 < VOZVRAT_PHOTOS_MAX ? (
                <Pressable onPress={shootMore} accessibilityRole="button" style={p.extraAdd}>
                  <Icon name="plus" size={18} color={colors.graphite} />
                  <Text style={p.extraAddText}>{t('vozvrat.morePhoto')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={p.footer}>
        <View style={p.rowCenter}>
          {onRemove ? (
            <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={t('vozvrat.remove')} style={p.trash}>
              <Icon name="trash" size={19} color={colors.dangerInk} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label={saving ? t('vozvrat.saving') : t('common.save')}
              onPress={onSave}
              disabled={missing != null || saving}
            />
          </View>
        </View>
        {missing ? <Text style={p.hint}>{t(missing)}</Text> : null}
      </View>
    </FuelScreen>
  );
}

/** All 16 reasons, grouped by who is to blame. */
export function VozvratReasonList({
  draft,
  onBack,
  onPick,
}: {
  draft: VozvratDraft;
  onBack: () => void;
  onPick: (code: VozvratReasonCode) => void;
}) {
  const { t } = useTranslation();
  const sub = draft.product ? draft.product.name : '';
  // One culprit at a time (owner, 29.10.2026): a row of buttons, and only the
  // pressed one's reasons under it. Opens on the reason already chosen.
  const order: (typeof REASON_GROUPS)[number]['key'][] = ['sotuvchi', 'mijoz', 'haydovchi', 'omborchi', 'other'];
  const groups = order.map((k) => REASON_GROUPS.find((g) => g.key === k)!).filter(Boolean);
  const [openKey, setOpenKey] = useState(() => groups.find((g) => draft.reason && g.codes.includes(draft.reason))?.key ?? null);
  const open = groups.find((g) => g.key === openKey);
  return (
    <FuelScreen>
      <ScreenHeader title={t('vozvrat.reasonTitle')} onBack={onBack} />
      {sub ? <Text style={p.headerSub}>{sub}</Text> : null}
      <ScrollView contentContainerStyle={p.body}>
        <View style={p.tabs}>
          {groups.map((g) => {
            const on = g.key === openKey;
            return (
              <Pressable
                key={g.key}
                onPress={() => setOpenKey(g.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={[p.tab, on && p.tabOn]}
              >
                <Text style={[p.tabText, on && p.tabTextOn]}>
                  {g.key === 'other' ? t('vozvrat.group_other') : t(`vozvrat.culprit_${g.key}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {(open ? [open] : []).map((g) => (
          <View key={g.key} style={{ gap: 4 }}>
            <View style={p.group}>
              {g.codes.map((code, i) => {
                const on = draft.reason === code;
                return (
                  <Pressable
                    key={code}
                    onPress={() => onPick(code)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[p.reasonRow, i > 0 && p.reasonRowLine, on && { backgroundColor: colors.brandTint }]}
                  >
                    <Text style={[p.rowChip, on && p.rowChipOn]}>{code}</Text>
                    <Text style={p.rowText}>{reasonText(code)}</Text>
                    {on ? <Icon name="check" size={18} color={colors.brand} strokeWidth={3} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </FuelScreen>
  );
}

const p = StyleSheet.create({
  body: { padding: 16, gap: 12, flexGrow: 1 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.mist,
    backgroundColor: colors.white,
  },
  tabOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  tabText: { fontSize: 15, fontWeight: '800', color: colors.ink },
  tabTextOn: { color: colors.brandDark },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tag: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: colors.slate,
  },
  brand: { color: colors.brandDark },
  muted: { fontSize: 13, fontWeight: '600', color: colors.slate, textAlign: 'center', marginTop: 16 },
  link: { fontSize: 13, fontWeight: '700', color: colors.brandDark },
  headerSub: {
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    paddingBottom: 10,
    fontSize: 12,
    fontWeight: '600',
    color: colors.slate,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 16,
    marginBottom: 0,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.brand,
    backgroundColor: colors.white,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.ink },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  resultTyped: { borderWidth: 1.5, borderColor: colors.brand, borderStyle: 'dashed', marginTop: 6 },
  resultName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  unit: { fontSize: 12, fontWeight: '600', color: colors.slate },
  card: { borderRadius: 14, backgroundColor: colors.white, paddingHorizontal: 13, paddingVertical: 12, gap: 8 },
  productName: { fontSize: 16, fontWeight: '800', color: colors.ink },
  stepBtn: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.mist,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 24, fontWeight: '700', color: colors.graphite },
  qtyInput: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.mist,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    color: colors.ink,
  },
  qtyUnit: { minWidth: 40, fontSize: 15, fontWeight: '700', color: colors.slate },
  choice: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.mist,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  choiceGood: { borderColor: colors.success, backgroundColor: colors.successBg },
  choiceBad: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  choiceOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  choiceText: { fontSize: 15, fontWeight: '700', color: colors.graphite },
  choiceTextOn: { fontWeight: '800', color: colors.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridCell: { flexBasis: '47%', flexGrow: 1 },
  reasonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.mist,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  reasonBtnEmpty: { borderColor: colors.brand, borderStyle: 'dashed' },
  codeChip: {
    borderRadius: 6,
    backgroundColor: colors.ink,
    color: colors.onAccent,
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
  },
  reasonText: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink, lineHeight: 18 },
  textarea: {
    minHeight: 80,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.mist,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
    textAlignVertical: 'top',
  },
  blameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    backgroundColor: colors.paper,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  blameText: { flex: 1, fontSize: 13, fontWeight: '800', color: colors.ink },
  blameAuto: { fontSize: 11, fontWeight: '700', color: colors.slate },
  required: {
    borderRadius: 99,
    backgroundColor: colors.dangerBg,
    color: colors.danger,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '800',
    overflow: 'hidden',
  },
  photo: { width: 96, height: 72, borderRadius: 10, backgroundColor: colors.photoBg },
  extraRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  extraPhoto: { width: 64, height: 64, borderRadius: 10, backgroundColor: colors.photoBg },
  extraDrop: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  extraAdd: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.slateLt,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  extraAddText: { fontSize: 11, fontWeight: '800', color: colors.graphite },
  shoot: {
    height: 96,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.slateLt,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  shootText: { fontSize: 14, fontWeight: '800', color: colors.graphite },
  footer: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.mist,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 8,
  },
  trash: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.mist,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { textAlign: 'center', fontSize: 13, fontWeight: '700', color: colors.brandDark },
  group: { borderRadius: 12, backgroundColor: colors.white, overflow: 'hidden' },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  reasonRowLine: { borderTopWidth: 1, borderTopColor: colors.chip },
  rowChip: {
    width: 28,
    textAlign: 'center',
    borderRadius: 6,
    paddingVertical: 3,
    fontSize: 12,
    fontWeight: '800',
    backgroundColor: colors.chip,
    color: colors.graphite,
    overflow: 'hidden',
  },
  rowChipOn: { backgroundColor: colors.brand, color: colors.onAccent },
  rowText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink, lineHeight: 18 },
});
