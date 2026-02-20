import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';
import { AdminService } from './admin.service';
import {
  OrganizationCreateDto,
  OrganizationUpdateDto,
  UserCreateDto,
  UserUpdateDto,
  UserPermissionsUpdateDto,
  IngestTokenCreateDto,
  IngestTokenUpdateDto,
} from './admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private adminService: AdminService) {}

  // ==================== ORGANIZATIONS ====================

  @Get('organizations')
  async listOrganizations(@CurrentUser() user: AuthedUser) {
    this.adminService.requireAdmin(user.role);
    return this.adminService.listOrganizations();
  }

  @Post('organizations')
  async createOrganization(@Body() dto: OrganizationCreateDto, @CurrentUser() user: AuthedUser) {
    this.adminService.requireAdmin(user.role);
    return this.adminService.createOrganization(dto.name);
  }

  @Put('organizations/:org_id')
  async updateOrganization(
    @Param('org_id') orgId: string,
    @Body() dto: OrganizationUpdateDto,
    @CurrentUser() user: AuthedUser,
  ) {
    this.adminService.requireAdmin(user.role);
    return this.adminService.updateOrganization(
      orgId,
      dto.name,
      dto.n8n_transcribe_webhook_url,
      dto.n8n_prompt_webhook_url,
      dto.n8n_approval_webhook_url,
    );
  }

  @Delete('organizations/:org_id')
  async deleteOrganization(@Param('org_id') orgId: string, @CurrentUser() user: AuthedUser) {
    this.adminService.requireAdmin(user.role);
    return this.adminService.deleteOrganization(orgId);
  }

  // ==================== USERS ====================

  @Get('users')
  async listUsers(@Query('org_id') orgId: string | undefined, @CurrentUser() user: AuthedUser) {
    this.adminService.requireAdmin(user.role);
    return this.adminService.listUsers(orgId);
  }

  @Post('users')
  async createUser(@Body() dto: UserCreateDto, @CurrentUser() user: AuthedUser) {
    this.adminService.requireAdmin(user.role);
    return this.adminService.createUser(dto.email, dto.password, dto.role, dto.org_id);
  }

  @Put('users/:user_id/permissions')
  async updateUserPermissions(
    @Param('user_id') userId: string,
    @Body() dto: UserPermissionsUpdateDto,
    @CurrentUser() user: AuthedUser,
  ) {
    this.adminService.requireAdmin(user.role);
    return this.adminService.updateUserPermissions(userId, dto.page_permissions ?? null);
  }

  @Put('users/:user_id')
  async updateUser(
    @Param('user_id') userId: string,
    @Body() dto: UserUpdateDto,
    @CurrentUser() user: AuthedUser,
  ) {
    this.adminService.requireAdmin(user.role);
    return this.adminService.updateUser(userId, dto.email, dto.password, dto.role);
  }

  @Delete('users/:user_id')
  async deleteUser(@Param('user_id') userId: string, @CurrentUser() user: AuthedUser) {
    this.adminService.requireAdmin(user.role);
    return this.adminService.deleteUser(userId);
  }

  // ==================== INGEST TOKENS ====================

  @Get('ingest-tokens')
  async listIngestTokens(
    @Query('org_id') orgId: string | undefined,
    @CurrentUser() user: AuthedUser,
  ) {
    this.adminService.requireAdmin(user.role);
    return this.adminService.listIngestTokens(orgId);
  }

  @Post('ingest-tokens')
  async createIngestToken(@Body() dto: IngestTokenCreateDto, @CurrentUser() user: AuthedUser) {
    this.adminService.requireAdmin(user.role);
    return this.adminService.createIngestToken(dto.org_id, dto.name);
  }

  @Put('ingest-tokens/:token_id')
  async updateIngestToken(
    @Param('token_id') tokenId: string,
    @Body() dto: IngestTokenUpdateDto,
    @CurrentUser() user: AuthedUser,
  ) {
    this.adminService.requireAdmin(user.role);
    return this.adminService.updateIngestToken(tokenId, dto.name, dto.is_active);
  }

  @Delete('ingest-tokens/:token_id')
  async deleteIngestToken(@Param('token_id') tokenId: string, @CurrentUser() user: AuthedUser) {
    this.adminService.requireAdmin(user.role);
    return this.adminService.deleteIngestToken(tokenId);
  }
}
