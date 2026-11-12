import { useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api } from '../lib/api';

/** Opens the camera; the photo's local uri, or null if cancelled or refused. */
export async function takePhoto(t: TFunction): Promise<string | null> {
  if (Platform.OS === 'web') {
    Alert.alert(t('delivery.cameraNotAvailable'));
    return null;
  }
  const ImagePicker = await import('expo-image-picker');
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchCameraAsync({
    quality: 0.5,
    allowsEditing: false,
    // The back lens, said outright: the phone otherwise opened whichever it used last — the driver's own face (owner, 02.11.2026).
    cameraType: ImagePicker.CameraType.back,
  });
  return !result.canceled && result.assets[0] ? result.assets[0].uri : null;
}

/** Uploads a local photo and returns its URL, or null (after telling the
 *  driver) if it could not be sent. */
export async function uploadPhoto(uri: string, t: TFunction): Promise<string | null> {
  try {
    const { File } = await import('expo-file-system');
    const base64 = await new File(uri).base64();
    const res = await api.post<{ url: string }>('/upload/photo', { base64 });
    return res.url;
  } catch (err) {
    const message =
      (err as Error)?.message === 'photo_upload_failed' ? t('errors.photoUploadFailed') : t('errors.network');
    Alert.alert(t('delivery.uploadFailedTitle'), message);
    return null;
  }
}

/**
 * The camera-and-upload half of every proof step: take a photo, optionally
 * comment on it, upload, hand back the URL.
 *
 * Three steps require proof — arriving at a pickup, handing the cargo to the
 * client, and handing a return back — and each used to carry its own copy of
 * this code. One copy means the photo rule behaves identically in all three,
 * including what happens when the upload fails.
 */
export function usePhotoCapture() {
  const { t } = useTranslation();
  const [uri, setUri] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [uploading, setUploading] = useState(false);

  const take = useCallback(async () => {
    const taken = await takePhoto(t);
    if (taken) setUri(taken);
  }, [t]);

  const reset = useCallback(() => {
    setUri(null);
    setComment('');
  }, []);

  /** Uploads the held photo and returns its URL, or null if it could not be
   *  sent — the caller then leaves the sheet open so nothing is lost. */
  const upload = useCallback(async (): Promise<string | null> => {
    if (!uri) return null;
    setUploading(true);
    try {
      return await uploadPhoto(uri, t);
    } finally {
      setUploading(false);
    }
  }, [t, uri]);

  return { uri, comment, setComment, take, reset, upload, uploading };
}

export type PhotoCapture = ReturnType<typeof usePhotoCapture>;
