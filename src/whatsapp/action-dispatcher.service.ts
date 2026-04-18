import { Injectable, Logger } from '@nestjs/common';
import { Business, Contact } from '@prisma/client';
import { Intent, IntentEntities, ConversationState } from '../ai/types/intent.types';
import { AppointmentsService } from '../appointments/appointments.service';
import { ServicesService } from '../services/services.service';
import { SalesService } from '../sales/sales.service';
import { StaffService } from '../staff/staff.service';
import { BranchService } from '../branches/branch.service';
import { ConversationsService } from '../conversations/conversations.service';
import { AiService } from '../ai/ai.service';
import { fromZonedTime, toZonedTime, format } from 'date-fns-tz';

export interface DispatchContext {
  intent: Intent;
  intents?: Intent[];   // multiple intents when message has multiple questions
  entities: IntentEntities;
  contact: Contact;
  business: Business;
  isAdmin: boolean;
  conversationId: string;
  conversationState?: ConversationState | null;
  rawMessage?: string; // original message text — used in state machine replies
}

@Injectable()
export class ActionDispatcherService {
  private readonly logger = new Logger(ActionDispatcherService.name);

  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly servicesService: ServicesService,
    private readonly salesService: SalesService,
    private readonly staffService: StaffService,
    private readonly branchService: BranchService,
    private readonly conversationsService: ConversationsService,
    private readonly aiService: AiService,
  ) {}

  async dispatch(ctx: DispatchContext): Promise<string> {
    const { intent, intents, conversationState, conversationId } = ctx;

    try {
      // ── Multi-intent: combine responses for each intent ───────
      if (intents && intents.length > 1) {
        const parts = await Promise.all(
          intents.map((i) => this.dispatch({ ...ctx, intent: i, intents: undefined })),
        );
        return parts.join('\n\n');
      }

      // ── Multi-turn state machine ──────────────────────────────
      // If user sends a clearly different intent while mid-flow, reset state and handle fresh
      const INTERRUPTING_INTENTS: Intent[] = ['GREET', 'CHECK_SERVICES', 'GENERAL_QUESTION', 'CANCEL_APPOINTMENT'];
      if (conversationState?.step && INTERRUPTING_INTENTS.includes(intent)) {
        await this.conversationsService.updateState(conversationId, { step: null });
        return this.dispatch({ ...ctx, conversationState: null });
      }

      if (conversationState?.step === 'AWAITING_BRANCH_PREFERENCE') {
        return this.handleBranchPreferenceReply(ctx);
      }
      if (conversationState?.step === 'AWAITING_STAFF_PREFERENCE') {
        return this.handleStaffPreferenceReply(ctx);
      }
      if (conversationState?.step === 'AWAITING_BOOKING_DETAILS') {
        return this.handleBookingDetailsReply(ctx);
      }
      if (conversationState?.step === 'AWAITING_CANCEL_TO_REBOOK') {
        return this.handleCancelToRebook(ctx);
      }

      // ── Normal intent routing ─────────────────────────────────
      switch (intent) {
        case 'GREET':
          return this.handleGreet(ctx);
        case 'CHECK_SERVICES':
          return this.handleCheckServices(ctx);
        case 'GENERAL_QUESTION':
          return this.handleGeneralQuestion(ctx);
        case 'CHECK_AVAILABILITY':
          return this.handleCheckAvailabilityWithStaff(ctx);
        case 'BOOK_APPOINTMENT':
          return this.handleBookAppointmentWithStaff(ctx);
        case 'RESCHEDULE_APPOINTMENT':
          return this.handleRescheduleAppointment(ctx);
        case 'CANCEL_APPOINTMENT':
          return this.handleCancelAppointment(ctx);
        default:
          return this.handleUnknown();
      }
    } catch (err: any) {
      this.logger.error(`Dispatcher error for intent ${intent}`, err?.message);
      if (err?.status === 409 || err?.message?.includes('disponible')) {
        return err.message;
      }
      return 'Ocurrió un error procesando tu solicitud. Por favor intentá de nuevo.';
    }
  }

  // ─────────────────────────────────────────────────────────────
  // STATE MACHINE: AWAITING_BRANCH_PREFERENCE
  // ─────────────────────────────────────────────────────────────

  private async handleBranchPreferenceReply(ctx: DispatchContext): Promise<string> {
    const { conversationState, business, conversationId } = ctx;
    const rawMessage = ctx.rawMessage ?? '';
    const pendingIntent = conversationState.pendingIntent as 'CHECK_AVAILABILITY' | 'BOOK_APPOINTMENT';
    const pendingEntities = conversationState.pendingEntities ?? {};

    const noPreferenceKeywords = ['cualquiera', 'no importa', 'da igual', 'el que sea', 'indiferente'];
    const noPreference = noPreferenceKeywords.some((kw) => rawMessage.toLowerCase().includes(kw));

    let selectedBranchId: string | null = null;

    if (!noPreference) {
      const matched = await this.branchService.findByName(business.id, rawMessage);
      if (!matched) {
        const activeBranches = await this.branchService.findActiveByBusiness(business.id);
        const names = activeBranches.map((b) => {
          const addr = b.address ? ' — ' + b.address.split(',')[0].trim() : '';
          return `• ${b.name}${addr}`;
        }).join('\n');
        return `No encontré esa sucursal. Nuestras sucursales:\n\n${names}\n\nO escribí "cualquiera".`;
      }
      selectedBranchId = matched.id;
    }

    // Save branch preference, then proceed to staff resolution
    const now = new Date().toISOString();
    await this.conversationsService.updateState(conversationId, {
      step: null,
      lastSelectedBranchId: selectedBranchId,
      lastSelectedBranchIdAt: now,
    });

    const resolvedCtx: DispatchContext = {
      ...ctx,
      intent: pendingIntent,
      entities: pendingEntities,
      conversationState: { step: null, lastSelectedBranchId: selectedBranchId, lastSelectedBranchIdAt: now },
    };

    const result = await this.resolveBranchAndStaff(resolvedCtx, pendingIntent, selectedBranchId);
    if (!result.done) return (result as { done: false; response: string }).response;

    if (pendingIntent === 'CHECK_AVAILABILITY') return this.executeCheckAvailability(resolvedCtx, result.staffId, result.branchId);
    return this.executeBookAppointment(resolvedCtx, result.staffId, result.branchId);
  }

  // ─────────────────────────────────────────────────────────────
  // STATE MACHINE: AWAITING_STAFF_PREFERENCE
  // ─────────────────────────────────────────────────────────────

  private async handleStaffPreferenceReply(ctx: DispatchContext): Promise<string> {
    const { conversationState, business, conversationId } = ctx;
    const rawMessage = ctx.rawMessage ?? '';
    const pendingBranchId = conversationState.pendingBranchId ?? null;

    const activeStaff = await this.staffService.findActiveByBusiness(business.id, pendingBranchId ?? undefined);
    const staffNames = activeStaff.map((s) => `• ${s.name}`).join('\n');

    const noPreferenceKeywords = ['cualquiera', 'no importa', 'da igual', 'el que sea', 'indiferente'];
    const noPreference = noPreferenceKeywords.some((kw) => rawMessage.toLowerCase().includes(kw));

    let selectedStaffId: string | null = null;

    if (!noPreference) {
      const matched = await this.staffService.findByName(business.id, rawMessage);
      if (!matched) {
        return `No encontré ese profesional. Nuestros profesionales:\n\n${staffNames}\n\nO escribí "cualquiera" para el primero disponible.`;
      }
      selectedStaffId = matched.id;
    }

    const pendingIntent = conversationState.pendingIntent;
    const pendingEntities = conversationState.pendingEntities ?? {};
    const now = new Date().toISOString();

    // Persist both staff and branch preferences
    await this.conversationsService.updateState(conversationId, {
      step: null,
      lastSelectedStaffId: selectedStaffId,
      lastSelectedStaffIdAt: now,
      lastSelectedBranchId: pendingBranchId,
      lastSelectedBranchIdAt: now,
    });

    const resolvedCtx: DispatchContext = {
      ...ctx,
      intent: pendingIntent,
      entities: pendingEntities,
      conversationState: null,
    };

    if (pendingIntent === 'CHECK_AVAILABILITY') return this.executeCheckAvailability(resolvedCtx, selectedStaffId, pendingBranchId);
    if (pendingIntent === 'BOOK_APPOINTMENT') return this.executeBookAppointment(resolvedCtx, selectedStaffId, pendingBranchId);

    await this.conversationsService.updateState(conversationId, { step: null });
    return this.handleUnknown();
  }

  // ─────────────────────────────────────────────────────────────
  // BRANCH + STAFF RESOLUTION (shared by CHECK and BOOK handlers)
  // ─────────────────────────────────────────────────────────────

  /**
   * Resolves branch and staff preferences, asking for input when needed.
   * Pass branchIdOverride to skip branch resolution (already resolved).
   */
  private async resolveBranchAndStaff(
    ctx: DispatchContext,
    intent: 'CHECK_AVAILABILITY' | 'BOOK_APPOINTMENT',
    branchIdOverride?: string | null,
  ): Promise<{ done: false; response: string } | { done: true; branchId: string | null; staffId: string | null }> {
    const { entities, business, conversationId, conversationState } = ctx;

    // ── 1. Resolve branch ──
    let branchId: string | null = null;

    if (branchIdOverride !== undefined) {
      branchId = branchIdOverride;
    } else if (entities.branchName) {
      const branch = await this.branchService.findByName(business.id, entities.branchName);
      branchId = branch?.id ?? null;
    } else if (conversationState != null && this.isBranchPreferenceFresh(conversationState)) {
      branchId = conversationState.lastSelectedBranchId ?? null;
    } else {
      const activeBranches = await this.branchService.findActiveByBusiness(business.id);
      if (activeBranches.length > 1) {
        const names = activeBranches.map((b) => {
          const addr = b.address ? ' — ' + b.address.split(',')[0].trim() : '';
          return `• ${b.name}${addr}`;
        }).join('\n');
        await this.conversationsService.updateState(conversationId, {
          step: 'AWAITING_BRANCH_PREFERENCE',
          pendingIntent: intent,
          pendingEntities: entities,
        });
        return { done: false, response: `¿A qué sucursal querés ir?\n\n${names}\n\nO escribí "cualquiera".` };
      }
      branchId = activeBranches.length === 1 ? activeBranches[0].id : null;
    }

    // ── 2. Resolve staff ──
    if (entities.staffName) {
      const staff = await this.staffService.findByName(business.id, entities.staffName);
      return { done: true, branchId, staffId: staff?.id ?? null };
    }

    if (conversationState != null && this.isStaffPreferenceFresh(conversationState)) {
      return { done: true, branchId, staffId: conversationState.lastSelectedStaffId ?? null };
    }

    const activeStaff = await this.staffService.findActiveByBusiness(business.id, branchId ?? undefined);

    if (activeStaff.length > 1) {
      const names = activeStaff.map((s) => `• ${s.name}`).join('\n');
      const label = intent === 'CHECK_AVAILABILITY'
        ? '¿Preferís consultar disponibilidad con un profesional en particular?'
        : '¿Tenés preferencia por algún profesional?';
      await this.conversationsService.updateState(conversationId, {
        step: 'AWAITING_STAFF_PREFERENCE',
        pendingIntent: intent,
        pendingEntities: entities,
        pendingBranchId: branchId,
      });
      return { done: false, response: `${label}\n\n${names}\n\nO escribí "cualquiera".` };
    }

    const staffId = activeStaff.length === 1 ? activeStaff[0].id : null;
    return { done: true, branchId, staffId };
  }

  // ─────────────────────────────────────────────────────────────
  // STATE MACHINE: AWAITING_BOOKING_DETAILS
  // ─────────────────────────────────────────────────────────────

  /**
   * User is completing a booking after being asked for missing date/time/service.
   * Merges the newly parsed entities with the ones saved in state (service, etc.).
   */
  private async handleBookingDetailsReply(ctx: DispatchContext): Promise<string> {
    const { conversationState, conversationId } = ctx;

    // Merge saved entities with what the AI just extracted from the new message.
    // Only override saved values with new ones that are non-empty (avoids wiping service, etc.)
    const saved = conversationState.pendingEntities ?? {};
    const freshEntries = Object.fromEntries(
      Object.entries(ctx.entities).filter(([, v]) => v != null && v !== ''),
    ) as IntentEntities;
    const merged: IntentEntities = { ...saved, ...freshEntries };

    const branchId = conversationState.pendingBranchId ?? null;
    const staffId = conversationState.pendingStaffId ?? null;

    await this.conversationsService.updateState(conversationId, {
      step: null,
      lastSelectedBranchId: branchId,
      lastSelectedBranchIdAt: conversationState.lastSelectedBranchIdAt,
      lastSelectedStaffId: staffId,
      lastSelectedStaffIdAt: conversationState.lastSelectedStaffIdAt,
    });

    return this.executeBookAppointment({ ...ctx, entities: merged }, staffId, branchId);
  }

  // ─────────────────────────────────────────────────────────────
  // STATE MACHINE: AWAITING_CANCEL_TO_REBOOK
  // ─────────────────────────────────────────────────────────────

  private async handleCancelToRebook(ctx: DispatchContext): Promise<string> {
    const { conversationState, conversationId, business, contact } = ctx;
    const raw = ctx.rawMessage?.toLowerCase() ?? '';

    const isYes = ['sí', 'si', 'sí', 'dale', 'ok', 'yes', 'cancelar', 'cancelalo'].some((kw) => raw.includes(kw));
    const isNo = ['no', 'nope', 'dejalo', 'mantener'].some((kw) => raw.includes(kw));

    if (!isYes && !isNo) {
      return 'No entendí. ¿Querés cancelar tu turno actual para reservar uno nuevo? Respondé *sí* o *no*.';
    }

    if (isNo) {
      await this.conversationsService.updateState(conversationId, { step: null });
      return 'Perfecto, tu turno sigue reservado. ¿Hay algo más en lo que te pueda ayudar?';
    }

    // Cancel the existing appointment
    const appointmentId = conversationState.cancelTargetAppointmentId;
    if (appointmentId) {
      await this.appointmentsService.cancelById(appointmentId);
    }

    // Proceed with the new booking using the saved context
    const entities = conversationState.pendingEntities ?? {};
    const staffId = conversationState.pendingStaffId ?? null;
    const branchId = conversationState.pendingBranchId ?? null;

    await this.conversationsService.updateState(conversationId, {
      step: null,
      lastSelectedBranchId: branchId,
      lastSelectedBranchIdAt: conversationState.lastSelectedBranchIdAt,
      lastSelectedStaffId: staffId,
      lastSelectedStaffIdAt: conversationState.lastSelectedStaffIdAt,
    });

    return this.executeBookAppointment({ ...ctx, entities }, staffId, branchId);
  }

  // ─────────────────────────────────────────────────────────────
  // CHECK AVAILABILITY
  // ─────────────────────────────────────────────────────────────

  private async handleCheckAvailabilityWithStaff(ctx: DispatchContext): Promise<string> {
    const result = await this.resolveBranchAndStaff(ctx, 'CHECK_AVAILABILITY');
    if (!result.done) return (result as { done: false; response: string }).response;
    return this.executeCheckAvailability(ctx, result.staffId, result.branchId);
  }

  private async executeCheckAvailability(ctx: DispatchContext, staffId: string | null, branchId?: string | null): Promise<string> {
    const { entities, business } = ctx;

    let durationMinutes = 30;
    let serviceName = '';

    if (entities.service) {
      const service = await this.servicesService.findByName(business.id, entities.service);
      if (service) {
        durationMinutes = service.durationMinutes;
        serviceName = service.name;
      }
    }

    const date = entities.date ?? this.todayStr();

    const slots = await this.appointmentsService.findAvailableSlots(
      business.id, date, durationMinutes, business.timezone,
      staffId ?? undefined, branchId ?? undefined,
    );

    const displayDate = this.formatDate(date);
    const serviceStr = serviceName ? ` para *${serviceName}*` : '';

    if (!slots.length) {
      return `No hay turnos disponibles para el ${displayDate}${serviceStr}. ¿Querés consultar otro día?`;
    }

    const staffContext = staffId ? await this.staffService.findById(staffId).then((s) => s?.name ?? '') : '';
    const staffStr = staffContext ? ` con *${staffContext}*` : '';

    const slotLines = slots.map((s) => `• ${s.displayStart}hs`).join('\n');
    return `Turnos disponibles el ${displayDate}${serviceStr}${staffStr}:\n\n${slotLines}\n\nPara reservar: "quiero turno [servicio] [día] a las [hora]"`;
  }

  // ─────────────────────────────────────────────────────────────
  // BOOK APPOINTMENT
  // ─────────────────────────────────────────────────────────────

  private async handleBookAppointmentWithStaff(ctx: DispatchContext): Promise<string> {
    const result = await this.resolveBranchAndStaff(ctx, 'BOOK_APPOINTMENT');
    if (!result.done) return (result as { done: false; response: string }).response;
    return this.executeBookAppointment(ctx, result.staffId, result.branchId);
  }

  private async executeBookAppointment(ctx: DispatchContext, preferredStaffId: string | null, branchId?: string | null): Promise<string> {
    const { entities, business, contact } = ctx;

    // Block if contact already has a pending/confirmed appointment
    const existing = await this.appointmentsService.findUpcomingForContact(contact.id, business.id);
    if (existing.length > 0) {
      const appt = existing[0];
      const localStart = toZonedTime(appt.startsAt, business.timezone);
      const dateStr = format(localStart, 'dd/MM/yyyy', { timeZone: business.timezone });
      const timeStr = format(localStart, 'HH:mm', { timeZone: business.timezone });
      const serviceName = (appt as any).service?.name ?? 'turno';

      await this.conversationsService.updateState(ctx.conversationId, {
        step: 'AWAITING_CANCEL_TO_REBOOK',
        cancelTargetAppointmentId: appt.id,
        pendingEntities: entities,
        pendingBranchId: branchId ?? null,
        pendingStaffId: preferredStaffId,
        lastSelectedBranchId: ctx.conversationState?.lastSelectedBranchId,
        lastSelectedBranchIdAt: ctx.conversationState?.lastSelectedBranchIdAt,
        lastSelectedStaffId: ctx.conversationState?.lastSelectedStaffId,
        lastSelectedStaffIdAt: ctx.conversationState?.lastSelectedStaffIdAt,
      });

      return `Ya tenés un turno reservado:\n\n*Servicio:* ${serviceName}\n*Fecha:* ${dateStr}\n*Hora:* ${timeStr}hs\n\n¿Querés cancelarlo para reservar uno nuevo? (sí / no)`;
    }

    // Resolve services (single or multiple)
    const serviceNames: string[] = entities.services?.length
      ? entities.services
      : entities.service ? [entities.service] : [];

    // Validate required entities
    const missing: string[] = [];
    if (!serviceNames.length) missing.push('servicio');
    if (!entities.date) missing.push('fecha');
    if (!entities.time) missing.push('horario');

    if (missing.length > 0) {
      // Save partial entities so the next reply can complete the booking without re-asking
      await this.conversationsService.updateState(ctx.conversationId, {
        step: 'AWAITING_BOOKING_DETAILS',
        pendingEntities: entities,
        pendingBranchId: branchId ?? null,
        pendingStaffId: preferredStaffId,
        lastSelectedBranchId: ctx.conversationState?.lastSelectedBranchId,
        lastSelectedBranchIdAt: ctx.conversationState?.lastSelectedBranchIdAt,
        lastSelectedStaffId: ctx.conversationState?.lastSelectedStaffId,
        lastSelectedStaffIdAt: ctx.conversationState?.lastSelectedStaffIdAt,
      });

      // If service is already known, ask only for what's missing in natural language
      if (serviceNames.length && !missing.includes('servicio')) {
        const parts: string[] = [];
        if (missing.includes('fecha')) parts.push('¿para qué día?');
        if (missing.includes('horario')) parts.push('¿a qué hora?');
        const staffLine = preferredStaffId
          ? await this.staffService.findById(preferredStaffId).then((s) => s ? ` Te agendaría con *${s.name}*.` : '')
          : '';
        return (parts.join(' ') || 'Decime el día y la hora y te lo agendo.') + staffLine;
      }

      // Service unknown — show full prompt with service list
      const availableServices = await this.servicesService.listActive(business.id);
      const names = availableServices.map((s) => `• ${s.name}`).join('\n');
      return `Para reservar necesito: ${missing.join(', ')}.\n\n${names}\n\nEjemplo: "quiero turno corte el lunes a las 10"`;
    }

    // Resolve each service from DB, sum durations
    const resolvedServices: { id: string; name: string; durationMinutes: number }[] = [];
    for (const svcName of serviceNames) {
      const svc = await this.servicesService.findByName(business.id, svcName);
      if (!svc) {
        const availableServices = await this.servicesService.listActive(business.id);
        const names2 = availableServices.map((s) => `• ${s.name}`).join('\n');
        return `No encontré el servicio "${svcName}". Servicios disponibles:\n\n${names2}`;
      }
      resolvedServices.push({ id: svc.id, name: svc.name, durationMinutes: svc.durationMinutes });
    }

    const totalDuration = resolvedServices.reduce((sum, s) => sum + s.durationMinutes, 0);
    const combinedName = resolvedServices.map((s) => s.name).join(' + ');
    // Use a synthetic service object for the rest of the flow
    const service = { id: resolvedServices[0].id, name: combinedName, durationMinutes: totalDuration };

    // If no preference, find the first staff available at the requested slot (filtered by branch)
    let staffId = preferredStaffId;
    if (!staffId) {
      const activeStaff = await this.staffService.findActiveByBusiness(business.id, branchId ?? undefined);

      if (activeStaff.length > 0) {
        // Find all staff available at the requested time, then pick one randomly
        const availableAtTime: string[] = [];
        for (const member of activeStaff) {
          const slots = await this.appointmentsService.findSlotsByStaff(
            member.id, business.id, entities.date, service.durationMinutes, business.timezone,
          );
          const hasSlot = slots.some((s) => {
            const t = format(toZonedTime(new Date(s.start), business.timezone), 'HH:mm', { timeZone: business.timezone });
            return t === entities.time;
          });
          if (hasSlot) availableAtTime.push(member.id);
        }

        if (availableAtTime.length === 0) {
          // No staff available at that time — show alternatives
          const alternatives = await this.appointmentsService.findAvailableSlots(
            business.id, entities.date, service.durationMinutes, business.timezone, undefined, branchId ?? undefined, 5,
          );
          const altStr = alternatives.length
            ? `Horarios disponibles: ${alternatives.map((s) => s.displayStart + 'hs').join(', ')}`
            : 'No hay más turnos disponibles ese día.';
          return `El horario ${entities.time}hs no está disponible. ${altStr}`;
        }

        staffId = availableAtTime[Math.floor(Math.random() * availableAtTime.length)];
      }
      // else: no staff configured — staffId stays null and bookAppointmentLegacy runs below
    }

    if (!staffId) {
      // No staff configured at all — book without staff assignment (legacy mode)
      const localDateTimeStr = `${entities.date}T${entities.time}:00`;
      const startsAt = fromZonedTime(localDateTimeStr, business.timezone);

      await this.appointmentsService.bookAppointmentLegacy({
        businessId: business.id,
        contactId: contact.id,
        serviceId: service.id,
        startsAt,
        durationMinutes: service.durationMinutes,
        source: 'WHATSAPP',
      });

      return this.buildBookingConfirmation(ctx, entities, service, null);
    }

    const localDateTimeStr = `${entities.date}T${entities.time}:00`;
    const startsAt = fromZonedTime(localDateTimeStr, business.timezone);

    // Validate: check if the requested slot is actually available for this staff member
    const available = await this.appointmentsService.findSlotsByStaff(
      staffId,
      business.id,
      entities.date,
      service.durationMinutes,
      business.timezone,
    );

    const isSlotAvailable = available.some((s) => {
      const slotTime = format(toZonedTime(new Date(s.start), business.timezone), 'HH:mm', {
        timeZone: business.timezone,
      });
      return slotTime === entities.time;
    });

    if (!isSlotAvailable) {
      return `El horario ${entities.time}hs no está disponible. ${available.length > 0 ? `Horarios libres: ${available.slice(0, 3).map((s) => s.displayStart + 'hs').join(', ')}` : 'No hay más turnos ese día.'}`;
    }

    await this.appointmentsService.bookAppointment({
      businessId: business.id,
      contactId: contact.id,
      serviceId: service.id,
      serviceIds: resolvedServices.map((s) => s.id),
      staffId,
      branchId: branchId ?? undefined,
      startsAt,
      durationMinutes: service.durationMinutes,
      source: 'WHATSAPP',
    });

    const staffMember = await this.staffService.findById(staffId);
    return this.buildBookingConfirmation(ctx, entities, service, staffMember?.name ?? null);
  }

  private async buildBookingConfirmation(ctx: DispatchContext, entities: IntentEntities, service: any, staffName: string | null): Promise<string> {
    await this.conversationsService.closeConversation(ctx.conversationId);
    const displayDate = this.formatDate(entities.date);
    const staffLine = staffName ? `\n*Profesional:* ${staffName}` : '';
    return `✅ ¡Turno confirmado!\n\n*Servicio:* ${service.name}${staffLine}\n*Fecha:* ${displayDate}\n*Hora:* ${entities.time}hs\n*Duración:* ${service.durationMinutes} min\n\nTe recordaremos antes del turno. ¡Hasta entonces! 💈`;
  }

  // ─────────────────────────────────────────────────────────────
  // OTHER CLIENT HANDLERS
  // ─────────────────────────────────────────────────────────────

  private handleGreet(ctx: DispatchContext): string {
    const name = ctx.contact.name ? ` ${ctx.contact.name}` : '';
    return `¡Hola${name}! Soy el asistente de ${ctx.business.name} 💈\nTe ayudo con turnos, precios y consultas. Escribime lo que necesitás y lo vemos.`;
  }

  private async handleCheckServices(ctx: DispatchContext): Promise<string> {
    const services = await this.servicesService.listActive(ctx.business.id);

    if (!services.length) {
      return 'Por el momento no hay servicios disponibles. Consultá más tarde.';
    }

    const lines = services.map(
      (s) => `• *${s.name}*: ${s.durationMinutes} min — $${s.price.toLocaleString('es-AR')}`,
    );

    return `Nuestros servicios:\n\n${lines.join('\n')}\n\nPara reservar: "quiero turno [servicio] [día] a las [hora]"`;
  }

  private async handleRescheduleAppointment(ctx: DispatchContext): Promise<string> {
    const { entities, business, contact } = ctx;

    if (!entities.date || !entities.time) {
      return 'Para reagendar necesito la nueva fecha y horario. Ejemplo: "quiero cambiar mi turno para el jueves a las 15"';
    }

    const upcoming = await this.appointmentsService.findUpcomingForContact(contact.id, business.id);
    if (!upcoming.length) {
      return 'No encontré turnos próximos para reagendar.';
    }

    const existingAppt = upcoming[0] as any;
    const durationMinutes = existingAppt.service?.durationMinutes ?? 30;
    const newStart = fromZonedTime(`${entities.date}T${entities.time}:00`, business.timezone);

    await this.appointmentsService.rescheduleLatestForContact(
      contact.id,
      business.id,
      newStart,
      durationMinutes,
    );

    return `✅ Turno reagendado para el ${this.formatDate(entities.date)} a las ${entities.time}hs. ¡Te esperamos!`;
  }

  private async handleCancelAppointment(ctx: DispatchContext): Promise<string> {
    const { business, contact } = ctx;

    const cancelled = await this.appointmentsService.cancelLatestForContact(contact.id, business.id);
    if (!cancelled) {
      return 'No encontré turnos activos para cancelar.';
    }

    const tz = business.timezone;
    const displayTime = format(toZonedTime(cancelled.startsAt, tz), "dd/MM/yyyy 'a las' HH:mm", { timeZone: tz });

    return `❌ Turno del ${displayTime}hs cancelado.\n\n¿Querés reservar uno nuevo? Escribí "quiero turno" y te ayudo.`;
  }

  private async handleGeneralQuestion(ctx: DispatchContext): Promise<string> {
    const { business, rawMessage } = ctx;
    const b = business as any;

    const address = b.address as string | null;
    const extraInfo = b.extraInfo as string | null;

    const branches = await this.branchService.findActiveByBusiness(business.id);

    const hasBranches = branches.length > 0;
    if (!address && !extraInfo && !hasBranches) {
      return 'Por el momento no tenemos esa información disponible. ¡Escribinos por este medio para más consultas!';
    }

    const contextLines: string[] = [`Negocio: ${business.name}`];
    if (address) contextLines.push(`Dirección: ${address}`);
    if (hasBranches) {
      contextLines.push('Sucursales:');
      for (const branch of branches) {
        const line = branch.address
          ? `  - ${branch.name}: ${branch.address}`
          : `  - ${branch.name}`;
        contextLines.push(line);
      }
    }
    if (extraInfo) contextLines.push(`Info adicional: ${extraInfo}`);

    try {
      const response = await this.aiService.answerGeneralQuestion(
        rawMessage ?? '',
        contextLines.join('\n'),
        business.id,
      );
      return response;
    } catch {
      const lines: string[] = [];
      if (address) lines.push(`📍 *Dirección:* ${address}`);
      if (hasBranches) {
        lines.push('*Sucursales:*');
        for (const branch of branches) {
          lines.push(branch.address ? `• ${branch.name}: ${branch.address}` : `• ${branch.name}`);
        }
      }
      if (extraInfo) lines.push(extraInfo);
      return lines.join('\n');
    }
  }

  private handleUnknown(): string {
    return `No entendí bien lo que necesitás. Podés preguntarme por precios, disponibilidad, sacar un turno o cancelar uno. Escribime de nuevo y lo vemos.`;
  }

  // ─────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────

  /** Returns true if the staff preference stored in state is still within the 24h window. */
  private isStaffPreferenceFresh(state: ConversationState): boolean {
    if (!('lastSelectedStaffId' in state) || !state.lastSelectedStaffIdAt) return false;
    const setAt = new Date(state.lastSelectedStaffIdAt).getTime();
    return Date.now() - setAt < 24 * 60 * 60 * 1000;
  }

  /** Returns true if the branch preference stored in state is still within the 24h window. */
  private isBranchPreferenceFresh(state: ConversationState): boolean {
    if (!('lastSelectedBranchId' in state) || !state.lastSelectedBranchIdAt) return false;
    const setAt = new Date(state.lastSelectedBranchIdAt).getTime();
    return Date.now() - setAt < 24 * 60 * 60 * 1000;
  }

  private todayStr(): string {
    return new Date().toISOString().split('T')[0];
  }

  private formatDate(dateStr: string): string {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  }
}
