import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { uploadPhotoSchema, type UploadPhotoInput } from '@bigant/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { UploadService } from './upload.service';

@ApiTags('upload')
@ApiBearerAuth()
@Controller('upload')
export class UploadController {
  constructor(private readonly upload: UploadService) {}

  /** A proof photo from the driver's phone. Validated and capped like every
   *  other photo field; the body limit alone let one request fill the disk. */
  @Roles('driver')
  @Post('photo')
  async uploadPhoto(
    @Body(new ZodValidationPipe(uploadPhotoSchema)) body: UploadPhotoInput,
  ): Promise<{ url: string }> {
    const url = await this.upload.uploadBase64(body.base64);
    return { url };
  }
}
