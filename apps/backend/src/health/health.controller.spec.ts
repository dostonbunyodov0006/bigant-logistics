import { HealthController } from './health.controller';

// A phone's crash or stuck-start report is kept in the database, not only in the
// container log that goes with every deploy (owner, 05.11.2026).
describe('HealthController.clientError', () => {
  it('stores the report, clipped', async () => {
    const create = jest.fn().mockResolvedValue({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new HealthController({ clientReport: { create } } as any);
    c.clientError({ fatal: false, version: '1.2.6', message: 'boot did not finish last time: js-start +0ms', stack: 'x'.repeat(5000) });
    await Promise.resolve();
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ fatal: false, version: '1.2.6', message: 'boot did not finish last time: js-start +0ms' });
    expect(data.stack).toHaveLength(4000);
  });

  it('a database that cannot take it does not fail the phone', () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new HealthController({ clientReport: { create } } as any);
    expect(() => c.clientError({ message: 'x' })).not.toThrow();
  });
});
