import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeService } from './realtime.service';
import { RealtimeController } from './realtime.controller';
import { SseQueryTokenGuard } from './sse-query-token.guard';

/** Global so RealtimeService injects into orders/drivers/scheduling/seller-board
 *  without import churn. JwtModule is imported locally for the SSE query-token guard. */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [RealtimeController],
  providers: [RealtimeService, SseQueryTokenGuard],
  exports: [RealtimeService],
})
export class RealtimeModule {}
