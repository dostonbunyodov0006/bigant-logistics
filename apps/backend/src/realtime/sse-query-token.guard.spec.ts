import { forgetAccount } from '../common/active-account';
import { SseQueryTokenGuard } from './sse-query-token.guard';

/** The stream's own door checks the account like every other request (audit, 07.11.2026). */
describe('SseQueryTokenGuard', () => {
  afterEach(() => forgetAccount());

  function make(status: string | null) {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', role: 'seller' }) };
    const config = { get: () => 'secret' };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(status ? { status } : null) } };
    const req: { query: { token: string }; user?: unknown } = { query: { token: 't' } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { guard: new SseQueryTokenGuard(jwt as any, config as any, prisma as any), ctx: ctx as any, req };
  }

  it('lets an active account in', async () => {
    const { guard, ctx, req } = make('active');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({ userId: 'u1', role: 'seller' });
  });

  it('refuses a switched-off account with a valid token', async () => {
    const { guard, ctx, req } = make('inactive');
    await expect(guard.canActivate(ctx)).rejects.toThrow('account_inactive');
    expect(req.user).toBeUndefined();
  });
});
