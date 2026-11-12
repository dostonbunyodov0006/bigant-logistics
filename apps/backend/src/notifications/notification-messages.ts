import { shiftStartLabel } from '../common/shift-clock';
/**
 * Uzbek push-notification copy, keyed by outbox event type.
 *
 * Device push goes to drivers, whose app is Uzbek-only, so the tray text is
 * always rendered in Uzbek here (no per-user language stored). Nobody in the
 * company reads order numbers: every line names the client instead, and says
 * plainly "Buyurtma" when there is no client to name. The in-app notification
 * list carries the type and is translated client-side with the same names.
 */
type Rendered = { title: string; body: string };

/** "Bekzod buyurtmasi" when a client is known, plain "Buyurtma" otherwise. */
const of = (client: string | null) => (client ? `${client} buyurtmasi` : 'Buyurtma');

const UZ: Record<string, (client: string | null) => Rendered> = {
  'order.assigned': (c) => ({ title: 'Yangi buyurtma tayinlandi', body: `${of(c)} sizga tayinlandi` }),
  'order.assigned_start_shift': (c) => ({
    title: 'Yangi buyurtma tayinlandi',
    body: `${of(c)} sizga tayinlandi. «Ishni boshlash»ni bosing`,
  }),
  'order.cancelled': (c) => ({ title: 'Buyurtma bekor qilindi', body: `${of(c)} bekor qilindi` }),
  'order.accepted': (c) => ({ title: 'Haydovchi buyurtmani qabul qildi', body: `${of(c)}ni haydovchi qabul qildi` }),
  'order.rejected': (c) => ({ title: 'Haydovchi buyurtmani rad etdi', body: `${of(c)} rad etildi va qaytadan bo'sh` }),
  'order.assignment_expired': (c) => ({
    title: 'Tayinlov muddati tugadi',
    body: `${of(c)} o'z vaqtida qabul qilinmadi va qaytadan bo'sh`,
  }),
  'order.problem': (c) => ({ title: 'Muammo bildirildi', body: `${of(c)}da muammo bildirildi` }),
  'order.status_changed': (c) => ({ title: 'Buyurtma holati yangilandi', body: `${of(c)} holati yangilandi` }),
  'order.delivered': (c) => ({ title: 'Buyurtma yetkazildi', body: `${of(c)} yetkazib berildi` }),
  'order.start_moved_later': (c) => ({
    title: `Buyurtma ${shiftStartLabel()} dan keyinga o'tdi`,
    body: `${of(c)} soat ${shiftStartLabel()} da ochiladi`,
  }),
  'order.start_moved_earlier': (c) => ({
    title: `Buyurtma ${shiftStartLabel()} dan oldinga o'tdi`,
    body: `${of(c)} endi ${shiftStartLabel()} ni kutmaydi — ertalab boshlang`,
  }),
};

/**
 * Render Uzbek push copy for a notification type. Returns null for unknown
 * types so the caller can fall back to the original text.
 */
export function renderPushUz(type: string, clientName: string | null): Rendered | null {
  const render = UZ[type];
  if (!render) {
    return null;
  }
  return render(clientName);
}
