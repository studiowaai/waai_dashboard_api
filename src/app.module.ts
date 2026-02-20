import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { MeModule } from './me/me.module';
import { StatsModule } from './stats/stats.module';
import { RunsModule } from './runs/runs.module';
import { AdminModule } from './admin/admin.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { PromptsModule } from './prompts/prompts.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('DATABASE_URL');

        if (!databaseUrl) {
          console.warn('⚠️  DATABASE_URL not set - database functionality will not work');
          return {
            type: 'postgres',
            autoLoadEntities: true,
          };
        }

        // Parse PostgreSQL connection URL
        const url = new URL(databaseUrl);

        return {
          type: 'postgres' as const,
          host: url.hostname,
          port: parseInt(url.port) || 5432,
          username: url.username,
          password: url.password,
          database: url.pathname.slice(1),
          entities: [],
          synchronize: false, // Don't auto-sync, use migrations
          logging: false,
          ssl: url.searchParams.get('sslmode') ? { rejectUnauthorized: false } : false,
        };
      },
    }),
    AuthModule,
    MeModule,
    StatsModule,
    RunsModule,
    AdminModule,
    ApprovalsModule,
    PromptsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
