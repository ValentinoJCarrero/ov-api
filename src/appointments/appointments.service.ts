import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Appointment, AppointmentStatus, AppointmentSource } from '@prisma/client';
import { ServicesService } from '../services/services.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { addMinutes, startOfDay, endOfDay, parseISO, isBefore, isAfter } from 'date-fns';
import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';

export interface AvailableSlot {
  start: string;        // ISO UTC string
  end: string;          // ISO UTC string
  displayStart: string; // "HH:MM" in business timezone
  staffId: string;      // which staff member is available in this slot
  staffName?: string;
}

interface BookAppointmentParams {
  businessId: string;
  contactId: string;
  serviceId?: string;
  serviceIds?: string[];  // all service IDs when booking multiple services
  staffId: string;
  branchId?: string;
  startsAt: Date;
  durationMinutes: number;
  source: AppointmentSource;
  notes?: string;
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly servicesService: ServicesService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly googleSheetsService: GoogleSheetsService,
  ) {}

  /**
   * Finds available slots for a specific staff member.
   * Uses StaffHours (not BusinessHours) for their schedule.
   */
  async findSlotsByStaff(
    staffId: string,
    businessId: string,
    date: string,
    durationMinutes: number,
    timezone: string,
  ): Promise<AvailableSlot[]> {
    const localDateStr = `${date}T00:00:00`;
    const dayStart = fromZonedTime(localDateStr, timezone);
    const dayEnd = endOfDay(dayStart);

    const zonedDate = toZonedTime(dayStart, timezone);
    const dayOfWeek = zonedDate.getDay();

    const staffHours = await this.prisma.staffHours.findUnique({
      where: { staffId_dayOfWeek: { staffId, dayOfWeek } },
      include: { staff: { select: { name: true } } },
    });

    // Fall back to BusinessHours when no specific StaffHours are set
    let openTime: string;
    let closeTime: string;

    if (staffHours?.isActive) {
      openTime = staffHours.openTime;
      closeTime = staffHours.closeTime;
    } else {
      const businessHours = await this.prisma.businessHours.findUnique({
        where: { businessId_dayOfWeek: { businessId, dayOfWeek } },
      });
      if (!businessHours || !businessHours.isActive) return [];
      openTime = businessHours.openTime;
      closeTime = businessHours.closeTime;
    }

    const staffName = (staffHours as any)?.staff?.name;

    const openUTC = fromZonedTime(`${date}T${openTime}:00`, timezone);
    const closeUTC = fromZonedTime(`${date}T${closeTime}:00`, timezone);

    // Generate candidate slots every 30 min so any start time is reachable,
    // while each slot still spans the full service duration.
    const STEP = 30;
    const candidates: { start: Date; end: Date }[] = [];
    let cursor = openUTC;
    while (true) {
      const slotEnd = addMinutes(cursor, durationMinutes);
      if (isAfter(slotEnd, closeUTC)) break;
      candidates.push({ start: cursor, end: slotEnd });
      cursor = addMinutes(cursor, STEP);
    }

    // Query this staff member's existing appointments for the day
    const existingAppointments = await this.prisma.appointment.findMany({
      where: {
        staffId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startsAt: { gte: dayStart, lte: dayEnd },
      },
    });

    const now = new Date();

    // Also fetch GCal busy slots to exclude externally blocked times
    const gcalBusy = await this.googleCalendarService.getBusySlots(staffId, date, timezone);

    return candidates
      .filter(({ start, end }) => {
        if (isBefore(start, now)) return false;
        // Check existing DB appointments
        if (existingAppointments.some((appt) => start < appt.endsAt && end > appt.startsAt)) {
          return false;
        }
        // Check Google Calendar busy slots
        if (gcalBusy.some((b) => start < b.end && end > b.start)) return false;
        return true;
      })
      .map(({ start, end }) => ({
        start: start.toISOString(),
        end: end.toISOString(),
        displayStart: format(toZonedTime(start, timezone), 'HH:mm', { timeZone: timezone }),
        staffId,
        staffName,
      }));
  }

  /**
   * Finds available slots across ALL active staff members.
   * Returns the first available slot per time, assigning the first staff member free at that time.
   * Falls back to BusinessHours if no staff exists (backward compat).
   */
  async findAvailableSlots(
    businessId: string,
    date: string,
    durationMinutes: number,
    timezone: string,
    staffId?: string,
    branchId?: string,
    count?: number,
  ): Promise<AvailableSlot[]> {
    // If a specific staff member is requested
    if (staffId) {
      const slots = await this.findSlotsByStaff(staffId, businessId, date, durationMinutes, timezone);
      return count != null ? slots.slice(0, count) : slots;
    }

    // No preference: check active staff (filtered by branch if provided)
    const staffWhere: any = { businessId, isActive: true };
    if (branchId) staffWhere.branchId = branchId;
    const activeStaff = await this.prisma.staff.findMany({ where: staffWhere });

    if (activeStaff.length > 0) {
      // Collect all slots from all staff
      const allSlots: AvailableSlot[] = [];
      for (const member of activeStaff) {
        const slots = await this.findSlotsByStaff(
          member.id, businessId, date, durationMinutes, timezone,
        );
        allSlots.push(...slots);
      }

      // Sort by start time
      allSlots.sort((a, b) => a.start.localeCompare(b.start));

      // Deduplicate: keep only first staff available at each display time
      const seenTimes = new Set<string>();
      const deduplicated: AvailableSlot[] = [];
      for (const slot of allSlots) {
        if (!seenTimes.has(slot.displayStart)) {
          seenTimes.add(slot.displayStart);
          deduplicated.push(slot);
        }
      }

      return count != null ? deduplicated.slice(0, count) : deduplicated;
    }

    // Fallback to BusinessHours if no staff configured
    return this.findSlotsByBusinessHours(businessId, date, durationMinutes, timezone, count);
  }

  /**
   * Fallback: availability based on BusinessHours (no staff configured).
   * Kept for backward compatibility with the initial MVP.
   */
  private async findSlotsByBusinessHours(
    businessId: string,
    date: string,
    durationMinutes: number,
    timezone: string,
    count?: number,
  ): Promise<AvailableSlot[]> {
    const localDateStr = `${date}T00:00:00`;
    const dayStart = fromZonedTime(localDateStr, timezone);
    const dayEnd = endOfDay(dayStart);
    const zonedDate = toZonedTime(dayStart, timezone);
    const dayOfWeek = zonedDate.getDay();

    const businessHours = await this.prisma.businessHours.findUnique({
      where: { businessId_dayOfWeek: { businessId, dayOfWeek } },
    });

    if (!businessHours || !businessHours.isActive) return [];

    const openUTC = fromZonedTime(`${date}T${businessHours.openTime}:00`, timezone);
    const closeUTC = fromZonedTime(`${date}T${businessHours.closeTime}:00`, timezone);

    const STEP = 30;
    const candidates: { start: Date; end: Date }[] = [];
    let cursor = openUTC;
    while (true) {
      const slotEnd = addMinutes(cursor, durationMinutes);
      if (isAfter(slotEnd, closeUTC)) break;
      candidates.push({ start: cursor, end: slotEnd });
      cursor = addMinutes(cursor, STEP);
    }

    const existingAppointments = await this.prisma.appointment.findMany({
      where: {
        businessId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startsAt: { gte: dayStart, lte: dayEnd },
      },
    });

    const now = new Date();

    return candidates
      .filter(({ start, end }) => {
        if (isBefore(start, now)) return false;
        return !existingAppointments.some(
          (appt) => start < appt.endsAt && end > appt.startsAt,
        );
      })
      .slice(0, count ?? Infinity)
      .map(({ start, end }) => ({
        start: start.toISOString(),
        end: end.toISOString(),
        displayStart: format(toZonedTime(start, timezone), 'HH:mm', { timeZone: timezone }),
        staffId: '',
        staffName: undefined,
      }));
  }

  /**
   * Books an appointment with race-condition protection.
   * Conflicts are checked per-staff (each member has their own agenda).
   */
  async bookAppointment(params: BookAppointmentParams): Promise<Appointment> {
    const { businessId, contactId, serviceId, serviceIds, staffId, branchId, startsAt, durationMinutes, source, notes } = params;
    const endsAt = addMinutes(startsAt, durationMinutes);

    const booked = await this.prisma.$transaction(async (tx) => {
      // Check for conflicts on this specific staff member's agenda
      const conflicts = await tx.appointment.findMany({
        where: {
          staffId,
          status: { in: ['PENDING', 'CONFIRMED'] },
          AND: [
            { startsAt: { lt: endsAt } },
            { endsAt: { gt: startsAt } },
          ],
        },
      });

      if (conflicts.length > 0) {
        throw new ConflictException('El horario solicitado ya no está disponible para ese profesional.');
      }

      this.logger.log(`Booking appointment: ${startsAt.toISOString()} for contact ${contactId} with staff ${staffId}`);

      const created = await tx.appointment.create({
        data: {
          businessId,
          contactId,
          serviceId: serviceId ?? null,
          serviceIds: serviceIds ?? [],
          staffId: staffId || null,
          branchId: branchId ?? null,
          startsAt,
          endsAt,
          status: 'CONFIRMED',
          source,
          notes,
        },
        include: { service: true, contact: true, staff: true },
      });

      return created;
    });

    // Sync to Google Calendar (outside transaction — non-critical)
    this.syncCreateEvent(booked, durationMinutes).catch((err) =>
      this.logger.error(`GCal sync failed for appointment ${booked.id}`, err?.message),
    );

    // Sync to Google Sheets
    const staffName = (booked as any).staff?.name;
    if (staffName) {
      this.getBusinessSheetsId(businessId).then((sheetsId) => {
        if (sheetsId) {
          this.googleSheetsService.markSlot(sheetsId, booked.startsAt, staffName).catch((err) =>
            this.logger.error(`Sheets sync failed for appointment ${booked.id}`, err?.message),
          );
        }
      }).catch(() => {});
    }

    return booked;
  }

  private async syncCreateEvent(appointment: any, durationMinutes: number): Promise<void> {
    if (!appointment.staffId) return;

    const clientName = appointment.contact?.name ?? appointment.contact?.phone ?? 'Cliente';
    const serviceName = appointment.service?.name ?? 'Turno';

    const eventId = await this.googleCalendarService.createEvent({
      staffId: appointment.staffId,
      title: `${serviceName} — ${clientName}`,
      description: `Cliente: ${clientName}\nServicio: ${serviceName}`,
      startsAt: appointment.startsAt,
      durationMinutes,
      timezone: 'America/Argentina/Buenos_Aires',
    });

    if (eventId) {
      await this.prisma.appointment.update({
        where: { id: appointment.id },
        data: { googleCalendarEventId: eventId },
      });
    }
  }

  /**
   * Books an appointment WITHOUT a staff member assigned (legacy / no-staff businesses).
   * Checks conflicts at the business level instead of per-staff.
   */
  async bookAppointmentLegacy(params: Omit<BookAppointmentParams, 'staffId'>): Promise<Appointment> {
    const { businessId, contactId, serviceId, startsAt, durationMinutes, source, notes } = params;
    const endsAt = addMinutes(startsAt, durationMinutes);

    return this.prisma.$transaction(async (tx) => {
      const conflicts = await tx.appointment.findMany({
        where: {
          businessId,
          staffId: null,
          status: { in: ['PENDING', 'CONFIRMED'] },
          AND: [{ startsAt: { lt: endsAt } }, { endsAt: { gt: startsAt } }],
        },
      });

      if (conflicts.length > 0) {
        throw new ConflictException('El horario solicitado ya no está disponible.');
      }

      return tx.appointment.create({
        data: { businessId, contactId, serviceId: serviceId ?? null, staffId: null, startsAt, endsAt, status: 'CONFIRMED', source, notes },
        include: { service: true, contact: true },
      });
    });
  }

  async findById(appointmentId: string): Promise<Appointment | null> {
    return this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { contact: true, service: true, staff: true },
    });
  }

  async findUpcomingForContact(contactId: string, businessId: string): Promise<Appointment[]> {
    return this.prisma.appointment.findMany({
      where: {
        contactId,
        businessId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startsAt: { gt: new Date() },
      },
      include: { service: true, staff: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  async cancelById(appointmentId: string): Promise<void> {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { staff: true },
    }) as any;

    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'CANCELLED' },
    });

    if (appt?.staffId && appt?.googleCalendarEventId) {
      this.googleCalendarService.deleteEvent(appt.staffId, appt.googleCalendarEventId).catch(() => {});
    }
    if (appt?.startsAt && appt?.staff?.name) {
      this.getBusinessSheetsId(appt.businessId).then((sheetsId) => {
        if (sheetsId) this.googleSheetsService.clearSlot(sheetsId, appt.startsAt, appt.staff.name).catch(() => {});
      }).catch(() => {});
    }
  }

  async cancelLatestForContact(contactId: string, businessId: string): Promise<Appointment | null> {
    const upcoming = await this.findUpcomingForContact(contactId, businessId);
    if (upcoming.length === 0) return null;

    const cancelled = await this.prisma.appointment.update({
      where: { id: upcoming[0].id },
      data: { status: 'CANCELLED' },
    });

    // Sync: delete GCal event
    const appt = upcoming[0] as any;
    if (appt.staffId && appt.googleCalendarEventId) {
      this.googleCalendarService.deleteEvent(appt.staffId, appt.googleCalendarEventId).catch(() => {});
    }
    if (appt.startsAt && appt.staff?.name) {
      this.getBusinessSheetsId(appt.businessId).then((sheetsId) => {
        if (sheetsId) this.googleSheetsService.clearSlot(sheetsId, appt.startsAt, appt.staff.name).catch(() => {});
      }).catch(() => {});
    }

    return cancelled;
  }

  async rescheduleLatestForContact(
    contactId: string,
    businessId: string,
    newStart: Date,
    durationMinutes: number,
  ): Promise<Appointment | null> {
    const upcoming = await this.findUpcomingForContact(contactId, businessId);
    if (upcoming.length === 0) return null;

    const target = upcoming[0];
    const newEnd = addMinutes(newStart, durationMinutes);

    const conflicts = await this.prisma.appointment.findMany({
      where: {
        staffId: target.staffId,
        id: { not: target.id },
        status: { in: ['PENDING', 'CONFIRMED'] },
        AND: [{ startsAt: { lt: newEnd } }, { endsAt: { gt: newStart } }],
      },
    });

    if (conflicts.length > 0) {
      throw new ConflictException('El nuevo horario no está disponible.');
    }

    const updated = await this.prisma.appointment.update({
      where: { id: target.id },
      data: {
        startsAt: newStart,
        endsAt: newEnd,
        reminderSentAt: null,
        status: 'CONFIRMED',
      },
      include: { service: true, staff: true, contact: true },
    });

    // Sync: update GCal event
    const targetAny = target as any;
    if (target.staffId && targetAny.googleCalendarEventId) {
      const serviceName = (updated as any).service?.name ?? 'Turno';
      const clientName = (updated as any).contact?.name ?? (updated as any).contact?.phone ?? 'Cliente';
      this.googleCalendarService.updateEvent({
        staffId: target.staffId,
        eventId: targetAny.googleCalendarEventId,
        title: `${serviceName} — ${clientName}`,
        description: `Cliente: ${clientName}\nServicio: ${serviceName}`,
        startsAt: newStart,
        durationMinutes,
        timezone: 'America/Argentina/Buenos_Aires',
      }).catch(() => {});
    }

    // Sync: clear old Sheets cell, mark new one
    const staffName = targetAny.staff?.name;
    if (staffName) {
      this.getBusinessSheetsId(target.businessId).then((sheetsId) => {
        if (!sheetsId) return;
        this.googleSheetsService.clearSlot(sheetsId, target.startsAt, staffName).catch(() => {});
        this.googleSheetsService.markSlot(sheetsId, newStart, staffName).catch(() => {});
      }).catch(() => {});
    }

    return updated;
  }

  async listForAdmin(
    businessId: string,
    filters?: { date?: string; status?: AppointmentStatus; staffId?: string },
  ): Promise<Appointment[]> {
    const where: any = { businessId };

    if (filters?.date) {
      const day = parseISO(filters.date);
      where.startsAt = { gte: startOfDay(day), lte: endOfDay(day) };
    }
    if (filters?.status) where.status = filters.status;
    if (filters?.staffId) where.staffId = filters.staffId;

    return this.prisma.appointment.findMany({
      where,
      include: { contact: true, service: true, staff: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  async updateStatus(appointmentId: string, status: AppointmentStatus): Promise<Appointment> {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { staffId: true, googleCalendarEventId: true },
    });

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status },
    });

    // Sync: delete GCal event on cancellation
    if (status === 'CANCELLED' && appt?.staffId && appt?.googleCalendarEventId) {
      this.googleCalendarService.deleteEvent(appt.staffId, appt.googleCalendarEventId).catch(() => {});
    }

    return updated;
  }

  async findAppointmentsDueForReminder(businessId: string): Promise<any[]> {
    const now = new Date();
    const cutoff = addMinutes(now, 24 * 60);

    return this.prisma.appointment.findMany({
      where: {
        businessId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        reminderSentAt: null,
        startsAt: { gt: now, lte: cutoff },
      },
      include: { contact: true, service: true, staff: true },
    });
  }

  /**
   * Finds a staff member's appointment at a specific time on a given date.
   * Used by the staff self-service flow to identify which appointment to move/cancel.
   * @param timeStr "HH:MM" in business timezone
   * @param dateStr "YYYY-MM-DD" in business timezone (defaults to today)
   */
  async findByStaffAndTime(
    staffId: string,
    timezone: string,
    timeStr: string,
    dateStr?: string,
  ): Promise<Appointment | null> {
    const date = dateStr ?? format(toZonedTime(new Date(), timezone), 'yyyy-MM-dd', { timeZone: timezone });
    const targetStart = fromZonedTime(`${date}T${timeStr}:00`, timezone);

    // Look for appointment within a 1-minute window around the requested time
    const windowMs = 60 * 1000;
    return this.prisma.appointment.findFirst({
      where: {
        staffId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startsAt: {
          gte: new Date(targetStart.getTime() - windowMs),
          lte: new Date(targetStart.getTime() + windowMs),
        },
      },
      include: { contact: true, service: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  private async getBusinessSheetsId(businessId: string): Promise<string | null> {
    const biz = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { sheetsSpreadsheetId: true },
    });
    return biz?.sheetsSpreadsheetId ?? null;
  }

  /**
   * Returns appointments for a specific staff member for today (used by Ovapy MY_APPOINTMENTS).
   */
  async findTodayByStaff(staffId: string, timezone: string): Promise<any[]> {
    const todayStr = format(toZonedTime(new Date(), timezone), 'yyyy-MM-dd', { timeZone: timezone });
    const dayStart = fromZonedTime(`${todayStr}T00:00:00`, timezone);
    const dayEnd = endOfDay(dayStart);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        staffId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startsAt: { gte: dayStart, lte: dayEnd },
      },
      include: { contact: true, service: true },
      orderBy: { startsAt: 'asc' },
    });

    // Enrich with extra services when serviceIds has more than one entry
    return Promise.all(
      appointments.map(async (a) => {
        if (a.serviceIds && a.serviceIds.length > 1) {
          const services = await this.prisma.service.findMany({ where: { id: { in: a.serviceIds } } });
          return { ...a, resolvedServiceNames: services.map((s) => s.name) };
        }
        return a;
      }),
    );
  }
}
