import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SERVICE_PHOTOS_PER_WORK, type ServiceReason, type ServiceVisit, type ServiceVisitItem } from '@bigant/shared';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Spinner } from '../../components/ui';
import { colors } from '../../components/theme';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { SERVICE_KEYS, fetchReasons, fetchVisit, fmtKm, invalidateService, takePhotoBase64 } from '../../lib/service';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { Card, Eyebrow, FuelScreen, PrimaryButton, f } from '../fuel/fuelUi';

type Nav = NativeStackNavigationProp<RootStackParams>;
type Route = RouteProp<RootStackParams, 'ServicePhotos'>;

/**
 * Two photos per work (owner, 11.11.2026), each shown big and opened full
 * screen on a tap. Each goes up the moment it is taken, so a phone that
 * dies half-way loses one photo, not all of them; the visit remembers which
 * are in. Davom etish opens when every row has one.
 *
 * The list itself is still open here: the mechanic finds one more thing, or
 * a ticked work turns out fine — so a row can be removed and another added,
 * right up to the moment the visit is completed.
 */
export function ServicePhotosScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { visitId } = useRoute<Route>().params;
  const q = useQuery({ queryKey: SERVICE_KEYS.visit(visitId), queryFn: () => fetchVisit(visitId) });
  const visit = q.data ?? null;

  const [sending, setSending] = useState<string | null>(null);
  // The just-taken photo, shown while the URL comes back and after it.
  const [local, setLocal] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [busyList, setBusyList] = useState(false);

  const setVisit = (v: ServiceVisit) => {
    queryClient.setQueryData(SERVICE_KEYS.visit(visitId), v);
    invalidateService();
  };
  const remove = (item: ServiceVisitItem) => {
    if (!visit || visit.items.length <= 1) return;
    Alert.alert(t('service.removeWorkTitle', { name: item.name }), item.photo_url ? t('service.removeWorkHasPhoto') : undefined, [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('service.removeWork'),
        style: 'destructive',
        onPress: async () => {
          setBusyList(true);
          try {
            setVisit(await api.del<ServiceVisit>(`/service/visits/${visitId}/items/${item.id}`));
          } catch {
            Alert.alert(t('errors.generic'));
          } finally {
            setBusyList(false);
          }
        },
      },
    ]);
  };
  const add = async (work: { reason_id: string } | { custom_name: string }) => {
    setBusyList(true);
    try {
      setVisit(await api.post<ServiceVisit>(`/service/visits/${visitId}/items`, work));
      setAdding(false);
    } catch {
      Alert.alert(t('errors.generic'));
    } finally {
      setBusyList(false);
    }
  };

  // One photo slot of one work: goes up the moment it is taken.
  const shoot = async (item: ServiceVisitItem, slot: number) => {
    const key = `${item.id}:${slot}`;
    const shot = await takePhotoBase64(t);
    if (!shot) return;
    setLocal((m) => ({ ...m, [key]: shot.uri }));
    setSending(key);
    try {
      const updated = await api.post<ServiceVisit>(`/service/visits/${visitId}/items/${item.id}/photo`, { photo_base64: shot.base64, slot });
      queryClient.setQueryData(SERVICE_KEYS.visit(visitId), updated);
    } catch {
      setLocal((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== key)));
      Alert.alert(t('service.photoFailed'));
    } finally {
      setSending(null);
    }
  };
  // The photo opened full screen, with its work and slot so it can be retaken from there.
  const [viewing, setViewing] = useState<{ uri: string; item: ServiceVisitItem; slot: number } | null>(null);
  // Each slot gets its size in points, measured from the row (owner, 11.11.2026): a box sized
  // only by aspectRatio left the photo, its badge and its label with no room and nothing showed.
  const [slotW, setSlotW] = useState(0);

  if (!visit) {
    return (
      <FuelScreen>
        <ScreenHeader title={t('service.photosTitle')} />
        <Spinner />
      </FuelScreen>
    );
  }

  const photosOf = (item: ServiceVisitItem): string[] => (item.photo_urls?.length ? item.photo_urls : item.photo_url ? [item.photo_url] : []);
  const need = SERVICE_PHOTOS_PER_WORK * visit.items.length;
  const done = visit.items.reduce((a, i) => a + Math.min(SERVICE_PHOTOS_PER_WORK, photosOf(i).length), 0);
  const all = done === need;
  const where = visit.selected_center?.name ?? visit.resolved_center?.name ?? t('service.street');

  return (
    <FuelScreen>
      <ScreenHeader title={t('service.photosTitle')} />
      <ScrollView contentContainerStyle={f.body}>
        <Card style={s.now}>
          <Eyebrow tone="brand">{t('service.nowHeading')}</Eyebrow>
          <Text style={s.where}>{where}</Text>
          <Text style={s.hint}>{t('service.photosHint')}</Text>
        </Card>

        {/* Two photos per work, each big enough to see what was shot (owner, 11.11.2026). */}
        {visit.items.map((item) => {
          const taken = photosOf(item);
          const count = Math.min(SERVICE_PHOTOS_PER_WORK, taken.length);
          const complete = count === SERVICE_PHOTOS_PER_WORK;
          return (
            <Card key={item.id} style={[s.work, complete && s.workDone]}>
              <View style={s.workHead}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.name}>{item.name}</Text>
                  <Text style={[s.sub, complete && { color: colors.success }]}>
                    {t('service.workPhotosDone', { done: count, total: SERVICE_PHOTOS_PER_WORK })}
                  </Text>
                </View>
                {visit.items.length > 1 && (
                  <Pressable
                    onPress={() => remove(item)}
                    disabled={!!sending || busyList}
                    accessibilityRole="button"
                    accessibilityLabel={t('service.removeWork')}
                    hitSlop={8}
                    style={s.remove}
                  >
                    <Icon name="x" size={18} color={colors.slateLt} strokeWidth={2.4} />
                  </Pressable>
                )}
              </View>
              <View style={s.slots} onLayout={(e) => setSlotW(Math.floor((e.nativeEvent.layout.width - 10) / 2))}>
                {Array.from({ length: SERVICE_PHOTOS_PER_WORK }, (_, slot) => {
                  const key = `${item.id}:${slot}`;
                  const uri = local[key] ?? taken[slot] ?? null;
                  const busy = sending === key;
                  // A slot opens only after the one before it: no gaps.
                  const locked = slot > taken.length;
                  return (
                    <View key={slot} style={s.slotCol}>
                      {uri ? (
                        <Pressable onPress={() => setViewing({ uri, item, slot })} accessibilityRole="imagebutton" style={{ width: slotW, height: slotW }}>
                          <Image source={{ uri }} style={[s.slotImg, { width: slotW, height: slotW }]} resizeMode="cover" accessibilityIgnoresInvertColors />
                          {busy ? (
                            <View style={s.slotBusy}>
                              <ActivityIndicator size="large" color={colors.onAccent} />
                            </View>
                          ) : (
                            <View style={s.slotBadge}>
                              <Icon name="check" size={14} color={colors.onAccent} strokeWidth={3.2} />
                            </View>
                          )}
                          <Text style={s.slotLabel}>{t('service.photoSlot', { n: slot + 1 })}</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          onPress={() => void shoot(item, slot)}
                          disabled={locked || !!sending}
                          accessibilityRole="button"
                          style={[s.slot, s.slotEmpty, { width: slotW, height: slotW }, locked && { opacity: 0.45 }]}
                        >
                          <Icon name="camera" size={34} color={colors.brand} />
                          <Text style={s.slotEmptyTitle}>{t('service.photoSlot', { n: slot + 1 })}</Text>
                          <Text style={s.slotEmptySub}>{t('service.photoTapToShoot')}</Text>
                        </Pressable>
                      )}
                      {uri && !busy ? (
                        <Pressable onPress={() => void shoot(item, slot)} disabled={!!sending} accessibilityRole="button" style={s.retakeBtn}>
                          <Icon name="camera" size={16} color={colors.brandDark} />
                          <Text style={s.retakeText}>{t('service.retake')}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </Card>
          );
        })}

        <Pressable onPress={() => setAdding(true)} disabled={busyList} accessibilityRole="button" style={s.addBig}>
          <Icon name="plus" size={22} color={colors.brandDark} strokeWidth={2.6} />
          <Text style={s.addBigText}>{t('service.addWork')}</Text>
        </Pressable>

        <Text style={s.progress}>{t('service.photosProgress', { done, total: need })}</Text>
      </ScrollView>
      {/* Pinned under the list, always in full view (owner, 11.11.2026). */}
      <View style={s.footer}>
        <PrimaryButton label={t('service.photosContinue')} onPress={() => nav.navigate('ServiceCost', { visitId })} disabled={!all || !!sending} />
        {!all && <Text style={s.gate}>{t('service.photosGate')}</Text>}
      </View>
      <AddWorkSheet visible={adding} onClose={() => setAdding(false)} taken={visit.items.map((i) => i.reason_id)} onAdd={add} busy={busyList} />

      {/* Full screen: the driver sees exactly what he shot, and can shoot it again from here. */}
      <Modal visible={!!viewing} animationType="fade" statusBarTranslucent onRequestClose={() => setViewing(null)}>
        <View style={s.viewer}>
          {viewing ? <Image source={{ uri: viewing.uri }} style={s.viewerImg} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
          <View style={s.viewerBar}>
            <Pressable onPress={() => setViewing(null)} accessibilityRole="button" style={[s.viewerBtn, s.viewerBtnGhost]}>
              <Text style={s.viewerBtnGhostText}>{t('service.photoClose')}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const v = viewing;
                setViewing(null);
                if (v) void shoot(v.item, v.slot);
              }}
              accessibilityRole="button"
              style={s.viewerBtn}
            >
              <Icon name="camera" size={18} color={colors.onAccent} />
              <Text style={s.viewerBtnText}>{t('service.retake')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </FuelScreen>
  );
}

/** The catalogue minus what is already on the visit, and a line to type another. */
function AddWorkSheet({
  visible,
  onClose,
  taken,
  onAdd,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  taken: (string | null)[];
  onAdd: (work: { reason_id: string } | { custom_name: string }) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const reasonsQ = useQuery({ queryKey: SERVICE_KEYS.reasons, queryFn: fetchReasons, enabled: visible });
  const [draft, setDraft] = useState('');
  const options = useMemo(
    () => (reasonsQ.data ?? []).filter((r: ServiceReason) => !taken.includes(r.id)),
    [reasonsQ.data, taken],
  );
  const submitCustom = () => {
    const name = draft.trim();
    if (!name) return;
    setDraft('');
    onAdd({ custom_name: name });
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('service.addWork')}>
      <View style={{ gap: 8 }}>
        {options.map((r) => (
          <Pressable key={r.id} onPress={() => onAdd({ reason_id: r.id })} disabled={busy} accessibilityRole="button" style={s.option}>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={s.optionName}>{r.name}</Text>
              {!r.approved ? (
                <Text style={s.optionSub}>{t('service.yours')}</Text>
              ) : r.interval_km != null ? (
                <Text style={s.optionSub}>{t('service.every', { km: fmtKm(r.interval_km) })}</Text>
              ) : null}
            </View>
            <Icon name="plus" size={16} color={colors.brandDark} strokeWidth={2.4} />
          </Pressable>
        ))}
        <View style={s.customRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('service.addReasonPlaceholder')}
            placeholderTextColor={colors.slateLt}
            style={s.customInput}
            returnKeyType="done"
            onSubmitEditing={submitCustom}
            maxLength={80}
          />
          <Pressable onPress={submitCustom} disabled={busy || !draft.trim()} accessibilityRole="button" style={[s.customBtn, !draft.trim() && { opacity: 0.5 }]}>
            <Text style={s.customBtnText}>{t('service.addReasonAdd')}</Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  now: { borderWidth: 1.5, borderColor: colors.brand, borderRadius: 18, gap: 4 },
  where: { fontSize: 20, fontWeight: '800', color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.mist },
  thumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: colors.photoBg },
  thumbEmpty: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.mist,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 18,
    height: 18,
    borderRadius: 99,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbBadgeBusy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 10, backgroundColor: 'rgba(20,24,31,0.45)', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 13, color: colors.slate, fontWeight: '600' },
  retake: { fontSize: 13, fontWeight: '700', color: colors.brand },
  shoot: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brand, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  shootText: { fontSize: 13, fontWeight: '800', color: colors.onAccent },
  remove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 13, color: colors.slate, lineHeight: 18, marginTop: 2 },
  work: { gap: 12, borderWidth: 1.5, borderColor: colors.mist, borderRadius: 18 },
  workDone: { borderColor: colors.success },
  workHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slots: { flexDirection: 'row', gap: 10 },
  slotCol: { flex: 1, gap: 8 },
  slot: { borderRadius: 14, backgroundColor: colors.photoBg },
  slotImg: { borderRadius: 14, backgroundColor: colors.photoBg },
  slotEmpty: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.brand,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 8,
  },
  slotEmptyTitle: { fontSize: 16, fontWeight: '800', color: colors.brandDark },
  slotEmptySub: { fontSize: 12, fontWeight: '600', color: colors.slate, textAlign: 'center' },
  slotBusy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,24,31,0.45)', alignItems: 'center', justifyContent: 'center' },
  slotBadge: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 26,
    height: 26,
    borderRadius: 99,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotLabel: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  retakeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.brand,
    backgroundColor: colors.brandTint,
  },
  retakeText: { fontSize: 15, fontWeight: '800', color: colors.brandDark },
  addBig: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 58,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.brand,
    backgroundColor: colors.brandTint,
  },
  addBigText: { fontSize: 17, fontWeight: '800', color: colors.brandDark },
  viewer: { flex: 1, backgroundColor: '#000000', justifyContent: 'center' },
  viewerImg: { flex: 1, width: '100%' },
  viewerBar: { flexDirection: 'row', gap: 12, padding: 16, paddingBottom: 36 },
  viewerBtn: {
    flex: 1,
    height: 54,
    borderRadius: 14,
    backgroundColor: colors.brand,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  viewerBtnText: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
  viewerBtnGhost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#ffffff' },
  viewerBtnGhostText: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
  addRow: { paddingVertical: 10 },
  addIcon: { width: 40, height: 40, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  addText: { fontSize: 15, fontWeight: '700', color: colors.brandDark },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.mist,
    borderRadius: 14,
    backgroundColor: colors.white,
  },
  optionName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  optionSub: { fontSize: 13, color: colors.slate, fontWeight: '600' },
  customRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  customInput: { flex: 1, height: 48, borderWidth: 1, borderColor: colors.mist, borderRadius: 14, paddingHorizontal: 14, fontSize: 16, color: colors.ink, backgroundColor: colors.white },
  customBtn: { height: 48, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  customBtnText: { fontSize: 15, fontWeight: '800', color: colors.onAccent },
  progress: { fontSize: 12.5, color: colors.slateLt, textAlign: 'center' },
  gate: { fontSize: 12, color: colors.slateLt, textAlign: 'center' },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14, gap: 6, borderTopWidth: 1, borderTopColor: colors.mist, backgroundColor: colors.paper },
});
