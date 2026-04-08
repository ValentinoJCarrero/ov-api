import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Staff, StaffHours } from '@prisma/client';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findActiveByBusiness(businessId: string, branchId?: string): Promise<Staff[]> {
    const where: any = { businessId, isActive: true };
    if (branchId !== undefined) where.branchId = branchId;
    return this.prisma.staff.findMany({ where, orderBy: { name: 'asc' } });
  }

  async findAllByBusiness(businessId: string): Promise<Staff[]> {
    return this.prisma.staff.findMany({
      where: { businessId },
      include: {
        staffHours: { orderBy: { dayOfWeek: 'asc' } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findById(staffId: string): Promise<Staff | null> {
    return this.prisma.staff.findUnique({
      where: { id: staffId },
      include: { staffHours: true },
    });
  }

  /**
   * Looks up a staff member by phone within a specific business.
   * Used to detect when a staff member writes to the business's own WA number.
   */
  async findByPhoneInBusiness(businessId: string, phone: string): Promise<Staff | null> {
    const normalized = phone.replace(/\D/g, '');
    return this.prisma.staff.findFirst({
      where: { businessId, phone: normalized, isActive: true },
    });
  }

  /**
   * Looks up a staff member by phone across ALL businesses.
   * Used when someone writes to the Ovapy number — we need to identify who they are.
   */
  async findByPhoneAcrossBusinesses(phone: string): Promise<Staff | null> {
    // Normalize phone — strip non-digits
    const normalized = phone.replace(/\D/g, '');

    return this.prisma.staff.findFirst({
      where: { phone: normalized, isActive: true },
    });
  }

  /**
   * Fuzzy name match — used to resolve "Pedro" → actual Staff record.
   * Tries exact → startsWith → includes, in that order.
   */
  async findByName(businessId: string, name: string): Promise<Staff | null> {
    const staff = await this.findActiveByBusiness(businessId);
    const normalized = name.toLowerCase().trim();

    const exact = staff.find((s) => s.name.toLowerCase() === normalized);
    if (exact) return exact;

    const startsWith = staff.find((s) => s.name.toLowerCase().startsWith(normalized));
    if (startsWith) return startsWith;

    const contains = staff.find((s) => s.name.toLowerCase().includes(normalized));
    return contains ?? null;
  }

  async getActiveNames(businessId: string): Promise<string[]> {
    const staff = await this.findActiveByBusiness(businessId);
    return staff.map((s) => s.name);
  }

  async create(businessId: string, dto: CreateStaffDto): Promise<Staff> {
    const phone = dto.phone ? dto.phone.replace(/\D/g, '') : null;
    return this.prisma.staff.create({
      data: { businessId, ...dto, phone },
    });
  }

  async update(staffId: string, dto: UpdateStaffDto): Promise<Staff> {
    const existing = await this.findById(staffId);
    if (!existing) throw new NotFoundException(`Staff ${staffId} not found`);

    const data: any = { ...dto };
    if (dto.phone !== undefined) data.phone = dto.phone ? dto.phone.replace(/\D/g, '') : null;

    return this.prisma.staff.update({
      where: { id: staffId },
      data,
    });
  }

  async getStaffHours(staffId: string): Promise<StaffHours[]> {
    return this.prisma.staffHours.findMany({
      where: { staffId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async upsertStaffHours(
    staffId: string,
    businessId: string,
    dayOfWeek: number,
    openTime: string,
    closeTime: string,
    isActive = true,
  ): Promise<StaffHours> {
    return this.prisma.staffHours.upsert({
      where: { staffId_dayOfWeek: { staffId, dayOfWeek } },
      update: { openTime, closeTime, isActive },
      create: { staffId, businessId, dayOfWeek, openTime, closeTime, isActive },
    });
  }
}
