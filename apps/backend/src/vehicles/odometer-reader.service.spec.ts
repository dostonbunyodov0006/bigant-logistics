import { judgeOdometer, parseOdometer } from './odometer-reader.service';

describe('the Monday odometer photo', () => {
  it('the number on the odometer is the number typed: taken', () => {
    expect(judgeOdometer(123456, { is_odometer: true, km: 123456, confidence: 'high' })).toBe('ok');
    // The last drum half-turned: one km either way is the same reading.
    expect(judgeOdometer(123456, { is_odometer: true, km: 123457, confidence: 'medium' })).toBe('ok');
  });

  it("the owner's case: some other picture with a number typed under it — refused", () => {
    expect(judgeOdometer(123456, { is_odometer: false, km: null, confidence: 'high' })).toBe('not_odometer');
  });

  it('an odometer that says something else than what he typed — refused', () => {
    expect(judgeOdometer(123456, { is_odometer: true, km: 120456, confidence: 'high' })).toBe('mismatch');
  });

  it('no answer, or a doubtful one: taken as typed and marked unread, never blocked', () => {
    expect(judgeOdometer(123456, null)).toBe('unread');
    expect(judgeOdometer(123456, { is_odometer: false, km: null, confidence: 'low' })).toBe('unread');
    expect(judgeOdometer(123456, { is_odometer: true, km: null, confidence: 'high' })).toBe('unread');
  });

  it('reads the model reply field by field and drops anything off-shape', () => {
    expect(parseOdometer('{"is_odometer":true,"km":123456.0,"confidence":"high"}')).toEqual({ is_odometer: true, km: 123456, confidence: 'high' });
    expect(parseOdometer('{"is_odometer":"yes","km":1,"confidence":"high"}')).toBeNull();
    expect(parseOdometer('{"is_odometer":true,"km":1,"confidence":"sure"}')).toBeNull();
    expect(parseOdometer('not json')).toBeNull();
  });
});
