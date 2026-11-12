import { readFileSync } from 'fs';
// The phone is deliberately set far from Tashkent: New York, ten hours behind
// in November. Every helper must still read Tashkent's clock (owner, 06.11.2026).
//
// Jest hands a test a copy of process.env, so setting TZ there changes nothing.
// The worker's own process is reached through a function from Node's realm
// (fs), and Node resets V8's zone the moment its TZ is assigned. Put back
// afterwards: the worker goes on to run other files.
const worker = (readFileSync.constructor as FunctionConstructor)('return process')() as NodeJS.Process;
const savedTz = worker.env.TZ;
worker.env.TZ = 'America/New_York';
afterAll(() => {
  if (savedTz === undefined) delete worker.env.TZ;
  else worker.env.TZ = savedTz;
});

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
import {
  addDays,
  formatDate,
  formatTime,
  fromTashkentWall,
  tashkentAt,
  tashkentClock,
  tashkentDayKey,
  tashkentDmy,
  tashkentMonth,
  tashkentWall,
} from '../lib/format';
import { groupDays, ymd } from '../screens/tabs/TodayOrdersTab';
import { order } from './fixtures';

// 19:30 UTC on 6 Nov is 00:30 on 7 Nov in Tashkent — and 14:30 on 6 Nov here.
const LATE = '2026-11-06T19:30:00Z';

describe('Tashkent time on a phone set to another zone', () => {
  it('the test really runs outside Tashkent', () => {
    expect(new Date(LATE).getHours()).toBe(14);
    expect(new Date(LATE).getDate()).toBe(6);
  });

  it('day key, clock, dmy and month are Tashkent', () => {
    expect(tashkentDayKey(LATE)).toBe('2026-11-07');
    expect(tashkentClock(LATE)).toBe('00:30');
    expect(tashkentDmy(LATE)).toBe('07.11.2026');
    expect(tashkentDayKey('2026-11-06T18:59:59Z')).toBe('2026-11-06');
    expect(tashkentDayKey('2026-11-06T19:00:00Z')).toBe('2026-11-07');
    // 31 Dec 20:00 UTC is already January in Tashkent.
    expect(tashkentMonth('2026-12-31T20:00:00Z')).toBe(0);
    expect(tashkentDayKey(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
  });

  it('formatTime and formatDate show the Tashkent wall clock', () => {
    expect(formatTime(LATE)).toMatch(/^(00|12):30/);
    expect(formatTime(LATE)).not.toMatch(/(14|02):30/);
    expect(formatDate(LATE)).toMatch(/7/);
    expect(formatDate(LATE)).not.toMatch(/\b6\b/);
    expect(formatTime(null)).toBe('—');
  });

  it('a Tashkent wall time maps to the right instant and back', () => {
    expect(tashkentAt('2026-11-07', 0, 30).toISOString()).toBe('2026-11-06T19:30:00.000Z');
    expect(tashkentAt('2026-11-07', 10, 0).toISOString()).toBe('2026-11-07T05:00:00.000Z');
    const wall = tashkentWall(LATE);
    expect([wall.getDate(), wall.getHours(), wall.getMinutes()]).toEqual([7, 0, 30]);
    expect(fromTashkentWall(wall).toISOString()).toBe('2026-11-06T19:30:00.000Z');
  });

  it('addDays crosses month and year ends without any zone', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-11-06', -30)).toBe('2026-10-07');
  });

  it("an evening order falls on its Tashkent day in the Bugungi tab", () => {
    expect(ymd(new Date(LATE))).toBe('2026-11-07');
    const o = order({ id: 'late', status: 'assigned_to_driver', delivery_datetime: LATE, created_at: LATE });
    expect(groupDays([o], '2026-11-07').queue.map((x) => x.id)).toEqual(['late']);
    expect(groupDays([o], '2026-11-06').queue).toEqual([]);
  });
});
