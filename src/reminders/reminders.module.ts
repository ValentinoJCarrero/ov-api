import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { AppointmentsModule } from '../appointments/appointments.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { BusinessModule } from '../business/business.module';

@Module({
  imports: [AppointmentsModule, WhatsappModule, BusinessModule],
  providers: [RemindersService],
})
export class RemindersModule {}
