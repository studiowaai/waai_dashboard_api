import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceRolesGuard, RequireRoles } from './workspace-roles.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';
import { WorkspacesService } from './workspaces.service';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  slug?: string;
}

class InviteMemberDto {
  @IsEmail()
  email: string;

  @IsEnum(['admin', 'agent'])
  role: 'admin' | 'agent';
}

class UpdateRoleDto {
  @IsEnum(['admin', 'agent'])
  role: 'admin' | 'agent';
}

@Controller('workspaces')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get('current')
  async getCurrentWorkspace(@CurrentUser() user: AuthedUser) {
    return this.workspacesService.getWorkspace(user.orgId);
  }

  @Put('current')
  @RequireRoles('owner', 'admin')
  async updateCurrentWorkspace(@CurrentUser() user: AuthedUser, @Body() body: UpdateWorkspaceDto) {
    return this.workspacesService.updateWorkspace(user.orgId, body);
  }

  // ── Members ───────────────────────────────────────────────

  @Get('current/members')
  async listMembers(@CurrentUser() user: AuthedUser) {
    return this.workspacesService.listMembers(user.orgId);
  }

  @Post('current/members')
  @RequireRoles('owner', 'admin')
  async inviteMember(@CurrentUser() user: AuthedUser, @Body() body: InviteMemberDto) {
    return this.workspacesService.inviteMember(user.orgId, body.email, body.role, user.userId);
  }

  @Put('current/members/:id/role')
  @RequireRoles('owner', 'admin')
  async updateMemberRole(
    @CurrentUser() user: AuthedUser,
    @Param('id', ParseUUIDPipe) memberId: string,
    @Body() body: UpdateRoleDto,
  ) {
    return this.workspacesService.updateMemberRole(user.orgId, memberId, body.role, user.userId);
  }

  @Delete('current/members/:id')
  @RequireRoles('owner', 'admin')
  async removeMember(
    @CurrentUser() user: AuthedUser,
    @Param('id', ParseUUIDPipe) memberId: string,
  ) {
    return this.workspacesService.removeMember(user.orgId, memberId);
  }
}
