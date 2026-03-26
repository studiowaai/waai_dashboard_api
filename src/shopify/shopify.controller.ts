import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Body,
  Param,
  Res,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';
import { ShopifyService } from './shopify.service';
import { IsString } from 'class-validator';
import { ConfigService } from '@nestjs/config';

class ConnectShopifyDto {
  @IsString()
  shop: string;

  @IsString()
  access_token: string;
}

@Controller('shopify')
export class ShopifyController {
  private readonly logger = new Logger(ShopifyController.name);

  constructor(
    private readonly shopifyService: ShopifyService,
    private readonly configService: ConfigService,
  ) {}

  // ── OAuth Flow ──────────────────────────────────────────────

  /**
   * Step 1: Redirect user to Shopify OAuth consent screen.
   * GET /shopify/auth?shop=mystore.myshopify.com
   * Protected by JwtAuthGuard — the user's identity is encoded in state.
   */
  @Get('auth')
  @UseGuards(JwtAuthGuard)
  async startOAuth(
    @Query('shop') shopDomain: string,
    @CurrentUser() user: AuthedUser,
    @Res() res: any,
  ) {
    if (!shopDomain) {
      throw new BadRequestException('shop parameter is verplicht');
    }

    const clientId = this.configService.get<string>('SHOPIFY_CLIENT_ID');
    if (!clientId) {
      throw new BadRequestException('Shopify OAuth is niet geconfigureerd');
    }

    const shop = shopDomain.includes('.myshopify.com') ? shopDomain : `${shopDomain}.myshopify.com`;

    const redirectUri = this.configService.get<string>(
      'SHOPIFY_REDIRECT_URI',
      `${this.configService.get<string>('FRONTEND_URL', 'http://localhost:8080')}/api/shopify/auth/callback`,
    );

    const scopes = 'read_orders,read_customers,read_products';

    // Encode user identity in state so the callback can identify who initiated the flow
    const state = Buffer.from(
      JSON.stringify({ userId: user.userId, orgId: user.orgId, shop }),
    ).toString('base64url');

    const authUrl =
      `https://${shop}/admin/oauth/authorize` +
      `?client_id=${clientId}` +
      `&scope=${scopes}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`;

    this.logger.log(`Shopify OAuth: redirecting to ${shop} for user ${user.userId}`);
    return res.redirect(302, authUrl);
  }

  /**
   * Step 2: Shopify redirects back here with an authorization code.
   * GET /shopify/auth/callback?code=...&shop=...&state=...
   * Exchanges the code for a permanent access token.
   */
  @Get('auth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('shop') shop: string,
    @Query('state') state: string,
    @Res() res: any,
  ) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:8080');

    try {
      if (!code || !shop) {
        throw new BadRequestException('Ongeldige callback parameters');
      }

      // Decode state to recover user identity and verify shop
      let stateData: { userId: string; orgId: string; shop: string };
      try {
        stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      } catch {
        throw new BadRequestException('Ongeldige state parameter');
      }

      if (!stateData.userId || !stateData.orgId) {
        throw new BadRequestException('Sessie verlopen — log opnieuw in');
      }

      // Exchange the code for an access token
      await this.shopifyService.exchangeOAuthCode(shop, code, stateData.userId, stateData.orgId);

      this.logger.log(`Shopify OAuth complete: ${shop} connected`);

      // Redirect back to the integrations page with success
      return res.redirect(302, `${frontendUrl}/integraties?shopify=connected`);
    } catch (err) {
      this.logger.error(`Shopify OAuth callback error: ${err.message}`);
      return res.redirect(
        302,
        `${frontendUrl}/integraties?shopify=error&message=${encodeURIComponent(err.message)}`,
      );
    }
  }

  // ── Direct Token Flow (legacy / Custom Apps) ──────────────

  /**
   * Connect a Shopify store with a direct access token (Custom App).
   */
  @Post('connect')
  @UseGuards(JwtAuthGuard)
  async connect(@CurrentUser() user: AuthedUser, @Body() body: ConnectShopifyDto) {
    return this.shopifyService.connectWithToken(
      user.orgId,
      body.shop,
      body.access_token,
      user.userId,
    );
  }

  /**
   * Disconnect Shopify from this workspace.
   */
  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  async disconnect(@CurrentUser() user: AuthedUser) {
    return this.shopifyService.disconnect(user.orgId);
  }

  /**
   * Check Shopify connection status.
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async status(@CurrentUser() user: AuthedUser) {
    return this.shopifyService.getConnectionStatus(user.orgId);
  }

  /**
   * Search orders by customer email.
   */
  @Get('orders')
  @UseGuards(JwtAuthGuard)
  async searchOrders(@CurrentUser() user: AuthedUser, @Query('email') email: string) {
    return this.shopifyService.searchOrders(user.orgId, email);
  }

  /**
   * Get a single order by ID.
   */
  @Get('orders/:id')
  @UseGuards(JwtAuthGuard)
  async getOrder(@CurrentUser() user: AuthedUser, @Param('id') orderId: string) {
    return this.shopifyService.getOrder(user.orgId, orderId);
  }

  /**
   * Search customers by email.
   */
  @Get('customers')
  @UseGuards(JwtAuthGuard)
  async searchCustomers(@CurrentUser() user: AuthedUser, @Query('email') email: string) {
    return this.shopifyService.searchCustomers(user.orgId, email);
  }

  /**
   * Get full customer context (customer + orders) for the dashboard.
   */
  @Get('context')
  @UseGuards(JwtAuthGuard)
  async getCustomerContext(@CurrentUser() user: AuthedUser, @Query('email') email: string) {
    return this.shopifyService.getCustomerContext(user.orgId, email);
  }
}
