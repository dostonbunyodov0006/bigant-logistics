import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  RETURN_DESTINATIONS,
  type OrderPickupSourcePublic,
  type ReturnDestination,
} from '@bigant/shared';
import { Sheet } from './Sheet';
import { colors } from './theme';

/**
 * Where each load goes back.
 *
 * Previously this was a row of chips inside the same modal that started the
 * return, with the validation reported as an alert after the fact. Here every
 * load is its own block naming the place it came from, and the button stays off
 * until each one has an answer — the rule is visible before it is broken.
 */
type OnSubmit = (
  returns: { pickup_source_id: string; destination: ReturnDestination }[],
  reason: string | null,
) => void;

export function ReturnDestinationSheet({
  visible,
  onClose,
  clientName,
  sources,
  pending,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  orderNumber: number;
  clientName: string;
  sources: OrderPickupSourcePublic[];
  pending: boolean;
  onSubmit: OnSubmit;
}) {
  const { t } = useTranslation();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('returns.whereTitle')}
      subtitle={`${t('home.clientNamed', { name: clientName })} · ${t('returns.loadCount', { n: sources.length })}`}
    >
      <View style={s.note}>
      </View>
      {/* Mounted only while open, so a reopened sheet starts empty. */}
      {visible && (
        <ReturnDestinationForm
          sources={sources}
          pending={pending}
          reasonLabel={t('home.reasonOptional')}
          onSubmit={onSubmit}
        />
      )}
      <Pressable onPress={onClose} style={s.cancel} accessibilityRole="button">
        <Text style={s.cancelText}>{t('common.back')}</Text>
      </Pressable>
    </Sheet>
  );
}

/** A destination per load, an optional note, and the start button — the
 *  sheet above and the last step of the vozvrat report both use it. */
export function ReturnDestinationForm({
  sources,
  pending,
  reasonLabel,
  onSubmit,
}: {
  sources: OrderPickupSourcePublic[];
  pending: boolean;
  reasonLabel: string;
  onSubmit: OnSubmit;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<Partial<Record<string, ReturnDestination>>>({});
  const [reason, setReason] = useState('');

  const missing = sources.filter((source) => !chosen[source.id]);
  const ready = sources.length > 0 && missing.length === 0 && !pending;

  const submit = () => {
    if (!ready) return;
    onSubmit(
      sources.map((source) => ({
        pickup_source_id: source.id,
        destination: chosen[source.id]!,
      })),
      reason.trim() || null,
    );
  };

  return (
    <>
      {sources.map((source) => {
        const pick = chosen[source.id];
        const place = [source.district_name, source.region_name].filter(Boolean).join(', ');
        return (
          <View key={source.id} style={[s.block, !pick && s.blockMissing]}>
            <Text style={s.blockTitle}>{source.name}</Text>
            {place ? <Text style={s.blockPlace}>{place}</Text> : null}
            <View style={s.row}>
              {RETURN_DESTINATIONS.map((destination) => {
                const active = pick === destination;
                return (
                  <Pressable
                    key={destination}
                    onPress={() => setChosen((c) => ({ ...c, [source.id]: destination }))}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={[s.dest, active && s.destOn]}
                  >
                    <Text style={[s.destText, active && s.destTextOn]}>
                      {t(`home.dest_${destination}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!pick && <Text style={s.blockHint}>{t('returns.notChosen')}</Text>}
          </View>
        );
      })}

      <View>
        <Text style={s.label}>{reasonLabel}</Text>
        <TextInput
          style={s.input}
          value={reason}
          onChangeText={setReason}
          placeholder={t('returns.reasonPlaceholder')}
          placeholderTextColor={colors.slateLt}
          maxLength={500}
        />
      </View>

      <View>
        <Pressable
          onPress={submit}
          disabled={!ready}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready }}
          style={[s.primary, !ready && s.primaryOff]}
        >
          <Text style={[s.primaryText, !ready && s.primaryTextOff]}>{t('returns.start')}</Text>
        </Pressable>
        {missing.length > 0 && <Text style={s.hint}>{t('returns.chooseEach')}</Text>}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  note: { borderRadius: 12, backgroundColor: colors.paper, paddingHorizontal: 13, paddingVertical: 11 },
  noteText: { fontSize: 12, fontWeight: '600', color: colors.slate, lineHeight: 17 },
  block: { borderRadius: 14, borderWidth: 1, borderColor: colors.mist, padding: 13 },
  blockMissing: { borderWidth: 1.5, borderColor: colors.brand },
  blockTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  blockPlace: { marginTop: 3, fontSize: 13, fontWeight: '600', color: colors.slate },
  blockHint: { marginTop: 9, fontSize: 12, fontWeight: '700', color: colors.brandDark },
  row: { marginTop: 11, flexDirection: 'row', gap: 7 },
  dest: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.mist,
    backgroundColor: colors.white,
  },
  destOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  destText: { fontSize: 13, fontWeight: '700', color: colors.graphite },
  destTextOn: { fontWeight: '800', color: colors.brandDark },
  label: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: colors.slate,
  },
  input: {
    marginTop: 6,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.white,
    paddingHorizontal: 13,
    fontSize: 15,
    color: colors.ink,
  },
  primary: {
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryOff: { backgroundColor: colors.mist },
  primaryText: { fontSize: 17, fontWeight: '800', color: colors.onAccent },
  primaryTextOff: { color: colors.slateLt },
  hint: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    color: colors.brandDark,
  },
  cancel: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  cancelText: { fontSize: 14, fontWeight: '700', color: colors.slate },
});
