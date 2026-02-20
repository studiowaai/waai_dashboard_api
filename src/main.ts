import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  const configService = app.get(ConfigService);
  const apiName = configService.get<string>('API_NAME', 'n8n Dashboard API');
  const corsOrigins = configService.get<string>('CORS_ORIGIN', 'http://localhost:8000');
  const corsOriginRegex = configService.get<string>('CORS_ORIGIN_REGEX');

  logger.log(`🚀 Starting ${apiName}`);
  logger.log(`🌐 CORS Origins configured: ${corsOrigins}`);
  logger.log(`🌐 CORS Origin Regex: ${corsOriginRegex || 'Not set'}`);

  // Validate CORS configuration
  if (corsOrigins.includes('*')) {
    logger.error("❌ CRITICAL: Wildcard '*' detected in CORS_ORIGIN with credentials=True");
    logger.error('❌ This will cause CORS errors in the browser');
  }

  if (corsOriginRegex) {
    logger.log(`📍 CORS Mode: Using regex pattern '${corsOriginRegex}'`);
  } else {
    logger.log(`📍 CORS Mode: Using explicit origins ${corsOrigins}`);
  }

  // Register plugins
  await app.register(fastifyCookie);
  await app.register(fastifyMultipart);

  // CORS Configuration
  const originList = corsOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOriginRegex ? new RegExp(corsOriginRegex) : originList,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');

  logger.log(`✅ Application is running on: http://localhost:${port}`);
}

bootstrap();
