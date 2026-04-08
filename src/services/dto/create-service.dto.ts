import { IsString, IsNumber, IsInt, IsBoolean, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateServiceDto {
  @IsString()
  name: string;

  @IsInt()
  @Min(5)
  @Type(() => Number)
  durationMinutes: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
