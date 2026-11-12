import { dueState, reminderDue, type ReminderHistory } from './service-due';

/**
 * The mileage rule, case by case. Every number here is one a fleet manager
 * could check on a napkin.
 */
describe('dueState — where a work stands', () => {
  it('due = last done + interval; remaining = due − current', () => {
    expect(dueState({ currentKm: 30_200, lastDoneKm: 25_000, intervalKm: 10_000 })).toEqual({
      dueKm: 35_000, remainingKm: 4_800, dueSoon: false, overdue: false,
    });
  });

  it('inside the 500 km window is due soon; past it is overdue (owner, 06.11.2026)', () => {
    expect(dueState({ currentKm: 34_200, lastDoneKm: 25_000, intervalKm: 10_000 })).toMatchObject({ remainingKm: 800, dueSoon: false, overdue: false });
    expect(dueState({ currentKm: 34_600, lastDoneKm: 25_000, intervalKm: 10_000 })).toMatchObject({ remainingKm: 400, dueSoon: true, overdue: false });
    expect(dueState({ currentKm: 35_000, lastDoneKm: 25_000, intervalKm: 10_000 })).toMatchObject({ remainingKm: 0, dueSoon: true, overdue: false });
    expect(dueState({ currentKm: 36_400, lastDoneKm: 25_000, intervalKm: 10_000 })).toMatchObject({ remainingKm: -1_400, dueSoon: false, overdue: true });
  });

  it('cannot be known without an interval, a baseline, or a current km', () => {
    expect(dueState({ currentKm: 30_000, lastDoneKm: 25_000, intervalKm: null })).toMatchObject({ dueKm: null, remainingKm: null });
    expect(dueState({ currentKm: 30_000, lastDoneKm: null, intervalKm: 10_000 })).toMatchObject({ dueKm: null, remainingKm: null });
    expect(dueState({ currentKm: null, lastDoneKm: 25_000, intervalKm: 10_000 })).toMatchObject({ dueKm: 35_000, remainingKm: null, dueSoon: false, overdue: false });
  });
});

describe('reminderDue — every day from 500 km before until done, never while a visit is open (owner, 06.11.2026)', () => {
  const NOW = new Date('2026-09-22T09:00:00Z'); // 14:00 Tashkent
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
  const soon = dueState({ currentKm: 34_600, lastDoneKm: 25_000, intervalKm: 10_000 });
  const over = dueState({ currentKm: 36_400, lastDoneKm: 25_000, intervalKm: 10_000 });
  const far = dueState({ currentKm: 34_200, lastDoneKm: 25_000, intervalKm: 10_000 });

  it('says nothing while more than 500 km are left', () => {
    expect(reminderDue(far, [], false, NOW)).toBeNull();
  });

  it('due soon: the first day "due soon", every next day "repeat", never twice a day', () => {
    expect(reminderDue(soon, [], false, NOW)).toBe('due_soon');
    expect(reminderDue(soon, [{ kind: 'due_soon', sentAt: daysAgo(1) }], false, NOW)).toBe('repeat');
    expect(reminderDue(soon, [{ kind: 'due_soon', sentAt: new Date('2026-09-22T04:30:00Z') }], false, NOW)).toBeNull();
  });

  it('overdue: "overdue" the first time past it, then a reminder every day', () => {
    expect(reminderDue(over, [], false, NOW)).toBe('overdue');
    expect(reminderDue(over, [{ kind: 'due_soon', sentAt: daysAgo(3) }], false, NOW)).toBe('overdue');
    expect(reminderDue(over, [{ kind: 'overdue', sentAt: daysAgo(1) }], false, NOW)).toBe('repeat');
    expect(reminderDue(over, [{ kind: 'overdue', sentAt: daysAgo(2) }, { kind: 'repeat', sentAt: new Date('2026-09-22T05:00:00Z') }], false, NOW)).toBeNull();
  });

  it('days go by Tashkent: 23:30 yesterday and 00:30 today (Tashkent) are two days', () => {
    const yesterdayLate = new Date('2026-09-21T18:30:00Z'); // 23:30 Tashkent
    expect(reminderDue(soon, [{ kind: 'due_soon', sentAt: yesterdayLate }], false, new Date('2026-09-21T19:30:00Z'))).toBe('repeat');
  });

  it('an open visit covering the work silences everything', () => {
    expect(reminderDue(soon, [], true, NOW)).toBeNull();
    expect(reminderDue(over, [{ kind: 'overdue', sentAt: daysAgo(30) }], true, NOW)).toBeNull();
  });
});
