import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { AdminConversationsController } from './admin-conversations.controller';
import { ActionDispatcherService } from './action-dispatcher.service';
import { OvapyDispatcherService } from './ovapy-dispatcher.service';
import { StaffSelfServiceDispatcherService } from './staff-self-service-dispatcher.service';
import { AiModule } from '../ai/ai.module';
import { BusinessModule } from '../business/business.module';
import { ContactsModule } from '../contacts/contacts.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { ServicesModule } from '../services/services.module';
import { SalesModule } from '../sales/sales.module';
import { StaffModule } from '../staff/staff.module';
import { BranchModule } from '../branches/branch.module';

@Module({
  imports: [
    AiModule,
    BusinessModule,
    ContactsModule,
    ConversationsModule,
    AppointmentsModule,
    ServicesModule,
    SalesModule,
    StaffModule,
    BranchModule,
  ],
  providers: [WhatsappService, ActionDispatcherService, OvapyDispatcherService, StaffSelfServiceDispatcherService],
  controllers: [WhatsappController, AdminConversationsController],
  exports: [WhatsappService],
})
export class WhatsappModule {}
