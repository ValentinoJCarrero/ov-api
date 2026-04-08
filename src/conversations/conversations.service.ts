import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Conversation, Message, MessageDirection, MessageType } from '@prisma/client';
import { ConversationState } from '../ai/types/intent.types';

export interface ConversationSummary {
  id: string;
  status: string;
  humanMode: boolean;
  lastMessageAt: Date;
  lastMessagePreview: string | null;
  contact: { id: string; name: string | null; phone: string };
}

interface SaveMessageParams {
  conversationId: string;
  businessId: string;
  contactId: string;
  direction: MessageDirection;
  type?: MessageType;
  content: string;
  rawPayload?: object;
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds the most recent OPEN conversation for this contact+business pair.
   * Creates a new one if none exists.
   */
  async findOrCreateOpen(businessId: string, contactId: string): Promise<Conversation> {
    const existing = await this.prisma.conversation.findFirst({
      where: { businessId, contactId, status: 'OPEN' },
      orderBy: { lastMessageAt: 'desc' },
    });

    if (existing) {
      return existing;
    }

    this.logger.log(`Creating new conversation for contact ${contactId}`);
    return this.prisma.conversation.create({
      data: { businessId, contactId, status: 'OPEN' },
    });
  }

  /**
   * Saves a message and updates the conversation's lastMessageAt atomically.
   */
  async saveMessage(params: SaveMessageParams): Promise<Message> {
    const { conversationId, businessId, contactId, direction, type = 'TEXT', content, rawPayload } = params;

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId,
          businessId,
          contactId,
          direction,
          type,
          content,
          rawPayload: rawPayload as any,
        },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    return message;
  }

  async closeConversation(conversationId: string): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'CLOSED' },
    });
  }

  async getRecentMessages(conversationId: string, limit = 10): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Updates the conversation state (used for multi-turn booking flows).
   * Pass null to clear the state after the flow completes.
   */
  async updateState(conversationId: string, state: ConversationState | null): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { state: state as any },
    });
  }

  async getState(conversationId: string): Promise<ConversationState | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { state: true },
    });
    return (conv?.state as unknown as ConversationState) ?? null;
  }

  /**
   * Returns all conversations for a business, sorted by last message descending.
   * Includes contact info and a preview of the last message.
   */
  async listForAdmin(businessId: string): Promise<ConversationSummary[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: { businessId },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true },
        },
      },
    });

    return conversations.map((c) => ({
      id: c.id,
      status: c.status,
      humanMode: c.humanMode,
      lastMessageAt: c.lastMessageAt,
      lastMessagePreview: c.messages[0]?.content ?? null,
      contact: c.contact,
    }));
  }

  /**
   * Returns all messages for a conversation, ordered oldest-first.
   */
  async getMessages(conversationId: string): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Sets the humanMode flag. When true, AI is skipped for this conversation.
   */
  async setHumanMode(conversationId: string, humanMode: boolean): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { humanMode },
    });
  }

  /**
   * Deletes all messages in a conversation and resets its state.
   * Used from the admin panel to start fresh (testing / clean slate).
   */
  async resetConversation(conversationId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.message.deleteMany({ where: { conversationId } }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { state: null, humanMode: false, lastMessageAt: new Date() },
      }),
    ]);
  }

  async isHumanMode(conversationId: string): Promise<boolean> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { humanMode: true },
    });
    return conv?.humanMode ?? false;
  }
}
