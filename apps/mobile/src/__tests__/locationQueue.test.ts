// Positions taken without internet are kept and sent later with their times (owner, 04.11.2026).
let mockStored: string | null = null;
jest.mock('expo-file-system', () => ({
  Paths: { document: 'doc' },
  File: class {
    get exists() {
      return mockStored !== null;
    }
    textSync() {
      return mockStored ?? '';
    }
    create() {
      mockStored = '';
    }
    write(s: string) {
      mockStored = s;
    }
    delete() {
      mockStored = null;
    }
  },
}));
const mockPostFn = jest.fn();
jest.mock('../lib/api', () => {
  class ApiError extends Error {
    status: number;
    constructor(code: number) {
      super(`HTTP ${code}`);
      this.status = code;
    }
  }
  return { api: { post: (...a: unknown[]) => mockPostFn(...a) }, ApiError };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { clearQueue, deliver, locationBacklog, syncBacklog } = require('../lib/locationQueue');

const p = (min: number) => ({ lat: 41 + min / 100, lng: 69, recorded_at: new Date(Date.UTC(2026, 10, 4, 10, min)).toISOString() });

beforeEach(() => {
  mockStored = null;
  mockPostFn.mockReset();
});

describe('the location queue', () => {
  it('online: one fix goes as a plain position, nothing is kept', async () => {
    mockPostFn.mockResolvedValue({ on_shift: true });
    expect(await deliver([p(0)])).toEqual({ on_shift: true });
    expect(mockPostFn).toHaveBeenCalledWith('/drivers/me/location', { lat: 41, lng: 69 });
    expect(mockStored).toBeNull();
  });

  it('no internet: kept with their times; back online: all go together, oldest first, and the queue empties', async () => {
    mockPostFn.mockRejectedValue(new Error('Network request failed'));
    await expect(deliver([p(0)])).rejects.toThrow();
    await expect(deliver([p(5)])).rejects.toThrow();
    expect(JSON.parse(mockStored!)).toHaveLength(2);
    expect(locationBacklog.get()).toBe(2);

    mockPostFn.mockResolvedValue({ on_shift: true });
    await deliver([p(10)]);
    expect(mockPostFn).toHaveBeenLastCalledWith('/drivers/me/location/batch', { points: [p(0), p(5), p(10)], sent_at: expect.any(String) });
    expect(mockStored).toBeNull();
    expect(locationBacklog.get()).toBe(0);
  });

  it('refused by the server as invalid: dropped, not retried for ever', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ApiError } = require('../lib/api');
    mockPostFn.mockRejectedValue(new ApiError(400));
    await deliver([p(0)]);
    expect(mockStored).toBeNull();
  });

  it('one bad point in the backlog: only it is dropped, the rest reach the server (owner, 06.11.2026)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ApiError } = require('../lib/api');
    const bad = { lat: 999, lng: 69, recorded_at: p(2).recorded_at };
    mockStored = JSON.stringify([p(0), p(1), bad, p(3), p(4)]);
    const taken: unknown[] = [];
    mockPostFn.mockImplementation(async (_path: string, body: { points: unknown[] }) => {
      if (body.points.some((x) => (x as { lat: number }).lat === 999)) throw new ApiError(400);
      taken.push(...body.points);
      return { on_shift: true };
    });
    expect(await deliver([p(5)])).toEqual({ on_shift: true });
    expect(taken).toEqual([p(0), p(1), p(3), p(4), p(5)]);
    expect(mockStored).toBeNull();
    expect(locationBacklog.get()).toBe(0);
  });

  it('refused every time: bounded, and what was not tried is kept for the next call', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ApiError } = require('../lib/api');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MAX_SENDS } = require('../lib/locationQueue');
    const backlog = Array.from({ length: 40 }, (_, i) => p(i));
    mockStored = JSON.stringify(backlog);
    mockPostFn.mockRejectedValue(new ApiError(400));
    await deliver([]);
    expect(mockPostFn).toHaveBeenCalledTimes(MAX_SENDS);
    const left = JSON.parse(mockStored!);
    expect(left.length).toBeGreaterThan(0);
    expect(left.length).toBeLessThan(40);
    expect(locationBacklog.get()).toBe(left.length);
  });

  it('server down (5xx) mid-way: what was taken is gone, the rest is kept', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ApiError } = require('../lib/api');
    mockStored = JSON.stringify([p(0), p(1), p(2), p(3)]);
    mockPostFn.mockRejectedValueOnce(new ApiError(400)).mockResolvedValueOnce({ on_shift: true }).mockRejectedValue(new ApiError(502));
    await expect(deliver([])).rejects.toThrow();
    expect(JSON.parse(mockStored!)).toEqual([p(2), p(3)]);
    expect(locationBacklog.get()).toBe(2);
  });

  it('signed out: the kept points are deleted, so the next account never sends them (audit, 07.11.2026)', async () => {
    mockPostFn.mockRejectedValue(new Error('Network request failed'));
    await expect(deliver([p(0)])).rejects.toThrow();
    expect(locationBacklog.get()).toBe(1);
    await clearQueue();
    expect(mockStored).toBeNull();
    expect(locationBacklog.get()).toBe(0);
    mockPostFn.mockReset();
    mockPostFn.mockResolvedValue({ on_shift: false });
    await deliver([]);
    expect(mockPostFn).not.toHaveBeenCalled();
  });
});

describe('syncBacklog (owner, 07.11.2026)', () => {
  it('after a cold start the count reads what the file holds, without sending', async () => {
    mockStored = JSON.stringify([p(0), p(5), p(10)]);
    expect(await syncBacklog()).toBe(3);
    expect(locationBacklog.get()).toBe(3);
    expect(mockPostFn).not.toHaveBeenCalled();
    mockStored = null;
    expect(await syncBacklog()).toBe(0);
    expect(locationBacklog.get()).toBe(0);
  });
});
