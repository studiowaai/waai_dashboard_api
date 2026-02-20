import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';
import { StatsService } from './stats.service';

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private statsService: StatsService) {}

  @Get('overview')
  async getOverview(@Query('range') range = '7d', @CurrentUser() user: AuthedUser) {
    return this.statsService.getOverview(user.orgId, range);
  }

  @Get('trends')
  async getTrends(@Query('range') range = '7d', @CurrentUser() user: AuthedUser) {
    return this.statsService.getTrends(user.orgId, range);
  }
}
