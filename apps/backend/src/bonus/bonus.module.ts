import { Module } from '@nestjs/common';
import { BonusService } from './bonus.service';
import { BonusController } from './bonus.controller';

@Module({
  providers: [BonusService],
  controllers: [BonusController],
  exports: [BonusService],
})
export class BonusModule {}
