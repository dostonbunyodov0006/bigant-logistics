import { Image, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { OrderPickupSourcePublic } from '@bigant/shared';
import { Icon } from './Icon';
import { colors } from './theme';

/** YUK OLISH JOYLARI — the ordered pickup stops with their leg status
 *  (Kutilmoqda → Yo'lda → Yuk olindi), matching screens 3–5. */
export function PickupStops({ sources }: { sources: OrderPickupSourcePublic[] }) {
  const { t } = useTranslation();
  if (sources.length === 0) return null;

  const legLabel = (leg: OrderPickupSourcePublic['leg_status']) =>
    ({
      pending: t('home.legPending'),
      en_route: t('home.legEnRoute'),
      arrived: t('home.legArrived'),
    })[leg];

  return (
    <View style={s.wrap}>
      <Text style={s.header}>{t('home.pickupPlaces')}</Text>
      {[...sources]
        .sort((a, b) => a.position - b.position)
        .map((src, i) => {
          const done = src.leg_status === 'arrived';
          const active = src.leg_status === 'en_route';
          return (
            <View key={src.id} style={s.row}>
              <View style={[s.dot, done && s.dotDone, active && s.dotActive]}>
                {done ? (
                  <Icon name="check" size={13} color={colors.success} strokeWidth={3} />
                ) : (
                  <Text style={[s.dotText, active && s.dotTextOn]}>{i + 1}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>
                  {src.name}
                  {src.district_name ? ` · ${src.district_name}` : ''}
                </Text>
                <Text style={[s.leg, done && s.legDone, active && s.legActive]}>{legLabel(src.leg_status)}</Text>
                {src.load_photo_url ? (
                  <Image source={{ uri: src.load_photo_url }} style={s.loadPhoto} resizeMode="cover" />
                ) : null}
              </View>
            </View>
          );
        })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.mist,
    padding: 12,
  },
  header: {
    marginBottom: 8,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.slateLt,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.paper,
  },
  dotActive: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  dotDone: { borderColor: colors.success, backgroundColor: colors.successBg },
  dotText: { fontSize: 12, fontWeight: '700', color: colors.slate },
  dotTextOn: { color: colors.ink },
  name: { fontSize: 14, fontWeight: '600', color: colors.ink },
  leg: { marginTop: 1, fontSize: 12, color: colors.slateLt },
  loadPhoto: { marginTop: 8, width: '100%', height: 140, borderRadius: 10, backgroundColor: colors.mist },
  legActive: { color: colors.brandDark, fontWeight: '600' },
  legDone: { color: colors.success, fontWeight: '600' },
});
