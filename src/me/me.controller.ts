import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';
import { MeService } from './me.service';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private meService: MeService) {}

  @Get()
  async getMe(@CurrentUser() user: AuthedUser) {
    return this.meService.getMe(user.userId, user.orgId, user.role);
  }
}
