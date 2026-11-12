import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  boardQuerySchema,
  companyJobSchema,
  companyJobOptionSchema,
  type CompanyJobInput,
  type CompanyJobOptionInput,
  fillOrderSchema,
  poputiReserveSchema,
  poputiSearchSchema,
  reserveSchema,
  startTimeSchema,
  type StartTimeInput,
  type BoardQueryInput,
  type FillOrderInput,
  type PoputiReserveInput,
  type PoputiSearchInput,
  type ReserveInput,
} from '@bigant/shared';
import { SellerBoardService } from './seller-board.service';
import { FleetDocsService } from '../fleet-docs/fleet-docs.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('seller-board')
@ApiBearerAuth()
// The admin (and the dispatcher, who counts as one) works the same board from
// the console's Statuslar page — sees everyone's orders and books himself
// (owner, 05.11.2026).
@Roles('seller', 'admin')
@Controller('seller')
export class SellerBoardController {
  constructor(
    private readonly board: SellerBoardService,
    private readonly docs: FleetDocsService,
  ) {}

  @Get('board')
  getBoard(
    @Query(new ZodValidationPipe(boardQuerySchema)) q: BoardQueryInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.board.board(q.view, actor);
  }

  /** The fleet's papers, the same rows the office's Hujjatlar page reads. */
  @Get('tech-passports')
  techPassports() {
    return this.docs.list();
  }

  @Get('cargo-types')
  cargoTypes() {
    return this.board.listCargoTypes();
  }

  @Get('vehicles/:id/queue')
  queue(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.board.vehicleQueue(id, actor);
  }

  @Post('vehicles/:id/reserve')
  reserve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reserveSchema)) body: ReserveInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.board.reserve(id, body, actor);
  }

  // "Ishxona ishi bilan" — the office only (owner, 12.11.2026).
  @Roles('admin')
  @Post('vehicles/:id/company-job')
  companyJob(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(companyJobSchema)) body: CompanyJobInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.board.startCompanyJob(id, body, actor);
  }

  // The "Nima ish bilan?" list (owner, 12.11.2026).
  @Roles('admin')
  @Get('company-job-options')
  companyJobOptions() {
    return this.board.companyJobOptions();
  }

  @Roles('admin')
  @Post('company-job-options')
  addCompanyJobOption(@Body(new ZodValidationPipe(companyJobOptionSchema)) body: CompanyJobOptionInput) {
    return this.board.addCompanyJobOption(body.name);
  }

  @Roles('admin')
  @Delete('company-job-options/:optionId')
  removeCompanyJobOption(@Param('optionId') optionId: string) {
    return this.board.removeCompanyJobOption(optionId);
  }

  @Roles('admin')
  @Delete('company-jobs/:jobId')
  endCompanyJob(@Param('jobId') jobId: string) {
    return this.board.endCompanyJob(jobId);
  }

  @Post('poputi/search')
  searchPoputi(
    @Body(new ZodValidationPipe(poputiSearchSchema)) body: PoputiSearchInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.board.searchPoputi(body, actor);
  }

  @Post('vehicles/:id/poputi')
  poputi(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(poputiReserveSchema)) body: PoputiReserveInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.board.reservePoputi(id, actor, body.host_order_id ?? null);
  }

  @Patch('reservations/:id/fill')
  fill(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(fillOrderSchema)) body: FillOrderInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.board.fill(id, body, actor);
  }

  @Get('bookings/:groupId')
  booking(@Param('groupId') groupId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.board.getBooking(groupId, actor);
  }

  @Post('bookings/:groupId/next')
  addNext(@Param('groupId') groupId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.board.addNext(groupId, actor);
  }

  /** Ertangi order moved between before and after 09:00. */
  @Patch('orders/:id/start-time')
  setStartTime(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(startTimeSchema)) body: StartTimeInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.board.setStartTime(id, body.start_after_nine, actor);
  }

  @Delete('reservations/:id')
  cancel(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.board.cancel(id, actor);
  }
}
