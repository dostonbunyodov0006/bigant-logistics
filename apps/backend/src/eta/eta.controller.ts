import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EtaService } from './eta.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class EtaController {
  constructor(private readonly eta: EtaService) {}

  /** Live ETA for one order. Access follows the order itself: a seller sees
   *  their own orders, a driver the ones assigned to them, staff everything. */
  @Roles('admin', 'manager', 'seller', 'driver')
  @Get(':id/eta')
  forOrder(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.eta.forOrder(id, actor);
  }
}

@ApiTags('drivers')
@ApiBearerAuth()
@Controller('drivers')
export class DriverTripController {
  constructor(private readonly eta: EtaService) {}

  /** A lorry pressed on the office map: where it is, and the road to its next stop. */
  @Roles('admin', 'manager', 'seller')
  @Get(':id/map-trip')
  trip(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.eta.driverTrip(id, actor);
  }
}
