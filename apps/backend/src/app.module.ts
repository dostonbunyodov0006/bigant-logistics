import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ClientsModule } from './clients/clients.module';
import { PickupPlacesModule } from './pickup-places/pickup-places.module';
import { GeoModule } from './geo/geo.module';
import { RoutingModule } from './routing/routing.module';
import { EtaModule } from './eta/eta.module';
import { BonusModule } from './bonus/bonus.module';
import { FinesModule } from './fines/fines.module';
import { PayrollModule } from './payroll/payroll.module';
import { LeaveModule } from './leave/leave.module';
import { ExpensesModule } from './expenses/expenses.module';
import { SellerBoardModule } from './seller-board/seller-board.module';
import { FuelModule } from './fuel/fuel.module';
import { ServiceModule } from './service/service.module';
import { CargoTypesModule } from './cargo-types/cargo-types.module';
import { DriversModule } from './drivers/drivers.module';
import { OrdersModule } from './orders/orders.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { ComplianceModule } from './compliance/compliance.module';
import { SettingsModule } from './settings/settings.module';
import { AttendanceModule } from './attendance/attendance.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TelegramModule } from './telegram/telegram.module';
import { OutboxModule } from './outbox/outbox.module';
import { RealtimeModule } from './realtime/realtime.module';
import { HealthModule } from './health/health.module';
import { AppHealthModule } from './app-health/app-health.module';
import { AppUpdatesModule } from './app-updates/app-updates.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { UploadModule } from './upload/upload.module';
import { FleetDocsModule } from './fleet-docs/fleet-docs.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { WorkerLeaseModule } from './common/worker-lease';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    WorkerLeaseModule,
    // Per-IP request budget. The default is wide enough never to touch normal
    // use (an office behind one NAT, drivers' location pings); login and
    // refresh set their own, tight one — see AuthController.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1_000 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    ClientsModule,
    PickupPlacesModule,
    GeoModule,
    RoutingModule,
    EtaModule,
    BonusModule,
    FinesModule,
    PayrollModule,
    LeaveModule,
    ExpensesModule,
    SellerBoardModule,
    FuelModule,
    ServiceModule,
    CargoTypesModule,
    DriversModule,
    OrdersModule,
    VehiclesModule,
    SchedulingModule,
    ComplianceModule,
    SettingsModule,
    AttendanceModule,
    NotificationsModule,
    TelegramModule,
    FleetDocsModule,
    OutboxModule,
    RealtimeModule,
    UploadModule,
    HealthModule,
    AppHealthModule,
    AppUpdatesModule,
    AnalyticsModule,
  ],
  providers: [
    // Order matters: authenticate first, then role, then fine-grained permission.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
