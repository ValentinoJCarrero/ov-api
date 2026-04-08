import { Controller, Get, Post, Body, Query, Logger } from '@nestjs/common';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { BusinessService } from '../business/business.service';
import { ApiTags, ApiOperation, ApiSecurity, ApiQuery } from '@nestjs/swagger';

@ApiTags('Sales')
@ApiSecurity('X-Admin-Api-Key')
@Controller('admin/sales')
export class SalesController {
  private readonly logger = new Logger(SalesController.name);

  constructor(
    private readonly salesService: SalesService,
    private readonly businessService: BusinessService,
  ) {}

  @ApiOperation({ summary: 'Listar ventas/ingresos (filtro opcional: date YYYY-MM-DD)' })
  @ApiQuery({ name: 'date', required: false, description: 'Fecha YYYY-MM-DD' })
  @Get()
  async listAll(@Query('date') date?: string) {
    const business = await this.businessService.getDefaultBusiness();
    return this.salesService.listForAdmin(business.id, { date });
  }

  @ApiOperation({ summary: 'Registrar venta/ingreso manual' })
  @Post()
  async create(@Body() dto: CreateSaleDto) {
    const business = await this.businessService.getDefaultBusiness();
    return this.salesService.registerSale({
      businessId: business.id,
      contactId: dto.contactId,
      description: dto.description,
      amount: dto.amount,
      source: dto.source ?? 'MANUAL',
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
    });
  }
}
