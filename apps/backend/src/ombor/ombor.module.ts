import { Module } from '@nestjs/common';
import { UploadModule } from '../upload/upload.module';
import { OmborBot } from './ombor-bot';
import { OmborController } from './ombor.controller';
import { OmborReminderDispatcher } from './ombor-reminder.dispatcher';
import { OmborService } from './ombor.service';

/** Omborchi: the warehouse page, moved here from the mini app (owner, 05.11.2026). */
@Module({
  imports: [UploadModule],
  controllers: [OmborController],
  providers: [OmborService, OmborBot, OmborReminderDispatcher],
  exports: [OmborService],
})
export class OmborModule {}
