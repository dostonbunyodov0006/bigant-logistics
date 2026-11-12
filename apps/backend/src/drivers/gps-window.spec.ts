import { gpsWindow, onBreakAt, gpsOnlyWindow } from './gps-window';

// GPS required only in working hours, or while work is in hand (owner, 04.11.2026).
const tas = (hhmm: string) => new Date(new Date(`2026-11-04T${hhmm}:00.000Z`).getTime() - 5 * 3_600_000);
const day = { isDayOff: false, startMinutes: 9 * 60, endMinutes: 18 * 60 };

describe('gpsWindow', () => {
  it('on shift in working hours: required from 09:00 to 18:00', () => {
    expect(gpsWindow({ now: tas('12:00'), onShift: true, inHand: false, day })).toEqual({ from: tas('09:00'), until: tas('18:00') });
  });
  it('after 18:00 with nothing in hand: not required, nobody is nagged', () => {
    expect(gpsWindow({ now: tas('18:30'), onShift: true, inHand: false, day })).toBeNull();
  });
  it('after 18:00 with an order or a return in hand: required while it lasts', () => {
    const w = gpsWindow({ now: tas('19:30'), onShift: true, inHand: true, day: null })!;
    expect(w.from.getTime()).toBeLessThan(tas('19:30').getTime());
    expect(w.until.getTime()).toBeGreaterThan(tas('23:00').getTime());
  });
  it('off shift, or a day off with nothing in hand: not required', () => {
    expect(gpsWindow({ now: tas('12:00'), onShift: false, inHand: true, day })).toBeNull();
    expect(gpsWindow({ now: tas('12:00'), onShift: true, inHand: false, day: { ...day, isDayOff: true } })).toBeNull();
  });
  it('started early, before 09:00, nothing in hand: the window opens at 09:00', () => {
    expect(gpsWindow({ now: tas('08:30'), onShift: true, inHand: false, day })).toEqual({ from: tas('09:00'), until: tas('18:00') });
  });

  describe('on a break (owner, 11.11.2026)', () => {
    it('on a break everything is asked as at work: GPS, internet, battery saver (owner, 12.11.2026)', () => {
      const brk = { breakStartedAt: tas('12:00'), breakUntil: tas('13:00') };
      expect(gpsWindow({ now: tas('12:10'), onShift: true, inHand: false, day, ...brk })).toEqual({ from: tas('09:00'), until: tas('18:00') });
      expect(gpsOnlyWindow({ now: tas('12:10'), onShift: true, inHand: false, day, ...brk })).toBeNull();
    });
    it('late back from it: the same, no red screen for the lateness itself', () => {
      const brk = { breakStartedAt: tas('12:00'), breakUntil: tas('13:00') };
      expect(gpsWindow({ now: tas('14:30'), onShift: true, inHand: false, day, ...brk })).toEqual({ from: tas('09:00'), until: tas('18:00') });
    });
    it('whereabouts on a break are his own: onBreakAt from its start to its end', () => {
      const brk = { breakStartedAt: tas('12:00'), breakUntil: tas('13:00') };
      expect(onBreakAt(brk, tas('11:59'))).toBe(false);
      expect(onBreakAt(brk, tas('12:30'))).toBe(true);
      expect(onBreakAt(brk, tas('13:00'))).toBe(false);
      expect(onBreakAt({ breakStartedAt: null, breakUntil: null }, tas('12:30'))).toBe(false);
    });
    it('a break only planned for later: nothing changes now', () => {
      expect(gpsWindow({ now: tas('11:00'), onShift: true, inHand: false, day, breakStartedAt: tas('12:00'), breakUntil: tas('13:00') })).toEqual({
        from: tas('09:00'),
        until: tas('18:00'),
      });
    });
  });
});
