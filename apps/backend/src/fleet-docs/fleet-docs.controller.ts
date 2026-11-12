import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  FLEET_DOC_KINDS,
  VEHICLE_DOC_TYPES,
  uploadPhotoSchema,
  type FleetDocKind,
  type UploadPhotoInput,
  type VehicleDocType,
} from '@bigant/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { FleetDocsService } from './fleet-docs.service';

const kindSchema = z.enum(FLEET_DOC_KINDS);
const docTypeSchema = z.enum(VEHICLE_DOC_TYPES);

@ApiTags('fleet-docs')
@ApiBearerAuth()
@Controller('fleet-docs')
export class FleetDocsController {
  constructor(private readonly docs: FleetDocsService) {}

  @Roles('admin')
  @Get()
  list() {
    return this.docs.list();
  }

  @Roles('admin')
  @Get('documents/:type')
  documentsOf(@Param('type', new ZodValidationPipe(docTypeSchema)) type: VehicleDocType) {
    return this.docs.documentsOf(type);
  }

  @Roles('admin')
  @Post('documents/:docId/photo')
  setDocumentPhoto(
    @Param('docId') docId: string,
    @Body(new ZodValidationPipe(uploadPhotoSchema)) body: UploadPhotoInput,
  ) {
    return this.docs.setDocumentPhoto(docId, body.base64);
  }

  @Roles('admin')
  @Delete('documents/:docId/photo')
  clearDocumentPhoto(@Param('docId') docId: string) {
    return this.docs.clearDocumentPhoto(docId);
  }

  @Roles('admin')
  @Post('vehicles/:id/:kind')
  setVehiclePhoto(
    @Param('id') id: string,
    @Param('kind', new ZodValidationPipe(kindSchema)) kind: FleetDocKind,
    @Body(new ZodValidationPipe(uploadPhotoSchema)) body: UploadPhotoInput,
  ) {
    return this.docs.setVehiclePhoto(id, kind, body.base64);
  }

  @Roles('admin')
  @Delete('vehicles/:id/:kind')
  clearVehiclePhoto(
    @Param('id') id: string,
    @Param('kind', new ZodValidationPipe(kindSchema)) kind: FleetDocKind,
  ) {
    return this.docs.clearVehiclePhoto(id, kind);
  }

  @Roles('admin')
  @Post('drivers/:id/:kind')
  setDriverPhoto(
    @Param('id') id: string,
    @Param('kind', new ZodValidationPipe(kindSchema)) kind: FleetDocKind,
    @Body(new ZodValidationPipe(uploadPhotoSchema)) body: UploadPhotoInput,
  ) {
    return this.docs.setDriverPhoto(id, kind, body.base64);
  }

  @Roles('admin')
  @Delete('drivers/:id/:kind')
  clearDriverPhoto(
    @Param('id') id: string,
    @Param('kind', new ZodValidationPipe(kindSchema)) kind: FleetDocKind,
  ) {
    return this.docs.clearDriverPhoto(id, kind);
  }

  /** The seller has the bot put a driver's papers into his own chat. */
  @Roles('seller')
  @Post('drivers/:id/send-to-me')
  sendToMe(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.docs.sendToSeller(id, userId);
  }
}
