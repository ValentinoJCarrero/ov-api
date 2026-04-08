import { Controller, Get, Post, Patch, Param, Body, Headers, Logger, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { BusinessService } from '../business/business.service';
import { ApiTags, ApiOperation, ApiSecurity, ApiHeader, ApiParam } from '@nestjs/swagger';

@ApiTags('Staff')
@ApiSecurity('X-Admin-Api-Key')
@ApiHeader({ name: 'X-Business-Id', required: false, description: 'ID del negocio' })
@Controller('admin/staff')
export class StaffController {
  private readonly logger = new Logger(StaffController.name);

  constructor(
    private readonly staffService: StaffService,
    private readonly businessService: BusinessService,
  ) {}

  @ApiOperation({ summary: 'Listar profesionales del negocio' })
  @Get()
  async listAll(@Headers('x-business-id') businessId?: string) {
    const business = await this.businessService.resolveBusiness(businessId);
    return this.staffService.findAllByBusiness(business.id);
  }

  @ApiOperation({ summary: 'Crear profesional' })
  @Post()
  async create(@Body() dto: CreateStaffDto, @Headers('x-business-id') businessId?: string) {
    const business = await this.businessService.resolveBusiness(businessId);
    return this.staffService.create(business.id, dto);
  }

  @ApiOperation({ summary: 'Actualizar profesional (nombre, teléfono, rol, activo)' })
  @ApiParam({ name: 'id', description: 'ID del profesional' })
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.staffService.update(id, dto);
  }

  @ApiOperation({ summary: 'Obtener horarios del profesional' })
  @ApiParam({ name: 'id', description: 'ID del profesional' })
  @Get(':id/hours')
  async getHours(@Param('id') id: string) {
    return this.staffService.getStaffHours(id);
  }

  @ApiOperation({ summary: 'Crear o actualizar horario de un día para el profesional' })
  @ApiParam({ name: 'id', description: 'ID del profesional' })
  @Post(':id/hours')
  async upsertHours(
    @Param('id') id: string,
    @Body() body: { dayOfWeek: number; openTime: string; closeTime: string; isActive?: boolean },
    @Headers('x-business-id') businessId?: string,
  ) {
    const business = await this.businessService.resolveBusiness(businessId);
    return this.staffService.upsertStaffHours(
      id,
      business.id,
      body.dayOfWeek,
      body.openTime,
      body.closeTime,
      body.isActive ?? true,
    );
  }

  @ApiOperation({ summary: 'Establecer PIN de acceso al dashboard (solo OWNER)' })
  @ApiParam({ name: 'id', description: 'ID del staff' })
  @Patch(':id/pin')
  async setPin(@Param('id') id: string, @Body() body: { pin: string }) {
    if (!body.pin || body.pin.length < 4) throw new BadRequestException('PIN debe tener al menos 4 caracteres');
    const hashed = await bcrypt.hash(body.pin, 10);
    return this.staffService.update(id, { ownerPin: hashed } as any);
  }
}
