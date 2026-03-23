import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';

export interface JwtPayload {
  sub: string;
  org: string;
  role: string;
}

export interface GoogleLoginData {
  googleId: string;
  email: string;
  displayName: string;
  avatar?: string;
  accessToken: string;
  refreshToken?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectDataSource()
    private dataSource: DataSource,
    private jwtService: JwtService,
  ) {}

  async hashPassword(plain: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(plain, saltRounds);
  }

  async verifyPassword(plain: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plain, hashed);
  }

  createJwt(userId: string, orgId: string, role: string): string {
    const payload: JwtPayload = {
      sub: userId,
      org: orgId,
      role,
    };
    return this.jwtService.sign(payload);
  }

  async validateUser(email: string, password: string) {
    const result = await this.dataSource.query(
      'SELECT u.id, u.default_workspace_id, u.role, u.password_hash FROM users u WHERE u.email = $1',
      [email],
    );

    if (!result || result.length === 0) {
      return null;
    }

    const user = result[0];
    const isValid = await this.verifyPassword(password, user.password_hash);

    if (!isValid) {
      return null;
    }

    return {
      id: user.id,
      org_id: user.default_workspace_id,
      role: user.role,
    };
  }

  /**
   * Handle Google OAuth login/register.
   * - If user with this google_id exists → update tokens & login
   * - If user with this email exists → link google_id & login
   * - Otherwise → create new user + workspace
   *
   * Also persists the Gmail connection as a connected_account so it
   * appears on the Integraties page alongside Shopify, WooCommerce, etc.
   */
  async handleGoogleLogin(data: GoogleLoginData) {
    const { googleId, email, displayName, avatar, accessToken, refreshToken } = data;

    // 1. Check by google_id
    let user = await this.dataSource
      .query('SELECT id, default_workspace_id, role FROM users WHERE google_id = $1', [googleId])
      .then((r) => r[0] || null);

    if (user) {
      // Update tokens
      await this.dataSource.query(
        `UPDATE users SET
          google_access_token = $1,
          google_refresh_token = COALESCE($2, google_refresh_token),
          google_token_expiry = NOW() + INTERVAL '1 hour',
          google_email = $3,
          display_name = COALESCE($4, display_name),
          avatar_url = COALESCE($5, avatar_url)
        WHERE google_id = $6`,
        [accessToken, refreshToken, email, displayName, avatar, googleId],
      );

      // Persist Gmail as connected_account
      await this.saveGmailConnectedAccount(
        user.default_workspace_id,
        user.id,
        email,
        accessToken,
        refreshToken,
      );

      this.logger.log(`Google login: existing user ${email}`);
      return { id: user.id, org_id: user.default_workspace_id, role: user.role };
    }

    // 2. Check by email (link accounts)
    user = await this.dataSource
      .query('SELECT id, default_workspace_id, role FROM users WHERE email = $1', [email])
      .then((r) => r[0] || null);

    if (user) {
      await this.dataSource.query(
        `UPDATE users SET
          google_id = $1,
          google_access_token = $2,
          google_refresh_token = COALESCE($3, google_refresh_token),
          google_token_expiry = NOW() + INTERVAL '1 hour',
          google_email = $4,
          display_name = COALESCE($5, display_name),
          avatar_url = COALESCE($6, avatar_url)
        WHERE email = $7`,
        [googleId, accessToken, refreshToken, email, displayName, avatar, email],
      );

      // Persist Gmail as connected_account
      await this.saveGmailConnectedAccount(
        user.default_workspace_id,
        user.id,
        email,
        accessToken,
        refreshToken,
      );

      this.logger.log(`Google login: linked to existing user ${email}`);
      return { id: user.id, org_id: user.default_workspace_id, role: user.role };
    }

    // 3. New user → create workspace + user + membership
    this.logger.log(`Google login: creating new user ${email}`);

    const workspaceName = displayName ? `${displayName}'s Workspace` : 'Mijn Workspace';
    const slug = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-');

    const wsResult = await this.dataSource.query(
      `INSERT INTO workspaces (id, name, slug) VALUES (gen_random_uuid(), $1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [workspaceName, slug],
    );
    const workspaceId = wsResult[0].id;

    const userResult = await this.dataSource.query(
      `INSERT INTO users (id, email, role, default_workspace_id, google_id, google_email, google_access_token, google_refresh_token, google_token_expiry, display_name, avatar_url)
       VALUES (gen_random_uuid(), $1, 'admin', $2, $3, $4, $5, $6, NOW() + INTERVAL '1 hour', $7, $8)
       RETURNING id, default_workspace_id, role`,
      [email, workspaceId, googleId, email, accessToken, refreshToken, displayName, avatar],
    );
    const newUser = userResult[0];

    await this.dataSource.query(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role)
       VALUES (gen_random_uuid(), $1, $2, 'owner')`,
      [workspaceId, newUser.id],
    );

    // Persist Gmail as connected_account
    await this.saveGmailConnectedAccount(
      newUser.default_workspace_id,
      newUser.id,
      email,
      accessToken,
      refreshToken,
    );

    return { id: newUser.id, org_id: newUser.default_workspace_id, role: newUser.role };
  }

  /**
   * Save or update the Gmail integration as a connected_account.
   * This lets it appear in the Integraties page alongside Shopify, etc.
   */
  private async saveGmailConnectedAccount(
    workspaceId: string,
    userId: string,
    email: string,
    accessToken: string,
    refreshToken?: string,
  ) {
    try {
      await this.dataSource.query(
        `INSERT INTO connected_accounts
           (workspace_id, provider_id, label, status, credentials_enc, metadata, connected_by, connected_at)
         VALUES ($1, 'gmail', $2, 'active', $3::bytea, $4, $5, NOW())
         ON CONFLICT (workspace_id, provider_id, label) DO UPDATE SET
           credentials_enc = EXCLUDED.credentials_enc,
           status = 'active',
           metadata = EXCLUDED.metadata,
           connected_at = NOW()`,
        [
          workspaceId,
          email,
          Buffer.from(
            JSON.stringify({
              access_token: accessToken,
              refresh_token: refreshToken || null,
            }),
          ),
          JSON.stringify({ email, type: 'google_oauth' }),
          userId,
        ],
      );
      this.logger.log(`Gmail connected_account saved for ${email} in workspace ${workspaceId}`);
    } catch (err) {
      // Non-fatal: the user can still use Gmail via tokens on the users table
      this.logger.warn(`Could not save Gmail connected_account: ${err.message}`);
    }
  }
}
