import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

const TIMEOUT_MS = 15_000;

/**
 * The mini app's bot (@bigant_innovation_bot), which the storekeepers already
 * use: it tells them about returns and opens the warehouse page inside
 * Telegram. A message that does not go out never stops the work.
 */
@Injectable()
export class OmborBot {
  private readonly logger = new Logger(OmborBot.name);
  readonly token?: string;
  private readonly pageUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.token = config.get('VOZVRAT_BOT_TOKEN', { infer: true });
    this.pageUrl = `https://${config.get('PUBLIC_DOMAIN', { infer: true })}/ombor`;
  }

  /** HTML message to each chat, with a button that opens the warehouse page. Returns how many went out. */
  async send(chatIds: string[], html: string): Promise<number> {
    if (!this.token) return 0;
    let n = 0;
    for (const id of [...new Set(chatIds)]) {
      try {
        const r = await this.call('sendMessage', {
          chat_id: id,
          text: html,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [[{ text: 'Очиш', web_app: { url: this.pageUrl } }]] },
        });
        if (r.ok) n++;
        else this.logger.warn(`ombor message to ${id}: ${r.description}`);
      } catch (err) {
        this.logger.warn(`ombor message to ${id}: ${(err as Error).message}`);
      }
    }
    return n;
  }

  private async call(method: string, payload: unknown): Promise<{ ok: boolean; description?: string }> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return (await res.json()) as { ok: boolean; description?: string };
  }
}

export const esc = (x: unknown) =>
  String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
