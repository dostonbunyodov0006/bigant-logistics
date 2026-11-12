import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SchedulingService } from './scheduling.service';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('scheduling')
@ApiBearerAuth()
@Controller('scheduling')
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  // FR-005: driver availability with current/upcoming assignments.
  @Roles('admin', 'seller')
  @Get('availability')
  availability() {
    return this.scheduling.availability();
  }
}
