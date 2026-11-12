import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TelegramModule } from '../telegram/telegram.module';
import { AppSeenInterceptor, AppSeenTracker } from './app-seen.tracker';
import { AppSilenceService } from './app-silence.service';
import { AppSilenceDispatcher } from './app-silence.dispatcher';
import { DeviceStateController } from './device-state.controller';
import { DeviceStateService } from './device-state.service';

/**
 * Is the driver app alive (owner, 09.11.2026): every signed-in driver request
 * stamps drivers.last_app_seen_at, and the office's Telegram hears when the app
 * goes quiet for 15 minutes during a shift — and when it is back.
 */
@Module({
  imports: [TelegramModule],
  controllers: [DeviceStateController],
  providers: [
    AppSeenTracker,
    { provide: APP_INTERCEPTOR, useClass: AppSeenInterceptor },
    AppSilenceService,
    AppSilenceDispatcher,
    DeviceStateService,
  ],
})
export class AppHealthModule {}
