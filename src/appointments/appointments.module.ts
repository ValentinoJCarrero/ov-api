import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { ServicesModule } from '../services/services.module';
import { BusinessModule } from '../business/business.module';
import { ContactsModule } from '../contacts/contacts.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';

@Module({
  imports: [ServicesModule, BusinessModule, ContactsModule, GoogleCalendarModule],
  providers: [AppointmentsService],
  controllers: [AppointmentsController],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
