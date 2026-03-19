import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';
import { InboxService } from './inbox.service';
import {
  ListConversationsDto,
  AssignConversationDto,
  UpdateConversationStatusDto,
  UpdateConversationPriorityDto,
  SendMessageDto,
} from './inbox.dto';

@Controller('inbox')
@UseGuards(JwtAuthGuard)
export class InboxController {
  constructor(private readonly inboxService: InboxService) {}

  // ── Conversations ────────────────────────────────────────

  @Get('conversations')
  async listConversations(@CurrentUser() user: AuthedUser, @Query() filters: ListConversationsDto) {
    return this.inboxService.listConversations(user.orgId, filters);
  }

  @Get('conversations/:id')
  async getConversation(@CurrentUser() user: AuthedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inboxService.getConversation(id, user.orgId);
  }

  @Get('conversations/:id/messages')
  async getMessages(
    @CurrentUser() user: AuthedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.inboxService.getConversationMessages(id, user.orgId, limit || 100, offset || 0);
  }

  @Post('conversations/:id/messages')
  async sendMessage(
    @CurrentUser() user: AuthedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SendMessageDto,
  ) {
    return this.inboxService.sendMessage(
      id,
      user.orgId,
      user.userId,
      body.content_text,
      body.content_html,
    );
  }

  @Put('conversations/:id/assign')
  async assignConversation(
    @CurrentUser() user: AuthedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignConversationDto,
  ) {
    return this.inboxService.assignConversation(id, user.orgId, body.user_id, user.userId);
  }

  @Put('conversations/:id/status')
  async updateStatus(
    @CurrentUser() user: AuthedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateConversationStatusDto,
  ) {
    return this.inboxService.updateStatus(id, user.orgId, body.status, user.userId);
  }

  @Put('conversations/:id/priority')
  async updatePriority(
    @CurrentUser() user: AuthedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateConversationPriorityDto,
  ) {
    return this.inboxService.updatePriority(id, user.orgId, body.priority, user.userId);
  }

  // ── AI Suggestions ───────────────────────────────────────

  @Get('conversations/:id/suggestions')
  async getAiSuggestions(@CurrentUser() user: AuthedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inboxService.getAiSuggestions(id, user.orgId);
  }

  @Post('suggestions/:id/accept')
  async acceptSuggestion(@CurrentUser() user: AuthedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inboxService.acceptAiSuggestion(id, user.orgId, user.userId);
  }

  // ── Events ───────────────────────────────────────────────

  @Get('conversations/:id/events')
  async getEvents(@CurrentUser() user: AuthedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inboxService.getConversationEvents(id, user.orgId);
  }
}
