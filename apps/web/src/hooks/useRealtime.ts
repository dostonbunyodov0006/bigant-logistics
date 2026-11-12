import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeEvent } from '@bigant/shared';
import { API_URL, getAccessToken } from '../lib/api';

/** Live board updates via the backend SSE stream. On each event, invalidate the
 *  affected React Query keys so the seller board / order lists / order detail
 *  refresh instantly.
 *
 *  Screens keep a slow (60s) fallback interval rather than none at all: an
 *  EventSource is only authenticated at connect time, so if the stream drops
 *  after the access token has expired, reconnects would loop on a stale token.
 *  The periodic request is what triggers the 401 → refresh that heals it. */
export function useRealtime(enabled: boolean): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const handle = (ev: RealtimeEvent) => {
      if (ev.type === 'driver_status_changed') {
        void qc.invalidateQueries({ queryKey: ['seller-board'] });
        void qc.invalidateQueries({ queryKey: ['drivers'] });
        void qc.invalidateQueries({ queryKey: ['seller-queue'] });
      } else if (ev.type === 'order_status_changed') {
        void qc.invalidateQueries({ queryKey: ['seller-board'] });
        void qc.invalidateQueries({ queryKey: ['orders'] });
        // The seller watching a truck's queue sees each step the driver takes
        // without touching anything: this is the key that card reads from.
        void qc.invalidateQueries({ queryKey: ['seller-queue'] });
        // A single order's detail is cached under ['order', id] — a different key
        // from the ['orders'] lists, so it needs invalidating explicitly.
        if (ev.order_id) void qc.invalidateQueries({ queryKey: ['order', ev.order_id] });
      }
    };

    const connect = () => {
      const token = getAccessToken();
      if (!token) {
        retry = setTimeout(connect, 2000);
        return;
      }
      es = new EventSource(`${API_URL}/realtime/stream?token=${encodeURIComponent(token)}`);
      es.onmessage = (e) => {
        try {
          handle(JSON.parse(e.data) as RealtimeEvent);
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        // EventSource auth is checked only at connect, so reconnect with a fresh token.
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      closed = true;
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [enabled, qc]);
}
