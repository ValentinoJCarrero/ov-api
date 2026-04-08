import {
  Controller, Get, Post, Patch, Delete, Param, Body,
  UseGuards, Req, UnauthorizedException, NotFoundException,
  BadRequestException, Logger,
} from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { OwnerGuard, OwnerJwtPayload } from './owner.guard';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';

@ApiTags('Owner Dashboard')
@Controller('owner')
export class OwnerController {
  private readonly logger = new Logger(OwnerController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationsService: ConversationsService,
    private readonly whatsappService: WhatsappService,
  ) {}

  // ── Auth ──────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Login con teléfono + PIN' })
  @Post('login')
  async login(@Body() body: { identity: string; password: string }) {
    if (!body.identity || !body.password) {
      throw new BadRequestException('identity y password son requeridos');
    }

    const phone = body.identity.replace(/\D/g, '');
    const staff = await this.prisma.staff.findFirst({
      where: { phone, role: 'OWNER', isActive: true },
    });

    if (!staff || !staff.ownerPin) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const valid = await bcrypt.compare(body.password, staff.ownerPin);
    if (!valid) throw new UnauthorizedException('Credenciales inválidas');

    const secret = process.env.OWNER_JWT_SECRET ?? 'ovapy-owner-secret';
    const token = jwt.sign(
      { staffId: staff.id, businessId: staff.businessId, phone: staff.phone },
      secret,
      { expiresIn: '30d' },
    );

    this.logger.log(`Owner login: ${staff.name} (${staff.phone})`);
    return { token, name: staff.name, businessId: staff.businessId };
  }

  // ── Me ────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Datos del owner autenticado' })
  @ApiBearerAuth()
  @UseGuards(OwnerGuard)
  @Get('me')
  async me(@Req() req: Request) {
    const owner = (req as any).owner as OwnerJwtPayload;
    const staff = await this.prisma.staff.findUnique({
      where: { id: owner.staffId },
      select: { id: true, name: true, phone: true, businessId: true },
    });
    const business = await this.prisma.business.findUnique({
      where: { id: owner.businessId },
      select: { id: true, name: true },
    });
    return { staff, business };
  }

  // ── Conversations ─────────────────────────────────────────────

  @ApiOperation({ summary: 'Listar conversaciones del negocio' })
  @ApiBearerAuth()
  @UseGuards(OwnerGuard)
  @Get('conversations')
  async listConversations(@Req() req: Request) {
    const { businessId } = (req as any).owner as OwnerJwtPayload;
    return this.conversationsService.listForAdmin(businessId);
  }

  @ApiOperation({ summary: 'Mensajes de una conversación' })
  @ApiParam({ name: 'id' })
  @ApiBearerAuth()
  @UseGuards(OwnerGuard)
  @Get('conversations/:id/messages')
  async getMessages(@Param('id') id: string, @Req() req: Request) {
    await this.assertOwnsConversation(id, (req as any).owner);
    return this.conversationsService.getMessages(id);
  }

  @ApiOperation({ summary: 'Enviar mensaje al cliente' })
  @ApiParam({ name: 'id' })
  @ApiBearerAuth()
  @UseGuards(OwnerGuard)
  @Post('conversations/:id/reply')
  async reply(@Param('id') id: string, @Body() body: { text: string }, @Req() req: Request) {
    if (!body.text?.trim()) throw new BadRequestException('text es requerido');
    await this.assertOwnsConversation(id, (req as any).owner);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: { contact: true, business: true },
    });
    if (!conversation) throw new NotFoundException('Conversación no encontrada');

    const { contact, business } = conversation;
    const token = business.waToken ?? process.env.WHATSAPP_TOKEN;
    await this.whatsappService.sendMessage(contact.phone, body.text, business.waPhoneNumberId ?? undefined, token);
    await this.conversationsService.saveMessage({
      conversationId: id,
      businessId: business.id,
      contactId: contact.id,
      direction: 'OUTBOUND',
      type: 'TEXT',
      content: body.text,
    });

    return { status: 'sent' };
  }

  @ApiOperation({ summary: 'Activar/desactivar modo manual' })
  @ApiParam({ name: 'id' })
  @ApiBearerAuth()
  @UseGuards(OwnerGuard)
  @Patch('conversations/:id/human-mode')
  async setHumanMode(@Param('id') id: string, @Body() body: { humanMode: boolean }, @Req() req: Request) {
    if (typeof body.humanMode !== 'boolean') throw new BadRequestException('humanMode must be boolean');
    await this.assertOwnsConversation(id, (req as any).owner);
    const updated = await this.conversationsService.setHumanMode(id, body.humanMode);
    return { id: updated.id, humanMode: updated.humanMode };
  }

  @ApiOperation({ summary: 'Resetear estado de conversación' })
  @ApiParam({ name: 'id' })
  @ApiBearerAuth()
  @UseGuards(OwnerGuard)
  @Delete('conversations/:id/reset')
  async reset(@Param('id') id: string, @Req() req: Request) {
    await this.assertOwnsConversation(id, (req as any).owner);
    await this.conversationsService.resetConversation(id);
    return { status: 'reset' };
  }

  // ── Helper ────────────────────────────────────────────────────

  private async assertOwnsConversation(conversationId: string, owner: OwnerJwtPayload) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.businessId !== owner.businessId) {
      throw new NotFoundException('Conversación no encontrada');
    }
  }
}
