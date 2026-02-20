import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { IsString, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';
import { ApprovalsService } from './approvals.service';

class RejectApprovalDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('approvals')
@UseGuards(JwtAuthGuard)
export class ApprovalsController {
  constructor(private approvalsService: ApprovalsService) {}

  @Get()
  async listApprovals(
    @Query('status') status: string,
    @Query('type') type: string,
    @Query('limit') limit: number = 50,
    @CurrentUser() user: AuthedUser,
  ) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.approvalsService.listApprovals(user.orgId, status, type, safeLimit);
  }

  @Get(':approval_id')
  async getApprovalDetail(
    @Param('approval_id') approvalId: string,
    @Req() req: FastifyRequest,
    @CurrentUser() user: AuthedUser,
  ) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    return this.approvalsService.getApprovalDetail(approvalId, user.orgId, user.userId, baseUrl);
  }

  @Post(':approval_id/approve')
  async approveApproval(@Param('approval_id') approvalId: string, @CurrentUser() user: AuthedUser) {
    return this.approvalsService.approveApproval(approvalId, user.orgId, user.userId);
  }

  @Post(':approval_id/reject')
  async rejectApproval(
    @Param('approval_id') approvalId: string,
    @Body() dto: RejectApprovalDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.approvalsService.rejectApproval(approvalId, user.orgId, user.userId, dto.reason);
  }

  @Get(':approval_id/assets/:asset_id')
  async viewApprovalAsset(
    @Param('approval_id') approvalId: string,
    @Param('asset_id') assetId: string,
    @CurrentUser() user: AuthedUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const asset = await this.approvalsService.viewApprovalAsset(approvalId, assetId, user.orgId);

    reply.header('Content-Type', asset.contentType);
    reply.header('Content-Disposition', `inline; filename="${asset.filename}"`);

    return new StreamableFile(asset.buffer);
  }
}
