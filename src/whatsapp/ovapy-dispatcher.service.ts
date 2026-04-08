import { Injectable, Logger } from '@nestjs/common';
import { Business, Staff } from '@prisma/client';
import { Intent, IntentEntities } from '../ai/types/intent.types';
import { AppointmentsService } from '../appointments/appointments.service';
import { SalesService } from '../sales/sales.service';
import { toZonedTime, format } from 'date-fns-tz';

export interface OvapyDispatchContext {
  intent: Intent;
  entities: IntentEntities;
  staffMember: Staff;
  business: Business;
  isOwner: true; // Ovapy only handles OWNER — MEMBER messages are silently ignored upstream
}

@Injectable()
export class OvapyDispatcherService {
  private readonly logger = new Logger(OvapyDispatcherService.name);

  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly salesService: SalesService,
  ) {}

  async dispatch(ctx: OvapyDispatchContext): Promise<string> {
    const { intent, business, entities } = ctx;

    try {
      switch (intent) {
        case 'REGISTER_SALE':
          return this.handleRegisterSale(entities, business);
        case 'LIST_APPOINTMENTS':
          return this.handleListAppointments(entities, business);
        case 'LIST_SALES':
          return this.handleListSales(entities, business);
        default:
          return this.handleOwnerUnknown(business);
      }
    } catch (err) {
      this.logger.error(`Ovapy dispatch error for intent ${intent}`, err?.message);
      return 'Ocurrió un error procesando tu solicitud. Intentá de nuevo.';
    }
  }

  // ─────────────────────────────────────────────────────────────
  // OWNER handlers
  // ─────────────────────────────────────────────────────────────

  private async handleRegisterSale(entities: IntentEntities, business: Business): Promise<string> {
    if (!entities.description || entities.amount == null) {
      return 'Para registrar una venta necesito descripción y monto. Ejemplo: "registra corte x 10000"';
    }

    const sale = await this.salesService.registerSale({
      businessId: business.id,
      description: entities.description,
      amount: entities.amount,
      source: 'WHATSAPP',
    });

    return `💰 Venta registrada: *${sale.description}* — $${sale.amount.toLocaleString('es-AR')}`;
  }

  private async handleListAppointments(entities: IntentEntities, business: Business): Promise<string> {
    const date = entities.date ?? this.todayStr();
    const appointments = await this.appointmentsService.listForAdmin(business.id, { date }) as any[];

    if (!appointments.length) {
      return `📅 No hay turnos para el ${this.formatDate(date)}.`;
    }

    const tz = business.timezone;
    const lines = appointments.map((a) => {
      const time = format(toZonedTime(a.startsAt, tz), 'HH:mm', { timeZone: tz });
      const client = a.contact?.name ?? a.contact?.phone ?? '?';
      const service = a.service?.name ?? '-';
      const staffName = a.staff?.name ? ` [${a.staff.name}]` : '';
      return `• ${time}hs — ${client} (${service})${staffName}`;
    });

    return `📅 Turnos del ${this.formatDate(date)}:\n\n${lines.join('\n')}`;
  }

  private async handleListSales(entities: IntentEntities, business: Business): Promise<string> {
    const date = entities.date ?? this.todayStr();
    const summary = await this.salesService.getDailySummary(business.id, date);

    if (summary.count === 0) {
      return `💰 No hay ventas registradas para el ${this.formatDate(date)}.`;
    }

    const lines = summary.sales.map(
      (s) => `• ${s.description}: $${s.amount.toLocaleString('es-AR')}`,
    );

    return `💰 Ventas del ${this.formatDate(date)}:\n\n${lines.join('\n')}\n\n*Total: $${summary.total.toLocaleString('es-AR')} (${summary.count} operaciones)*`;
  }

  private handleOwnerUnknown(business: Business): string {
    return `No entendí tu mensaje. Podés:\n• Registrar venta: "registra [descripción] x [monto]"\n• Ver turnos: "turnos de hoy"\n• Ver ventas: "ventas de hoy"`;
  }

  private todayStr(): string {
    return new Date().toISOString().split('T')[0];
  }

  private formatDate(dateStr: string): string {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  }
}
