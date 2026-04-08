import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Headers,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConversationsService } from '../conversations/conversations.service';
import { BusinessService } from '../business/business.service';
import { WhatsappService } from './whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiTags, ApiOperation, ApiSecurity, ApiHeader, ApiParam } from '@nestjs/swagger';

@ApiTags('Conversations')
@ApiSecurity('X-Admin-Api-Key')
@ApiHeader({ name: 'X-Business-Id', required: false, description: 'ID del negocio' })
@Controller('admin/conversations')
export class AdminConversationsController {
  private readonly logger = new Logger(AdminConversationsController.name);

  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly businessService: BusinessService,
    private readonly whatsappService: WhatsappService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiOperation({ summary: 'Listar conversaciones del negocio (orden: último mensaje)' })
  @Get()
  async list(@Headers('x-business-id') businessId?: string) {
    const business = await this.businessService.resolveBusiness(businessId);
    return this.conversationsService.listForAdmin(business.id);
  }

  @ApiOperation({ summary: 'Mensajes de una conversación (más antiguos primero)' })
  @ApiParam({ name: 'id', description: 'ID de la conversación' })
  @Get(':id/messages')
  async messages(@Param('id') id: string) {
    const msgs = await this.conversationsService.getMessages(id);
    return msgs;
  }

  @ApiOperation({ summary: 'Enviar mensaje manual al cliente (inbox)' })
  @ApiParam({ name: 'id', description: 'ID de la conversación' })
  @Post(':id/reply')
  async reply(@Param('id') id: string, @Body() body: { text: string }) {
    if (!body.text?.trim()) {
      throw new BadRequestException('text is required');
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: { contact: true, business: true },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const { contact, business } = conversation;
    const token = business.waToken ?? process.env.WHATSAPP_TOKEN;
    const phoneNumberId = business.waPhoneNumberId ?? undefined;

    await this.whatsappService.sendMessage(contact.phone, body.text, phoneNumberId, token);

    await this.conversationsService.saveMessage({
      conversationId: id,
      businessId: business.id,
      contactId: contact.id,
      direction: 'OUTBOUND',
      type: 'TEXT',
      content: body.text,
    });

    this.logger.log(`Admin reply to ${contact.phone}: "${body.text.substring(0, 60)}"`);
    return { status: 'sent' };
  }

  /**
   * PATCH /admin/conversations/:id/human-mode
   * Enables or disables human mode for a conversation.
   * Body: { humanMode: boolean }
   */
  @ApiOperation({ summary: 'Resetear estado de la conversación (borra state machine)' })
  @ApiParam({ name: 'id', description: 'ID de la conversación' })
  @Delete(':id/reset')
  async reset(@Param('id') id: string) {
    await this.conversationsService.resetConversation(id);
    return { status: 'reset' };
  }

  @ApiOperation({ summary: 'Activar/desactivar modo manual (deshabilita la IA para esa conversación)' })
  @ApiParam({ name: 'id', description: 'ID de la conversación' })
  @Patch(':id/human-mode')
  async setHumanMode(@Param('id') id: string, @Body() body: { humanMode: boolean }) {
    if (typeof body.humanMode !== 'boolean') {
      throw new BadRequestException('humanMode must be a boolean');
    }
    const updated = await this.conversationsService.setHumanMode(id, body.humanMode);
    return { id: updated.id, humanMode: updated.humanMode };
  }
}
