import { IsString, IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { StaffRole } from '@prisma/client';

export class CreateStaffDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  branchId?: string;

  @IsEnum(StaffRole)
  @IsOptional()
  role?: StaffRole;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
