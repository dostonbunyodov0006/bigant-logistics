import { AppUpdatesController } from './app-updates.controller';
import { AppUpdatesService, parseTesterIds } from './app-updates.service';

// A new update goes to the test phones first (owner, 09.11.2026).
const service = (raw: string | undefined) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new AppUpdatesService({ get: () => raw } as any);

describe('OTA test channel', () => {
  it('reads a comma-separated list, spaces and blanks ignored', () => {
    expect([...parseTesterIds(' a , b,,c ')]).toEqual(['a', 'b', 'c']);
    expect(parseTesterIds('').size).toBe(0);
    expect(parseTesterIds(undefined).size).toBe(0);
  });

  it('a listed user is a tester, anyone else is not', () => {
    const s = service('u-1,u-2');
    expect(s.isTester('u-1')).toBe(true);
    expect(s.isTester('u-2')).toBe(true);
    expect(s.isTester('u-3')).toBe(false);
  });

  it('nobody is a tester when the list is unset', () => {
    expect(service(undefined).isTester('u-1')).toBe(false);
  });

  it('the endpoint answers for the signed-in user', () => {
    const c = new AppUpdatesController(service('u-1'));
    expect(c.channel('u-1')).toEqual({ tester: true });
    expect(c.channel('u-9')).toEqual({ tester: false });
  });
});
