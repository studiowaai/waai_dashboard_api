import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller()
export class HealthController {
  constructor(private configService: ConfigService) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  @Get('debug/cors')
  debugCors() {
    return {
      CORS_ORIGIN_env: process.env.CORS_ORIGIN || 'NOT SET',
      CORS_ORIGIN_REGEX_env: process.env.CORS_ORIGIN_REGEX || 'NOT SET',
      CORS_ORIGINS_config: this.configService.get<string>('CORS_ORIGIN'),
      CORS_ORIGIN_REGEX_config: this.configService.get<string>('CORS_ORIGIN_REGEX'),
      all_env_vars: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => key.includes('CORS') || key.includes('DATABASE') || key.includes('JWT'),
        ),
      ),
    };
  }
}
