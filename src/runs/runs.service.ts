import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class RunsService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async getRecent(orgId: string, limit: number) {
    const query = `
      SELECT wr.id, w.name, wr.started_at, wr.ended_at, wr.status,
             EXTRACT(epoch FROM (wr.ended_at - wr.started_at)) * 1000 as duration_ms
      FROM workflow_runs wr
      JOIN workflows w ON w.id = wr.workflow_id
      WHERE wr.org_id = $1
      ORDER BY wr.started_at DESC
      LIMIT $2
    `;

    const rows = await this.dataSource.query(query, [orgId, limit]);

    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      startedAt: r.started_at.toISOString(),
      durationMs: r.duration_ms ? Math.floor(r.duration_ms) : null,
      status: r.status,
    }));
  }

  async getRunDetails(runId: number, orgId: string) {
    const query = `
      SELECT 
        wr.id,
        wr.workflow_id,
        w.name as workflow_name,
        wr.started_at,
        wr.ended_at,
        wr.status,
        wr.duration_ms,
        wr.error_message,
        wr.external_run_id,
        wr.payload
      FROM workflow_runs wr
      JOIN workflows w ON w.id = wr.workflow_id
      WHERE wr.id = $1 AND wr.org_id = $2
      LIMIT 1
    `;

    const result = await this.dataSource.query(query, [runId, orgId]);

    if (!result || result.length === 0) {
      throw new NotFoundException('Workflow run not found');
    }

    const row = result[0];

    return {
      id: row.id,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      startedAt: row.started_at.toISOString(),
      endedAt: row.ended_at ? row.ended_at.toISOString() : null,
      status: row.status,
      durationMs: row.duration_ms,
      errorMessage: row.error_message,
      externalRunId: row.external_run_id,
      metadata: row.payload || {},
    };
  }
}
