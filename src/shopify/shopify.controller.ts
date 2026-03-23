import { Controller, Get, Post, Delete, Query, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';
import { ShopifyService } from './shopify.service';
import { IsString } from 'class-validator';

class ConnectShopifyDto {
  @IsString()
  shop: string;

  @IsString()
  access_token: string;
}

@Controller('shopify')
@UseGuards(JwtAuthGuard)
export class ShopifyController {
  constructor(private readonly shopifyService: ShopifyService) {}

  /**
   * Connect a Shopify store with a direct access token (Custom App).
   * The token is verified against the Shopify API, then stored.
   */
  @Post('connect')
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
  async disconnect(@CurrentUser() user: AuthedUser) {
    return this.shopifyService.disconnect(user.orgId);
  }

  /**
   * Check Shopify connection status.
   */
  @Get('status')
  async status(@CurrentUser() user: AuthedUser) {
    return this.shopifyService.getConnectionStatus(user.orgId);
  }

  /**
   * Search orders by customer email.
   */
  @Get('orders')
  async searchOrders(@CurrentUser() user: AuthedUser, @Query('email') email: string) {
    return this.shopifyService.searchOrders(user.orgId, email);
  }

  /**
   * Get a single order by ID.
   */
  @Get('orders/:id')
  async getOrder(@CurrentUser() user: AuthedUser, @Param('id') orderId: string) {
    return this.shopifyService.getOrder(user.orgId, orderId);
  }

  /**
   * Search customers by email.
   */
  @Get('customers')
  async searchCustomers(@CurrentUser() user: AuthedUser, @Query('email') email: string) {
    return this.shopifyService.searchCustomers(user.orgId, email);
  }

  /**
   * Get full customer context (customer + orders) for the dashboard.
   */
  @Get('context')
  async getCustomerContext(@CurrentUser() user: AuthedUser, @Query('email') email: string) {
    return this.shopifyService.getCustomerContext(user.orgId, email);
  }
}
