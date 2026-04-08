import { Controller, Get, Post, Patch, Body, Param, Headers, UseGuards } from '@nestjs/common';
import { BranchService } from './branch.service';
import { BusinessService } from '../business/business.service';
import { AdminGuard } from '../common/guards/admin.guard';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { ApiTags, ApiOperation, ApiSecurity, ApiHeader, ApiParam } from '@nestjs/swagger';

@ApiTags('Branches')
@ApiSecurity('X-Admin-Api-Key')
@ApiHeader({ name: 'X-Business-Id', required: false, description: 'ID del negocio' })
@Controller('admin/branches')
@UseGuards(AdminGuard)
export class BranchController {
  constructor(
    private readonly branchService: BranchService,
    private readonly businessService: BusinessService,
  ) {}

  @ApiOperation({ summary: 'Listar sucursales del negocio' })
  @Get()
  async list(@Headers('x-business-id') businessId?: string) {
    const business = await this.businessService.resolveBusiness(businessId);
    return this.branchService.findAllByBusiness(business.id);
  }

  @ApiOperation({ summary: 'Crear sucursal' })
  @Post()
  async create(@Body() dto: CreateBranchDto, @Headers('x-business-id') businessId?: string) {
    const business = await this.businessService.resolveBusiness(businessId);
    return this.branchService.create(business.id, dto);
  }

  @ApiOperation({ summary: 'Actualizar sucursal' })
  @ApiParam({ name: 'id', description: 'ID de la sucursal' })
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.branchService.update(id, dto);
  }
}
