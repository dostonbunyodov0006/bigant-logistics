import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';
import { UploadService } from './upload/upload.service';

/** Proof photos are posted as base64 JSON, so the default 100kb body cap is far
 *  too small. */
const BODY_LIMIT = '10mb';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Nest's own body-parser hook rather than `require('express')`: express is only
  // a transitive dependency (via @nestjs/platform-express) and pnpm does not
  // hoist those, so requiring it directly fails to resolve outside a warm
  // dev process — including in the production image.
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });
  const config = app.get(ConfigService<Env, true>);

  app.use(helmet());
  // Behind nginx the socket peer is the proxy; the client address is in
  // X-Forwarded-For, which nginx sets. Rate limits are per client, not per proxy.
  app.set('trust proxy', 1);

  const logger = new Logger('Bootstrap');
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  // Fail closed in production: an unset allowlist used to reflect *any* origin
  // with credentials enabled. Same-origin deployments (web served from the same
  // host as /api) and the native mobile app need no CORS at all, so `false` is
  // the correct default — set CORS_ORIGINS only to allow a different host.
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });
  const allowedOrigins = corsOrigins
    ? corsOrigins.split(',').map((o) => o.trim())
    : isProduction
      ? false
      : true;
  app.enableCors({ origin: allowedOrigins, credentials: true });
  if (isProduction && !corsOrigins) {
    logger.warn('CORS_ORIGINS is unset: cross-origin browser requests are refused.');
  }

  // The schema documents every endpoint and payload shape, so it stays off in
  // production unless explicitly opted into.
  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('BIGANT Logistics API')
      .setDescription('Internal Logistics Automation System — backend API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  // Photos stored on disk. In production nginx serves this directory at /media
  // itself; this covers development, where the API is the only server. The
  // dashboard runs on another origin there, so lift helmet's same-origin CORP.
  app.useStaticAssets(app.get(UploadService).mediaDir, {
    prefix: '/media/',
    index: false,
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  });

  const port = config.get('PORT', { infer: true });
  // Behind nginx; binding all interfaces is what lets the proxy container reach it.
  // SIGTERM from a deploy runs the shutdown hooks: timers stop and the
  // worker lease is let go, so the new backend picks the work up at once.
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');
  logger.log(
    `Logistics backend on port ${port}` + (isProduction ? '' : ' (docs at /docs)'),
  );
}

void bootstrap();
