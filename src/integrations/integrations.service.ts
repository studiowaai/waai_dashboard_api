import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  // ==================== PROVIDERS (catalog) ====================

  async listProviders() {
    return this.dataSource.query(
      `SELECT id, name, category, auth_type, is_active, description, icon, website,
              config->'fields' as config_fields
       FROM integration_providers
       WHERE is_active = true
       ORDER BY name`,
    );
  }

  /**
   * Get a single provider details with its workspace-specific config status.
   */
  async getProviderWithConfig(providerId: string, workspaceId: string) {
    const provider = await this.dataSource.query(
      `SELECT id, name, category, auth_type, description, icon, website,
              config->'fields' as config_fields, config->'scopes' as scopes
       FROM integration_providers WHERE id = $1 AND is_active = true`,
      [providerId],
    );

    if (!provider?.length) throw new NotFoundException(`Provider '${providerId}' not found`);

    // Get workspace-level config (without secrets)
    const wpc = await this.dataSource.query(
      `SELECT id, config, configured_by, updated_at FROM workspace_provider_configs
       WHERE workspace_id = $1 AND provider_id = $2`,
      [workspaceId, providerId],
    );

    // Get connected accounts
    const accounts = await this.dataSource.query(
      `SELECT ca.id, ca.label, ca.status, ca.connected_at, ca.metadata
       FROM connected_accounts ca WHERE ca.workspace_id = $1 AND ca.provider_id = $2
       ORDER BY ca.connected_at DESC`,
      [workspaceId, providerId],
    );

    return {
      ...provider[0],
      workspace_config: wpc?.length
        ? { configured: true, updated_at: wpc[0].updated_at }
        : { configured: false },
      connected_accounts: accounts,
    };
  }

  // ==================== WORKSPACE PROVIDER CONFIG ====================

  /**
   * Save workspace-level configuration for a provider (e.g. Shopify client_id/secret).
   */
  async saveProviderConfig(
    workspaceId: string,
    providerId: string,
    config: Record<string, any>,
    userId: string,
  ) {
    // Verify provider exists
    const provider = await this.dataSource.query(
      `SELECT id FROM integration_providers WHERE id = $1 AND is_active = true`,
      [providerId],
    );
    if (!provider?.length) throw new NotFoundException(`Provider '${providerId}' not found`);

    await this.dataSource.query(
      `INSERT INTO workspace_provider_configs (workspace_id, provider_id, config, configured_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, provider_id) DO UPDATE SET
         config = EXCLUDED.config,
         configured_by = EXCLUDED.configured_by,
         updated_at = NOW()`,
      [workspaceId, providerId, JSON.stringify(config), userId],
    );

    this.logger.log(`Provider config saved: ${providerId} for workspace ${workspaceId}`);
    return { ok: true, provider_id: providerId };
  }

  /**
   * Get workspace config for a provider (masks secret fields).
   */
  async getProviderConfig(workspaceId: string, providerId: string) {
    // Get the field definitions from integration_providers
    const provider = await this.dataSource.query(
      `SELECT config->'fields' as fields FROM integration_providers WHERE id = $1`,
      [providerId],
    );

    const wpc = await this.dataSource.query(
      `SELECT config, updated_at FROM workspace_provider_configs
       WHERE workspace_id = $1 AND provider_id = $2`,
      [workspaceId, providerId],
    );

    if (!wpc?.length) return { configured: false, config: {}, fields: provider?.[0]?.fields || [] };

    // Mask secret fields (type = 'password')
    const fields = provider?.[0]?.fields || [];
    const maskedConfig = { ...wpc[0].config };
    for (const field of fields) {
      if (field.type === 'password' && maskedConfig[field.key]) {
        maskedConfig[field.key] = '••••••••' + maskedConfig[field.key].slice(-4);
      }
    }

    return { configured: true, config: maskedConfig, updated_at: wpc[0].updated_at, fields };
  }

  /**
   * Delete workspace provider config.
   */
  async deleteProviderConfig(workspaceId: string, providerId: string) {
    await this.dataSource.query(
      `DELETE FROM workspace_provider_configs WHERE workspace_id = $1 AND provider_id = $2`,
      [workspaceId, providerId],
    );
    return { ok: true };
  }

  // ==================== CONNECTED ACCOUNTS ====================

  async listConnectedAccounts(workspaceId: string) {
    const query = `
      SELECT
        ca.id, ca.provider_id, ca.label, ca.status, ca.metadata,
        ca.connected_at, ca.expires_at, ca.created_at,
        ip.name as provider_name, ip.category as provider_category,
        u.email as connected_by_email
      FROM connected_accounts ca
      JOIN integration_providers ip ON ip.id = ca.provider_id
      LEFT JOIN users u ON u.id = ca.connected_by
      WHERE ca.workspace_id = $1
      ORDER BY ca.created_at DESC
    `;

    return this.dataSource.query(query, [workspaceId]);
  }

  async getConnectedAccount(accountId: string, workspaceId: string) {
    const query = `
      SELECT
        ca.*, ip.name as provider_name, ip.category as provider_category, ip.auth_type
      FROM connected_accounts ca
      JOIN integration_providers ip ON ip.id = ca.provider_id
      WHERE ca.id = $1 AND ca.workspace_id = $2
    `;

    const result = await this.dataSource.query(query, [accountId, workspaceId]);
    if (!result || result.length === 0) {
      throw new NotFoundException('Connected account not found');
    }

    return result[0];
  }

  // ==================== OAUTH FLOW ====================

  async initiateOAuth(
    workspaceId: string,
    providerId: string,
    userId: string,
    redirectUri?: string,
  ) {
    // Check provider exists
    const provider = await this.dataSource.query(
      `SELECT id, name, config, auth_type FROM integration_providers WHERE id = $1 AND is_active = true`,
      [providerId],
    );

    if (!provider || provider.length === 0) {
      throw new NotFoundException(`Integration provider '${providerId}' not found`);
    }

    if (provider[0].auth_type !== 'oauth2') {
      throw new BadRequestException(`Provider '${providerId}' does not use OAuth2`);
    }

    // Generate state token
    const stateToken = crypto.randomBytes(32).toString('hex');

    await this.dataSource.query(
      `INSERT INTO oauth_states (workspace_id, provider_id, state_token, redirect_uri, initiated_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [workspaceId, providerId, stateToken, redirectUri, userId],
    );

    // Create pending connected account
    const accountResult = await this.dataSource.query(
      `INSERT INTO connected_accounts (workspace_id, provider_id, status, connected_by)
       VALUES ($1, $2, 'pending', $3)
       RETURNING id`,
      [workspaceId, providerId, userId],
    );

    return {
      state_token: stateToken,
      account_id: accountResult[0].id,
      provider: provider[0],
    };
  }

  async handleOAuthCallback(stateToken: string, code: string) {
    // Validate state token
    const stateResult = await this.dataSource.query(
      `SELECT id, workspace_id, provider_id, initiated_by, redirect_uri
       FROM oauth_states
       WHERE state_token = $1 AND consumed_at IS NULL AND expires_at > NOW()`,
      [stateToken],
    );

    if (!stateResult || stateResult.length === 0) {
      throw new BadRequestException('Invalid or expired OAuth state');
    }

    const state = stateResult[0];

    // Mark state as consumed
    await this.dataSource.query(`UPDATE oauth_states SET consumed_at = NOW() WHERE id = $1`, [
      state.id,
    ]);

    // TODO: Exchange code for tokens via provider-specific logic
    // This is where Gmail/Shopify specific OAuth exchange happens
    this.logger.log(
      `OAuth callback for provider ${state.provider_id}, workspace ${state.workspace_id}, code received: ${!!code}`,
    );

    return {
      workspace_id: state.workspace_id,
      provider_id: state.provider_id,
      // The actual token exchange will be implemented per-provider
    };
  }

  async disconnectAccount(accountId: string) {
    await this.dataSource.query(
      `UPDATE connected_accounts SET status = 'revoked', credentials_enc = NULL WHERE id = $1`,
      [accountId],
    );

    return { ok: true, message: 'Account disconnected' };
  }

  // ==================== SYNC JOBS ====================

  async listSyncJobs(accountId: string, workspaceId: string, limit = 20) {
    // Verify account belongs to workspace
    await this.getConnectedAccount(accountId, workspaceId);

    const query = `
      SELECT id, job_type, status, started_at, completed_at, records_processed, error_message, created_at
      FROM sync_jobs
      WHERE connected_account_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

    return this.dataSource.query(query, [accountId, limit]);
  }

  // ==================== CHANNELS ====================

  async listChannels(workspaceId: string) {
    const query = `
      SELECT
        ch.id, ch.type, ch.name, ch.is_active, ch.config, ch.created_at,
        ca.provider_id, ca.label as account_label, ca.status as account_status
      FROM channels ch
      LEFT JOIN connected_accounts ca ON ca.id = ch.connected_account_id
      WHERE ch.workspace_id = $1
      ORDER BY ch.created_at DESC
    `;

    return this.dataSource.query(query, [workspaceId]);
  }
}
