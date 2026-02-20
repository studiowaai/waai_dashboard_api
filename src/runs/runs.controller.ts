import { Controller, Get, Param, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';
import { RunsService } from './runs.service';

@Controller('runs')
@UseGuards(JwtAuthGuard)
export class RunsController {
  constructor(private runsService: RunsService) {}

  @Get('recent')
  async getRecent(@Query('limit', ParseIntPipe) limit = 10, @CurrentUser() user: AuthedUser) {
    const maxLimit = Math.min(Math.max(limit, 1), 100);
    return this.runsService.getRecent(user.orgId, maxLimit);
  }

  @Get(':run_id')
  async getRunDetails(
    @Param('run_id', ParseIntPipe) runId: number,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.runsService.getRunDetails(runId, user.orgId);
  }
}
