import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { GmailController } from './gmail.controller';
import { GmailService } from '../auth/gmail.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule, AuthModule],
  controllers: [InboxController, GmailController],
  providers: [InboxService, GmailService],
  exports: [InboxService, GmailService],
})
export class InboxModule {}
