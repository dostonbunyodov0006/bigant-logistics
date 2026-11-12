import {
  confirmedUntil,
  decide,
  firstCheckAt,
  isAwaitingAnswer,
  isDue,
  isStale,
  readEndCheckNotes,
  type EndCheckShift,
} from './shift-end-check';

/** 26.09 at HH:MM Tashkent, as a UTC instant. */
const tas = (hhmm: string, day = '2026-09-26') => new Date(new Date(`${day}T${hhmm}:00.000Z`).getTime() - 5 * 3_600_000);
const END_18 = 18 * 60;

const shift = (over: Partial<EndCheckShift> = {}): EndCheckShift => ({
  clockInAt: tas('09:02'),
  endMinutes: END_18,
  endCheckRanAt: null,
  endCheckSentAt: null,
  endCheckAnsweredAt: null,
  endCheckUnanswered: 0,
  ...over,
});

describe('when the check looks at a shift', () => {
  it('first half an hour after the shift end — 18:30 on the default schedule (owner, 10.11.2026)', () => {
    expect(firstCheckAt(tas('09:02'), END_18)).toEqual(tas('18:30'));
    expect(isDue(shift(), tas('18:29'))).toBe(false);
    expect(isDue(shift(), tas('18:30'))).toBe(true);
  });

  it('a driver on his own schedule is checked half an hour after his own end', () => {
    expect(isDue(shift({ endMinutes: 20 * 60 }), tas('20:29'))).toBe(false);
    expect(isDue(shift({ endMinutes: 20 * 60 }), tas('20:30'))).toBe(true);
  });

  it('asked at 18:30, then 19:00 — the last ask, ten minutes to answer', () => {
    const first = shift({ endCheckRanAt: tas('18:30'), endCheckSentAt: tas('18:30') });
    expect(isDue(first, tas('18:59'))).toBe(false);
    expect(isDue(first, tas('19:00'))).toBe(true);
  });

  it('the second ask out and unanswered: looked at again ten minutes later, 19:10', () => {
    const s = shift({ endCheckRanAt: tas('19:00'), endCheckSentAt: tas('19:00'), endCheckUnanswered: 1 });
    expect(isDue(s, tas('19:09'))).toBe(false);
    expect(isDue(s, tas('19:10'))).toBe(true);
    // Answered "+30": back to the half-hour rhythm.
    expect(isDue({ ...s, endCheckAnsweredAt: tas('19:02') }, tas('19:10'))).toBe(false);
    expect(isDue({ ...s, endCheckAnsweredAt: tas('19:02') }, tas('19:32'))).toBe(true);
  });

  it('a Viloyat shift is looked at every ten minutes', () => {
    const s = { clockInAt: tas('09:00'), endMinutes: 1080, endCheckRanAt: tas('19:50'), endCheckZone: 'viloyat', endCheckSentAt: null, endCheckAnsweredAt: null, endCheckUnanswered: 0 };
    expect(isDue(s, tas('19:59'))).toBe(false);
    expect(isDue(s, tas('20:00'))).toBe(true);
    expect(isDue({ ...s, endCheckZone: 'tashkent' }, tas('20:00'))).toBe(false);
  });

  it('a shift from an earlier day is due at once, whatever its schedule', () => {
    const old = shift({ clockInAt: tas('09:40', '2026-09-15') });
    expect(isStale(old.clockInAt, tas('07:00'))).toBe(true);
    // Not before three in the morning: he may still be on the road back (owner, 03.11.2026).
    expect(isStale(old.clockInAt, tas('00:30', '2026-09-16'))).toBe(false);
    expect(isStale(old.clockInAt, tas('02:59', '2026-09-16'))).toBe(false);
    expect(isStale(old.clockInAt, tas('03:00', '2026-09-16'))).toBe(true);
    expect(isDue(old, tas('07:00'))).toBe(true);
  });
});

describe('what the check does — the diagram, box by box', () => {
  const base = { stale: false, sentAt: null, answeredAt: null, unanswered: 0 };

  it('Viloyat: flagged and skipped — even with no order, even from yesterday', () => {
    expect(decide({ ...base, zone: 'viloyat', hasActiveOrder: false }).action).toBe('skip_viloyat');
    expect(decide({ ...base, stale: true, zone: 'viloyat', hasActiveOrder: false }).action).toBe('skip_viloyat');
  });

  it('Tashkent with an active order: skip', () => {
    expect(decide({ ...base, zone: 'tashkent', hasActiveOrder: true }).action).toBe('skip_active');
  });

  it('Tashkent with no order, the same evening: asked first', () => {
    expect(decide({ ...base, zone: 'tashkent', hasActiveOrder: false })).toEqual({ action: 'remind', unanswered: 0 });
  });

  it('an unknown location is asked, not skipped', () => {
    expect(decide({ ...base, zone: 'unknown', hasActiveOrder: false }).action).toBe('remind');
  });

  it('18:30 asked, no answer → 19:00 asked again; still none → 19:10 closed for him (owner, 10.11.2026)', () => {
    const second = decide({ ...base, zone: 'tashkent', hasActiveOrder: false, sentAt: tas('18:30') });
    expect(second).toEqual({ action: 'remind', unanswered: 1 });
    const close = decide({ ...base, zone: 'tashkent', hasActiveOrder: false, sentAt: tas('19:00'), unanswered: 1 });
    expect(close).toEqual({ action: 'close_no_answer', unanswered: 2 });
  });

  it('"+30 min" answered in between: asked again, the count does not grow', () => {
    const d = decide({ ...base, zone: 'unknown', hasActiveOrder: false, sentAt: tas('18:30'), answeredAt: tas('18:35'), unanswered: 0 });
    expect(d).toEqual({ action: 'remind', unanswered: 0 });
  });

  it('open from an earlier day, in Tashkent, nothing in hand: ended without asking', () => {
    expect(decide({ ...base, stale: true, zone: 'tashkent', hasActiveOrder: false }).action).toBe('close_stale');
    expect(decide({ ...base, stale: true, zone: 'unknown', hasActiveOrder: false }).action).toBe('close_stale');
  });

  it('open from an earlier day but still delivering: left alone', () => {
    expect(decide({ ...base, stale: true, zone: 'tashkent', hasActiveOrder: true }).action).toBe('skip_active');
  });

  it('a reminder is awaiting his answer until he answers after it', () => {
    expect(isAwaitingAnswer({ endCheckSentAt: tas('18:10'), endCheckAnsweredAt: null })).toBe(true);
    expect(isAwaitingAnswer({ endCheckSentAt: tas('18:10'), endCheckAnsweredAt: tas('18:12') })).toBe(false);
    expect(isAwaitingAnswer({ endCheckSentAt: tas('18:40'), endCheckAnsweredAt: tas('18:12') })).toBe(true);
    expect(isAwaitingAnswer({ endCheckSentAt: null, endCheckAnsweredAt: null })).toBe(false);
  });
});

describe('decide — back from the viloyat', () => {
  const base = { stale: false, hasActiveOrder: false, sentAt: null, answeredAt: null, unanswered: 0 };
  it('back in the city the same evening with nothing in hand: the day is over, closed at the border', () => {
    expect(decide({ ...base, zone: 'tashkent', returnedToCity: true })).toEqual({ action: 'close_returned', unanswered: 0 });
  });
  it('leaves him alone while an order is still in hand', () => {
    expect(decide({ ...base, zone: 'tashkent', returnedToCity: true, hasActiveOrder: true }).action).toBe('skip_active');
  });
});

describe('closed for no answer: ended at the time he last confirmed (owner, 07.11.2026)', () => {
  const dayEnd = tas('18:00');
  const clockInAt = tas('09:02');
  const now = tas('19:10');

  it("never pressed '+30': the day's end, 18:00", () => {
    expect(confirmedUntil({ dayEnd, clockInAt, notes: [], now })).toEqual(tas('18:00'));
  });

  it('pressed once at 18:00: 18:30; twice: 19:00 — by presses, not by when he pressed', () => {
    expect(confirmedUntil({ dayEnd, clockInAt, notes: [{ at: tas('18:00') }], now: tas('19:40') })).toEqual(tas('18:30'));
    expect(confirmedUntil({ dayEnd, clockInAt, notes: [{ at: tas('18:05') }, { at: tas('18:50') }], now: tas('20:30') })).toEqual(
      tas('19:00'),
    );
  });

  it('never after now', () => {
    expect(confirmedUntil({ dayEnd, clockInAt, notes: [{ at: tas('18:00') }, { at: tas('18:01') }], now: tas('18:40') })).toEqual(
      tas('18:40'),
    );
  });

  it('a shift begun after six counts from its start', () => {
    expect(confirmedUntil({ dayEnd, clockInAt: tas('18:20'), notes: [{ at: tas('18:50') }], now: tas('20:30') })).toEqual(tas('18:50'));
  });

  it('reopened at 20:00: counts from the reopen, presses before it left out', () => {
    const notes = [{ at: tas('18:00') }, { at: tas('20:30') }];
    expect(confirmedUntil({ dayEnd, clockInAt, reopenedAt: tas('20:00'), notes, now: tas('22:10') })).toEqual(tas('20:30'));
  });

  it('reads the stored notes back, skipping anything malformed', () => {
    expect(
      readEndCheckNotes([
        { at: tas('18:01').toISOString(), note: 'Chilonzorda yuk tushiryapman' },
        { at: 'nonsense', note: 'x' },
        { note: 'no time' },
        null,
      ]),
    ).toEqual([{ at: tas('18:01'), note: 'Chilonzorda yuk tushiryapman' }]);
    expect(readEndCheckNotes(null)).toEqual([]);
  });
});
