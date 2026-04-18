import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminGuard } from './common/guards/admin.guard';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Api-Key', 'X-Business-Id', 'ngrok-skip-browser-warning'],
  });

  // Protect all /admin/* routes with API key guard
  app.useGlobalGuards(new AdminGuard());

  // Enable class-validator globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,       // Strip properties not in DTO
      transform: true,       // Auto-transform payloads to DTO types
      forbidNonWhitelisted: false,
    }),
  );

  // Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Ovapy API')
    .setDescription('API para gestión de negocios, turnos, staff y WhatsApp')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Admin-Api-Key' }, 'X-Admin-Api-Key')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Business-Id', description: 'ID del negocio seleccionado (opcional, usa el primero si se omite)' }, 'X-Business-Id')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  app.getHttpAdapter().get('/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(`Application running on http://localhost:${port}`);
  logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
  logger.log(`Webhook URL:  http://localhost:${port}/webhook`);
  logger.log(`Admin API:    http://localhost:${port}/admin/*`);
}

bootstrap();
