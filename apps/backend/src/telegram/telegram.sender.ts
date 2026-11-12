import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

export interface TelegramSendInput {
  text: string;
  photoUrl?: string | null;
  /** More photos after the first: sent together as one album, the text on the first. */
  morePhotoUrls?: string[];
  /** Send the files as documents, not photos: Telegram recompresses a photo,
   *  and a scanned passport has to stay legible. */
  asDocuments?: boolean;
}

/** Telegram caps an album at ten items. */
const ALBUM_MAX = 10;

export interface TelegramSendResult {
  delivered: boolean;
  skipped?: boolean;
}

/** Network timeout for Telegram API calls (ms). */
const TELEGRAM_TIMEOUT_MS = 15_000;

/**
 * Sends messages to the configured Telegram group via the Bot API.
 * Uses the global fetch (Node 20). When the bot token or chat id is missing,
 * the send is skipped (logged) rather than failing — graceful degradation.
 */
@Injectable()
export class TelegramSender {
  private readonly logger = new Logger(TelegramSender.name);
  private readonly token?: string;
  private readonly chatId?: string;
  /** Chat id for Vozrat (return) reports; falls back to nothing when unset. */
  readonly vozratChatId?: string;
  /** Chat id for pickup (loading) reports; falls back to nothing when unset. */
  readonly pickupChatId?: string;
  /** Chat id for fuel fill-ups (the dispenser photo). */
  readonly fuelChatId?: string;
  /** Chat id for service visits (work photos and the receipt). */
  readonly serviceChatId?: string;

  constructor(config: ConfigService<Env, true>) {
    this.token = config.get('TELEGRAM_BOT_TOKEN', { infer: true });
    this.chatId = config.get('TELEGRAM_GROUP_CHAT_ID', { infer: true });
    this.vozratChatId = config.get('TELEGRAM_VOZRAT_GROUP_ID', { infer: true });
    this.pickupChatId = config.get('TELEGRAM_PICKUP_GROUP_ID', { infer: true });
    this.fuelChatId = config.get('TELEGRAM_FUEL_GROUP_ID', { infer: true });
    this.serviceChatId = config.get('TELEGRAM_SERVICE_GROUP_ID', { infer: true });
  }

  /** Send to `chatId` (defaults to the main delivery group). Skips gracefully
   *  when the bot token or the target chat id is missing. */
  async send(input: TelegramSendInput, chatId: string | undefined = this.chatId): Promise<TelegramSendResult> {
    if (!this.token || !chatId) {
      this.logger.warn('Telegram not configured; skipping send');
      return { delivered: false, skipped: true };
    }
    const photos = [input.photoUrl, ...(input.morePhotoUrls ?? [])].filter((u): u is string => !!u).slice(0, ALBUM_MAX);
    const kind = input.asDocuments ? 'document' : 'photo';
    const single = input.asDocuments ? 'sendDocument' : 'sendPhoto';
    const method = photos.length > 1 ? 'sendMediaGroup' : photos.length === 1 ? single : 'sendMessage';
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    const payload =
      photos.length > 1
        ? { chat_id: chatId, media: photos.map((media, i) => ({ type: kind, media, ...(i === 0 ? { caption: input.text } : {}) })) }
        : photos.length === 1
          ? { chat_id: chatId, [kind]: photos[0], caption: input.text }
          : { chat_id: chatId, text: input.text };

    // Bound the request so a blocked/unreachable Telegram host fails fast
    // (and is retried) rather than hanging the dispatcher.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = controller.signal.aborted ? 'timed out' : (err as Error).message;
      throw new Error(`Telegram request failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Telegram API error ${res.status}: ${detail.slice(0, 200)}`);
    }
    return { delivered: true };
  }
}
