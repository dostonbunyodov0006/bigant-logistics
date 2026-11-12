import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  updateWorkSettingsSchema,
  saveVehicleTariffsSchema,
  type UpdateWorkSettingsInput,
  type SaveVehicleTariffsInput,
} from '@bigant/shared';
import { SettingsService } from './settings.service';
import { VehicleTariffsService } from './vehicle-tariffs.service';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { Env } from '../config/env.validation';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly tariffs: VehicleTariffsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Which map the office and the sellers see: Google when its key is set
   *  (owner, 30.10.2026), otherwise our own tiles. The key is a browser key,
   *  public by nature; Google only accepts it from our domain. */
  @Roles('admin', 'manager', 'seller')
  @Get('map')
  getMap() {
    return {
      google_maps_key: this.config.get('GOOGLE_MAPS_BROWSER_KEY', { infer: true }) ?? null,
      esri_key: this.config.get('ESRI_API_KEY', { infer: true }) ?? null,
    };
  }

  // Drivers read this to know their expected shift start/end (late / early prompts);
  // sellers to show the shift start on the board's "… dan oldin / keyin".
  @Roles('admin', 'manager', 'driver', 'seller')
  @Get('work')
  getWork() {
    return this.settings.getWorkSettings();
  }

  @Roles('admin')
  @Patch('work')
  updateWork(
    @Body(new ZodValidationPipe(updateWorkSettingsSchema)) body: UpdateWorkSettingsInput,
  ) {
    return this.settings.updateWorkSettings(body);
  }

  // Driver-pay tariffs per vehicle class (Mashina tariflar). Admin/manager config.
  @Roles('admin', 'manager')
  @Get('vehicle-tariffs')
  getVehicleTariffs() {
    return this.tariffs.getAll();
  }

  @Roles('admin', 'manager')
  @Put('vehicle-tariffs')
  saveVehicleTariffs(
    @Body(new ZodValidationPipe(saveVehicleTariffsSchema)) body: SaveVehicleTariffsInput,
  ) {
    return this.tariffs.saveAll(body);
  }
}
