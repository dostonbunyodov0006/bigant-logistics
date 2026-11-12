/**
 * The working day's start and end, as the office set them under Kunlik ish
 * soati (owner, 30.10.2026: "admin o'zgartirsa o'sha narsa ishlasin"). They
 * used to be written into the code as 09:00 and 18:00; now SettingsService
 * keeps this up to date — on start, on every save, and once a minute so a
 * second backend hears of a change too. The code that asks is synchronous,
 * hence a value kept here rather than a query each time.
 *
 * Offsets are from a Tashkent day's label (its UTC midnight): Tashkent keeps
 * +05:00, so 09:00 there is 04:00 UTC.
 */
const TASHKENT_OFFSET_MIN = 5 * 60;
let startMin = 9 * 60;
let endMin = 18 * 60;

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export function setShiftClock(shiftStart: string, shiftEnd: string): void {
  startMin = toMin(shiftStart);
  endMin = toMin(shiftEnd);
}

/** The shift start, from a Tashkent day's UTC-midnight label, in ms. */
export const shiftStartUtcMs = (): number => (startMin - TASHKENT_OFFSET_MIN) * 60_000;

/** "09:00" — for messages. */
export const shiftStartLabel = (): string =>
  `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`;

