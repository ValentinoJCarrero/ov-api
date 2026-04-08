import { IsString, IsNumber, IsInt, IsBoolean, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateServiceDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsInt()
  @Min(5)
  @IsOptional()
  @Type(() => Number)
  durationMinutes?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  price?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
