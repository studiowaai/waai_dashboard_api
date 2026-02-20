import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import * as crypto from 'crypto';

@Injectable()
export class AdminService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private authService: AuthService,
  ) {}

  requireAdmin(role: string) {
    if (role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
  }

  generateIngestToken(): string {
    const randomPart = crypto.randomBytes(32).toString('hex');
    return `sk_live_${randomPart}`;
  }

  // ==================== ORGANIZATIONS ====================

  async listOrganizations() {
    const query = `
      SELECT id, name, n8n_transcribe_webhook_url, n8n_prompt_webhook_url, n8n_approval_webhook_url 
      FROM organizations 
      ORDER BY name
    `;
    const rows = await this.dataSource.query(query);

    return rows.map((row: any) => ({
      id: row.id.toString(),
      name: row.name,
      n8n_transcribe_webhook_url: row.n8n_transcribe_webhook_url,
      n8n_prompt_webhook_url: row.n8n_prompt_webhook_url,
      n8n_approval_webhook_url: row.n8n_approval_webhook_url,
    }));
  }

  async createOrganization(name: string) {
    const query = `
      INSERT INTO organizations (name)
      VALUES ($1)
      RETURNING id, name
    `;

    const result = await this.dataSource.query(query, [name]);
    const row = result[0];
    const orgId = row.id;
    const orgName = row.name;

    // Create default ingest token
    const token = this.generateIngestToken();
    const tokenQuery = `
      INSERT INTO ingest_tokens (org_id, token, name, is_active)
      VALUES ($1, $2, $3, TRUE)
    `;

    await this.dataSource.query(tokenQuery, [orgId, token, `Default token for ${orgName}`]);

    return {
      id: orgId.toString(),
      name: orgName,
    };
  }

  async updateOrganization(
    orgId: string,
    name: string,
    transcribeUrl?: string,
    promptUrl?: string,
    approvalUrl?: string,
  ) {
    const query = `
      UPDATE organizations
      SET name = $1,
          n8n_transcribe_webhook_url = $2,
          n8n_prompt_webhook_url = $3,
          n8n_approval_webhook_url = $4
      WHERE id = $5
      RETURNING id, name, n8n_transcribe_webhook_url, n8n_prompt_webhook_url, n8n_approval_webhook_url
    `;

    const result = await this.dataSource.query(query, [
      name,
      transcribeUrl,
      promptUrl,
      approvalUrl,
      orgId,
    ]);

    if (!result || result.length === 0) {
      throw new NotFoundException('Organization not found');
    }

    const row = result[0];

    return {
      id: row.id.toString(),
      name: row.name,
      n8n_transcribe_webhook_url: row.n8n_transcribe_webhook_url,
      n8n_prompt_webhook_url: row.n8n_prompt_webhook_url,
      n8n_approval_webhook_url: row.n8n_approval_webhook_url,
    };
  }

  async deleteOrganization(orgId: string) {
    const checkQuery = 'SELECT id FROM organizations WHERE id = $1';
    const row = await this.dataSource.query(checkQuery, [orgId]);

    if (!row || row.length === 0) {
      throw new NotFoundException('Organization not found');
    }

    const deleteQuery = 'DELETE FROM organizations WHERE id = $1';
    await this.dataSource.query(deleteQuery, [orgId]);

    return { ok: true, message: 'Organization deleted successfully' };
  }

  // ==================== USERS ====================

  async listUsers(orgId?: string) {
    let query: string;
    let params: any[];

    if (orgId) {
      query = `
        SELECT u.id, u.email, u.role, u.org_id, u.created_at, u.page_permissions, o.name as org_name
        FROM users u
        JOIN organizations o ON o.id = u.org_id
        WHERE u.org_id = $1
        ORDER BY u.email
      `;
      params = [orgId];
    } else {
      query = `
        SELECT u.id, u.email, u.role, u.org_id, u.created_at, u.page_permissions, o.name as org_name
        FROM users u
        JOIN organizations o ON o.id = u.org_id
        ORDER BY o.name, u.email
      `;
      params = [];
    }

    const rows = await this.dataSource.query(query, params);

    return rows.map((row: any) => ({
      id: row.id.toString(),
      email: row.email,
      role: row.role,
      org_id: row.org_id.toString(),
      org_name: row.org_name,
      created_at: row.created_at.toISOString(),
      page_permissions: row.page_permissions,
    }));
  }

  async createUser(email: string, password: string, role: string, orgId: string) {
    if (role !== 'admin' && role !== 'viewer') {
      throw new BadRequestException("Role must be 'admin' or 'viewer'");
    }

    // Check if org exists
    const orgCheck = await this.dataSource.query('SELECT id FROM organizations WHERE id = $1', [
      orgId,
    ]);

    if (!orgCheck || orgCheck.length === 0) {
      throw new NotFoundException('Organization not found');
    }

    // Check if email exists
    const emailCheck = await this.dataSource.query('SELECT id FROM users WHERE email = $1', [
      email,
    ]);

    if (emailCheck && emailCheck.length > 0) {
      throw new BadRequestException('Email already exists');
    }

    // Hash password
    const passwordHash = await this.authService.hashPassword(password);

    // Create user
    const query = `
      INSERT INTO users (org_id, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, role, org_id, created_at
    `;

    const result = await this.dataSource.query(query, [orgId, email, passwordHash, role]);
    const row = result[0];

    // Get org name
    const orgNameQuery = await this.dataSource.query(
      'SELECT name FROM organizations WHERE id = $1',
      [orgId],
    );
    const orgName = orgNameQuery[0].name;

    return {
      id: row.id.toString(),
      email: row.email,
      role: row.role,
      org_id: row.org_id.toString(),
      org_name: orgName,
      created_at: row.created_at.toISOString(),
      page_permissions: null,
    };
  }

  async updateUserPermissions(userId: string, pagePermissions: string[] | null) {
    const checkQuery = 'SELECT id, org_id FROM users WHERE id = $1';
    const existing = await this.dataSource.query(checkQuery, [userId]);

    if (!existing || existing.length === 0) {
      throw new NotFoundException('User not found');
    }

    let query: string;
    let result: any;

    if (pagePermissions === null) {
      query = `
        UPDATE users SET page_permissions = NULL WHERE id = $1
        RETURNING id, email, role, org_id, created_at, page_permissions
      `;
      result = await this.dataSource.query(query, [userId]);
    } else {
      const cleaned = pagePermissions.filter((p) => typeof p === 'string');
      const ppJson = JSON.stringify(cleaned);

      query = `
        UPDATE users SET page_permissions = $1::jsonb WHERE id = $2
        RETURNING id, email, role, org_id, created_at, page_permissions
      `;
      result = await this.dataSource.query(query, [ppJson, userId]);
    }

    const row = result[0];

    // Get org name
    const orgNameQuery = await this.dataSource.query(
      'SELECT name FROM organizations WHERE id = $1',
      [row.org_id],
    );
    const orgName = orgNameQuery[0].name;

    return {
      id: row.id.toString(),
      email: row.email,
      role: row.role,
      org_id: row.org_id.toString(),
      org_name: orgName,
      created_at: row.created_at.toISOString(),
      page_permissions: row.page_permissions,
    };
  }

  async updateUser(userId: string, email?: string, password?: string, role?: string) {
    const checkQuery = 'SELECT id, org_id FROM users WHERE id = $1';
    const existing = await this.dataSource.query(checkQuery, [userId]);

    if (!existing || existing.length === 0) {
      throw new NotFoundException('User not found');
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (email !== undefined) {
      const emailCheck = await this.dataSource.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, userId],
      );

      if (emailCheck && emailCheck.length > 0) {
        throw new BadRequestException('Email already exists');
      }

      updates.push(`email = $${paramIndex++}`);
      params.push(email);
    }

    if (password !== undefined) {
      const passwordHash = await this.authService.hashPassword(password);
      updates.push(`password_hash = $${paramIndex++}`);
      params.push(passwordHash);
    }

    if (role !== undefined) {
      if (role !== 'admin' && role !== 'viewer') {
        throw new BadRequestException("Role must be 'admin' or 'viewer'");
      }

      updates.push(`role = $${paramIndex++}`);
      params.push(role);
    }

    if (updates.length === 0) {
      // No updates, just return existing user
      const query = `
        SELECT u.id, u.email, u.role, u.org_id, u.created_at, u.page_permissions, o.name as org_name
        FROM users u
        JOIN organizations o ON o.id = u.org_id
        WHERE u.id = $1
      `;
      const result = await this.dataSource.query(query, [userId]);
      const row = result[0];

      return {
        id: row.id.toString(),
        email: row.email,
        role: row.role,
        org_id: row.org_id.toString(),
        org_name: row.org_name,
        created_at: row.created_at.toISOString(),
        page_permissions: row.page_permissions,
      };
    }

    params.push(userId);

    const query = `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, email, role, org_id, created_at, page_permissions
    `;

    const result = await this.dataSource.query(query, params);
    const row = result[0];

    // Get org name
    const orgNameQuery = await this.dataSource.query(
      'SELECT name FROM organizations WHERE id = $1',
      [row.org_id],
    );
    const orgName = orgNameQuery[0].name;

    return {
      id: row.id.toString(),
      email: row.email,
      role: row.role,
      org_id: row.org_id.toString(),
      org_name: orgName,
      created_at: row.created_at.toISOString(),
      page_permissions: row.page_permissions,
    };
  }

  async deleteUser(userId: string) {
    const checkQuery = 'SELECT id FROM users WHERE id = $1';
    const row = await this.dataSource.query(checkQuery, [userId]);

    if (!row || row.length === 0) {
      throw new NotFoundException('User not found');
    }

    const deleteQuery = 'DELETE FROM users WHERE id = $1';
    await this.dataSource.query(deleteQuery, [userId]);

    return { ok: true, message: 'User deleted successfully' };
  }

  // ==================== INGEST TOKENS ====================

  async listIngestTokens(orgId?: string) {
    let query: string;
    let params: any[];

    if (orgId) {
      query = `
        SELECT it.id, it.org_id, it.token, it.name, it.is_active, it.created_at, o.name as org_name
        FROM ingest_tokens it
        JOIN organizations o ON o.id = it.org_id
        WHERE it.org_id = $1
        ORDER BY it.created_at DESC
      `;
      params = [orgId];
    } else {
      query = `
        SELECT it.id, it.org_id, it.token, it.name, it.is_active, it.created_at, o.name as org_name
        FROM ingest_tokens it
        JOIN organizations o ON o.id = it.org_id
        ORDER BY o.name, it.created_at DESC
      `;
      params = [];
    }

    const rows = await this.dataSource.query(query, params);

    return rows.map((row: any) => ({
      id: row.id.toString(),
      org_id: row.org_id.toString(),
      org_name: row.org_name,
      token: row.token,
      name: row.name,
      is_active: row.is_active,
      created_at: row.created_at.toISOString(),
    }));
  }

  async createIngestToken(orgId: string, name: string) {
    const orgCheck = await this.dataSource.query('SELECT id FROM organizations WHERE id = $1', [
      orgId,
    ]);

    if (!orgCheck || orgCheck.length === 0) {
      throw new NotFoundException('Organization not found');
    }

    const token = this.generateIngestToken();

    const query = `
      INSERT INTO ingest_tokens (org_id, token, name, is_active)
      VALUES ($1, $2, $3, TRUE)
      RETURNING id, org_id, token, name, is_active, created_at
    `;

    const result = await this.dataSource.query(query, [orgId, token, name]);
    const row = result[0];

    const orgNameQuery = await this.dataSource.query(
      'SELECT name FROM organizations WHERE id = $1',
      [orgId],
    );
    const orgName = orgNameQuery[0].name;

    return {
      id: row.id.toString(),
      org_id: row.org_id.toString(),
      org_name: orgName,
      token: row.token,
      name: row.name,
      is_active: row.is_active,
      created_at: row.created_at.toISOString(),
    };
  }

  async updateIngestToken(tokenId: string, name?: string, isActive?: boolean) {
    const checkQuery = 'SELECT id, org_id FROM ingest_tokens WHERE id = $1';
    const existing = await this.dataSource.query(checkQuery, [tokenId]);

    if (!existing || existing.length === 0) {
      throw new NotFoundException('Ingest token not found');
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      params.push(name);
    }

    if (isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      params.push(isActive);
    }

    if (updates.length === 0) {
      const query = `
        SELECT it.id, it.org_id, it.token, it.name, it.is_active, it.created_at, o.name as org_name
        FROM ingest_tokens it
        JOIN organizations o ON o.id = it.org_id
        WHERE it.id = $1
      `;
      const result = await this.dataSource.query(query, [tokenId]);
      const row = result[0];

      return {
        id: row.id.toString(),
        org_id: row.org_id.toString(),
        org_name: row.org_name,
        token: row.token,
        name: row.name,
        is_active: row.is_active,
        created_at: row.created_at.toISOString(),
      };
    }

    params.push(tokenId);

    const query = `
      UPDATE ingest_tokens
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, org_id, token, name, is_active, created_at
    `;

    const result = await this.dataSource.query(query, params);
    const row = result[0];

    const orgNameQuery = await this.dataSource.query(
      'SELECT name FROM organizations WHERE id = $1',
      [row.org_id],
    );
    const orgName = orgNameQuery[0].name;

    return {
      id: row.id.toString(),
      org_id: row.org_id.toString(),
      org_name: orgName,
      token: row.token,
      name: row.name,
      is_active: row.is_active,
      created_at: row.created_at.toISOString(),
    };
  }

  async deleteIngestToken(tokenId: string) {
    const checkQuery = 'SELECT id FROM ingest_tokens WHERE id = $1';
    const row = await this.dataSource.query(checkQuery, [tokenId]);

    if (!row || row.length === 0) {
      throw new NotFoundException('Ingest token not found');
    }

    const deleteQuery = 'DELETE FROM ingest_tokens WHERE id = $1';
    await this.dataSource.query(deleteQuery, [tokenId]);

    return { ok: true, message: 'Ingest token deleted successfully' };
  }
}
