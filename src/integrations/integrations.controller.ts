import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';
import { IntegrationsService } from './integrations.service';
import { ConnectAccountDto } from './integrations.dto';

@Controller('integrations')
@UseGuards(JwtAuthGuard)
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  // ── Providers ────────────────────────────────────────────

  @Get('providers')
  async listProviders() {
    return this.integrationsService.listProviders();
  }

  @Get('providers/:id')
  async getProvider(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.integrationsService.getProviderWithConfig(id, user.orgId);
  }

  // ── Workspace Provider Config ────────────────────────────

  @Get('providers/:id/config')
  async getProviderConfig(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.integrationsService.getProviderConfig(user.orgId, id);
  }

  @Put('providers/:id/config')
  async saveProviderConfig(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.integrationsService.saveProviderConfig(user.orgId, id, body, user.userId);
  }

  @Delete('providers/:id/config')
  async deleteProviderConfig(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.integrationsService.deleteProviderConfig(user.orgId, id);
  }

  // ── Connected Accounts ───────────────────────────────────

  @Get('accounts')
  async listAccounts(@CurrentUser() user: AuthedUser) {
    return this.integrationsService.listConnectedAccounts(user.orgId);
  }

  @Get('accounts/:id')
  async getAccount(@CurrentUser() user: AuthedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.integrationsService.getConnectedAccount(id, user.orgId);
  }

  @Post('connect')
  async initiateConnect(@CurrentUser() user: AuthedUser, @Body() body: ConnectAccountDto) {
    return this.integrationsService.initiateOAuth(
      user.orgId,
      body.provider_id,
      user.userId,
      body.redirect_uri,
    );
  }

  @Post('callback')
  async handleCallback(@Query('state') state: string, @Query('code') code: string) {
    return this.integrationsService.handleOAuthCallback(state, code);
  }

  @Delete('accounts/:id')
  async disconnectAccount(@CurrentUser() user: AuthedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.integrationsService.disconnectAccount(id);
  }

  // ── Sync Jobs ────────────────────────────────────────────

  @Get('accounts/:id/sync-jobs')
  async listSyncJobs(
    @CurrentUser() user: AuthedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: number,
  ) {
    return this.integrationsService.listSyncJobs(id, user.orgId, limit || 20);
  }

  // ── Channels ─────────────────────────────────────────────

  @Get('channels')
  async listChannels(@CurrentUser() user: AuthedUser) {
    return this.integrationsService.listChannels(user.orgId);
  }
}
