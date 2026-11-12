import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { DeviceStateService, type DeviceState } from './device-state.service';

const deviceStateSchema = z.object({
  gps_off: z.boolean().optional(),
  low_power: z.boolean().optional(),
});

@ApiTags('app-health')
@ApiBearerAuth()
@Controller('app-health')
export class DeviceStateController {
  constructor(private readonly devices: DeviceStateService) {}

  /** The phone's location services and battery saver, sent when either changes (owner, 10.11.2026). */
  @Post('device-state')
  @HttpCode(200)
  @Roles('driver')
  report(@CurrentUser('userId') userId: string, @Body(new ZodValidationPipe(deviceStateSchema)) body: DeviceState) {
    return this.devices.report(userId, body);
  }
}
