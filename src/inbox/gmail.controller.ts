import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';
import { GmailService } from '../auth/gmail.service';

@Controller('gmail')
@UseGuards(JwtAuthGuard)
export class GmailController {
  constructor(private readonly gmailService: GmailService) {}

  @Get('inbox')
  async getInbox(
    @CurrentUser() user: AuthedUser,
    @Query('limit') limit?: string,
    @Query('pageToken') pageToken?: string,
    @Query('q') query?: string,
  ) {
    return this.gmailService.getInbox(
      user.userId,
      limit ? parseInt(limit, 10) : 20,
      pageToken,
      query,
    );
  }

  @Get('messages/:id')
  async getMessage(@CurrentUser() user: AuthedUser, @Param('id') messageId: string) {
    return this.gmailService.getMessage(user.userId, messageId);
  }

  @Get('profile')
  async getProfile(@CurrentUser() user: AuthedUser) {
    return this.gmailService.getProfile(user.userId);
  }
}
