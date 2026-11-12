import { generateKeyPairSync, verify } from 'node:crypto';
import { ApnsSender } from './apns.sender';
import { PushSender } from './push.sender';

const config = (v: Record<string, unknown>) => ({ get: (k: string) => v[k] });

describe('ApnsSender — iPhone push (owner, 06.11.2026)', () => {
  it('is off, and says so, without the key', () => {
    const s = new ApnsSender(config({ APNS_BUNDLE_ID: 'com.bigant.driver', APNS_PRODUCTION: true }) as never);
    expect(s.configured).toBe(false);
  });

  it('signs the provider token with the .p8 key (ES256) and reuses it for 50 minutes', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const s = new ApnsSender(config({ APNS_KEY: pem, APNS_KEY_ID: 'KEY123', APNS_TEAM_ID: 'TEAM45', APNS_BUNDLE_ID: 'com.bigant.driver', APNS_PRODUCTION: true }) as never);
    expect(s.configured).toBe(true);
    const tok = (s as unknown as { providerToken(now: number): string }).providerToken(1_000_000);
    const [h, p, sig] = tok.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ iss: 'TEAM45', iat: 1000 });
    expect(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true);
    expect((s as unknown as { providerToken(now: number): string }).providerToken(1_000_000 + 49 * 60_000)).toBe(tok);
    expect((s as unknown as { providerToken(now: number): string }).providerToken(1_000_000 + 51 * 60_000)).not.toBe(tok);
  });
});

describe('PushSender splits by phone', () => {
  it('iPhone tokens go to APNs, Android ones to Firebase; a token Apple refuses is dropped', async () => {
    const prisma = {
      pushToken: {
        findMany: jest.fn().mockResolvedValue([
          { userId: 'u1', fcmToken: 'apns-a', platform: 'ios' },
          { userId: 'u1', fcmToken: 'apns-b', platform: 'ios' },
          { userId: 'u2', fcmToken: 'fcm-c', platform: 'android' },
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const apns = { configured: true, send: jest.fn().mockResolvedValue(['sent', 'gone']) };
    // Firebase not configured here: only the iPhone side runs.
    const push = new PushSender(prisma as never, config({}) as never, apns as never);
    await push.sendToMany(['u1', 'u2'], 'Yangi zakaz', 'Mijoz: Aziz', { orderId: 'o1' });
    expect(apns.send).toHaveBeenCalledWith(['apns-a', 'apns-b'], 'Yangi zakaz', 'Mijoz: Aziz', { orderId: 'o1' });
    expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({ where: { fcmToken: { in: ['apns-b'] } } });
  });
});
