import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private httpService: HttpService,
  ) {}

  async listApprovals(orgId: string, status?: string, type?: string, limit: number = 50) {
    const whereClauses = ['org_id = $1'];
    const params: any[] = [orgId];
    let paramIndex = 2;

    if (status) {
      whereClauses.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (type) {
      whereClauses.push(`type = $${paramIndex++}`);
      params.push(type);
    }

    params.push(limit);

    const query = `
      SELECT id,
             type,
             status,
             title,
             (data->'preview') AS preview,
             created_at
      FROM approvals
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${paramIndex}
    `;

    const rows = await this.dataSource.query(query, params);

    return rows.map((row: any) => ({
      id: row.id.toString(),
      type: row.type,
      status: row.status,
      title: row.title,
      preview: row.preview || {},
      created_at: row.created_at.toISOString(),
    }));
  }

  async getApprovalDetail(approvalId: string, orgId: string, userId: string, baseUrl: string) {
    const approvalQuery = `
      SELECT id,
             org_id,
             type,
             status,
             title,
             (data->'preview') AS preview,
             data,
             n8n_execute_webhook_url,
             created_at,
             updated_at,
             approved_at,
             approved_by_user_id
      FROM approvals
      WHERE id = $1 AND org_id = $2
    `;

    const approvalResult = await this.dataSource.query(approvalQuery, [approvalId, orgId]);

    if (!approvalResult || approvalResult.length === 0) {
      throw new NotFoundException('Approval not found');
    }

    const approval = approvalResult[0];

    // Fetch assets
    const assetsQuery = `
      SELECT id, role, external_url, filename, mime_type, size_bytes
      FROM approval_assets
      WHERE approval_id = $1
      ORDER BY created_at
    `;

    const assetsResult = await this.dataSource.query(assetsQuery, [approvalId]);

    const assets = assetsResult.map((row: any) => ({
      id: row.id.toString(),
      role: row.role,
      url: `${baseUrl}/approvals/${approvalId}/assets/${row.id}`,
      filename: row.filename,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
    }));

    // Log viewed event
    await this.logApprovalEvent(approvalId, 'viewed', userId);

    return {
      id: approval.id.toString(),
      type: approval.type,
      status: approval.status,
      title: approval.title,
      preview: approval.preview || {},
      data: approval.data || {},
      assets,
      created_at: approval.created_at.toISOString(),
      updated_at: approval.updated_at.toISOString(),
      approved_at: approval.approved_at ? approval.approved_at.toISOString() : null,
      approved_by_user_id: approval.approved_by_user_id
        ? approval.approved_by_user_id.toString()
        : null,
      n8n_execute_webhook_url: approval.n8n_execute_webhook_url,
    };
  }

  async approveApproval(approvalId: string, orgId: string, userId: string) {
    // Lock row for update
    const lockQuery = `
      SELECT id, org_id, status, type, data, n8n_execute_webhook_url, title
      FROM approvals
      WHERE id = $1 AND org_id = $2
      FOR UPDATE
    `;

    const result = await this.dataSource.query(lockQuery, [approvalId, orgId]);

    if (!result || result.length === 0) {
      throw new NotFoundException('Approval not found');
    }

    const approval = result[0];

    if (approval.status !== 'pending') {
      throw new BadRequestException(`Cannot approve: approval is already '${approval.status}'`);
    }

    // Update to approved
    const updateQuery = `
      UPDATE approvals
      SET status = 'approved',
          approved_by_user_id = $1,
          approved_at = NOW()
      WHERE id = $2
    `;

    await this.dataSource.query(updateQuery, [userId, approvalId]);

    // Log approved event
    await this.logApprovalEvent(approvalId, 'approved', userId);

    // Call n8n webhook if configured
    let finalStatus = 'approved';
    let errorMessage = null;

    if (approval.n8n_execute_webhook_url) {
      try {
        this.logger.log(`Calling n8n webhook for approval ${approvalId}`);

        const payload = {
          ...(approval.data || {}),
          _approval_id: approvalId,
          _approval_type: approval.type,
          _approval_title: approval.title,
          _org_id: orgId,
          _user_id: userId,
        };

        const response = await firstValueFrom(
          this.httpService.post(approval.n8n_execute_webhook_url, payload, {
            timeout: 30000,
          }),
        );

        if (response.status >= 200 && response.status < 300) {
          finalStatus = 'sent';
          await this.logApprovalEvent(approvalId, 'sent', userId);
          this.logger.log(`Approval ${approvalId} sent successfully`);
        } else {
          finalStatus = 'failed';
          errorMessage = `Webhook returned status ${response.status}`;
          await this.logApprovalEvent(approvalId, 'failed', userId, { error: errorMessage });
        }
      } catch (error: any) {
        finalStatus = 'failed';
        errorMessage = error.message || 'Unknown error';
        await this.logApprovalEvent(approvalId, 'failed', userId, { error: errorMessage });
        this.logger.error(`Webhook failed for approval ${approvalId}: ${errorMessage}`);
      }

      // Update final status
      await this.dataSource.query('UPDATE approvals SET status = $1 WHERE id = $2', [
        finalStatus,
        approvalId,
      ]);
    }

    return {
      ok: true,
      message: 'Approval successful',
      approval_id: approvalId,
      status: finalStatus,
    };
  }

  async rejectApproval(approvalId: string, orgId: string, userId: string, reason?: string) {
    const lockQuery = `
      SELECT id, status
      FROM approvals
      WHERE id = $1 AND org_id = $2
      FOR UPDATE
    `;

    const result = await this.dataSource.query(lockQuery, [approvalId, orgId]);

    if (!result || result.length === 0) {
      throw new NotFoundException('Approval not found');
    }

    if (result[0].status !== 'pending') {
      throw new BadRequestException(`Cannot reject: approval is already '${result[0].status}'`);
    }

    await this.dataSource.query('UPDATE approvals SET status = $1 WHERE id = $2', [
      'rejected',
      approvalId,
    ]);

    await this.logApprovalEvent(approvalId, 'rejected', userId, { reason });

    return {
      ok: true,
      message: 'Approval rejected',
      approval_id: approvalId,
      status: 'rejected',
    };
  }

  async viewApprovalAsset(approvalId: string, assetId: string, orgId: string) {
    // Verify approval belongs to org
    const approvalCheck = await this.dataSource.query(
      'SELECT id FROM approvals WHERE id = $1 AND org_id = $2',
      [approvalId, orgId],
    );

    if (!approvalCheck || approvalCheck.length === 0) {
      throw new NotFoundException('Approval not found');
    }

    // Get asset
    const assetQuery = `
      SELECT id, external_url, mime_type, filename
      FROM approval_assets
      WHERE id = $1 AND approval_id = $2
    `;

    const result = await this.dataSource.query(assetQuery, [assetId, approvalId]);

    if (!result || result.length === 0) {
      throw new NotFoundException('Asset not found');
    }

    const asset = result[0];

    // Fetch from external URL and proxy
    try {
      const response = await firstValueFrom(
        this.httpService.get(asset.external_url, {
          responseType: 'arraybuffer',
          timeout: 30000,
        }),
      );

      return {
        buffer: Buffer.from(response.data),
        contentType: asset.mime_type || 'application/octet-stream',
        filename: asset.filename,
      };
    } catch (error: any) {
      this.logger.error(`Failed to fetch asset ${assetId}: ${error.message}`);
      throw new NotFoundException('Asset unavailable');
    }
  }

  private async logApprovalEvent(
    approvalId: string,
    event: string,
    userId: string,
    metadata: any = {},
  ) {
    const query = `
      INSERT INTO approval_events (approval_id, event, by_user_id, metadata)
      VALUES ($1, $2, $3, $4)
    `;

    await this.dataSource.query(query, [approvalId, event, userId, JSON.stringify(metadata)]);
  }
}
