import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Sale, SaleSource } from '@prisma/client';
import { startOfDay, endOfDay, parseISO } from 'date-fns';

interface RegisterSaleParams {
  businessId: string;
  contactId?: string;
  description: string;
  amount: number;
  source: SaleSource;
  occurredAt?: Date;
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registerSale(params: RegisterSaleParams): Promise<Sale> {
    const { businessId, contactId, description, amount, source, occurredAt } = params;

    this.logger.log(`Registering sale: ${description} - $${amount} (${source})`);

    return this.prisma.sale.create({
      data: {
        businessId,
        contactId: contactId ?? null,
        description,
        amount,
        source,
        occurredAt: occurredAt ?? new Date(),
      },
    });
  }

  async listForAdmin(
    businessId: string,
    filters?: { date?: string },
  ): Promise<Sale[]> {
    const where: any = { businessId };

    if (filters?.date) {
      const day = parseISO(filters.date);
      where.occurredAt = {
        gte: startOfDay(day),
        lte: endOfDay(day),
      };
    }

    return this.prisma.sale.findMany({
      where,
      include: { contact: true },
      orderBy: { occurredAt: 'desc' },
    });
  }

  async getDailySummary(
    businessId: string,
    date: string,
  ): Promise<{ total: number; count: number; sales: Sale[] }> {
    const sales = await this.listForAdmin(businessId, { date });
    const total = sales.reduce((sum, s) => sum + s.amount, 0);
    return { total, count: sales.length, sales };
  }
}
