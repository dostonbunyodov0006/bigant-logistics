import type { PrismaService } from '../prisma/prisma.service';

/**
 * Whether an account may still act (owner, 06.11.2026): a dismissed or
 * blocked person is out at once — not when their 15-minute token runs out,
 * and not 30 days later when the refresh token does. Asked on every request,
 * so the answer is kept for 20 seconds.
 */
const TTL_MS = 20_000;
const cache = new Map<string, { active: boolean; at: number }>();

export async function isActiveAccount(prisma: PrismaService, userId: string, now = Date.now()): Promise<boolean> {
  const hit = cache.get(userId);
  if (hit && now - hit.at < TTL_MS) return hit.active;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  const active = user?.status === 'active';
  cache.set(userId, { active, at: now });
  if (cache.size > 5000) cache.clear();
  return active;
}

/** For tests and for the moment an account is changed here: ask the database next time. */
export function forgetAccount(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
