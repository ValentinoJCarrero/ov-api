import { Injectable, Logger } from '@nestjs/common';
import { google, calendar_v3 } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service';
import { addMinutes } from 'date-fns';

export interface CalendarEvent {
  id: string;
  start: Date;
  end: Date;
  summary: string;
}

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────
  // OAuth2
  // ─────────────────────────────────────────────────────────────

  private createOAuthClient() {
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );
  }

  /**
   * Generates the Google OAuth2 authorization URL for a given staff member.
   * The staffId is encoded in the state param so we know who to save tokens for.
   */
  getAuthUrl(staffId: string): string {
    const oauth2Client = this.createOAuthClient();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // force refresh token even if already authorized
      scope: ['https://www.googleapis.com/auth/calendar'],
      state: staffId,
    });
  }

  /**
   * Exchanges the authorization code for tokens and persists them to DB.
   * Called from the OAuth callback route.
   */
  async handleCallback(code: string, staffId: string): Promise<void> {
    const oauth2Client = this.createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    await this.prisma.staff.update({
      where: { id: staffId },
      data: {
        googleAccessToken: tokens.access_token,
        googleRefreshToken: tokens.refresh_token ?? undefined,
        googleTokenExpiry: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : undefined,
        googleCalendarId: 'primary',
      },
    });

    this.logger.log(`Google Calendar connected for staff ${staffId}`);
  }

  /**
   * Returns an authenticated Google Calendar client for the given staff member.
   * Automatically refreshes the access token if expired.
   */
  private async getCalendarClient(staffId: string): Promise<calendar_v3.Calendar | null> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiry: true,
        googleCalendarId: true,
      },
    });

    if (!staff?.googleAccessToken || !staff?.googleRefreshToken) {
      return null;
    }

    const oauth2Client = this.createOAuthClient();
    oauth2Client.setCredentials({
      access_token: staff.googleAccessToken,
      refresh_token: staff.googleRefreshToken,
      expiry_date: staff.googleTokenExpiry?.getTime(),
    });

    // Auto-refresh: if token is expired or expires in the next 2 minutes, refresh now
    const expiresAt = staff.googleTokenExpiry?.getTime() ?? 0;
    const refreshThreshold = Date.now() + 2 * 60 * 1000;
    if (expiresAt < refreshThreshold) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        await this.prisma.staff.update({
          where: { id: staffId },
          data: {
            googleAccessToken: credentials.access_token,
            googleTokenExpiry: credentials.expiry_date
              ? new Date(credentials.expiry_date)
              : undefined,
          },
        });
        oauth2Client.setCredentials(credentials);
        this.logger.log(`Access token refreshed for staff ${staffId}`);
      } catch (err) {
        this.logger.error(`Token refresh failed for staff ${staffId}`, err?.message);
        return null;
      }
    }

    return google.calendar({ version: 'v3', auth: oauth2Client });
  }

  // ─────────────────────────────────────────────────────────────
  // Calendar operations
  // ─────────────────────────────────────────────────────────────

  /**
   * Creates a calendar event for an appointment.
   * Returns the GCal event ID (to be stored in Appointment.googleCalendarEventId).
   */
  async createEvent(params: {
    staffId: string;
    title: string;
    description: string;
    startsAt: Date;
    durationMinutes: number;
    timezone: string;
  }): Promise<string | null> {
    const calendar = await this.getCalendarClient(params.staffId);
    if (!calendar) return null;

    const staff = await this.prisma.staff.findUnique({
      where: { id: params.staffId },
      select: { googleCalendarId: true },
    });

    const endsAt = addMinutes(params.startsAt, params.durationMinutes);

    try {
      const res = await calendar.events.insert({
        calendarId: staff.googleCalendarId ?? 'primary',
        requestBody: {
          summary: params.title,
          description: params.description,
          start: { dateTime: params.startsAt.toISOString(), timeZone: params.timezone },
          end: { dateTime: endsAt.toISOString(), timeZone: params.timezone },
        },
      });

      this.logger.log(`GCal event created: ${res.data.id} for staff ${params.staffId}`);
      return res.data.id;
    } catch (err) {
      this.logger.error(`GCal createEvent failed for staff ${params.staffId}`, err?.message);
      return null;
    }
  }

  /**
   * Updates an existing calendar event (used on reschedule).
   */
  async updateEvent(params: {
    staffId: string;
    eventId: string;
    title: string;
    description: string;
    startsAt: Date;
    durationMinutes: number;
    timezone: string;
  }): Promise<void> {
    const calendar = await this.getCalendarClient(params.staffId);
    if (!calendar) return;

    const staff = await this.prisma.staff.findUnique({
      where: { id: params.staffId },
      select: { googleCalendarId: true },
    });

    const endsAt = addMinutes(params.startsAt, params.durationMinutes);

    try {
      await calendar.events.patch({
        calendarId: staff.googleCalendarId ?? 'primary',
        eventId: params.eventId,
        requestBody: {
          summary: params.title,
          description: params.description,
          start: { dateTime: params.startsAt.toISOString(), timeZone: params.timezone },
          end: { dateTime: endsAt.toISOString(), timeZone: params.timezone },
        },
      });
      this.logger.log(`GCal event updated: ${params.eventId}`);
    } catch (err) {
      this.logger.error(`GCal updateEvent failed: ${params.eventId}`, err?.message);
    }
  }

  /**
   * Deletes a calendar event (used on cancellation).
   */
  async deleteEvent(staffId: string, eventId: string): Promise<void> {
    const calendar = await this.getCalendarClient(staffId);
    if (!calendar) return;

    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { googleCalendarId: true },
    });

    try {
      await calendar.events.delete({
        calendarId: staff.googleCalendarId ?? 'primary',
        eventId,
      });
      this.logger.log(`GCal event deleted: ${eventId}`);
    } catch (err) {
      // 410 = already deleted — ignore
      if (err?.code !== 410) {
        this.logger.error(`GCal deleteEvent failed: ${eventId}`, err?.message);
      }
    }
  }

  /**
   * Returns all busy time blocks from a staff member's Google Calendar for a given date.
   * Used by the availability algorithm to exclude GCal-blocked slots.
   */
  async getBusySlots(
    staffId: string,
    date: string,
    timezone: string,
  ): Promise<Array<{ start: Date; end: Date }>> {
    const calendar = await this.getCalendarClient(staffId);
    if (!calendar) return [];

    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { googleCalendarId: true },
    });

    // Build day bounds in UTC
    const { fromZonedTime } = await import('date-fns-tz');
    const dayStart = fromZonedTime(`${date}T00:00:00`, timezone);
    const dayEnd = fromZonedTime(`${date}T23:59:59`, timezone);

    try {
      const res = await calendar.freebusy.query({
        requestBody: {
          timeMin: dayStart.toISOString(),
          timeMax: dayEnd.toISOString(),
          timeZone: timezone,
          items: [{ id: staff.googleCalendarId ?? 'primary' }],
        },
      });

      const busy = res.data.calendars?.[staff.googleCalendarId ?? 'primary']?.busy ?? [];
      return busy.map((b) => ({
        start: new Date(b.start),
        end: new Date(b.end),
      }));
    } catch (err) {
      this.logger.error(`GCal getBusySlots failed for staff ${staffId}`, err?.message);
      return [];
    }
  }

  isConnected(staff: { googleAccessToken?: string | null; googleRefreshToken?: string | null }): boolean {
    return !!(staff.googleAccessToken && staff.googleRefreshToken);
  }
}
