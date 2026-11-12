import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

/**
 * Exports the OpenAPI spec to apps/backend/openapi.json without a running
 * database (set OPENAPI_EXPORT=1). Phase 2/3 generate the typed HTTP client
 * for web & mobile from this spec; entity types already live in @bigant/shared.
 */
async function exportSpec(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  const config = new DocumentBuilder()
    .setTitle('BIGANT Logistics API')
    .setDescription('Internal Logistics Automation System — backend API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  const outPath = join(__dirname, '..', 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2));
  await app.close();
  console.log(`OpenAPI spec written to ${outPath}`);
}

exportSpec().catch((err) => {
  console.error(err);
  process.exit(1);
});
