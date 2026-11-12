import { useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation } from '@tanstack/react-query';
import { queryClient } from '../../lib/queryClient';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { takePhoto, uploadPhoto } from '../../hooks/usePhotoCapture';
import { Icon } from '../../components/Icon';
import { colors } from '../../components/theme';
import { ScreenHeader } from '../../components/ScreenHeader';
import { ErrorBanner } from '../../components/ui';
import { errorText } from '../../lib/errorText';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { deferKm } from '../../lib/kmDefer';
import { Card, PrimaryButton, SecondaryButton, f, FuelScreen } from './fuelUi';

type Nav = NativeStackNavigationProp<RootStackParams>;
type Route = RouteProp<RootStackParams, 'FuelOdometer'>;

/**
 * "Keyinroq yuboraman" is offered after one send that did not get through, or
 * once a send has been going this long (owner, 07.11.2026): a photo can take
 * ~3 min on a weak signal, and two of those meant ~6 min with no way out.
 */
export const LATER_AFTER_MS = 60_000;

/**
 * A send that did not get through (no network, timeout, 5xx, 408, 429). A
 * refused reading — any other 4xx, "not an odometer", "does not match",
 * "less than before" — is his to fix, never a way past the screen.
 */
export function didNotGetThrough(err: unknown): boolean {
  return !(err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429);
}

/** True once `pending` has stayed on for `ms`; false again when it ends (owner, 07.11.2026). */
export function useSlowSend(pending: boolean, ms: number = LATER_AFTER_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!pending) return;
    const id = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(id);
  }, [pending, ms]);
  return pending && slow;
}

/** "152 340" or "152340" → 152340; null while it is not a whole number. */
export function kmOf(text: string): number | null {
  const digits = text.replace(/\s/g, '');
  return /^\d{1,7}$/.test(digits) && Number(digits) > 0 ? Number(digits) : null;
}

/**
 * Every Monday, right after "Ishni boshladim": the odometer, photographed and
 * typed (owner, 30.10.2026 — it used to come at the pump). Both are needed and
 * there is no way past it until they are in: no back, no swipe — except
 * "Keyinroq yuboraman" once a send has failed or has been going for a minute. It keeps the lorry's km
 * true — the service reminders run on it.
 */
export function FuelOdometerScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { lastKm, shiftStartedAt } = useRoute<Route>().params;
  useEffect(() => nav.setOptions({ gestureEnabled: false }), [nav]);
  // Android's back button does nothing here either.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);
  const [uri, setUri] = useState<string | null>(null);
  const [text, setText] = useState('');
  const km = kmOf(text);
  const tooLow = km != null && lastKm != null && km < lastKm;
  const [fails, setFails] = useState(0);
  // Left with "Keyinroq yuboraman" while the send was still going: if it then
  // gets through, it counts, but the screen he is on now is not closed.
  const gone = useRef(false);

  const saveM = useMutation({
    mutationFn: async () => {
      const url = await uploadPhoto(uri!, t);
      if (!url) throw new Error('photo_upload_failed');
      return api.post('/drivers/me/km', { km, photo_url: url });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['km-due'] });
      if (!gone.current) nav.goBack();
    },
    // Only a send that did not get through counts (audit, 07.11.2026).
    onError: (err) => {
      if (!gone.current && didNotGetThrough(err)) setFails((n) => n + 1);
    },
  });
  const slow = useSlowSend(saveM.isPending);

  const later = () => {
    gone.current = true;
    deferKm(shiftStartedAt);
    if (nav.canGoBack()) nav.goBack();
    else nav.navigate('DriverHome');
  };

  const shoot = async () => {
    const shot = await takePhoto(t);
    if (shot) setUri(shot);
  };

  return (
    <FuelScreen>
      <ScreenHeader title={t('fuel.odometerTitle')} back={false} />
      <View style={f.body}>
        <Card>
          {uri ? (
            <Pressable onPress={shoot} accessibilityRole="button" accessibilityLabel={t('fuel.odometerRetake')}>
              <Image source={{ uri }} style={s.photo} />
            </Pressable>
          ) : (
            <Pressable onPress={shoot} accessibilityRole="button" style={s.shoot}>
              <Icon name="camera" size={28} color={colors.graphite} />
              <Text style={s.shootText}>{t('fuel.odometerPhoto')}</Text>
            </Pressable>
          )}
        </Card>
        <Card>
          <Text style={f.eyebrow}>{t('fuel.odometerKm')}</Text>
          <TextInput
            value={text}
            onChangeText={(v) => setText(v.replace(/[^\d\s]/g, ''))}
            keyboardType="number-pad"
            placeholder={lastKm != null ? String(lastKm) : '152340'}
            placeholderTextColor={colors.slateLt}
            style={[s.input, tooLow && s.inputBad]}
            maxLength={9}
          />
          {tooLow ? <Text style={s.bad}>{t('fuel.odometerTooLow', { km: lastKm })}</Text> : null}
        </Card>
        {saveM.error ? <ErrorBanner message={errorText(saveM.error)} /> : null}
        <View style={f.spacer} />
        <PrimaryButton
          label={t('fuel.odometerSave')}
          icon="check"
          onPress={() => saveM.mutate()}
          disabled={!uri || km == null || tooLow || saveM.isPending}
        />
        {fails > 0 || slow ? (
          <SecondaryButton label={t('fuel.odometerLater')} icon="clock" onPress={later} style={s.later} />
        ) : null}
      </View>
    </FuelScreen>
  );
}

const s = StyleSheet.create({
  shoot: {
    height: 150,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.slateLt,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  shootText: { fontSize: 15, fontWeight: '800', color: colors.graphite },
  photo: { width: '100%', height: 200, borderRadius: 12, backgroundColor: colors.photoBg },
  input: {
    marginTop: 8,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.mist,
    paddingHorizontal: 14,
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
    backgroundColor: colors.white,
  },
  inputBad: { borderColor: colors.danger },
  later: { marginTop: 10 },
  bad: { marginTop: 6, fontSize: 13, fontWeight: '700', color: colors.danger },
});
