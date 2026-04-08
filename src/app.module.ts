import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { AiModule } from './ai/ai.module';
import { ContactsModule } from './contacts/contacts.module';
import { ConversationsModule } from './conversations/conversations.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { ServicesModule } from './services/services.module';
import { SalesModule } from './sales/sales.module';
import { RemindersModule } from './reminders/reminders.module';
import { BusinessModule } from './business/business.module';
import { StaffModule } from './staff/staff.module';
import { BranchModule } from './branches/branch.module';
import { AdminModule } from './admin/admin.module';
import { OwnerModule } from './owner/owner.module';
import { GoogleCalendarModule } from './google-calendar/google-calendar.module';

@Module({
  imports: [
    // Load .env variables globally
    ConfigModule.forRoot({ isGlobal: true }),
    // Enable @Cron decorators globally
    ScheduleModule.forRoot(),
    // Database
    PrismaModule,
    // Domain modules
    BusinessModule,
    ContactsModule,
    ConversationsModule,
    ServicesModule,
    AppointmentsModule,
    SalesModule,
    StaffModule,
    BranchModule,
    AdminModule,
    OwnerModule,
    // Integration modules
    AiModule,
    WhatsappModule,
    RemindersModule,
    GoogleCalendarModule,
  ],
})
export class AppModule {}
