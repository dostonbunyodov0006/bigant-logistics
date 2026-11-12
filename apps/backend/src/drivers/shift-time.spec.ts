import {
  breakTakenMinutes,
  earlyMinutesAt,
  shiftDayKey,
  lateMinutesAt,
  netMinutes,
  shiftDayEnd,
  workedByDay,
} from './shift-time';

/** HH:MM Tashkent on a day, as a UTC instant. */
const tas = (hhmm: string, day = '2026-09-25') => new Date(`${day}T${hhmm}:00.000+05:00`);

describe('shift-time', () => {
  describe('early leave is judged against the day the shift began', () => {
    it('the shift day ends at its expected end on the clock-in day', () => {
      expect(shiftDayEnd(tas('09:00'), '18:00')).toEqual(tas('18:00'));
      expect(shiftDayEnd(tas('09:00'), null)).toBeNull();
    });

    it('clocking out at 00:21 after a late delivery is not early', () => {
      expect(earlyMinutesAt(tas('09:00'), '18:00', tas('00:21', '2026-09-26'))).toBe(0);
    });

    it('leaving at 17:30 is 30 minutes early; at 18:00 or later, not at all', () => {
      expect(earlyMinutesAt(tas('09:00'), '18:00', tas('17:30'))).toBe(30);
      expect(earlyMinutesAt(tas('09:00'), '18:00', tas('18:00'))).toBe(0);
    });

    it('a day off has no end, so nothing is early', () => {
      expect(earlyMinutesAt(tas('09:00'), null, tas('12:00'))).toBe(0);
    });
  });

  it('late minutes count from the expected start of the clock-in day', () => {
    expect(lateMinutesAt(tas('09:25'), '09:00')).toBe(25);
    expect(lateMinutesAt(tas('08:50'), '09:00')).toBe(0);
    expect(lateMinutesAt(tas('09:25'), null)).toBe(0);
  });

  it('net minutes leave breaks out', () => {
    expect(
      netMinutes({ clockInAt: tas('09:00'), clockOutAt: tas('18:00'), breakMinutes: 60 }),
    ).toBe(480);
    expect(netMinutes({ clockInAt: tas('09:00'), clockOutAt: null })).toBeNull();
  });

  describe('worked minutes per Tashkent day', () => {
    it('a shift over midnight is split at 00:00 Tashkent, not 05:00', () => {
      expect(
        workedByDay({ clockInAt: tas('20:00'), clockOutAt: tas('02:00', '2026-09-26') }),
      ).toEqual([
        { date: '2026-09-25', minutes: 240 },
        { date: '2026-09-26', minutes: 120 },
      ]);
    });

    it('a three-day trip credits each day it covered', () => {
      const days = workedByDay({ clockInAt: tas('09:00'), clockOutAt: tas('12:00', '2026-09-27') });
      expect(days).toEqual([
        { date: '2026-09-25', minutes: 900 },
        { date: '2026-09-26', minutes: 1440 },
        { date: '2026-09-27', minutes: 720 },
      ]);
    });

    it('breaks come off the first day, and the days add up to the net total', () => {
      const log = {
        clockInAt: tas('20:00'),
        clockOutAt: tas('02:00', '2026-09-26'),
        breakMinutes: 30,
      };
      const days = workedByDay(log);
      expect(days).toEqual([
        { date: '2026-09-25', minutes: 210 },
        { date: '2026-09-26', minutes: 120 },
      ]);
      expect(days.reduce((s, d) => s + d.minutes, 0)).toBe(netMinutes(log));
    });

    it('an open shift has nothing to split yet', () => {
      expect(workedByDay({ clockInAt: tas('09:00'), clockOutAt: null })).toEqual([]);
    });
  });

  describe('break taken', () => {
    const started = tas('13:00');
    it('runs to its planned end once that has passed', () => {
      expect(
        breakTakenMinutes({ breakStartedAt: started, breakUntil: tas('14:00') }, tas('16:00')),
      ).toBe(60);
    });
    it('runs to now when ended early', () => {
      expect(
        breakTakenMinutes({ breakStartedAt: started, breakUntil: tas('14:00') }, tas('13:20')),
      ).toBe(20);
    });
    it('is nothing when no break was started', () => {
      expect(breakTakenMinutes({ breakStartedAt: null, breakUntil: null }, tas('16:00'))).toBe(0);
    });
  });
});

describe('shiftDayKey — a shift day runs 05:00 to 05:00 (owner, 04.11.2026; 07.11.2026)', () => {
  const at = (iso: string) => new Date(new Date(`${iso}.000Z`).getTime() - 5 * 3_600_000);
  it('19:15 and 04:59 the next night are the same shift day; 05:00 starts a new one', () => {
    expect(shiftDayKey(at('2026-11-03T19:15:00'))).toBe('2026-11-03');
    expect(shiftDayKey(at('2026-11-04T03:00:00'))).toBe('2026-11-03');
    expect(shiftDayKey(at('2026-11-04T04:59:00'))).toBe('2026-11-03');
    expect(shiftDayKey(at('2026-11-04T05:00:00'))).toBe('2026-11-04');
  });
});
