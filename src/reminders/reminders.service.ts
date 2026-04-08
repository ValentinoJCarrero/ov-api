import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { BusinessService } from '../business/business.service';
import { toZonedTime, format } from 'date-fns-tz';

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentsService: AppointmentsService,
    private readonly whatsappService: WhatsappService,
    private readonly businessService: BusinessService,
  ) {}

  /**
   * Runs every hour at minute 0.
   * Finds appointments due for a reminder (within the next 24h, not yet reminded),
   * sends a WhatsApp message, and logs the result.
   *
   * Idempotency: the `reminderSentAt IS NULL` condition ensures we never double-send,
   * even if the cron runs multiple times (e.g., after a restart).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sendReminders(): Promise<void> {
    this.logger.log('Running reminders cron job...');

    try {
      const business = await this.businessService.getDefaultBusiness();
      const appointments = await this.appointmentsService.findAppointmentsDueForReminder(
        business.id,
      );

      if (!appointments.length) {
        this.logger.log('No reminders to send.');
        return;
      }

      this.logger.log(`Found ${appointments.length} appointment(s) to remind.`);

      for (const appt of appointments) {
        await this.processReminder(appt, business);
      }
    } catch (err) {
      this.logger.error('Reminders cron job failed', err?.message);
    }
  }

  private async processReminder(appt: any, business: any): Promise<void> {
    const contact = appt.contact;

    if (!contact?.phone) {
      this.logger.warn(`Appointment ${appt.id} has no contact phone. Skipping reminder.`);
      return;
    }

    // Skip walk-in contacts (no real phone number)
    if (contact.phone.startsWith('walkin-')) {
      this.logger.log(`Skipping reminder for walk-in contact on appointment ${appt.id}`);
      return;
    }

    const tz = business.timezone;
    const zonedStart = toZonedTime(appt.startsAt, tz);
    const displayDate = format(zonedStart, 'dd/MM/yyyy', { timeZone: tz });
    const displayTime = format(zonedStart, 'HH:mm', { timeZone: tz });
    const clientName = contact.name ?? 'Cliente';
    const serviceName = appt.service?.name ?? 'turno';

    const token = business.waToken ?? process.env.WHATSAPP_TOKEN;
    const phoneNumberId = business.waPhoneNumberId ?? undefined;

    try {
      if (business.waReminderTemplate) {
        // Use approved Meta template with Quick Reply buttons
        await this.whatsappService.sendTemplateMessage({
          to: contact.phone,
          templateName: business.waReminderTemplate,
          bodyParams: [clientName, serviceName, displayDate, displayTime],
          buttonPayloads: [`confirm_${appt.id}`, `cancel_${appt.id}`],
          phoneNumberId,
          token,
        });
      } else {
        // Fallback: free-form text (only works within 24h customer-initiated window)
        const message = `⏰ Hola ${clientName}! Te recordamos que tenés *${serviceName}* mañana ${displayDate} a las ${displayTime}hs en ${business.name}.\n\n¿Algún problema? Escribinos y te ayudamos a reagendar.`;
        await this.whatsappService.sendMessage(contact.phone, message, phoneNumberId, token);
      }

      await this.prisma.$transaction([
        this.prisma.appointment.update({
          where: { id: appt.id },
          data: { reminderSentAt: new Date() },
        }),
        this.prisma.reminderLog.create({
          data: {
            appointmentId: appt.id,
            businessId: business.id,
            sentAt: new Date(),
            status: 'SENT',
            payload: {
              phone: contact.phone,
              template: business.waReminderTemplate ?? null,
            },
          },
        }),
      ]);

      this.logger.log(`Reminder sent for appointment ${appt.id} to ${contact.phone}`);
    } catch (err) {
      this.logger.error(`Reminder failed for appointment ${appt.id}`, err?.message);

      await this.prisma.reminderLog.create({
        data: {
          appointmentId: appt.id,
          businessId: business.id,
          sentAt: new Date(),
          status: 'FAILED',
          payload: { error: err?.message },
        },
      });
    }
  }
}
