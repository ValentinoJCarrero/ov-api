import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Branch } from '@prisma/client';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchService {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveByBusiness(businessId: string): Promise<Branch[]> {
    return this.prisma.branch.findMany({
      where: { businessId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findAllByBusiness(businessId: string): Promise<Branch[]> {
    return this.prisma.branch.findMany({
      where: { businessId },
      orderBy: { name: 'asc' },
    });
  }

  async findById(branchId: string): Promise<Branch | null> {
    return this.prisma.branch.findUnique({ where: { id: branchId } });
  }

  /** Fuzzy name match: exact → startsWith → includes */
  async findByName(businessId: string, name: string): Promise<Branch | null> {
    const branches = await this.findActiveByBusiness(businessId);
    const normalized = name.toLowerCase().trim();

    const exact = branches.find((b) => b.name.toLowerCase() === normalized);
    if (exact) return exact;

    const starts = branches.find((b) => b.name.toLowerCase().startsWith(normalized));
    if (starts) return starts;

    return branches.find((b) => b.name.toLowerCase().includes(normalized)) ?? null;
  }

  async create(businessId: string, dto: CreateBranchDto): Promise<Branch> {
    return this.prisma.branch.create({ data: { businessId, ...dto } });
  }

  async update(branchId: string, dto: UpdateBranchDto): Promise<Branch> {
    const existing = await this.findById(branchId);
    if (!existing) throw new NotFoundException(`Branch ${branchId} not found`);
    return this.prisma.branch.update({ where: { id: branchId }, data: dto });
  }
}
