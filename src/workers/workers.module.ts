import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GmailSyncProcessor } from './gmail-sync.processor';
import { AiProcessor } from './ai.processor';
import { GmailModule } from '../gmail/gmail.module';
import { AiModule } from '../ai/ai.module';

export const GMAIL_SYNC_QUEUE = 'gmail-sync';
export const AI_QUEUE = 'ai-processing';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: new URL(config.get<string>('REDIS_URL', 'redis://localhost:6379')).hostname,
          port: parseInt(
            new URL(config.get<string>('REDIS_URL', 'redis://localhost:6379')).port || '6379',
          ),
        },
      }),
    }),
    BullModule.registerQueue({ name: GMAIL_SYNC_QUEUE }, { name: AI_QUEUE }),
    TypeOrmModule,
    GmailModule,
    AiModule,
  ],
  providers: [GmailSyncProcessor, AiProcessor],
  exports: [BullModule],
})
export class WorkersModule {}
