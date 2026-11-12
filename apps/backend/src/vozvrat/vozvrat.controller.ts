import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { VozvratProduct } from '@bigant/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { VozvratProductsService } from './vozvrat-products.service';

/** What the driver's vozvrat form needs: the product search. */
@ApiTags('vozvrat')
@ApiBearerAuth()
@Controller('vozvrat')
export class VozvratController {
  constructor(private readonly catalogue: VozvratProductsService) {}

  /** Products by name, from the mini app's catalogue (a sample list until it is configured). */
  @Roles('driver', 'admin', 'manager')
  @Get('products')
  products(@Query('q') q?: string): Promise<VozvratProduct[]> {
    return this.catalogue.search(q ?? '');
  }
}
