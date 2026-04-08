import { Injectable, Logger } from '@nestjs/common';
import { Business, Staff } from '@prisma/client';
import { Intent, IntentEntities } from '../ai/types/intent.types';
import { AppointmentsService } from '../appointments/appointments.service';
import { ServicesService } from '../services/services.service';
import { ContactsService } from '../contacts/contacts.service';
import { fromZonedTime, toZonedTime, format } from 'date-fns-tz';
import { addMinutes } from 'date-fns';

export interface StaffSelfServiceContext {
  intent: Intent;
  entities: IntentEntities;
  staffMember: Staff;
  business: Business;
}

@Injectable()
export class StaffSelfServiceDispatcherService {
  private readonly logger = new Logger(StaffSelfServiceDispatcherService.name);

  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly servicesService: ServicesService,
    private readonly contactsService: ContactsService,
  ) {}

  async dispatch(ctx: StaffSelfServiceContext): Promise<string> {
    const { intent, staffMember } = ctx;

    try {
      switch (intent) {
        case 'MY_APPOINTMENTS':
          return this.handleMyAppointments(ctx);
        case 'BOOK_APPOINTMENT':
          return this.handleBook(ctx);
        case 'RESCHEDULE_APPOINTMENT':
          return this.handleReschedule(ctx);
        case 'CANCEL_APPOINTMENT':
          return this.handleCancel(ctx);
        default:
          return this.handleUnknown(staffMember.name);
      }
    } catch (err) {
      this.logger.error(`Staff self-service error for intent ${intent}`, err?.message);
      if (err?.message?.includes('disponible') || err?.status === 409) {
        return err.message;
      }
      return 'Ocurrió un error. Intentá de nuevo.';
    }
  }

  // ─────────────────────────────────────────────────────────────
  // VER AGENDA
  // ─────────────────────────────────────────────────────────────

  private async handleMyAppointments(ctx: StaffSelfServiceContext): Promise<string> {
    const { staffMember, business, entities } = ctx;
    const tz = business.timezone;

    const dateStr =
      entities.date ?? format(toZonedTime(new Date(), tz), 'yyyy-MM-dd', { timeZone: tz });

    const appointments = await this.appointmentsService.findTodayByStaff(staffMember.id, tz);

    if (!appointments.length) {
      const label = entities.date ? `el ${this.formatDate(dateStr)}` : 'hoy';
      return `📅 No tenés turnos ${label}, ${staffMember.name}.`;
    }

    const lines = appointments.map((a: any) => {
      const time = format(toZonedTime(a.startsAt, tz), 'HH:mm', { timeZone: tz });
      const endTime = format(toZonedTime(a.endsAt, tz), 'HH:mm', { timeZone: tz });
      const client = a.contact?.name ?? a.contact?.phone ?? 'Sin nombre';
      const service = a.resolvedServiceNames?.join(' + ') ?? a.service?.name ?? '-';
      return `• ${time}–${endTime}hs — *${client}* (${service})`;
    });

    return `📅 Tu agenda de hoy, ${staffMember.name}:\n\n${lines.join('\n')}\n\nPara mover un turno: "mover el de las 10 para las 15"\nPara cancelar: "cancelar el de las 14"`;
  }

  // ─────────────────────────────────────────────────────────────
  // AGENDAR TURNO PARA UN CLIENTE
  // ─────────────────────────────────────────────────────────────

  private async handleBook(ctx: StaffSelfServiceContext): Promise<string> {
    const { staffMember, business, entities } = ctx;

    const missing: string[] = [];
    if (!entities.service) missing.push('servicio');
    if (!entities.date) missing.push('fecha');
    if (!entities.time) missing.push('horario');

    if (missing.length > 0) {
      const services = await this.servicesService.listActive(business.id);
      const names = services.map((s) => s.name).join(', ');
      return `Para agendar necesito: ${missing.join(', ')}.\nServicios: ${names}\nEjemplo: "agendá corte para Juan el lunes a las 10"`;
    }

    const service = await this.servicesService.findByName(business.id, entities.service);
    if (!service) {
      const services = await this.servicesService.listActive(business.id);
      return `No encontré el servicio "${entities.service}". Disponibles: ${services.map((s) => s.name).join(', ')}`;
    }

    // Verify slot is free for this staff member
    const available = await this.appointmentsService.findSlotsByStaff(
      staffMember.id,
      business.id,
      entities.date,
      service.durationMinutes,
      business.timezone,
    );

    const isSlotFree = available.some((s) => s.displayStart === entities.time);
    if (!isSlotFree) {
      const freeSlots = available.slice(0, 4).map((s) => s.displayStart + 'hs').join(', ');
      return `El horario ${entities.time}hs no está libre.${freeSlots ? ` Horarios disponibles: ${freeSlots}` : ''}`;
    }

    // Resolve client contact
    const clientName = entities.clientName ?? 'Walk-in';
    const contact = await this.contactsService.findOrCreateByName(business.id, clientName);

    const startsAt = fromZonedTime(`${entities.date}T${entities.time}:00`, business.timezone);

    await this.appointmentsService.bookAppointment({
      businessId: business.id,
      contactId: contact.id,
      serviceId: service.id,
      staffId: staffMember.id,
      startsAt,
      durationMinutes: service.durationMinutes,
      source: 'MANUAL',
    });

    const displayDate = this.formatDate(entities.date);
    const endsDisplay = format(
      toZonedTime(addMinutes(startsAt, service.durationMinutes), business.timezone),
      'HH:mm',
      { timeZone: business.timezone },
    );

    return `✅ Turno agendado:\n\n*Cliente:* ${clientName}\n*Servicio:* ${service.name}\n*Fecha:* ${displayDate}\n*Hora:* ${entities.time}–${endsDisplay}hs`;
  }

  // ─────────────────────────────────────────────────────────────
  // MOVER UN TURNO
  // ─────────────────────────────────────────────────────────────

  private async handleReschedule(ctx: StaffSelfServiceContext): Promise<string> {
    const { staffMember, business, entities } = ctx;
    const tz = business.timezone;

    if (!entities.currentTime || !entities.time) {
      return 'Para mover un turno necesito el horario actual y el nuevo.\nEjemplo: "mover el de las 10 para las 15"';
    }

    const dateStr =
      entities.date ?? format(toZonedTime(new Date(), tz), 'yyyy-MM-dd', { timeZone: tz });

    const appointment = await this.appointmentsService.findByStaffAndTime(
      staffMember.id,
      tz,
      entities.currentTime,
      dateStr,
    ) as any;

    if (!appointment) {
      return `No encontré un turno a las ${entities.currentTime}hs${entities.date ? ` del ${this.formatDate(entities.date)}` : ' de hoy'}. Revisá tu agenda con "mis turnos".`;
    }

    const durationMinutes = appointment.service?.durationMinutes ?? 30;
    const newDateStr = entities.date ?? dateStr;
    const newStart = fromZonedTime(`${newDateStr}T${entities.time}:00`, tz);

    await this.appointmentsService.rescheduleLatestForContact(
      appointment.contactId,
      business.id,
      newStart,
      durationMinutes,
    );

    const clientName = appointment.contact?.name ?? appointment.contact?.phone ?? 'el cliente';
    return `✅ Turno de *${clientName}* movido de las ${entities.currentTime}hs → ${entities.time}hs (${this.formatDate(newDateStr)}).`;
  }

  // ─────────────────────────────────────────────────────────────
  // CANCELAR UN TURNO
  // ─────────────────────────────────────────────────────────────

  private async handleCancel(ctx: StaffSelfServiceContext): Promise<string> {
    const { staffMember, business, entities } = ctx;
    const tz = business.timezone;

    let appointment: any;

    if (entities.currentTime) {
      const dateStr =
        entities.date ?? format(toZonedTime(new Date(), tz), 'yyyy-MM-dd', { timeZone: tz });
      appointment = await this.appointmentsService.findByStaffAndTime(
        staffMember.id,
        tz,
        entities.currentTime,
        dateStr,
      );

      if (!appointment) {
        return `No encontré un turno a las ${entities.currentTime}hs. Revisá tu agenda con "mis turnos".`;
      }

      await this.appointmentsService.updateStatus(appointment.id, 'CANCELLED');
    } else {
      // Cancel the next upcoming appointment for this staff member
      const upcoming = await this.appointmentsService.findTodayByStaff(staffMember.id, tz);
      if (!upcoming.length) {
        return 'No tenés turnos próximos para cancelar.';
      }
      appointment = upcoming[0];
      await this.appointmentsService.updateStatus(appointment.id, 'CANCELLED');
    }

    const time = format(toZonedTime(appointment.startsAt, tz), 'HH:mm', { timeZone: tz });
    const clientName = appointment.contact?.name ?? appointment.contact?.phone ?? 'el cliente';
    return `❌ Turno de *${clientName}* a las ${time}hs cancelado.`;
  }

  // ─────────────────────────────────────────────────────────────
  // UNKNOWN
  // ─────────────────────────────────────────────────────────────

  private handleUnknown(staffName: string): string {
    return `Hola ${staffName}! Podés:\n• *mis turnos* → ver tu agenda de hoy\n• *agendá [servicio] para [cliente] el [día] a las [hora]* → nuevo turno\n• *mover el de las [hora] para las [hora]* → mover un turno\n• *cancelar el de las [hora]* → cancelar un turno`;
  }

  private formatDate(dateStr: string): string {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  }
}
