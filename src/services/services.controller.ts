import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Headers,
  Logger,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { BusinessService } from '../business/business.service';
import { ApiTags, ApiOperation, ApiSecurity, ApiHeader, ApiParam } from '@nestjs/swagger';

@ApiTags('Services')
@ApiSecurity('X-Admin-Api-Key')
@ApiHeader({ name: 'X-Business-Id', required: false, description: 'ID del negocio' })
@Controller('admin/services')
export class ServicesController {
  private readonly logger = new Logger(ServicesController.name);

  constructor(
    private readonly servicesService: ServicesService,
    private readonly businessService: BusinessService,
  ) {}

  @ApiOperation({ summary: 'Listar servicios del negocio' })
  @Get()
  async listAll(@Headers('x-business-id') businessId?: string) {
    const business = await this.businessService.resolveBusiness(businessId);
    return this.servicesService.listAll(business.id);
  }

  @ApiOperation({ summary: 'Crear servicio' })
  @Post()
  async create(@Body() dto: CreateServiceDto, @Headers('x-business-id') businessId?: string) {
    const business = await this.businessService.resolveBusiness(businessId);
    return this.servicesService.create(business.id, dto);
  }

  @ApiOperation({ summary: 'Actualizar servicio (nombre, duración, precio, activo)' })
  @ApiParam({ name: 'id', description: 'ID del servicio' })
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.servicesService.update(id, dto);
  }
}
