import { Alert, Platform } from 'react-native';
import type { TFunction } from 'i18next';
import type { ServiceDueItem, ServiceReason, ServiceVisit } from '@bigant/shared';
import { api } from './api';
import { formatNumber } from './fuel';
import { queryClient } from './queryClient';

/**
 * What the service screens share: the queries, the one-shot camera, and the
 * small readings of a visit the home card and the screens both need.
 */

/** A work the driver ticked: from the catalogue, or typed on the spot. */
export type Work = { reason_id: string; name: string } | { custom_name: string; name: string };

export const SERVICE_KEYS = {
  reasons: ['service', 'reasons'] as const,
  due: ['service', 'due', 'mine'] as const,
  visits: ['service', 'visits', 'mine'] as const,
  visit: (id: string) => ['service', 'visit', id] as const,
};

export const fetchReasons = () => api.get<ServiceReason[]>('/service/reasons');
export const fetchMyDue = () => api.get<ServiceDueItem[]>('/service/due/mine');
export const fetchMyVisits = () => api.get<ServiceVisit[]>('/service/visits/mine');
export const fetchVisit = (id: string) => api.get<ServiceVisit>(`/service/visits/${id}`);

/** After anything that changes a visit or the km: the home card, the list, the due strip. */
export function invalidateService(): void {
  void queryClient.invalidateQueries({ queryKey: ['service'] });
}

const OPEN = ['requested', 'approved', 'in_progress'] as const;
export const isOpen = (v: ServiceVisit) => (OPEN as readonly string[]).includes(v.status);

/** The one visit the home screen talks about: in progress first, then approved, then waiting. */
export function currentVisit(visits: ServiceVisit[]): ServiceVisit | null {
  const rank = { in_progress: 0, approved: 1, requested: 2 } as Record<string, number>;
  const open = visits.filter(isOpen).sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  return open[0] ?? null;
}

export const worksLine = (v: ServiceVisit) => v.items.map((i) => i.name).join(' · ');

/** The camera, without GPS: a photo as base64, or null if the driver backed out. */
export async function takePhotoBase64(t: TFunction): Promise<{ uri: string; base64: string } | null> {
  if (Platform.OS === 'web') {
    Alert.alert(t('delivery.cameraNotAvailable'));
    return null;
  }
  const ImagePicker = await import('expo-image-picker');
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchCameraAsync({
    quality: 0.6,
    allowsEditing: false,
    // The back lens, said outright: the phone otherwise opened whichever it used last — the driver's own face (owner, 02.11.2026).
    cameraType: ImagePicker.CameraType.back,
  });
  if (result.canceled || !result.assets[0]) return null;
  const uri = result.assets[0].uri;
  const { File } = await import('expo-file-system');
  return { uri, base64: await new File(uri).base64() };
}

/** "4 800 km qoldi" / "300 km o'tib ketdi" — how far a work is, in the driver's words. */
export function remainingLabel(t: TFunction, remainingKm: number | null): string | null {
  if (remainingKm == null) return null;
  const km = formatNumber(Math.abs(remainingKm));
  return remainingKm < 0 ? t('service.overdueBy', { km }) : t('service.remaining', { km });
}

export const fmtKm = (km: number) => formatNumber(km);
