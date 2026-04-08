import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Service } from '@prisma/client';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listActive(businessId: string): Promise<Service[]> {
    return this.prisma.service.findMany({
      where: { businessId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async listAll(businessId: string): Promise<Service[]> {
    return this.prisma.service.findMany({
      where: { businessId },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Fuzzy name match: exact → startsWith → includes.
   * Used to map AI-extracted service names ("corte") to actual records.
   */
  async findByName(businessId: string, name: string): Promise<Service | null> {
    const services = await this.listActive(businessId);
    const normalized = name.toLowerCase().trim();

    // Exact match (case-insensitive)
    const exact = services.find((s) => s.name.toLowerCase() === normalized);
    if (exact) return exact;

    // StartsWith match
    const startsWith = services.find((s) => s.name.toLowerCase().startsWith(normalized));
    if (startsWith) return startsWith;

    // Contains match
    const contains = services.find((s) => s.name.toLowerCase().includes(normalized));
    if (contains) return contains;

    // Reverse: does any word in the service name match the input?
    const wordMatch = services.find((s) =>
      s.name.toLowerCase().split(/[\s+]+/).some((word) => word.startsWith(normalized)),
    );

    return wordMatch ?? null;
  }

  async findById(serviceId: string): Promise<Service | null> {
    return this.prisma.service.findUnique({ where: { id: serviceId } });
  }

  async getServiceNames(businessId: string): Promise<string[]> {
    const services = await this.listActive(businessId);
    return services.map((s) => s.name);
  }

  async create(businessId: string, dto: CreateServiceDto): Promise<Service> {
    return this.prisma.service.create({
      data: { businessId, ...dto },
    });
  }

  async update(serviceId: string, dto: UpdateServiceDto): Promise<Service> {
    const service = await this.findById(serviceId);
    if (!service) throw new NotFoundException(`Service ${serviceId} not found`);

    return this.prisma.service.update({
      where: { id: serviceId },
      data: dto,
    });
  }
}
