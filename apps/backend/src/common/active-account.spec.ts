import { forgetAccount, isActiveAccount } from './active-account';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';

const prismaWith = (status: string | null) => ({
  user: { findUnique: jest.fn().mockResolvedValue(status ? { status } : null) },
});

beforeEach(() => forgetAccount());

describe('a dismissed account is out at once (owner, 06.11.2026)', () => {
  it('asks the database, then keeps the answer for 20 s', async () => {
    const prisma = prismaWith('active');
    expect(await isActiveAccount(prisma as never, 'u1', 1_000)).toBe(true);
    expect(await isActiveAccount(prisma as never, 'u1', 15_000)).toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    await isActiveAccount(prisma as never, 'u1', 22_000);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('an inactive or deleted account is not active; forgetting makes a change count at once', async () => {
    expect(await isActiveAccount(prismaWith('inactive') as never, 'u2', 0)).toBe(false);
    expect(await isActiveAccount(prismaWith(null) as never, 'u3', 0)).toBe(false);
    const p = prismaWith('active');
    expect(await isActiveAccount(p as never, 'u2', 1)).toBe(false); // cached
    forgetAccount('u2');
    expect(await isActiveAccount(p as never, 'u2', 2)).toBe(true);
  });

  it('a valid token of a dismissed person is refused', async () => {
    const config = { get: () => 'x'.repeat(40) };
    const strategy = new JwtStrategy(config as never, prismaWith('inactive') as never);
    await expect(strategy.validate({ sub: 'u9', role: 'seller' } as never)).rejects.toThrow('account_inactive');
    const ok = new JwtStrategy(config as never, prismaWith('active') as never);
    forgetAccount();
    await expect(ok.validate({ sub: 'u8', role: 'seller' } as never)).resolves.toEqual({ userId: 'u8', role: 'seller' });
  });
});
