import { Controller, Get, Query, Param, Res, Logger, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { GoogleCalendarService } from './google-calendar.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('admin')
export class GoogleCalendarController {
  private readonly logger = new Logger(GoogleCalendarController.name);

  constructor(
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * GET /admin/staff/:id/google/connect
   * Redirects the browser to Google's OAuth2 consent page for this staff member.
   */
  @Get('staff/:id/google/connect')
  async connect(@Param('id') staffId: string, @Res() res: Response) {
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff) throw new NotFoundException('Staff not found');

    const url = this.googleCalendarService.getAuthUrl(staffId);
    res.redirect(url);
  }

  /**
   * GET /admin/google/callback
   * Google redirects here after the user grants permission.
   * Exchanges the code for tokens and saves them, then redirects back to the admin panel.
   */
  @Get('google/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') staffId: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    if (error) {
      this.logger.warn(`Google OAuth error for staff ${staffId}: ${error}`);
      return res.redirect('/admin?gcal=error');
    }

    if (!code || !staffId) {
      return res.redirect('/admin?gcal=error');
    }

    try {
      await this.googleCalendarService.handleCallback(code, staffId);
      res.redirect('/admin?gcal=connected');
    } catch (err) {
      this.logger.error(`Google OAuth callback failed for staff ${staffId}`, err?.message);
      res.redirect('/admin?gcal=error');
    }
  }

  /**
   * GET /admin/staff/:id/google/status
   * Returns connection status for a staff member.
   */
  @Get('staff/:id/google/status')
  async status(@Param('id') staffId: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true,
        googleCalendarId: true,
        googleTokenExpiry: true,
      },
    });

    if (!staff) throw new NotFoundException('Staff not found');

    return {
      connected: this.googleCalendarService.isConnected(staff),
      calendarId: staff.googleCalendarId,
      tokenExpiry: staff.googleTokenExpiry,
    };
  }
}
