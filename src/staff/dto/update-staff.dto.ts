import { IsString, IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { StaffRole } from '@prisma/client';

export class UpdateStaffDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(StaffRole)
  @IsOptional()
  role?: StaffRole;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
