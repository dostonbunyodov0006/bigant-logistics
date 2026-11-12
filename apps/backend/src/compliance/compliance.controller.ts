import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { ComplianceService } from './compliance.service';

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  /** Expired / expiring-soon vehicle + driver documents for the dashboard panel. */
  @Roles('admin') // manager passes via the RolesGuard admin alias
  @Get('expiring')
  listExpiring() {
    return this.compliance.listExpiring();
  }
}
