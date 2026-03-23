import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  // ── Workspace CRUD ────────────────────────────────────────

  async getWorkspace(workspaceId: string) {
    const result = await this.dataSource.query(
      `SELECT id, name, slug, plan, settings, created_at, updated_at
       FROM workspaces WHERE id = $1`,
      [workspaceId],
    );

    if (!result?.length) {
      throw new NotFoundException('Workspace niet gevonden');
    }

    return result[0];
  }

  async updateWorkspace(workspaceId: string, data: { name?: string; slug?: string }) {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name) {
      sets.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.slug) {
      // Check slug uniqueness
      const existing = await this.dataSource.query(
        `SELECT id FROM workspaces WHERE slug = $1 AND id != $2`,
        [data.slug, workspaceId],
      );
      if (existing?.length) {
        throw new BadRequestException('Slug is al in gebruik');
      }
      sets.push(`slug = $${idx++}`);
      values.push(data.slug);
    }

    if (sets.length === 0) {
      return this.getWorkspace(workspaceId);
    }

    sets.push(`updated_at = NOW()`);
    values.push(workspaceId);

    await this.dataSource.query(
      `UPDATE workspaces SET ${sets.join(', ')} WHERE id = $${idx}`,
      values,
    );

    return this.getWorkspace(workspaceId);
  }

  // ── Members ───────────────────────────────────────────────

  async listMembers(workspaceId: string) {
    return this.dataSource.query(
      `SELECT wm.id, wm.user_id, wm.role, wm.created_at,
              u.email, u.display_name as name, u.avatar_url
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY wm.created_at ASC`,
      [workspaceId],
    );
  }

  async inviteMember(
    workspaceId: string,
    email: string,
    role: 'admin' | 'agent',
    invitedBy: string,
  ) {
    // Find user by email
    const user = await this.dataSource.query(`SELECT id FROM users WHERE email = $1`, [email]);

    if (!user?.length) {
      throw new NotFoundException(
        `Gebruiker met e-mail ${email} niet gevonden. Ze moeten eerst een account aanmaken.`,
      );
    }

    // Check not already a member
    const existing = await this.dataSource.query(
      `SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, user[0].id],
    );

    if (existing?.length) {
      throw new BadRequestException('Gebruiker is al lid van deze workspace');
    }

    const result = await this.dataSource.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, role, created_at`,
      [workspaceId, user[0].id, role],
    );

    this.logger.log(`Member invited: ${email} as ${role} to workspace ${workspaceId}`);
    return result[0];
  }

  async updateMemberRole(
    workspaceId: string,
    memberId: string,
    role: 'admin' | 'agent',
    updatedBy: string,
  ) {
    // Prevent changing own owner role
    const member = await this.dataSource.query(
      `SELECT user_id, role FROM workspace_members WHERE id = $1 AND workspace_id = $2`,
      [memberId, workspaceId],
    );

    if (!member?.length) {
      throw new NotFoundException('Lid niet gevonden');
    }

    if (member[0].role === 'owner') {
      throw new BadRequestException('Kan de eigenaar-rol niet wijzigen');
    }

    await this.dataSource.query(
      `UPDATE workspace_members SET role = $1 WHERE id = $2 AND workspace_id = $3`,
      [role, memberId, workspaceId],
    );

    return { ok: true, role };
  }

  async removeMember(workspaceId: string, memberId: string) {
    const member = await this.dataSource.query(
      `SELECT role FROM workspace_members WHERE id = $1 AND workspace_id = $2`,
      [memberId, workspaceId],
    );

    if (!member?.length) {
      throw new NotFoundException('Lid niet gevonden');
    }

    if (member[0].role === 'owner') {
      throw new BadRequestException('Kan de eigenaar niet verwijderen');
    }

    await this.dataSource.query(
      `DELETE FROM workspace_members WHERE id = $1 AND workspace_id = $2`,
      [memberId, workspaceId],
    );

    return { ok: true };
  }
}
