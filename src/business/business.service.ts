import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Business } from '@prisma/client';

@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);
  // Simple in-memory cache — valid for single-tenant MVP
  private cachedBusiness: Business | null = null;

  constructor(private readonly prisma: PrismaService) {}

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
   * Updates configurable WA credentials for a business (called from admin panel).
   */
  async updateWaConfig(
    businessId: string,
    config: { waToken?: string; waPhoneNumberId?: string; waVerifyToken?: string; waReminderTemplate?: string },
  ): Promise<Business> {
    this.invalidateCache();
    return this.prisma.business.update({
      where: { id: businessId },
      data: config,
    });
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

  /**
   * Invalidates the in-memory cache (call after updating business data).
   */
  invalidateCache(): void {
    this.cachedBusiness = null;
  }
}
