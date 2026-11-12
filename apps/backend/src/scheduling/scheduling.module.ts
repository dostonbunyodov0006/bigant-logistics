import { Module } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { AssignmentTimeoutDispatcher } from './assignment-timeout.dispatcher';
import { AssignmentsController } from './assignments.controller';
import { SchedulingController } from './scheduling.controller';

@Module({
  providers: [SchedulingService, AssignmentTimeoutDispatcher],
  controllers: [AssignmentsController, SchedulingController],
  exports: [SchedulingService],
})
export class SchedulingModule {}
