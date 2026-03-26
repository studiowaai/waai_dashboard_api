import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShopifyController } from './shopify.controller';
import { ShopifyService } from './shopify.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule,
    AuthModule,
  ],
  controllers: [ShopifyController],
  providers: [ShopifyService],
  exports: [ShopifyService],
})
export class ShopifyModule {}
