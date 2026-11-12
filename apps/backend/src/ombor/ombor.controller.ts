import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OmborService } from './ombor.service';

/**
 * Omborchi (owner, 05.11.2026). The warehouse page signs in with Telegram
 * (the mini app's bot), not with a dashboard login: these routes are public
 * to the dashboard guard and check their own pass in `x-ombor-token`.
 */
@ApiTags('ombor')
@Controller('ombor')
export class OmborController {
  constructor(private readonly ombor: OmborService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('session')
  @HttpCode(200)
  session(@Body() body: { initData?: unknown }) {
    return this.ombor.session(typeof body?.initData === 'string' ? body.initData : '');
  }

  @Public()
  @Get('returns')
  async list(@Headers('x-ombor-token') token?: string) {
    return { royxat: await this.ombor.list(await this.ombor.auth(token)) };
  }

  @Public()
  @Post('photo')
  async photo(@Headers('x-ombor-token') token: string | undefined, @Body() body: { base64?: unknown }) {
    return this.ombor.photo(await this.ombor.auth(token), body?.base64 as string);
  }

  @Public()
  @Post('returns/:number/accept')
  @HttpCode(200)
  async accept(
    @Headers('x-ombor-token') token: string | undefined,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: { malumot?: unknown; rasmlar?: Record<string, unknown>; umumiy?: unknown },
    @Query('joy') joy?: string,
  ) {
    return this.ombor.accept(await this.ombor.auth(token), number, body ?? {}, joy || undefined);
  }

  /** The office marks a waiting return as taken in, from the Vozvrat page (owner, 07.11.2026). */
  @Roles('admin', 'manager')
  @Post('returns/:id/release')
  @HttpCode(200)
  release(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.ombor.release(id, userId);
  }

  @Public()
  @Get('products')
  async products(@Headers('x-ombor-token') token: string | undefined, @Query('q') q?: string) {
    return { royxat: await this.ombor.searchProducts(await this.ombor.auth(token), q ?? '') };
  }

  // ---- the admin keeps the list of storekeepers (Xodimlar page) ----

  @Roles('admin', 'manager')
  @Get('staff')
  staff() {
    return this.ombor.staffList();
  }

  @Roles('admin', 'manager')
  @Post('staff')
  saveStaff(@Body() body: { telegram_id?: unknown; name?: unknown; roles?: unknown }) {
    return this.ombor.staffSave(body ?? {});
  }

  /** The list's checkboxes: the exact set of roles (owner, 09.11.2026). */
  @Roles('admin', 'manager')
  @Patch('staff/:id')
  setStaffRoles(@Param('id') id: string, @Body() body: { roles?: unknown }) {
    return this.ombor.staffSetRoles(id, body?.roles);
  }

  @Roles('admin', 'manager')
  @Delete('staff/:id')
  removeStaff(@Param('id') id: string) {
    return this.ombor.staffRemove(id);
  }
}
