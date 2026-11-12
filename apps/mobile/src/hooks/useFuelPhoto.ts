import { useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { captureFix, type CaptureFix } from '../lib/fuel';

export interface FuelShot {
  uri: string;
  capturedAt: string;
  position: CaptureFix | null;
}

/**
 * The camera for a fuel log: a photo and the position it was taken at.
 *
 * The GPS request starts the moment the camera opens and is awaited only
 * after the shutter, so a slow fix costs the driver nothing — by the time
 * they have framed the dispenser it is usually there. Timestamp is the
 * shutter, not the fix.
 */
export function useFuelPhoto() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const take = useCallback(async (): Promise<FuelShot | null> => {
    if (Platform.OS === 'web') {
      Alert.alert(t('delivery.cameraNotAvailable'));
      return null;
    }
    setBusy(true);
    try {
      const fix = captureFix();
      const ImagePicker = await import('expo-image-picker');
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return null;
      const result = await ImagePicker.launchCameraAsync({
    quality: 0.35,
    allowsEditing: false,
    // The back lens, said outright: the phone otherwise opened whichever it used last — the driver's own face (owner, 02.11.2026).
    cameraType: ImagePicker.CameraType.back,
  });
      if (result.canceled || !result.assets[0]) return null;
      const capturedAt = new Date().toISOString();
      return { uri: result.assets[0].uri, capturedAt, position: await fix };
    } finally {
      setBusy(false);
    }
  }, [t]);

  return { take, busy };
}
