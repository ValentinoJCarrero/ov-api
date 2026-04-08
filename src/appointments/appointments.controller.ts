import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiParam, ApiQuery } from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { BusinessService } from '../business/business.service';
import { ServicesService } from '../services/services.service';
import { ContactsService } from '../contacts/contacts.service';
import { AppointmentStatus } from '@prisma/client';
import { addMinutes } from 'date-fns';

@ApiTags('Appointments')
@ApiSecurity('X-Admin-Api-Key')
@Controller('admin/appointments')
export class AppointmentsController {
  private readonly logger = new Logger(AppointmentsController.name);

  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly businessService: BusinessService,
    private readonly servicesService: ServicesService,
    private readonly contactsService: ContactsService,
  ) {}

  @ApiOperation({ summary: 'Listar turnos (filtros opcionales: date YYYY-MM-DD, status)' })
  @ApiQuery({ name: 'date', required: false, description: 'Fecha YYYY-MM-DD' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING','CONFIRMED','CANCELLED','COMPLETED'] })
  @Get()
  async listAll(
    @Query('date') date?: string,
    @Query('status') status?: AppointmentStatus,
  ) {
    const business = await this.businessService.getDefaultBusiness();
    return this.appointmentsService.listForAdmin(business.id, { date, status });
  }

  @ApiOperation({ summary: 'Crear turno manual' })
  @Post()
  async create(@Body() dto: CreateAppointmentDto) {
    const business = await this.businessService.getDefaultBusiness();

    let durationMinutes = dto.durationMinutes ?? 30;
    let serviceId = dto.serviceId;

    if (serviceId) {
      const service = await this.servicesService.findById(serviceId);
      if (service) durationMinutes = service.durationMinutes;
    }

    // Admin manual bookings use legacy (no staff assignment required)
    return this.appointmentsService.bookAppointmentLegacy({
      businessId: business.id,
      contactId: dto.contactId,
      serviceId,
      startsAt: new Date(dto.startsAt),
      durationMinutes,
      source: dto.source ?? 'MANUAL',
      notes: dto.notes,
    });
  }

  @ApiOperation({ summary: 'Cambiar estado del turno' })
  @ApiParam({ name: 'id', description: 'ID del turno' })
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: AppointmentStatus,
  ) {
    return this.appointmentsService.updateStatus(id, status);
  }

  @ApiOperation({ summary: 'Consultar slots disponibles para una fecha' })
  @ApiQuery({ name: 'date', required: true, description: 'Fecha YYYY-MM-DD' })
  @ApiQuery({ name: 'serviceId', required: false })
  @ApiQuery({ name: 'duration', required: false, description: 'Duración en minutos (si no hay serviceId)' })
  @Get('availability')
  async checkAvailability(
    @Query('date') date: string,
    @Query('serviceId') serviceId?: string,
    @Query('duration') duration?: string,
  ) {
    const business = await this.businessService.getDefaultBusiness();

    let durationMinutes = duration ? parseInt(duration) : 30;
    if (serviceId) {
      const service = await this.servicesService.findById(serviceId);
      if (service) durationMinutes = service.durationMinutes;
    }

    return this.appointmentsService.findAvailableSlots(
      business.id,
      date,
      durationMinutes,
      business.timezone,
    );
  }
}
