import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { OrderPublic, ServiceCenter, ServiceVisit } from '@bigant/shared';
import { api, ApiError } from '../lib/api';
import { errorText } from '../lib/errorText';
import { captureFix } from '../lib/fuel';
import { ORDERS_LIST_KEY } from '../lib/ordersQuery';
import { queryClient } from '../lib/queryClient';
import { invalidateService, type Work } from '../lib/service';

/** The order the truck is on right now, if any — an emergency mid-order is noted against it. */
const UNDERWAY = ['collecting_items', 'items_collected', 'on_the_way', 'arrived_at_customer', 'returning'];
function currentOrderId(): string | null {
  const orders = queryClient.getQueryData<OrderPublic[]>(ORDERS_LIST_KEY) ?? [];
  return orders.find((o) => UNDERWAY.includes(o.status))?.id ?? null;
}

/**
 * "Shu yerdaman — boshlash": the moment the driver arrives.
 *
 * Reads the phone's position, opens the visit if it does not exist yet (an
 * emergency is created here, an approved request already has an id), tells
 * the server where the truck is, and lands on the photos with the home
 * screen underneath — there is no going back to "start" a visit that has
 * started. GPS that does not answer is not a reason to stop: the server files
 * the visit as unverified and admin sees it.
 */
export function useStartServiceVisit() {
  const { t } = useTranslation();
  const nav = useNavigation();
  const [busy, setBusy] = useState(false);
  // A visit opened on an attempt whose "start" then failed. The next tap
  // starts that one instead of opening a second emergency visit against the
  // same breakdown.
  const opened = useRef<string | null>(null);
  // Set before anything is sent (audit, 07.11.2026): `busy` is state and only
  // shows on the next render, so a second tap while the first create was still
  // on its way opened a second emergency visit.
  const inFlight = useRef(false);

  const start = useCallback(
    async (input: { visitId?: string; works?: Work[]; center: ServiceCenter | null }) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        const fix = captureFix();
        let visitId = input.visitId ?? opened.current ?? undefined;
        if (!visitId) {
          const created = await api.post<ServiceVisit>('/service/visits', {
            origin: 'emergency',
            works: (input.works ?? []).map((w) => ('reason_id' in w ? { reason_id: w.reason_id } : { custom_name: w.custom_name })),
            center_id: input.center?.id ?? null,
            order_id: currentOrderId(),
          });
          visitId = created.id;
          opened.current = created.id;
        }
        const position = await fix;
        const visit = await api.post<ServiceVisit>(`/service/visits/${visitId}/start`, {
          center_id: input.center?.id ?? null,
          captured_at: new Date().toISOString(),
          position,
        });
        opened.current = null;
        invalidateService();
        nav.dispatch(
          CommonActions.reset({
            index: 1,
            routes: [{ name: 'DriverHome' }, { name: 'ServicePhotos', params: { visitId: visit.id } }],
          }),
        );
      } catch (err) {
        // Started already (double tap, or resumed from the card): just go on.
        const started = input.visitId ?? opened.current;
        if (err instanceof ApiError && err.status === 409 && started) {
          opened.current = null;
          nav.dispatch(
            CommonActions.reset({
              index: 1,
              routes: [{ name: 'DriverHome' }, { name: 'ServicePhotos', params: { visitId: started } }],
            }),
          );
          return;
        }
        Alert.alert(errorText(err));
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [nav, t],
  );

  return { start, busy };
}
