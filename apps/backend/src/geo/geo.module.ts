import { Module } from '@nestjs/common';
import { GeoService } from './geo.service';
import { GeoController } from './geo.controller';
import { PhotonService } from './photon.service';
import { MapLinkService } from './map-link.service';
import { RoutingModule } from '../routing/routing.module';
import { SpeedStatsService } from './speed-stats.service';

@Module({
  imports: [RoutingModule],
  providers: [GeoService, PhotonService, MapLinkService, SpeedStatsService],
  controllers: [GeoController],
  exports: [GeoService, PhotonService, SpeedStatsService],
})
export class GeoModule {}
