import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, cert, getApps, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env.validation';
import { ApnsSender } from './apns.sender';

/** Firebase's own call has no deadline; this is ours. */
const PUSH_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`push timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}

@Injectable()
export class PushSender implements OnModuleInit {
  private readonly logger = new Logger(PushSender.name);
  private readonly serviceAccountValue: string | undefined;
  private configured = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
    private readonly apns: ApnsSender,
  ) {
    this.serviceAccountValue = config.get('FIREBASE_SERVICE_ACCOUNT', { infer: true });
  }

  onModuleInit() {
    if (!this.serviceAccountValue) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT not set — push disabled');
      return;
    }

    try {
      let sa: ServiceAccount;
      if (this.serviceAccountValue.trim().startsWith('{')) {
        sa = JSON.parse(this.serviceAccountValue) as ServiceAccount;
      } else {
        const resolved = path.resolve(this.serviceAccountValue);
        sa = JSON.parse(fs.readFileSync(resolved, 'utf-8')) as ServiceAccount;
      }

      if (getApps().length === 0) {
        initializeApp({ credential: cert(sa) });
      }
      this.configured = true;
      this.logger.log('Firebase Admin initialized — push enabled');
    } catch (err) {
      this.logger.error('Failed to initialize Firebase Admin', (err as Error).message);
    }
  }

  async send(userId: string, title: string, body: string): Promise<void> {
    return this.sendToMany([userId], title, body);
  }

  /**
   * One notification to many recipients: a single token lookup and a single
   * multicast, instead of a query + call per user. Every recipient gets the
   * same text, so there is nothing to gain from sending them separately.
   */
  async sendToMany(userIds: string[], title: string, body: string, data?: Record<string, string>): Promise<void> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    if (!this.configured && !this.apns.configured) {
      this.logger.debug(`(push disabled) → ${unique.length} user(s): ${title} — ${body}`);
      return;
    }
    const tokens = await this.prisma.pushToken.findMany({ where: { userId: { in: unique } } });
    if (tokens.length === 0) {
      this.logger.debug(`(push) no device tokens for ${unique.length} user(s)`);
      return;
    }

    // iPhones registered Apple's own token, which only APNs takes (owner, 06.11.2026).
    const iosTokens = tokens.filter((t) => t.platform === 'ios').map((t) => t.fcmToken);
    if (iosTokens.length > 0 && this.apns.configured) {
      const results = await this.apns.send(iosTokens, title, body, data);
      const gone = iosTokens.filter((_, i) => results[i] === 'gone');
      this.logger.log(`(push) iPhone: ${results.filter((r) => r === 'sent').length}/${iosTokens.length} device(s)`);
      if (gone.length > 0) await this.prisma.pushToken.deleteMany({ where: { fcmToken: { in: gone } } });
    }

    const fcmTokens = tokens.filter((t) => t.platform !== 'ios').map((t) => t.fcmToken);
    if (fcmTokens.length === 0 || !this.configured) return;
    try {
      // Firebase has no per-call deadline of its own, and every other
      // outbound call in the app has one; a hung multicast would hold the
      // outbox poll open behind it.
      const response = await withTimeout(
        getMessaging().sendEachForMulticast({
          tokens: fcmTokens,
          notification: { title, body },
          ...(data ? { data } : {}),
          // The app's own "orders_alert" channel (MAX importance, alarm-loud
          // sound, vibration; see usePushNotifications): without a channel
          // Android files the push under its fallback, which lists it but never
          // shows it on the screen.
          android: { priority: 'high', notification: { channelId: 'orders_alert', sound: 'default', defaultVibrateTimings: false, vibrateTimingsMillis: [0, 700, 300, 700, 300, 700], visibility: 'public' } },
        }),
        PUSH_TIMEOUT_MS,
      );
      this.logger.log(
        `(push) sent to ${response.successCount}/${fcmTokens.length} device(s) across ${unique.length} user(s)`,
      );

      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
          failedTokens.push(fcmTokens[idx]);
        }
      });
      if (failedTokens.length > 0) {
        await this.prisma.pushToken.deleteMany({ where: { fcmToken: { in: failedTokens } } });
        this.logger.log(`(push) cleaned ${failedTokens.length} stale token(s)`);
      }
    } catch (err) {
      this.logger.error(`(push) failed for ${unique.length} user(s)`, (err as Error).message);
    }
  }
}
