import { IsString, IsOptional, IsDateString, IsEnum, IsInt, Min } from 'class-validator';
import { AppointmentSource } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateAppointmentDto {
  @IsString()
  contactId: string;

  @IsString()
  @IsOptional()
  serviceId?: string;

  @IsDateString()
  startsAt: string;

  // Required when no serviceId is provided, to calculate endsAt
  @IsInt()
  @Min(5)
  @IsOptional()
  @Type(() => Number)
  durationMinutes?: number;

  @IsEnum(AppointmentSource)
  @IsOptional()
  source?: AppointmentSource;

  @IsString()
  @IsOptional()
  notes?: string;
}
