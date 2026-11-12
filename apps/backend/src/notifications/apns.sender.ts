import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import * as fs from 'node:fs';
import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

/** A token Apple will never accept again: drop it. */
export type ApnsResult = 'sent' | 'gone' | 'failed';

const TIMEOUT_MS = 20_000;
/** Apple refuses a provider token older than an hour; it is renewed well before. */
const TOKEN_TTL_MS = 50 * 60_000;

/**
 * iPhone push (owner, 06.11.2026): the driver app on an iPhone registers the
 * token Apple gives it, which Firebase cannot send to. This sends to Apple's
 * own service (APNs, HTTP/2, a .p8 key from the Apple Developer account).
 * Without the key it is off and says so; Android push is untouched.
 */
@Injectable()
export class ApnsSender implements OnModuleDestroy {
  private readonly logger = new Logger(ApnsSender.name);
  private readonly key: KeyObject | null = null;
  private readonly keyId?: string;
  private readonly teamId?: string;
  private readonly topic: string;
  private readonly host: string;
  private jwt: { value: string; at: number } | null = null;
  private session: ClientHttp2Session | null = null;

  constructor(config: ConfigService<Env, true>) {
    this.keyId = config.get('APNS_KEY_ID', { infer: true });
    this.teamId = config.get('APNS_TEAM_ID', { infer: true });
    this.topic = config.get('APNS_BUNDLE_ID', { infer: true });
    this.host = config.get('APNS_PRODUCTION', { infer: true }) ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
    const raw = config.get('APNS_KEY', { infer: true });
    if (raw && this.keyId && this.teamId) {
      try {
        const pem = raw.includes('BEGIN PRIVATE KEY') ? raw.replace(/\\n/g, '\n') : fs.readFileSync(raw, 'utf8');
        this.key = createPrivateKey(pem);
        this.logger.log(`APNs ready (${this.host.includes('sandbox') ? 'sandbox' : 'production'}, ${this.topic})`);
      } catch (err) {
        this.logger.error(`APNs key unreadable: ${(err as Error).message}`);
      }
    } else {
      this.logger.warn('APNS_KEY / APNS_KEY_ID / APNS_TEAM_ID not set — iPhone push disabled');
    }
  }

  get configured(): boolean {
    return this.key !== null;
  }

  onModuleDestroy(): void {
    this.session?.close();
  }

  /** Each token on its own request over one connection; returns what became of each. */
  async send(tokens: string[], title: string, body: string, data?: Record<string, string>): Promise<ApnsResult[]> {
    if (!this.key || tokens.length === 0) return tokens.map(() => 'failed' as const);
    // Time-sensitive: an order push gets through Focus / Do Not Disturb, as the
    // Android "orders_alert" channel does (10.11.2026). Needs the entitlement
    // in the iOS build (app.json); without it iOS treats it as an ordinary alert.
    const payload = JSON.stringify({
      aps: { alert: { title, body }, sound: 'default', 'interruption-level': 'time-sensitive' },
      ...(data ?? {}),
    });
    return Promise.all(tokens.map((t) => this.one(t, payload)));
  }

  private one(token: string, payload: string): Promise<ApnsResult> {
    return new Promise((resolve) => {
      let session: ClientHttp2Session;
      try {
        session = this.connection();
      } catch (err) {
        this.logger.warn(`APNs connect failed: ${(err as Error).message}`);
        return resolve('failed');
      }
      const req = session.request({
        [constants.HTTP2_HEADER_METHOD]: 'POST',
        [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
        authorization: `bearer ${this.providerToken()}`,
        'apns-topic': this.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
      let status = 0;
      let answer = '';
      const timer = setTimeout(() => req.close(constants.NGHTTP2_CANCEL), TIMEOUT_MS);
      req.setEncoding('utf8');
      req.on('response', (h) => (status = Number(h[constants.HTTP2_HEADER_STATUS])));
      req.on('data', (c: string) => (answer += c));
      req.on('error', (err) => {
        clearTimeout(timer);
        this.logger.warn(`APNs request failed: ${err.message}`);
        resolve('failed');
      });
      req.on('close', () => {
        clearTimeout(timer);
        if (status === 200) return resolve('sent');
        const reason = (() => {
          try {
            return (JSON.parse(answer) as { reason?: string }).reason ?? '';
          } catch {
            return '';
          }
        })();
        // 410: the app was removed; BadDeviceToken: not a token for this app/environment.
        if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') return resolve('gone');
        if (status) this.logger.warn(`APNs ${status} ${reason}`);
        resolve('failed');
      });
      req.end(payload);
    });
  }

  private connection(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) return this.session;
    const s = connect(this.host);
    s.on('error', (err) => this.logger.warn(`APNs connection: ${err.message}`));
    s.on('close', () => {
      if (this.session === s) this.session = null;
    });
    s.unref();
    this.session = s;
    return s;
  }

  /** The provider token: an ES256 JWT signed with the .p8 key, reused for 50 minutes. */
  private providerToken(now = Date.now()): string {
    if (this.jwt && now - this.jwt.at < TOKEN_TTL_MS) return this.jwt.value;
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'ES256', kid: this.keyId })}.${b64({ iss: this.teamId, iat: Math.floor(now / 1000) })}`;
    const sig = sign('sha256', Buffer.from(unsigned), { key: this.key!, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    this.jwt = { value: `${unsigned}.${sig}`, at: now };
    return this.jwt.value;
  }
}
