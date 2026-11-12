import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { DriverPublic } from '@bigant/shared';
import { api } from '../lib/api';
import { useBottomInset } from '../lib/useBottomInset';
import { ScreenHeader } from '../components/ScreenHeader';
import { Icon } from '../components/Icon';
import { colors } from '../components/theme';

type Doc = 'license' | 'tech';

/**
 * The driver's own papers: his licence and the lorry's tech passport, each a
 * button that opens to the scans the office holds. Nothing is uploaded from
 * here; the office keeps the originals.
 */
export function DocumentsScreen() {
  const { t } = useTranslation();
  const bottomInset = useBottomInset();
  const [open, setOpen] = useState<Doc | null>(null);
  const driverQ = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => api.get<DriverPublic>('/drivers/me'),
  });
  const d = driverQ.data;

  const docs: { key: Doc; label: string; front: string | null; back: string | null }[] = [
    { key: 'license', label: t('profile.licenseDoc'), front: d?.license_front_url ?? null, back: d?.license_back_url ?? null },
    {
      key: 'tech',
      label: t('profile.techPassportDoc'),
      front: d?.vehicle_tech_passport_front_url ?? null,
      back: d?.vehicle_tech_passport_back_url ?? null,
    },
  ];

  return (
    <View style={s.screen}>
      <ScreenHeader title={t('profile.documents')} />
      <ScrollView contentContainerStyle={[s.body, { paddingBottom: 24 + bottomInset }]}>
        {docs.map((doc) => {
          const isOpen = open === doc.key;
          return (
            <View key={doc.key}>
              <Pressable
                onPress={() => setOpen(isOpen ? null : doc.key)}
                accessibilityRole="button"
                style={s.option}
              >
                <View style={s.iconBox}>
                  <Icon name="image" size={22} color={colors.brand} />
                </View>
                <Text style={s.label}>{doc.label}</Text>
                <Text style={s.chevron}>{isOpen ? '⌄' : '›'}</Text>
              </Pressable>
              {isOpen && (
                <View style={s.scans}>
                  {[
                    { side: t('profile.docFront'), url: doc.front },
                    { side: t('profile.docBack'), url: doc.back },
                  ].map((side) => (
                    <View key={side.side} style={s.scan}>
                      <Text style={s.side}>{side.side}</Text>
                      {side.url ? (
                        <Image source={{ uri: side.url }} style={s.image} resizeMode="contain" />
                      ) : (
                        <Text style={s.none}>{t('profile.noPhoto')}</Text>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  body: { padding: 16, gap: 12 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.mist,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.ink },
  chevron: { fontSize: 22, color: colors.slateLt },
  scans: { gap: 12, paddingTop: 12 },
  scan: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.mist, borderRadius: 16, padding: 12, gap: 8 },
  side: { fontSize: 13, fontWeight: '700', color: colors.slate },
  image: { width: '100%', aspectRatio: 1.55, borderRadius: 10, backgroundColor: colors.paper },
  none: { fontSize: 14, color: colors.slateLt, paddingVertical: 12, textAlign: 'center' },
});
