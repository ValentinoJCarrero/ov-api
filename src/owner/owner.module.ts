import { Module } from '@nestjs/common';
import { OwnerController } from './owner.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [PrismaModule, ConversationsModule, WhatsappModule],
  controllers: [OwnerController],
})
export class OwnerModule {}
