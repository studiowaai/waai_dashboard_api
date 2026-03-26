import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface ShopifyOrder {
  id: number;
  name: string;
  email: string;
  created_at: string;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  currency: string;
  line_items: Array<{
    title: string;
    quantity: number;
    price: string;
  }>;
  shipping_address?: {
    city: string;
    country: string;
  };
}

export interface ShopifyCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  orders_count: number;
  total_spent: string;
  created_at: string;
  tags: string;
}

@Injectable()
export class ShopifyService {
  private readonly logger = new Logger(ShopifyService.name);

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  // ── OAuth Flow ──────────────────────────────────────────────

  /**
   * Exchange a Shopify OAuth authorization code for a permanent access token.
   * Then store the token in connected_accounts.
   */
  async exchangeOAuthCode(shop: string, code: string, userId: string, workspaceId: string) {
    const clientId = this.configService.get<string>('SHOPIFY_CLIENT_ID');
    const clientSecret = this.configService.get<string>('SHOPIFY_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new BadRequestException('Shopify OAuth is niet geconfigureerd');
    }

    // Exchange the authorization code for an access token
    const tokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: clientId,
      client_secret: clientSecret,
      code,
    });

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
      throw new BadRequestException('Kon geen access token verkrijgen van Shopify');
    }

    // Store the token using the existing connectWithToken method
    return this.connectWithToken(workspaceId, shop, accessToken, userId);
  }

  // ── Connect with direct access token (Custom App) ─────────

  /**
   * Connect a Shopify store using a direct Admin API access token.
   * This is for Shopify Custom Apps — no OAuth flow needed.
   * The token + shop are stored in connected_accounts, just like Gmail.
   */
  async connectWithToken(
    workspaceId: string,
    shopDomain: string,
    accessToken: string,
    userId: string,
  ) {
    // Normalize shop domain
    const shop = shopDomain.includes('.myshopify.com') ? shopDomain : `${shopDomain}.myshopify.com`;

    // Verify the token actually works
    try {
      const res = await axios.get(`https://${shop}/admin/api/2024-01/shop.json`, {
        headers: { 'X-Shopify-Access-Token': accessToken },
      });
      this.logger.log(`Shopify token verified for: ${res.data.shop?.name || shop}`);
    } catch {
      throw new BadRequestException(
        'Shopify-token is ongeldig of het shop-domein klopt niet. Controleer je gegevens.',
      );
    }

    // Upsert the connected account
    const result = await this.dataSource.query(
      `INSERT INTO connected_accounts (workspace_id, provider_id, label, status, credentials_enc, metadata, connected_by, connected_at)
       VALUES ($1, 'shopify', $2, 'active', $3::bytea, $4, $5, NOW())
       ON CONFLICT ON CONSTRAINT uq_connected_accounts_ws_provider_label DO UPDATE SET
         credentials_enc = EXCLUDED.credentials_enc,
         status = 'active',
         metadata = EXCLUDED.metadata,
         connected_at = NOW()
       RETURNING id`,
      [
        workspaceId,
        shop,
        Buffer.from(JSON.stringify({ access_token: accessToken })),
        JSON.stringify({ shop, type: 'oauth' }),
        userId,
      ],
    );

    this.logger.log(`Shopify connected (custom app): ${shop} for workspace ${workspaceId}`);
    return { ok: true, shop, account_id: result[0].id };
  }

  /**
   * Disconnect Shopify for a workspace.
   */
  async disconnect(workspaceId: string) {
    await this.dataSource.query(
      `UPDATE connected_accounts
       SET status = 'revoked', credentials_enc = NULL
       WHERE workspace_id = $1 AND provider_id = 'shopify' AND status = 'active'`,
      [workspaceId],
    );
    return { ok: true };
  }

  /**
   * Check if Shopify is connected for a workspace.
   */
  async getConnectionStatus(workspaceId: string) {
    const result = await this.dataSource.query(
      `SELECT ca.id, ca.label, ca.status, ca.connected_at, ca.metadata
       FROM connected_accounts ca
       WHERE ca.workspace_id = $1 AND ca.provider_id = 'shopify' AND ca.status = 'active'
       LIMIT 1`,
      [workspaceId],
    );
    if (!result?.length) return { connected: false };
    return {
      connected: true,
      shop: result[0].label,
      connected_at: result[0].connected_at,
      account_id: result[0].id,
    };
  }

  // ── API Calls ─────────────────────────────────────────────

  /**
   * Get Shopify access token for a workspace.
   */
  private async getCredentials(
    workspaceId: string,
  ): Promise<{ accessToken: string; shop: string }> {
    const result = await this.dataSource.query(
      `SELECT ca.credentials_enc, ca.label
       FROM connected_accounts ca
       JOIN integration_providers ip ON ip.id = ca.provider_id
       WHERE ca.workspace_id = $1 AND ip.name = 'shopify' AND ca.status = 'active'
       LIMIT 1`,
      [workspaceId],
    );

    if (!result || result.length === 0) {
      throw new NotFoundException('Shopify niet gekoppeld');
    }

    const creds = JSON.parse(Buffer.from(result[0].credentials_enc).toString());
    return { accessToken: creds.access_token, shop: result[0].label };
  }

  /**
   * Search orders by customer email.
   */
  async searchOrders(workspaceId: string, email: string): Promise<ShopifyOrder[]> {
    const { accessToken, shop } = await this.getCredentials(workspaceId);

    const response = await axios.get(`https://${shop}/admin/api/2024-01/orders.json`, {
      params: {
        email,
        status: 'any',
        limit: 10,
      },
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    return (response.data.orders || []).map((o: any) => ({
      id: o.id,
      name: o.name,
      email: o.email,
      created_at: o.created_at,
      financial_status: o.financial_status,
      fulfillment_status: o.fulfillment_status,
      total_price: o.total_price,
      currency: o.currency,
      line_items: (o.line_items || []).map((li: any) => ({
        title: li.title,
        quantity: li.quantity,
        price: li.price,
      })),
      shipping_address: o.shipping_address
        ? { city: o.shipping_address.city, country: o.shipping_address.country }
        : undefined,
    }));
  }

  /**
   * Search customers by email.
   */
  async searchCustomers(workspaceId: string, email: string): Promise<ShopifyCustomer[]> {
    const { accessToken, shop } = await this.getCredentials(workspaceId);

    const response = await axios.get(`https://${shop}/admin/api/2024-01/customers/search.json`, {
      params: { query: `email:${email}` },
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    return (response.data.customers || []).map((c: any) => ({
      id: c.id,
      email: c.email,
      first_name: c.first_name,
      last_name: c.last_name,
      orders_count: c.orders_count,
      total_spent: c.total_spent,
      created_at: c.created_at,
      tags: c.tags,
    }));
  }

  /**
   * Get a single order by ID.
   */
  async getOrder(workspaceId: string, orderId: string): Promise<ShopifyOrder> {
    const { accessToken, shop } = await this.getCredentials(workspaceId);

    const response = await axios.get(`https://${shop}/admin/api/2024-01/orders/${orderId}.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    const o = response.data.order;
    return {
      id: o.id,
      name: o.name,
      email: o.email,
      created_at: o.created_at,
      financial_status: o.financial_status,
      fulfillment_status: o.fulfillment_status,
      total_price: o.total_price,
      currency: o.currency,
      line_items: (o.line_items || []).map((li: any) => ({
        title: li.title,
        quantity: li.quantity,
        price: li.price,
      })),
      shipping_address: o.shipping_address
        ? { city: o.shipping_address.city, country: o.shipping_address.country }
        : undefined,
    };
  }

  /**
   * Get customer context for the AI panel — combines customer + orders.
   */
  async getCustomerContext(workspaceId: string, email: string) {
    try {
      const [customers, orders] = await Promise.all([
        this.searchCustomers(workspaceId, email),
        this.searchOrders(workspaceId, email),
      ]);

      return {
        customer: customers[0] || null,
        orders,
        hasShopify: true,
      };
    } catch (err) {
      if (err instanceof NotFoundException) {
        return { customer: null, orders: [], hasShopify: false };
      }
      this.logger.error(`Shopify context error: ${err.message}`);
      return { customer: null, orders: [], hasShopify: false, error: err.message };
    }
  }
}
