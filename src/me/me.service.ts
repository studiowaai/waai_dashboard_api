import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const ALL_PAGES = ['dashboard', 'executions', 'approvals', 'admin', 'prompts'];

@Injectable()
export class MeService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async getMe(userId: string, orgId: string, role: string) {
    const query = `
      SELECT u.email, u.role, u.page_permissions, o.id as org_id, o.name as org_name
      FROM users u
      JOIN organizations o ON o.id = u.org_id
      WHERE u.id = $1
    `;

    const result = await this.dataSource.query(query, [userId]);

    if (!result || result.length === 0) {
      return {
        user: { id: userId, email: null, role },
        org: { id: orgId, name: null },
        allowed_pages: ['dashboard'],
      };
    }

    const row = result[0];
    let allowedPages: string[];

    if (row.page_permissions === null) {
      if (row.role === 'admin') {
        allowedPages = ALL_PAGES;
      } else {
        allowedPages = ['dashboard', 'executions', 'approvals'];
      }
    } else {
      allowedPages = row.page_permissions.filter((p: any) => typeof p === 'string');
    }

    return {
      user: { id: userId, email: row.email, role: row.role },
      org: { id: row.org_id.toString(), name: row.org_name },
      allowed_pages: allowedPages,
    };
  }
}
