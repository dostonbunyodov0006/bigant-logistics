import { Module } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { ClientAddressesService } from './client-addresses.service';
import { ClientsController } from './clients.controller';

@Module({
  providers: [ClientsService, ClientAddressesService],
  controllers: [ClientsController],
  exports: [ClientsService, ClientAddressesService],
})
export class ClientsModule {}
