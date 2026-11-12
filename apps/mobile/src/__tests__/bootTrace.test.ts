/** The start written down step by step; an unfinished start is reported next time (owner, 05.11.2026). */
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
    write(v: string) {
      mockStored = v;
    }
  },
}));
const mockReport = jest.fn();
jest.mock('../lib/crashReport', () => ({ report: (e: Error) => mockReport(e.message) }));

beforeEach(() => {
  jest.resetModules();
  mockStored = null;
  mockReport.mockReset();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

// eslint-disable-next-line @typescript-eslint/no-require-imports
const load = () => require('../lib/bootTrace') as typeof import('../lib/bootTrace');

describe('boot trace', () => {
  it('each step is written down at once', () => {
    const t = load();
    t.bootBegin();
    t.bootMark('auth:begin');
    expect(JSON.parse(mockStored!).map((m: [string]) => m[0])).toEqual(['js-start', 'auth:begin']);
  });

  it('a start that never got to the end is reported on the next one, with its last step', () => {
    mockStored = JSON.stringify([['js-start', 1000], ['refresh:read-token', 1200]]);
    load().bootBegin();
    expect(mockReport).toHaveBeenCalledWith(expect.stringContaining('refresh:read-token +200ms'));
  });

  it('a finished start is not reported', () => {
    mockStored = JSON.stringify([['js-start', 1000], ['ready', 2000]]);
    load().bootBegin();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('still not finished after 15 s: reported there and then', () => {
    const t = load();
    t.bootBegin();
    t.bootMark('auth:begin');
    jest.advanceTimersByTime(15_000);
    expect(mockReport).toHaveBeenCalledWith(expect.stringContaining('still not finished'));
    mockReport.mockReset();
    const u = load();
    u.bootBegin();
    u.bootMark('ready');
    jest.advanceTimersByTime(15_000);
    expect(mockReport).not.toHaveBeenCalledWith(expect.stringContaining('still not finished'));
  });
});
