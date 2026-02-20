import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class StatsService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async getOverview(orgId: string, range: string) {
    const days = range === '30d' ? 30 : 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const totalWorkflows = await this.dataSource.query(
      'SELECT COUNT(*) FROM workflows WHERE org_id = $1 AND active',
      [orgId],
    );

    const totalExec = await this.dataSource.query(
      'SELECT COUNT(*) FROM workflow_runs WHERE org_id = $1 AND started_at >= $2',
      [orgId, since],
    );

    const successful = await this.dataSource.query(
      `SELECT COUNT(*) FROM workflow_runs 
       WHERE org_id = $1 AND status = 'success' AND started_at >= $2`,
      [orgId, since],
    );

    const failed = await this.dataSource.query(
      `SELECT COUNT(*) FROM workflow_runs 
       WHERE org_id = $1 AND status = 'failed' AND started_at >= $2`,
      [orgId, since],
    );

    // Previous period for trends
    const prevSince = new Date(since.getTime() - days * 24 * 60 * 60 * 1000);
    const prevExec = await this.dataSource.query(
      'SELECT COUNT(*) FROM workflow_runs WHERE org_id = $1 AND started_at >= $2 AND started_at < $3',
      [orgId, prevSince, since],
    );

    const prevSucc = await this.dataSource.query(
      `SELECT COUNT(*) FROM workflow_runs 
       WHERE org_id = $1 AND status = 'success' AND started_at >= $2 AND started_at < $3`,
      [orgId, prevSince, since],
    );

    const prevFail = await this.dataSource.query(
      `SELECT COUNT(*) FROM workflow_runs 
       WHERE org_id = $1 AND status = 'failed' AND started_at >= $2 AND started_at < $3`,
      [orgId, prevSince, since],
    );

    const pct = (cur: number, prev: number) => {
      const prevVal = prev || 0;
      const base = prevVal > 0 ? prevVal : 1;
      return Math.round((((cur || 0) - prevVal) / base) * 100 * 10) / 10;
    };

    return {
      totalWorkflows: parseInt(totalWorkflows[0].count || '0'),
      totalExecutions: parseInt(totalExec[0].count || '0'),
      successful: parseInt(successful[0].count || '0'),
      failed: parseInt(failed[0].count || '0'),
      trends: {
        workflowsPct: 0,
        executionsPct: pct(parseInt(totalExec[0].count), parseInt(prevExec[0].count)),
        successPct: pct(parseInt(successful[0].count), parseInt(prevSucc[0].count)),
        failedPct: pct(parseInt(failed[0].count), parseInt(prevFail[0].count)),
      },
    };
  }

  async getTrends(orgId: string, range: string) {
    const days = range === '30d' ? 30 : 7;

    const query = `
      SELECT date_trunc('day', started_at)::date as day,
             COUNT(*) FILTER (WHERE status='success') as success,
             COUNT(*) FILTER (WHERE status='failed') as failed
      FROM workflow_runs
      WHERE org_id = $1 AND started_at >= NOW() - ($2 || ' days')::interval
      GROUP BY 1
      ORDER BY 1
    `;

    const rows = await this.dataSource.query(query, [orgId, days.toString()]);

    return rows.map((r: any) => ({
      date: r.day.toISOString().split('T')[0],
      success: parseInt(r.success),
      failed: parseInt(r.failed),
    }));
  }
}
