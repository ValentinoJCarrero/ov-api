import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Response } from 'express';
import { WhatsappService } from './whatsapp.service';
import { WhatsappWebhookPayload } from './dto/whatsapp-webhook.dto';

@ApiTags('Webhook')
@Controller('webhook')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(private readonly whatsappService: WhatsappService) {}

  /**
   * GET /webhook
   * WhatsApp webhook verification endpoint.
   * Meta sends this request when you register/update the webhook URL in the developer dashboard.
   */
  @ApiOperation({ summary: 'Verificación del webhook (Meta llama esto al registrar)' })
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (!expectedToken) {
      this.logger.warn('WHATSAPP_VERIFY_TOKEN not configured. Set it in .env before registering the webhook.');
      res.status(500).json({ error: 'WHATSAPP_VERIFY_TOKEN not configured' });
      return;
    }

    if (mode === 'subscribe' && verifyToken === expectedToken) {
      this.logger.log('Webhook verified successfully');
      res.status(200).send(challenge);
    } else {
      this.logger.warn(`Webhook verification failed. Token mismatch or wrong mode: ${mode}`);
      res.status(403).json({ error: 'Forbidden' });
    }
  }

  /**
   * POST /webhook
   * Receives inbound messages and status updates from WhatsApp.
   * Must return 200 IMMEDIATELY — processing happens asynchronously.
   * If we take too long, Meta will retry the webhook and we'll get duplicate messages.
   */
  @ApiOperation({ summary: 'Recibe eventos de WhatsApp (mensajes entrantes, status updates)' })
  @Post()
  @HttpCode(200)
  handleWebhook(@Body() payload: WhatsappWebhookPayload) {
    // Fire and forget — we return 200 right away
    this.whatsappService.processInbound(payload).catch((err) => {
      this.logger.error('Unhandled error in processInbound', err?.message);
    });

    return { status: 'ok' };
  }
}
