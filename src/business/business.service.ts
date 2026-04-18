import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { Business } from '@prisma/client';
import { google } from 'googleapis';

@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);
  // Simple in-memory cache — valid for single-tenant MVP
  private cachedBusiness: Business | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleSheetsService: GoogleSheetsService,
  ) {}

  /**
   * Returns all business records.
   */
  async listAll(): Promise<Business[]> {
    return this.prisma.business.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /**
   * Resolves business from an optional ID (from X-Business-Id header).
   * Falls back to getDefaultBusiness() if no ID provided.
   */
  async resolveBusiness(id?: string): Promise<Business> {
    if (id) {
      const biz = await this.prisma.business.findUnique({ where: { id } });
      if (!biz) throw new NotFoundException(`Business ${id} not found`);
      return biz;
    }
    return this.getDefaultBusiness();
  }

  /**
   * Returns the single business record.
   * Throws if the database hasn't been seeded yet.
   */
  async getDefaultBusiness(): Promise<Business> {
    if (this.cachedBusiness) {
      return this.cachedBusiness;
    }

    const business = await this.prisma.business.findFirst();
    if (!business) {
      throw new NotFoundException(
        'No business found in database. Run the seed script first: npm run prisma:seed',
      );
    }

    this.cachedBusiness = business;
    return business;
  }

  /**
   * Normalizes a phone number to digits-only format for comparison.
   * Strips +, spaces, dashes, parentheses.
   */
  normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  async findById(businessId: string): Promise<Business | null> {
    return this.prisma.business.findUnique({ where: { id: businessId } });
  }

  /**
   * Finds a business by the Meta phone_number_id configured for its client-facing WA number.
   * Returns null if not found (caller should fallback to getDefaultBusiness).
   */
  async findByWaPhoneNumberId(waPhoneNumberId: string): Promise<Business | null> {
    if (!waPhoneNumberId) return null;
    return this.prisma.business.findFirst({ where: { waPhoneNumberId } });
  }

  /**
   * Updates configurable WA + integration credentials for a business.
   * If sheetsSpreadsheetId is provided and the business has a Google token, auto-shares the sheet.
   */
  async updateWaConfig(
    businessId: string,
    config: { waToken?: string; waPhoneNumberId?: string; waVerifyToken?: string; waReminderTemplate?: string; sheetsSpreadsheetId?: string },
  ): Promise<Business> {
    this.invalidateCache();
    const updated = await this.prisma.business.update({
      where: { id: businessId },
      data: config,
    });

    if (config.sheetsSpreadsheetId && updated.googleAccessToken && updated.googleRefreshToken) {
      this.googleSheetsService.shareWithServiceAccount(config.sheetsSpreadsheetId, {
        accessToken: updated.googleAccessToken,
        refreshToken: updated.googleRefreshToken,
        tokenExpiry: updated.googleTokenExpiry,
      }).catch((err) => this.logger.error('Auto-share sheets failed', err?.message));
    }

    return updated;
  }

  getGoogleAuthUrl(businessId: string): string {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI?.replace('/staff/', '/business/'),
    );
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/drive'],
      state: `business:${businessId}`,
    });
  }

  async handleGoogleCallback(code: string, businessId: string): Promise<void> {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI?.replace('/staff/', '/business/'),
    );
    const { tokens } = await oauth2Client.getToken(code);
    this.invalidateCache();
    await this.prisma.business.update({
      where: { id: businessId },
      data: {
        googleAccessToken: tokens.access_token,
        googleRefreshToken: tokens.refresh_token ?? undefined,
        googleTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      },
    });
    this.logger.log(`Google Drive connected for business ${businessId}`);
  }

  /**
   * Updates basic info (name, phoneNumber, timezone) for a business.
   */
  async updateBusiness(
    businessId: string,
    data: { name?: string; phoneNumber?: string; timezone?: string },
  ): Promise<Business> {
    this.invalidateCache();
    // Avoid unique constraint error if phoneNumber wasn't actually changed
    const current = await this.prisma.business.findUnique({ where: { id: businessId } });
    const payload: typeof data = { ...data };
    if (payload.phoneNumber === current?.phoneNumber) delete payload.phoneNumber;
    return this.prisma.business.update({ where: { id: businessId }, data: payload });
  }

  /**
   * Creates a new business record.
   */
  async createBusiness(data: {
    name: string;
    phoneNumber: string;
    timezone?: string;
  }): Promise<Business> {
    return this.prisma.business.create({
      data: {
        name: data.name,
        phoneNumber: data.phoneNumber,
        timezone: data.timezone ?? 'America/Argentina/Buenos_Aires',
      },
    });
  }

  async getHours(businessId: string) {
    return this.prisma.businessHours.findMany({
      where: { businessId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async upsertHour(
    businessId: string,
    dayOfWeek: number,
    openTime: string,
    closeTime: string,
    isActive: boolean,
  ) {
    return this.prisma.businessHours.upsert({
      where: { businessId_dayOfWeek: { businessId, dayOfWeek } },
      update: { openTime, closeTime, isActive },
      create: { businessId, dayOfWeek, openTime, closeTime, isActive },
    });
  }

  getServiceAccountEmail(): string | null {
    return this.googleSheetsService.getServiceAccountEmail();
  }

  /**
   * Invalidates the in-memory cache (call after updating business data).
   */
  invalidateCache(): void {
    this.cachedBusiness = null;
  }
}
