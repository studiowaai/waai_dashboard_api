import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GmailController } from './gmail.controller';
import { GmailSyncService } from './gmail-sync.service';
import { GmailService } from '../auth/gmail.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule, AuthModule],
  controllers: [GmailController],
  providers: [GmailService, GmailSyncService],
  exports: [GmailService, GmailSyncService],
})
export class GmailModule {}
