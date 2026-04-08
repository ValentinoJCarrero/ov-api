import { Controller, Get, Post, Patch, Body, Headers, Logger, NotFoundException } from '@nestjs/common';
import { BusinessService } from './business.service';
import { IsString, IsOptional } from 'class-validator';
import { ApiTags, ApiOperation, ApiSecurity, ApiHeader, ApiResponse } from '@nestjs/swagger';

class UpdateWaConfigDto {
  @IsString()
  @IsOptional()
  waToken?: string;

  @IsString()
  @IsOptional()
  waPhoneNumberId?: string;

  @IsString()
  @IsOptional()
  waVerifyToken?: string;

  @IsString()
  @IsOptional()
  waReminderTemplate?: string;
}

class CreateBusinessDto {
  @IsString()
  name: string;

  @IsString()
  phoneNumber: string;

  @IsString()
  @IsOptional()
  timezone?: string;
}

class UpdateBusinessDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsString()
  @IsOptional()
  timezone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  extraInfo?: string;
}

@ApiTags('Business')
@ApiSecurity('X-Admin-Api-Key')
@ApiHeader({ name: 'X-Business-Id', required: false, description: 'ID del negocio (usa el primero si se omite)' })
@Controller('admin/business')
export class BusinessController {
  private readonly logger = new Logger(BusinessController.name);

  constructor(private readonly businessService: BusinessService) {}

  @ApiOperation({ summary: 'Listar todos los negocios' })
  @Get('all')
  async listAll() {
    return this.businessService.listAll();
  }

  @ApiOperation({ summary: 'Obtener negocio actual (según X-Business-Id o el primero)' })
  @Get()
  async getCurrent(@Headers('x-business-id') businessId?: string) {
    try {
      return await this.businessService.resolveBusiness(businessId);
    } catch (e) {
      if (e instanceof NotFoundException) return null;
      throw e;
    }
  }

  @ApiOperation({ summary: 'Crear negocio' })
  @Post()
  async create(@Body() dto: CreateBusinessDto) {
    return this.businessService.createBusiness(dto);
  }

  @ApiOperation({ summary: 'Editar nombre / teléfono / timezone' })
  @Patch()
  async update(
    @Body() dto: UpdateBusinessDto,
    @Headers('x-business-id') businessId?: string,
  ) {
    const business = await this.businessService.resolveBusiness(businessId);
    return this.businessService.updateBusiness(business.id, dto);
  }

  @ApiOperation({ summary: 'Obtener horarios del negocio' })
  @Get('hours')
  async getHours(@Headers('x-business-id') businessId?: string) {
    const business = await this.businessService.resolveBusiness(businessId);
    return this.businessService.getHours(business.id);
  }

  @ApiOperation({ summary: 'Crear o actualizar horario de un día (0=Dom … 6=Sáb)' })
  @Post('hours')
  async upsertHour(
    @Body() body: { dayOfWeek: number; openTime: string; closeTime: string; isActive: boolean },
    @Headers('x-business-id') businessId?: string,
  ) {
    const business = await this.businessService.resolveBusiness(businessId);
    return this.businessService.upsertHour(
      business.id, body.dayOfWeek, body.openTime, body.closeTime, body.isActive,
    );
  }

  @ApiOperation({ summary: 'Actualizar credenciales de WhatsApp del negocio' })
  @Patch('config')
  async updateWaConfig(
    @Body() dto: UpdateWaConfigDto,
    @Headers('x-business-id') businessId?: string,
  ) {
    const business = await this.businessService.resolveBusiness(businessId);
    return this.businessService.updateWaConfig(business.id, dto);
  }
}
