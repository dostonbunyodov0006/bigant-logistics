import { earlyAmount, MorningStartService, settleMorningStart } from './morning-start.service';
import { morningNineFor, recordMorningPress } from '../orders/morning-start';

const day = new Date('2026-10-29T00:00:00.000Z'); // the 29th; 09:00 Tashkent = 04:00Z
const at = (hm: string) => new Date(`2026-10-29T${hm}:00.000Z`); // UTC
const here = { lat: 41.3, lng: 69.24 };
const away = { lat: 41.31, lng: 69.24 }; // ~1.1 km north

describe('morning early start', () => {
  it('counts only an Ertangi order booked for before 9:00', () => {
    expect(morningNineFor({ bookingKind: 'bron', deliveryDatetime: day, startAfterNine: false })?.toISOString()).toBe(
      '2026-10-29T04:00:00.000Z',
    );
    expect(morningNineFor({ bookingKind: 'bron', deliveryDatetime: day, startAfterNine: true })).toBeNull();
    expect(morningNineFor({ bookingKind: 'zanyat', deliveryDatetime: at('03:12'), startAfterNine: false })).toBeNull();
  });

  it('waits while the lorry has not moved', () => {
    const press = { pressedAt: at('03:00'), pressLat: here.lat, pressLng: here.lng, day }; // 08:00 Tashkent
    expect(settleMorningStart(press, [{ ...here, recordedAt: at('03:05') }])).toBeNull();
  });

  it('starts when the lorry is seen 300 m off, not at the press: 08:05 → 55 min', () => {
    const press = { pressedAt: at('03:00'), pressLat: here.lat, pressLng: here.lng, day };
    const r = settleMorningStart(press, [
      { ...here, recordedAt: at('03:01') },
      { ...away, recordedAt: at('03:05') },
    ]);
    expect(r?.startedAt.toISOString()).toBe('2026-10-29T03:05:00.000Z');
    expect(r?.earlyMinutes).toBe(55);
  });

  it('08:40 → 20 min', () => {
    const press = { pressedAt: at('03:00'), pressLat: here.lat, pressLng: here.lng, day };
    const r = settleMorningStart(press, [{ ...away, recordedAt: at('03:40') }]);
    expect(r?.startedAt.toISOString()).toBe('2026-10-29T03:40:00.000Z');
    expect(r?.earlyMinutes).toBe(20);
  });

  it('gives nothing when the lorry only moved after 9:00, even pressed at 08:50', () => {
    const press = { pressedAt: at('03:50'), pressLat: here.lat, pressLng: here.lng, day };
    expect(settleMorningStart(press, [{ ...away, recordedAt: at('04:05') }])).toBeNull();
  });

  it('counts a press at 08:50 that moved off at 08:55: 5 min', () => {
    const press = { pressedAt: at('03:50'), pressLat: here.lat, pressLng: here.lng, day };
    expect(settleMorningStart(press, [{ ...away, recordedAt: at('03:55') }])?.earlyMinutes).toBe(5);
  });

  it('uses the first fix after the press when the phone had none at the press', () => {
    const press = { pressedAt: at('03:00'), pressLat: null, pressLng: null, day };
    const r = settleMorningStart(press, [
      { ...here, recordedAt: at('03:02') },
      { ...away, recordedAt: at('03:08') },
    ]);
    expect(r?.earlyMinutes).toBe(52);
  });
});

describe('early start pay', () => {
  it("is the hourly rate ÷ 60 × minutes: the owner's example, 101 min at 70 000 = 117 833", () => {
    expect(earlyAmount(70_000, 101)).toBe(117_833);
  });
  it('a small lorry at 40 000 for 55 min', () => {
    expect(earlyAmount(40_000, 55)).toBe(36_667);
  });
});

describe('pay period lock (owner, 07.11.2026)', () => {
  const day15 = new Date('2026-11-15T00:00:00.000Z');
  const pressed = new Date('2026-11-15T02:00:00.000Z'); // 07:00 Tashkent
  const moved = [
    { ...here, recordedAt: new Date('2026-11-15T02:01:00.000Z') },
    { ...away, recordedAt: new Date('2026-11-15T02:05:00.000Z') },
  ];
  function make() {
    const prisma = {
      morningStart: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'm1', driverId: 'd1', day: day15, pressedAt: pressed, pressLat: here.lat, pressLng: here.lng, status: 'waiting_gps' },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      driverLocationPing: { findMany: jest.fn().mockResolvedValue(moved) },
      driver: { findUnique: jest.fn().mockResolvedValue({ vehicle: { category: 'katta' } }) },
      vehicleTariff: { findUnique: jest.fn().mockResolvedValue({ earlyHourSom: 70_000 }) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { svc: new MorningStartService(prisma as any), prisma };
  }

  it('a morning of the 15th is never confirmed once its period locked on the 16th at 12:00', async () => {
    const { svc, prisma } = make();
    expect(await svc.runOnce(new Date('2026-11-16T07:00:00.000Z'))).toEqual({ confirmed: 0, no_move: 1 });
    expect(prisma.morningStart.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'no_move' } });
  });

  it('the same morning on the 16th at 11:59 is still confirmed', async () => {
    const { svc, prisma } = make();
    expect(await svc.runOnce(new Date('2026-11-16T06:59:00.000Z'))).toEqual({ confirmed: 1, no_move: 0 });
    expect(prisma.morningStart.update.mock.calls[0][0].data).toMatchObject({ status: 'confirmed', earlyMinutes: 115 });
  });

  it('a press before nine is noted as before: its day is always still open', async () => {
    // Before 09:00 of the order's day its period cannot be locked yet (that is
    // on a later 16th at 12:00), so the guard in recordMorningPress never bites.
    const prisma = {
      morningStart: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
    };
    const order = { id: 'o1', bookingKind: 'bron' as const, deliveryDatetime: new Date('2026-11-15T00:00:00.000Z'), startAfterNine: false };
    const driver = { id: 'd1', locationLat: null, locationLng: null, locationUpdatedAt: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recordMorningPress(prisma as any, order as any, driver, 'pickup', pressed);
    expect(prisma.morningStart.create).toHaveBeenCalledTimes(1);
  });
});
